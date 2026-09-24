import { serve, type ServerType } from '@hono/node-server';
import type { Logger } from './logger';

/** Anything with a Web-standard fetch handler (a Hono or OpenAPIHono app). */
export interface FetchApp {
  fetch: (request: Request) => Response | Promise<Response>;
}

export interface RunServiceOptions {
  app: FetchApp;
  port: number;
  logger: Logger;
  /** Runs after the server stops accepting connections (close DB pools, flush queues). */
  onShutdown?: () => Promise<void>;
  shutdownTimeoutMs?: number;
}

/** Starts the HTTP server and exits cleanly on SIGTERM/SIGINT, draining in-flight requests. */
export function runService({
  app,
  port,
  logger,
  onShutdown,
  shutdownTimeoutMs = 10_000,
}: RunServiceOptions): ServerType {
  const server = serve({ fetch: (request) => app.fetch(request), port }, (info) => {
    logger.info({ port: info.port }, 'listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error({ shutdownTimeoutMs }, 'forced exit: shutdown timed out');
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExit.unref();

    server.close((closeError) => {
      void (async () => {
        let exitCode = closeError ? 1 : 0;
        if (closeError) logger.error({ err: closeError }, 'server close failed');
        try {
          await onShutdown?.();
        } catch (error) {
          exitCode = 1;
          logger.error({ err: error }, 'shutdown hook failed');
        }
        process.exit(exitCode);
      })();
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}
