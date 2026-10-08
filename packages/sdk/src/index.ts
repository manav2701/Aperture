/*
 * The Aperture agent SDK: a small, dependency-free client for the gateway's agent routes
 * (plan/phases/phase-07 §7.4). Model calls themselves go through any OpenAI / Anthropic / Gemini
 * SDK pointed at the gateway; this client covers what those SDKs can't: budget, estimates,
 * approvals, delegation and the kill switch — and turns Aperture's refusals into typed errors.
 */

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ApertureOptions {
  /** An `apk_…` agent key. Defaults to the APERTURE_API_KEY environment variable. */
  apiKey?: string | undefined;
  /** The gateway base URL, e.g. https://api.example.com/gw. Defaults to APERTURE_BASE_URL. */
  baseUrl?: string | undefined;
  fetch?: FetchLike | undefined;
}

// ---------------------------------------------------------------------------------------------
// Errors

export type ApertureErrorType =
  | 'aperture_unauthorized'
  | 'aperture_invalid_request'
  | 'aperture_policy_denied'
  | 'aperture_approval_required'
  | 'aperture_budget_exceeded'
  | 'aperture_no_budget'
  | 'aperture_principal_inactive'
  | 'aperture_model_unpriced'
  | 'aperture_provider_not_connected'
  | 'aperture_rate_limited'
  | 'aperture_unavailable'
  | 'upstream_error';

