import { z } from 'zod';
import { ConnectorError, ProviderHttp } from '../http';
import type { Connector, ConnectorOptions } from '../types';

const HUGGINGFACE_BASE_URL = 'https://huggingface.co/api';
export const HUGGINGFACE_ROUTER_URL = 'https://router.huggingface.co';

const whoamiSchema = z.object({ name: z.string(), id: z.string().optional() });

/**
 * Hugging Face with an access token. There is no public usage or billing API for Inference
 * Providers, so this connection is visibility-free (T3): route HF traffic through the gateway
 * (the HF router is OpenAI-compatible) to govern it.
 */
export function huggingFaceConnector(options: ConnectorOptions): Connector {
  const http = new ProviderHttp({
    baseUrl: HUGGINGFACE_BASE_URL,
    headers: { authorization: `Bearer ${options.secret}` },
    fetch: options.fetch,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  return {
    provider: 'huggingface',
    capabilities: { createKey: false, setLimit: false, revoke: false, usage: 'none', tier: 'T3' },
    async test() {
      const result = whoamiSchema.safeParse(await http.json('GET', '/whoami-v2'));
      if (!result.success) throw new ConnectorError('invalid_response', 'unexpected Hugging Face whoami response');
      return { fingerprint: result.data.id ?? result.data.name, details: { account: result.data.name } };
    },
    listKeys: () => Promise.resolve([]),
    revoke: () =>
      Promise.reject(new ConnectorError('unsupported', 'Hugging Face tokens can’t be revoked through an API')),
  };
}
