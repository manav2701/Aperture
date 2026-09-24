import { EntityError, LedgerError } from '@aperture/db';
import { MoneyError } from '@aperture/core';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Logger } from '@aperture/runtime';

/** An error with a stable code that clients can rely on; the message is for humans. */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details: unknown;

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'resource') => new AppError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'you do not have permission to do this') => new AppError(403, 'forbidden', message);

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export const errorBody = (code: string, message: string, details?: unknown): ErrorBody => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

const entityStatus: Record<EntityError['code'], ContentfulStatusCode> = {
  invalid_timezone: 400,
  invalid_limit: 400,
  not_found: 404,
  cross_org_reference: 400,
};

/** Maps errors to responses. Internal details are logged, never returned. */
export function handleError(error: Error, c: Context, logger: Logger): Response {
  if (error instanceof AppError) return c.json(errorBody(error.code, error.message, error.details), error.status);
  if (error instanceof EntityError) return c.json(errorBody(error.code, error.message), entityStatus[error.code]);
  if (error instanceof MoneyError) return c.json(errorBody('invalid_amount', error.message), 400);
  if (error instanceof LedgerError) return c.json(errorBody(error.code, error.message), 409);
  logger.error({ err: error, path: c.req.path, method: c.req.method }, 'unhandled error');
  return c.json(errorBody('internal_error', 'something went wrong'), 500);
}