export class ApertureError extends Error {
  readonly type: ApertureErrorType;
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(
    type: ApertureErrorType,
    status: number,
    message: string,
    details: Record<string, unknown>,
    requestId: string | null,
  ) {
    super(message);
    this.name = 'ApertureError';
    this.type = type;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

/** Policy wants a person to approve this; wait with `waitForApproval(error.approvalId)`, then retry. */
export class ApprovalRequiredError extends ApertureError {
  readonly approvalId: string;

  constructor(status: number, message: string, details: Record<string, unknown>, requestId: string | null) {
    super('aperture_approval_required', status, message, details, requestId);
    this.name = 'ApprovalRequiredError';
    this.approvalId = typeof details.approval_id === 'string' ? details.approval_id : '';
  }
}

export class BudgetExceededError extends ApertureError {
  readonly remainingUsd: string | null;

  constructor(
    type: ApertureErrorType,
    status: number,
    message: string,
    details: Record<string, unknown>,
    requestId: string | null,
  ) {
    super(type, status, message, details, requestId);
    this.name = 'BudgetExceededError';
    this.remainingUsd = typeof details.remaining_usd === 'string' ? details.remaining_usd : null;
  }
}

export class PolicyDeniedError extends ApertureError {
  constructor(status: number, message: string, details: Record<string, unknown>, requestId: string | null) {
    super('aperture_policy_denied', status, message, details, requestId);
    this.name = 'PolicyDeniedError';
  }
}

/** This agent (or its mandate) was paused or revoked; stop working. */
export class PrincipalInactiveError extends ApertureError {
  constructor(status: number, message: string, details: Record<string, unknown>, requestId: string | null) {
    super('aperture_principal_inactive', status, message, details, requestId);
    this.name = 'PrincipalInactiveError';
  }
}

const KNOWN_TYPES = new Set<string>([
  'aperture_unauthorized',
  'aperture_invalid_request',
  'aperture_policy_denied',
  'aperture_approval_required',
  'aperture_budget_exceeded',
  'aperture_no_budget',
  'aperture_principal_inactive',
  'aperture_model_unpriced',
  'aperture_provider_not_connected',
  'aperture_rate_limited',
  'aperture_unavailable',
  'upstream_error',
]);

/** Reads an error in any of the gateway's shapes (OpenAI, Anthropic, Gemini). */
export async function errorFromResponse(response: Response): Promise<ApertureError> {
  const requestId = response.headers.get('x-aperture-request-id');
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // Not JSON: fall through with an empty payload.
  }
  const inner = (typeof payload.error === 'object' && payload.error !== null ? payload.error : {}) as Record<
    string,
    unknown
  >;
  const gemini = Array.isArray(inner.details) ? ((inner.details[0] ?? {}) as Record<string, unknown>) : {};
  const rawType = typeof inner.type === 'string' ? inner.type : typeof inner.status === 'string' ? inner.status : '';
  const type = (
    KNOWN_TYPES.has(rawType) ? rawType : response.status >= 500 ? 'aperture_unavailable' : 'aperture_invalid_request'
  ) as ApertureErrorType;
  const message = typeof inner.message === 'string' ? inner.message : `Aperture answered ${String(response.status)}`;
  const { type: _type, code: _code, message: _message, status: _status, details: _details, ...rest } = inner;
  const details = { ...gemini, ...rest };
  switch (type) {
    case 'aperture_approval_required':
      return new ApprovalRequiredError(response.status, message, details, requestId);
    case 'aperture_budget_exceeded':
    case 'aperture_no_budget':
      return new BudgetExceededError(type, response.status, message, details, requestId);
    case 'aperture_policy_denied':
      return new PolicyDeniedError(response.status, message, details, requestId);
    case 'aperture_principal_inactive':
      return new PrincipalInactiveError(response.status, message, details, requestId);
    default:
      return new ApertureError(type, response.status, message, details, requestId);
  }
}

// ---------------------------------------------------------------------------------------------
// Shapes returned by the gateway

export interface Mandate {
  id: string;
  parent_id: string | null;
  purpose: string;
  scope: Record<string, unknown>;
  uses: number;
  max_uses: number | null;
  not_before: string;
  expires_at: string;
  remaining_usd: string | null;
  jws: string;
}

export interface Me {
  org_id: string;
  principal: {
    id: string;
    name: string | null;
    kind: string | null;
    status: string | null;
    parent_principal_id: string | null;
  };
  budget: { name: string | null; remaining_usd: string | null };
  mandate: Mandate | null;
}

/** This agent's own card (Phase 11 §11.7): what it declared, what governs it, and what it can still spend. */
export interface AgentCard {
  id: string;
  name: string;
  status: string;
  purpose: string | null;
  data_classes: string[];
  risk_tier: string | null;
  budget: { name: string | null; remaining_usd: string | null };
  rules: { level: string; type: string }[];
  mandates: { id: string; purpose: string; expires_at: string }[];
  live_keys: number;
}

export interface Model {
  id: string;
  provider: string;
  input_usd_per_mtok: string;
  output_usd_per_mtok: string;
  needs_approval: boolean;
}

export interface Estimate {
  allowed: boolean;
  outcome: string;
  reasons: { code: string; message: string }[];
  estimate_usd: string | null;
  remaining_usd?: string | null;
  remaining_after_usd?: string | null;
  budget?: string | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'used';

export interface Approval {
  id: string;
  status: ApprovalStatus;
  rail: string;
  resource: string;
  amount_usd: string;
  approved_usd: string | null;
  purpose: string;
  note: string | null;
  expires_at: string;
  decided_at: string | null;
  /** Card approvals: the single-use card once issued (its number is never returned by Aperture). */
  card?: { id: string; last4: string | null; status: string; expires_at: string | null } | null;
}

export interface SubagentInput {
  name: string;
  purpose: string;
  budgetUsd: string;
  period?: 'hour' | 'day' | 'week' | 'month' | 'none';
  models?: string[];
  providers?: string[];
  maxPerActionUsd?: string;
  maxUses?: number;
  expiresInSeconds?: number;
}

export interface Subagent {
  principal_id: string;
  name: string;
  /** Shown once; hand it to the sub-agent. */
  api_key: string;
  mandate: Mandate;
}

// ---------------------------------------------------------------------------------------------
// Client

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export class Aperture {
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: FetchLike;

  constructor(options: ApertureOptions = {}) {
    const apiKey = options.apiKey ?? process.env.APERTURE_API_KEY;
    const baseUrl = options.baseUrl ?? process.env.APERTURE_BASE_URL;
    if (apiKey === undefined || apiKey === '') throw new Error('Aperture: pass apiKey or set APERTURE_API_KEY');
    if (baseUrl === undefined || baseUrl === '') throw new Error('Aperture: pass baseUrl or set APERTURE_BASE_URL');
    this.#apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async #call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const response = await this.#fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw await errorFromResponse(response);
    return (await response.json()) as T;
  }

  /** Who this key is, what it has left, and the mandate it acts under. */
  me(): Promise<Me> {
    return this.#call('GET', '/v1/me');
  }

  /** This agent's card: declared purpose and risk tier, the rules that apply, budget left, and mandates. */
  card(): Promise<AgentCard> {
    return this.#call('GET', '/v1/card');
  }

  /** Models this agent may use right now, with prices; `needs_approval` ones go to a person first. */
  async models(): Promise<Model[]> {
    return (await this.#call<{ data: Model[] }>('GET', '/v1/models')).data;
  }

  /** What a call would cost at most, and whether policy and budget would allow it — without spending. */
  estimate(input: {
    type: 'chat' | 'image' | 'video';
    model: string;
    prompt?: string;
    maxTokens?: number;
    n?: number;
    seconds?: number;
    resolution?: string;
    quality?: string;
    audio?: boolean;
  }): Promise<Estimate> {
    const { maxTokens, ...rest } = input;
    return this.#call('POST', '/v1/estimate', {
      ...rest,
      ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
    });
  }

