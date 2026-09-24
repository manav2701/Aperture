import { z } from 'zod';

export const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
export type LogLevel = z.infer<typeof logLevelSchema>;

/** Variables every Aperture service reads. Services extend this with their own. */
export function serviceEnvSchema(defaultPort: number) {
  return z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: logLevelSchema.default('info'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(defaultPort),
  });
}

export class EnvError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'EnvError';
    this.issues = issues;
  }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Validates environment variables against a schema. Empty strings count as unset, so a
 * variable declared as `FOO=` in a .env file falls back to the default or fails validation
 * instead of silently becoming "".
 */
export function parseEnv<S extends z.ZodType>(schema: S, source: EnvSource = process.env): z.output<S> {
  const withoutEmpty = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = schema.safeParse(withoutEmpty);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`));
  }
  return result.data;
}

/** Like `parseEnv`, but prints the problems and exits the process — for service entrypoints. */
export function loadEnvOrExit<S extends z.ZodType>(schema: S): z.output<S> {
  try {
    return parseEnv(schema);
  } catch (error) {
    if (error instanceof EnvError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
