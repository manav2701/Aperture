import { anthropicConnector } from './providers/anthropic';
import { googleConnector } from './providers/google';
import { huggingFaceConnector } from './providers/huggingface';
import { openAiConnector } from './providers/openai';
import { openRouterConnector } from './providers/openrouter';
import type { Connector, ConnectorOptions, Provider } from './types';

export function connectorFor(provider: Provider, options: ConnectorOptions): Connector {
  switch (provider) {
    case 'openrouter':
      return openRouterConnector(options);
    case 'openai':
      return openAiConnector(options);
    case 'anthropic':
      return anthropicConnector(options);
    case 'google':
      return googleConnector(options);
    case 'huggingface':
      return huggingFaceConnector(options);
  }
}

/** What the connect wizard shows for each provider. */
export interface ProviderInfo {
  provider: Provider;
  name: string;
  secretLabel: string;
  /** Where the customer creates the secret. */
  secretUrl: string;
  steps: string[];
  /** Extra config fields the connection needs. */
  configFields: { key: string; label: string; required: boolean }[];
  /** The gateway can use this connection to forward requests. */
  gateway: boolean;
}

export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  openrouter: {
    provider: 'openrouter',
    name: 'OpenRouter',
    secretLabel: 'Management (provisioning) key',
    secretUrl: 'https://openrouter.ai/settings/provisioning-keys',
    steps: [
      'Open OpenRouter → Settings → Provisioning Keys and create a key.',
      'Paste it here. Aperture creates one OpenRouter key per person or agent with a hard limit equal to their remaining budget.',
    ],
    configFields: [],
    gateway: true,
  },
  openai: {
    provider: 'openai',
    name: 'OpenAI',
    secretLabel: 'Admin key',
    secretUrl: 'https://platform.openai.com/settings/organization/admin-keys',
    steps: [
      'You must be an organization owner. Create an Admin key under Settings → Organization → Admin keys.',
      'Enter the project Aperture should manage (proj_…). Aperture creates a service account per person or agent there.',
      'Also set a project budget in the OpenAI dashboard as a backstop.',
    ],
    configFields: [{ key: 'projectId', label: 'Project id (proj_…)', required: true }],
    gateway: true,
  },
  anthropic: {
    provider: 'anthropic',
    name: 'Anthropic',
    secretLabel: 'Admin key (sk-ant-admin…)',
    secretUrl: 'https://console.anthropic.com/settings/admin-keys',
    steps: [
      'Admin keys need an organization account. Create one under Console → Settings → Admin keys.',
      'Anthropic keys can’t be created through the API: create keys in the Console, then assign each imported key to a person or agent here.',
      'Also set a workspace spend limit in the Console as a backstop.',
    ],
    configFields: [],
    gateway: true,
  },
  google: {
    provider: 'google',
    name: 'Google Gemini',
    secretLabel: 'Gemini API key, or a service-account JSON',
    secretUrl: 'https://aistudio.google.com/apikey',
    steps: [
      'Simplest: paste a Gemini API key. The gateway can then govern Gemini calls; direct use of the key is not visible to Aperture.',
      'For enforcement on keys used directly: paste a service-account JSON with the API Keys Admin role, and point a Cloud Billing budget’s Pub/Sub push at the webhook URL shown after connecting.',
    ],
    configFields: [],
    gateway: true,
  },
  huggingface: {
    provider: 'huggingface',
    name: 'Hugging Face',
    secretLabel: 'Access token',
    secretUrl: 'https://huggingface.co/settings/tokens',
    steps: [
      'Create a fine-grained token with "Make calls to Inference Providers".',
      'Hugging Face has no usage API, so route its traffic through the Aperture gateway to govern it.',
    ],
    configFields: [],
    gateway: true,
  },
};
