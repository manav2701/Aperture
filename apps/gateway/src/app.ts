import { createServiceApp, type Logger } from '@aperture/runtime';

export function buildApp(logger: Logger) {
  return createServiceApp({ service: 'gateway', logger });
}
