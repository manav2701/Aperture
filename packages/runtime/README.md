# @aperture/runtime

Process bootstrap shared by every Aperture service, so the services don't each reimplement it.

| Export                                                       | What it does                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serviceEnvSchema(defaultPort)`, `parseEnv`, `loadEnvOrExit` | Validate environment variables with Zod at startup; empty strings count as unset; invalid config prints every problem and exits with code 1. No hardcoded fallbacks for secrets or URLs.                                   |
| `createLogger`                                               | pino JSON logger tagged with the service name, with secrets redacted (`REDACT_PATHS`: auth headers, cookies, Stripe/Slack signatures, and keys such as `password`, `secret`, `apiKey`, `token`, `privateKey`, `mnemonic`). |
| `createServiceApp`                                           | Hono app with `/healthz` and `/readyz`; readiness checks time out after 2 s, and failure details are logged, never returned.                                                                                               |
| `runService`                                                 | Starts the HTTP server and shuts down gracefully on SIGTERM/SIGINT (drains requests, runs an `onShutdown` hook, forces exit after 10 s).                                                                                   |
