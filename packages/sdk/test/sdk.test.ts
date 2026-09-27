import { describe, expect, it } from 'vitest';
import {
  Aperture,
  ApertureError,
  ApprovalRequiredError,
  BudgetExceededError,
  PrincipalInactiveError,
  errorFromResponse,
  type FetchLike,
} from '../src/index';

function scripted(responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    return Promise.resolve(
      next ?? Response.json({ error: { type: 'aperture_unavailable', message: 'no more' } }, { status: 503 }),
    );
  };
  return { fetch, calls };
}

const client = (fetch: FetchLike) =>
  new Aperture({ apiKey: 'apk_test_x', baseUrl: 'https://gw.example.com/gw/', fetch });

describe('errors', () => {
  it('turns each gateway error shape into a typed error', async () => {
    const approval = await errorFromResponse(
      Response.json(
        {
          error: {
            type: 'aperture_approval_required',
            code: 'aperture_approval_required',
            message: 'ask',
            approval_id: 'a-1',
          },
        },
        { status: 403, headers: { 'x-aperture-request-id': 'r-1' } },
      ),
    );
    expect(approval).toBeInstanceOf(ApprovalRequiredError);
    expect(approval).toMatchObject({ approvalId: 'a-1', status: 403, requestId: 'r-1' });

    const anthropic = await errorFromResponse(
      Response.json(
        { type: 'error', error: { type: 'aperture_budget_exceeded', message: 'no', remaining_usd: '0.10' } },
        { status: 402 },
      ),
    );
    expect(anthropic).toBeInstanceOf(BudgetExceededError);
    expect((anthropic as BudgetExceededError).remainingUsd).toBe('0.10');

    const gemini = await errorFromResponse(
      Response.json(
        { error: { code: 403, status: 'aperture_principal_inactive', message: 'paused', details: [{}] } },
        { status: 403 },
      ),
    );
    expect(gemini).toBeInstanceOf(PrincipalInactiveError);

    const garbage = await errorFromResponse(new Response('<html>', { status: 502 }));
    expect(garbage).toBeInstanceOf(ApertureError);
    expect(garbage.type).toBe('aperture_unavailable');
  });
});

describe('client', () => {
  it('authenticates, trims the base URL, and maps snake_case', async () => {
    const { fetch, calls } = scripted([
      Response.json({ principal_id: 'p', name: 'n', api_key: 'apk_test_child', mandate: {} }, { status: 201 }),
    ]);
    const sub = await client(fetch).createSubagent({ name: 'n', purpose: 'p', budgetUsd: '0.5', maxUses: 3 });
    expect(sub.api_key).toBe('apk_test_child');
    expect(calls[0]?.url).toBe('https://gw.example.com/gw/v1/subagents');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer apk_test_x');
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      name: 'n',
      purpose: 'p',
      budget_usd: '0.5',
      max_uses: 3,
    });
  });

  it('waits for a decision, then retries with the approval id', async () => {
    const pending = { id: 'a-1', status: 'pending' };
    const { fetch, calls } = scripted([
      Response.json(
        { error: { type: 'aperture_approval_required', message: 'ask', approval_id: 'a-1' } },
        { status: 403 },
      ),
      Response.json(pending),
      Response.json(pending),
      Response.json({ ...pending, status: 'approved', approved_usd: '1.00' }),
      Response.json({ choices: [] }),
    ]);
    const aperture = client(fetch);
    const body = { model: 'openai/gpt-4o', messages: [] };
    const error = await aperture.chat(body).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApprovalRequiredError);
    const decided = await aperture.waitForApproval((error as ApprovalRequiredError).approvalId, { pollMs: 1 });
    expect(decided.status).toBe('approved');
    await aperture.chat(body, { approvalId: decided.id });
    expect(new Headers(calls.at(-1)?.init?.headers).get('x-aperture-approval')).toBe('a-1');
  });

  it('needs a key and a base URL', () => {
    expect(() => new Aperture({ apiKey: '', baseUrl: 'https://x' })).toThrow(/apiKey/);
    expect(() => new Aperture({ apiKey: 'apk_test_x', baseUrl: '' })).toThrow(/baseUrl/);
  });
});
