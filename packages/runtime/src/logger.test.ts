import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ service: 'test', level: 'info' }, stream);
  return { logger, output: () => lines.join('') };
}

describe('createLogger', () => {
  it('tags every line with the service name', () => {
    const { logger, output } = captureLogger();
    logger.info('hello');
    expect(JSON.parse(output())).toMatchObject({ service: 'test', msg: 'hello' });
  });

  it('redacts secrets at the top level, one level deep, and in headers', () => {
    const { logger, output } = captureLogger();
    logger.info(
      {
        apiKey: 'sk-top-level',
        connection: { secret: 'nested-secret', mnemonic: 'whisper worth raven' },
        req: { headers: { authorization: 'Bearer apk_live_x', 'stripe-signature': 't=1,v1=abc' } },
      },
      'request',
    );
    const text = output();
    for (const leaked of ['sk-top-level', 'nested-secret', 'whisper worth raven', 'apk_live_x', 'v1=abc']) {
      expect(text).not.toContain(leaked);
    }
    expect(text).toContain('[redacted]');
  });
});
