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
    'get_agent_card',
    {
      title: 'Agent card',
      description:
        'The agent card: its declared purpose, data classes and risk tier, which policy rules apply to it, budget left, and active mandates. Read it before planning paid work.',
      annotations: { readOnlyHint: true },
    },
    () => run(() => client.card()),
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
    'create_task_card',
    {
      title: 'Ask for a single-use card',
      description:
        'Asks a person for a single-use virtual card for one purchase, capped at amount_usd and limited to one merchant category. Returns an approval id; poll check_approval until it shows the card. Aperture never returns card numbers.',
      inputSchema: {
        amount_usd: z.string().regex(/^\d+(\.\d{1,2})?$/, 'a USD amount such as "49.00"'),
        category: z
          .string()
          .regex(/^[a-z_]+$/)
          .describe('Stripe merchant category, e.g. computer_software_stores'),
        purpose: z.string().min(1).max(500),
        merchant: z.string().max(200).optional(),
      },
    },
    (input) =>
      run(() =>
        client.createTaskCard({
          amountUsd: input.amount_usd,
          category: input.category,
          purpose: input.purpose,
          ...(input.merchant === undefined ? {} : { merchant: input.merchant }),
        }),
      ),
  );

  server.registerTool(
    'pay_x402',
    {
      title: 'Call a paid (x402) API',
      description:
        'Calls a URL; if it asks for payment (HTTP 402, x402 on Solana), Aperture checks the price against this agent’s budget, policies and payee rules, pays it in USDC from the company’s budget account, and returns the response. Refused payments move no money.',
      inputSchema: {
        url: z.url(),
        method: z.enum(['GET', 'POST']).default('GET'),
        body: z.string().max(100_000).optional(),
        purpose: z.string().max(500).optional(),
      },
    },
    (input) =>
      run(async () => {
        const response = await client.x402Fetch(
          input.url,
          {
            method: input.method,
            ...(input.body === undefined ? {} : { body: input.body, headers: { 'content-type': 'application/json' } }),
          },
          input.purpose === undefined ? {} : { purpose: input.purpose },
        );
        const text = await response.text();
        return { status: response.status, body: text.length > 20_000 ? `${text.slice(0, 20_000)}…` : text };
      }),
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
