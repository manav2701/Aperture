import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvError, parseEnv, serviceEnvSchema } from './env';

describe('parseEnv', () => {
  const schema = serviceEnvSchema(4000).extend({ DATABASE_URL: z.url() });

  it('applies defaults and coerces the port', () => {
    const env = parseEnv(schema, { DATABASE_URL: 'postgres://localhost/aperture', PORT: '4100' });
    expect(env).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      PORT: 4100,
      DATABASE_URL: 'postgres://localhost/aperture',
    });
  });

  it('treats empty strings as unset so defaults still apply', () => {
    const env = parseEnv(schema, { DATABASE_URL: 'postgres://localhost/aperture', PORT: '', LOG_LEVEL: '' });
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('reports every invalid variable by name', () => {
    const attempt = () => parseEnv(schema, { PORT: '70000', LOG_LEVEL: 'loud' });
    expect(attempt).toThrow(EnvError);
    try {
      attempt();
    } catch (error) {
      const issues = (error as EnvError).issues.join('\n');
      expect(issues).toContain('PORT');
      expect(issues).toContain('LOG_LEVEL');
      expect(issues).toContain('DATABASE_URL');
    }
  });
});
