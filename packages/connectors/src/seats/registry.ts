import { claudeCodeSeatConnector, claudeEnterpriseSeatConnector } from './anthropic';
import { cursorSeatConnector } from './cursor';
import { githubCopilotSeatConnector } from './github';
import { m365CopilotSeatConnector } from './microsoft';
import { SEAT_PROVIDER_IDS, type SeatConnector, type SeatConnectorOptions, type SeatProvider } from './types';

export const isSeatProvider = (value: string): value is SeatProvider =>
  (SEAT_PROVIDER_IDS as readonly string[]).includes(value);

export function seatConnectorFor(provider: SeatProvider, options: SeatConnectorOptions): SeatConnector {
  switch (provider) {
    case 'seat:cursor':
      return cursorSeatConnector(options);
    case 'seat:claude_enterprise':
      return claudeEnterpriseSeatConnector(options);
    case 'seat:claude_code':
      return claudeCodeSeatConnector(options);
    case 'seat:github_copilot':
      return githubCopilotSeatConnector(options);
    case 'seat:m365_copilot':
      return m365CopilotSeatConnector(options);
  }
}

/** What the "connect seats" dialog shows for each product. */
export interface SeatProviderInfo {
  provider: SeatProvider;
  name: string;
  toolId: string;
  secretLabel: string;
  secretUrl: string;
  /** The plan that unlocks the API, for the dialog (VERIFY with the vendor). */
  requires: string;
  steps: string[];
  configFields: { key: string; label: string; required: boolean }[];
}

export const SEAT_PROVIDER_INFO: Record<SeatProvider, SeatProviderInfo> = {
  'seat:cursor': {
    provider: 'seat:cursor',
    name: 'Cursor',
    toolId: 'cursor',
    secretLabel: 'Admin API key',
    secretUrl: 'https://cursor.com/dashboard?tab=settings',
    requires: 'Cursor Teams or Enterprise; a team admin creates the key',
    steps: [
      'In the Cursor dashboard, open Settings → Advanced → Admin API keys and create a key.',
      'Paste it here. Aperture only reads members, daily usage, and spend; it never changes limits.',
    ],
    configFields: [],
  },
  'seat:claude_enterprise': {
    provider: 'seat:claude_enterprise',
    name: 'Claude Enterprise',
    toolId: 'claude',
    secretLabel: 'Analytics API key',
    secretUrl: 'https://claude.ai/admin-settings/api-access',
    requires: 'Claude Enterprise; only the primary owner can create the key',
    steps: [
      'As the primary owner, open claude.ai → Organization settings → API, turn on API access, and create an Analytics API key.',
      'Paste it here. It has the read:analytics scope only. Data appears with about a one-day delay.',
    ],
    configFields: [],
  },
  'seat:claude_code': {
    provider: 'seat:claude_code',
    name: 'Claude Code (Console organization)',
    toolId: 'claude_code',
    secretLabel: 'Admin API key (sk-ant-admin…)',
    secretUrl: 'https://platform.claude.com/settings/admin-keys',
    requires: 'A Claude Console organization (not an individual account)',
    steps: [
      'An organization admin creates an Admin API key in the Claude Console.',
      'Aperture reads the Claude Code analytics report: sessions, lines of code, and estimated cost per developer.',
    ],
    configFields: [],
  },
  'seat:github_copilot': {
    provider: 'seat:github_copilot',
    name: 'GitHub Copilot',
    toolId: 'github_copilot',
    secretLabel: 'Personal access token (classic) with read:org or manage_billing:copilot',
    secretUrl: 'https://github.com/settings/tokens',
    requires: 'Copilot Business or Enterprise on a GitHub organization',
    steps: [
      'An organization owner creates a token with read:org (or manage_billing:copilot).',
      'Enter the organization login. GitHub reports logins, not emails: link each seat to a member in Seats.',
    ],
    configFields: [{ key: 'org', label: 'Organization login', required: true }],
  },
  'seat:m365_copilot': {
    provider: 'seat:m365_copilot',
    name: 'Microsoft 365 Copilot',
    toolId: 'microsoft_copilot',
    secretLabel: 'App registration JSON: {"tenantId", "clientId", "clientSecret"}',
    secretUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps',
    requires:
      'Microsoft 365 Copilot licences; an app registration with Reports.Read.All (application) and admin consent',
    steps: [
      'Register an app in Microsoft Entra, add the Microsoft Graph application permission Reports.Read.All, and grant admin consent.',
      'Create a client secret and paste the tenant id, client id, and secret as JSON.',
      'If reports show hashed names, turn off "Display concealed user, group, and site names" in the Microsoft 365 admin center so seats can be matched to people.',
    ],
    configFields: [],
  },
};
