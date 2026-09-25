import type { Adapter } from './adapters';

export type GatewayErrorType =
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
  | 'aperture_unavailable';

const STATUS: Record<GatewayErrorType, number> = {
  aperture_unauthorized: 401,
  aperture_invalid_request: 400,
  aperture_policy_denied: 403,
  aperture_approval_required: 403,
  aperture_budget_exceeded: 402,
  aperture_no_budget: 402,
  aperture_principal_inactive: 403,
  aperture_model_unpriced: 403,
  aperture_provider_not_connected: 424,
  aperture_rate_limited: 429,
  aperture_unavailable: 503,
};

export class GatewayError extends Error {
  readonly type: GatewayErrorType;
  readonly details: Record<string, unknown>;

  constructor(type: GatewayErrorType, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'GatewayError';
    this.type = type;
    this.details = details;
  }

  get status() {
    return STATUS[this.type];
  }
}

/**
 * Errors in the caller's SDK's own shape, so OpenAI, Anthropic and Gemini clients surface our
 * message instead of failing to parse it.
 */
export function errorResponse(error: GatewayError, format: Adapter['format'], requestId: string): Response {
  const headers = { 'content-type': 'application/json', 'x-aperture-request-id': requestId };
  const body =
    format === 'anthropic'
      ? { type: 'error', error: { type: error.type, message: error.message, ...error.details } }
      : format === 'gemini'
        ? { error: { code: error.status, status: error.type, message: error.message, details: [error.details] } }
        : { error: { type: error.type, code: error.type, message: error.message, ...error.details } };
  return new Response(JSON.stringify(body), { status: error.status, headers });
}
