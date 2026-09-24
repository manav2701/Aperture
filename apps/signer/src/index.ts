import { createLogger, loadEnvOrExit, runService, serviceEnvSchema } from '@aperture/runtime';
import { buildApp } from './app';

const env = loadEnvOrExit(serviceEnvSchema(4300));
const logger = createLogger({ service: 'signer', level: env.LOG_LEVEL });

runService({ app: buildApp(logger), port: env.PORT, logger });
