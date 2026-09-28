// What other services import to run the gateway in-process (the API with EMBED_GATEWAY=true).
export { buildApp as buildGatewayApp } from './app';
export { GatewayCache } from './context';
export { listenForInvalidation } from './invalidation';
export { RequestLimiter } from './limits';
export type { GatewayDeps } from './pipeline';
export { SignerUnavailable, httpSigner, type SignerClient } from './x402';
