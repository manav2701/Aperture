import { pino, type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './env';

/**
 * Fields that must never reach logs. Paths cover top-level keys, one level of nesting
 * (`*.x`), and HTTP headers. Extend this list rather than redacting ad hoc at call sites.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'req.headers["stripe-signature"]',
  'req.headers["x-slack-signature"]',
  ...[
    'password',
    'secret',
    'apiKey',
    'api_key',
    'token',
    'accessToken',
    'refreshToken',
    'privateKey',
    'mnemonic',
  ].flatMap((key) => [key, `*.${key}`]),
];

export interface LoggerOptions {
  service: string;
  level: LogLevel;
}

export function createLogger({ service, level }: LoggerOptions, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return destination ? pino(options, destination) : pino(options);
}

export type { Logger };