  /** Asks a person ahead of time. `provider` is `openrouter` for `vendor/model` ids. */
  requestApproval(input: { provider: string; model: string; amountUsd: string; purpose: string }): Promise<Approval> {
    return this.#call('POST', '/v1/approvals', {
      provider: input.provider,
      model: input.model,
      amount_usd: input.amountUsd,
      purpose: input.purpose,
    });
  }

  getApproval(approvalId: string): Promise<Approval> {
    return this.#call('GET', `/v1/approvals/${encodeURIComponent(approvalId)}`);
  }

  /**
   * Polls until a person decides. Resolves with the approval (approved, denied or expired);
   * pass its id as `approvalId` on the retry. Gives up after `timeoutMs` (default 15 minutes).
   */
  async waitForApproval(approvalId: string, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<Approval> {
    const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
    let approval = await this.getApproval(approvalId);
    while (approval.status === 'pending' && Date.now() < deadline) {
      await sleep(options.pollMs ?? 5_000);
      approval = await this.getApproval(approvalId);
    }
    return approval;
  }

  /** Delegates a slice of this agent's mandate to a new sub-agent with its own key. */
  createSubagent(input: SubagentInput): Promise<Subagent> {
    return this.#call('POST', '/v1/subagents', {
      name: input.name,
      purpose: input.purpose,
      budget_usd: input.budgetUsd,
      ...(input.period === undefined ? {} : { period: input.period }),
      ...(input.models === undefined ? {} : { models: input.models }),
      ...(input.providers === undefined ? {} : { providers: input.providers }),
      ...(input.maxPerActionUsd === undefined ? {} : { max_per_action_usd: input.maxPerActionUsd }),
      ...(input.maxUses === undefined ? {} : { max_uses: input.maxUses }),
      ...(input.expiresInSeconds === undefined ? {} : { expires_in_seconds: input.expiresInSeconds }),
    });
  }

  /**
   * Asks for a single-use card for one purchase. A person approves it (possibly for less); then
   * `waitForApproval(id)` returns the approval with `card`. Card details come from the org's own
   * Stripe account, never from Aperture.
   */
  createTaskCard(input: {
    amountUsd: string;
    category: string;
    purpose: string;
    merchant?: string;
  }): Promise<Approval> {
    return this.#call('POST', '/v1/cards/task', {
      amount_usd: input.amountUsd,
      category: input.category,
      purpose: input.purpose,
      ...(input.merchant === undefined ? {} : { merchant: input.merchant }),
    });
  }

  /**
   * `fetch` that pays x402 (plan/phases/phase-09 §9.5): on a 402 it asks Aperture to authorize
   * the seller's price (policy, budget, payee binding, on-chain allowance), retries with the
   * signed PAYMENT-SIGNATURE, and reports whether the paid resource was delivered. Refusals
   * throw the usual typed errors; no refusal ever moves money.
   */
  async x402Fetch(url: string, init: RequestInit = {}, options: { purpose?: string } = {}): Promise<Response> {
    const first = await this.#fetch(url, init);
    if (first.status !== 402) return first;
    const header = first.headers.get('payment-required');
    const paymentRequired: unknown = header ?? (await first.json().catch(() => null));
    const authorized = await this.#call<{ payment_id: string; payment_signature: string }>(
      'POST',
      '/v1/x402/authorize',
      {
        url,
        paymentRequired,
        ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
      },
    );
    const headers = new Headers(init.headers);
    headers.set('PAYMENT-SIGNATURE', authorized.payment_signature);
    const paid = await this.#fetch(url, { ...init, headers });
    await this.#call('POST', `/v1/x402/payments/${authorized.payment_id}/delivered`, { status: paid.status }).catch(
      () => undefined,
    );
    return paid;
  }

  /** The agent's own kill switch. A person has to resume it. */
  async pauseSelf(): Promise<void> {
    await this.#call('POST', '/v1/me/pause');
  }

  /**
   * An OpenAI-format chat completion through the gateway (non-streaming), for agents that don't
   * use another SDK. `approvalId` retries a request a person approved.
   */
  chat<T = Record<string, unknown>>(
    body: Record<string, unknown>,
    options: { approvalId?: string; purpose?: string } = {},
  ): Promise<T> {
    return this.#call('POST', '/v1/chat/completions', body, {
      ...(options.approvalId === undefined ? {} : { 'x-aperture-approval': options.approvalId }),
      ...(options.purpose === undefined ? {} : { 'x-aperture-purpose': options.purpose }),
    });
  }
}
