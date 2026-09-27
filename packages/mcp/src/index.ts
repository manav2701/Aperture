import { Aperture, ApertureError, ApprovalRequiredError, type ApertureOptions } from '@aperture/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/*
 * Aperture as MCP tools (plan/phases/phase-07 §7.5): an agent in any MCP host can check its
 * budget, price a call before making it, ask a person for approval, delegate to a sub-agent,
 * and stop itself. Every tool is a thin call to the gateway's agent routes with the agent's own
 * key — the server holds no authority of its own.
 */

type ToolResult = CallToolResult;

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

/** Refusals are results the model should read and act on, not protocol failures. */
function refusal(error: unknown): ToolResult {
  if (error instanceof ApprovalRequiredError) {
    return {
      content: [
        {
          type: 'text',
          text: `${error.message}\nApproval id: ${error.approvalId}. Call check_approval with it until a person decides.`,
        },
      ],
      isError: true,
    };
  }
  if (error instanceof ApertureError) {
    return { content: [{ type: 'text', text: `${error.type}: ${error.message}` }], isError: true };
  }
  throw error;
}

async function run(call: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await call());
  } catch (error) {
    return refusal(error);
  }
}

const usd = z.string().regex(/^\d+(\.\d{1,6})?$/, 'a USD amount such as "0.25"');

export function createApertureMcpServer(client: Aperture): McpServer {
  const server = new McpServer({ name: 'aperture', version: '0.7.0' });

  server.registerTool(
    'get_budget',
    {
      title: 'Budget and mandate',
      description: 'What this agent may still spend, the budget that limits it, and the mandate it acts under.',
      annotations: { readOnlyHint: true },
    },
    () => run(() => client.me()),
  );

  server.registerTool(
    'list_allowed_models',
    {
      title: 'Allowed models',
      description:
        'Models this agent may use now, with USD prices per million tokens. needs_approval=true means a person must approve first.',
      annotations: { readOnlyHint: true },
    },
    () => run(() => client.models()),
  );

  server.registerTool(
    'estimate_cost',
    {
      title: 'Estimate a call',
      description:
        'The most a chat, image or video call could cost, and whether policy and budget would allow it. Spends nothing.',
      inputSchema: {
        type: z.enum(['chat', 'image', 'video']),
        model: z.string().min(1),
        prompt: z.string().optional(),
        max_tokens: z.number().int().positive().optional(),
        n: z.number().int().positive().optional(),
        seconds: z.number().int().positive().optional(),
        resolution: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (input) =>
      run(() =>
        client.estimate({
          type: input.type,
          model: input.model,
          ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
          ...(input.max_tokens === undefined ? {} : { maxTokens: input.max_tokens }),
          ...(input.n === undefined ? {} : { n: input.n }),
          ...(input.seconds === undefined ? {} : { seconds: input.seconds }),
          ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
        }),
      ),
  );

  server.registerTool(
    'request_approval',
    {
      title: 'Ask a person',
      description:
        'Asks an approver to allow spending up to amount_usd on one model call. Returns an approval id; poll check_approval, then retry the call with header x-aperture-approval.',
      inputSchema: {
        provider: z.string().min(1).describe('openrouter for vendor/model ids, else openai, anthropic, google'),
        model: z.string().min(1),
        amount_usd: usd,
        purpose: z.string().min(1).max(500).describe('Why this is needed, in one sentence a person can judge'),
      },
    },
    (input) =>
      run(() =>
        client.requestApproval({
          provider: input.provider,
          model: input.model,
          amountUsd: input.amount_usd,
          purpose: input.purpose,
        }),
      ),
  );

  server.registerTool(
    'check_approval',
    {
      title: 'Check an approval',
      description:
        'Status of an approval request: pending, approved (with the approved amount), denied, expired or used.',
      inputSchema: { approval_id: z.uuid() },
      annotations: { readOnlyHint: true },
    },
    (input) => run(() => client.getApproval(input.approval_id)),
  );

  server.registerTool(
    'create_subagent',
    {
      title: 'Delegate to a sub-agent',
      description:
        'Creates a sub-agent with its own key and a mandate carved out of this agent’s: a smaller budget, optionally fewer models. Returns the key once.',
      inputSchema: {
        name: z.string().min(1).max(100),
        purpose: z.string().min(1).max(500),
        budget_usd: usd,
        period: z.enum(['hour', 'day', 'week', 'month', 'none']).optional(),
        models: z.array(z.string()).optional(),
        max_uses: z.number().int().positive().optional(),
        expires_in_seconds: z.number().int().min(60).optional(),
      },
    },
    (input) =>
      run(() =>
        client.createSubagent({
          name: input.name,
          purpose: input.purpose,
          budgetUsd: input.budget_usd,
          ...(input.period === undefined ? {} : { period: input.period }),
          ...(input.models === undefined ? {} : { models: input.models }),
          ...(input.max_uses === undefined ? {} : { maxUses: input.max_uses }),
          ...(input.expires_in_seconds === undefined ? {} : { expiresInSeconds: input.expires_in_seconds }),
        }),
      ),
  );

  server.registerTool(
    'pause_self',
    {
      title: 'Stop this agent',
      description:
        'Pauses this agent at once: every further paid call is refused until a person resumes it. Use when something looks wrong.',
      annotations: { destructiveHint: true },
    },
    () =>
      run(async () => {
        await client.pauseSelf();
        return { status: 'paused' };
      }),
  );

  return server;
}

/**
 * Streamable HTTP, stateless (no session id generator): each request carries the agent's own key as a bearer token, so
 * one deployment can serve many agents. Mount it at e.g. `/mcp` on a web-standard server.
 */
export async function handleMcpHttp(
  request: Request,
  options: Omit<ApertureOptions, 'apiKey'> = {},
): Promise<Response> {
  const bearer = request.headers.get('authorization');
  const apiKey = bearer?.toLowerCase().startsWith('bearer ') === true ? bearer.slice(7).trim() : '';
  if (apiKey === '') {
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32001, message: 'send your Aperture agent key as a bearer token' }, id: null },
      { status: 401 },
    );
  }
  const server = createApertureMcpServer(new Aperture({ ...options, apiKey }));
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
