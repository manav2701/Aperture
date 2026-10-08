import { Aperture, type FetchLike } from '@aperture/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createApertureMcpServer, handleMcpHttp } from '../src/index';

function fakeGateway(routes: Record<string, (init: RequestInit | undefined) => Response>) {
  const calls: string[] = [];
  const fetch: FetchLike = (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    calls.push(key);
    const route = routes[key];
    return Promise.resolve(
      route
        ? route(init)
        : Response.json({ error: { type: 'aperture_invalid_request', message: 'no route' } }, { status: 404 }),
    );
  };
  return { fetch, calls };
}

async function connected(fetch: FetchLike) {
  const server = createApertureMcpServer(new Aperture({ apiKey: 'apk_test_x', baseUrl: 'https://gw.test', fetch }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  return client;
}

const text = (result: unknown) => (result as { content: { text: string }[] }).content[0]?.text ?? '';

describe('Aperture MCP tools', () => {
  it('lists the ten tools', async () => {
    const client = await connected(fakeGateway({}).fetch);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'check_approval',
      'create_subagent',
      'create_task_card',
      'estimate_cost',
      'get_agent_card',
      'get_budget',
      'list_allowed_models',
      'pause_self',
      'pay_x402',
      'request_approval',
    ]);
  });

  it('calls the gateway with the agent’s key and returns its answer', async () => {
    const gateway = fakeGateway({
      'GET /v1/me': () => Response.json({ budget: { remaining_usd: '4.20' } }),
      'POST /v1/estimate': (init) => {
        expect(JSON.parse(init?.body as string)).toMatchObject({
          type: 'chat',
          model: 'openai/gpt-4o-mini',
          max_tokens: 100,
        });
        return Response.json({ allowed: true, estimate_usd: '0.0001' });
      },
    });
    const client = await connected(gateway.fetch);
    expect(text(await client.callTool({ name: 'get_budget', arguments: {} }))).toContain('4.20');
    const estimate = await client.callTool({
      name: 'estimate_cost',
      arguments: { type: 'chat', model: 'openai/gpt-4o-mini', max_tokens: 100 },
    });
    expect(text(estimate)).toContain('"allowed": true');
  });

  it('reads the agent card from the gateway', async () => {
    const client = await connected(
      fakeGateway({ 'GET /v1/card': () => Response.json({ name: 'research-bot', risk_tier: 'high' }) }).fetch,
    );
    expect(text(await client.callTool({ name: 'get_agent_card', arguments: {} }))).toContain('"risk_tier": "high"');
  });

  it('turns refusals into tool errors the model can act on', async () => {
    const client = await connected(
      fakeGateway({
        'POST /v1/me/pause': () =>
          Response.json(
            { error: { type: 'aperture_approval_required', message: 'ask first', approval_id: 'ap-1' } },
            { status: 403 },
          ),
      }).fetch,
    );
    const result = await client.callTool({ name: 'pause_self', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Approval id: ap-1');
  });

  it('serves Streamable HTTP per request with the caller’s own key', async () => {
    const unauthenticated = await handleMcpHttp(new Request('https://mcp.test/mcp', { method: 'POST', body: '{}' }));
    expect(unauthenticated.status).toBe(401);
    const response = await handleMcpHttp(
      new Request('https://mcp.test/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer apk_test_x',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
        }),
      }),
      { baseUrl: 'https://gw.test', fetch: fakeGateway({}).fetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { serverInfo: { name: 'aperture' } } });
  });
});
