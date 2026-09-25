import type { DatabaseHandle } from '@aperture/db';
import type { Logger } from '@aperture/runtime';
import type { GatewayCache } from './context';

/**
 * Listens for `aperture_invalidate` notifications (sent by triggers on principals, policies,
 * keys, budgets, credentials and connections) and drops the org's cached entries, so policy
 * changes reach the gateway in milliseconds rather than at the 30 s TTL. Reconnects on failure.
 */
export function listenForInvalidation(
  database: DatabaseHandle,
  cache: GatewayCache,
  logger: Logger,
): () => Promise<void> {
  let stopped = false;
  let release: (() => void) | undefined;
  let retry: NodeJS.Timeout | undefined;

  const start = async () => {
    try {
      const client = await database.pool.connect();
      release = () => {
        client.release(true);
      };
      client.on('notification', (message) => {
        if (message.channel === 'aperture_invalidate' && message.payload !== undefined)
          cache.invalidate(message.payload);
      });
      client.on('error', (error) => {
        logger.warn({ err: error }, 'invalidation listener lost its connection; reconnecting');
        release?.();
        release = undefined;
        if (!stopped) retry = setTimeout(() => void start(), 2_000);
      });
      await client.query('LISTEN aperture_invalidate');
    } catch (error) {
      logger.warn({ err: error }, 'invalidation listener could not connect; retrying');
      if (!stopped) retry = setTimeout(() => void start(), 5_000);
    }
  };
  void start();

  return async () => {
    stopped = true;
    if (retry !== undefined) clearTimeout(retry);
    release?.();
    await Promise.resolve();
  };
}
