/**
 * The AI tool catalogue (plan/phases/phase-11 §11.4, phase-12 §12.1): vendors, how their charges
 * look on bank and card statements, which domains send their receipts, their plans, and how
 * Aperture can see them. Statement matching runs in the browser, so this is plain data with no
 * I/O. List prices are the vendors' published monthly prices as of 2026-10 and are marked
 * VERIFY in the plan: they only feed savings estimates, never the ledger.
 */

export const TOOL_CATEGORIES = [
  'chat',
  'coding',
  'image',
  'video',
  'voice',
  'writing',
  'search',
  'meetings',
  'api',
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** `seat`: a flat price per person; `usage`: pay as you go; `seat_plus_usage`: both. */
export type PricingModel = 'seat' | 'usage' | 'seat_plus_usage';

export interface ToolPlan {
  id: string;
  name: string;
  /** Published monthly price per seat in USD, as a decimal string; null when quoted per customer. */
  monthlyUsd: string | null;
  /** A team or business plan with an admin console. */
  team: boolean;
}

export interface AiTool {
  id: string;
  vendor: string;
  product: string;
  category: ToolCategory;
  pricing: PricingModel;
  /**
   * Patterns matched against a normalized statement descriptor (upper case, single spaces).
   * Kept narrow on purpose: a missed charge is a smaller problem than a false shadow-AI flag.
   */
  descriptors: readonly string[];
  /** Domains that send this vendor's receipts (From address or DKIM domain). */
  senderDomains: readonly string[];
  plans: readonly ToolPlan[];
  /**
   * Set when the charge is API billing for a provider Aperture can connect. If that provider is
   * connected, the statement row is the invoice for spend Aperture already sees (V12), not shadow AI.
   */
  apiProvider?: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'huggingface';
  /** The seat connector that can list this tool's seats, when one exists (Phase 12 §12.2). */
  seatProvider?: SeatProviderId;
  /** The terminal tool's telemetry Aperture understands (Phase 12 §12.5). */
  telemetry?: 'claude_code';
}

export const SEAT_PROVIDERS = [
  'seat:cursor',
  'seat:claude_enterprise',
  'seat:claude_code',
  'seat:github_copilot',
  'seat:m365_copilot',
] as const;
export type SeatProviderId = (typeof SEAT_PROVIDERS)[number];

const plan = (id: string, name: string, monthlyUsd: string | null, team = false): ToolPlan => ({
  id,
  name,
  monthlyUsd,
  team,
});

export const AI_TOOLS: readonly AiTool[] = [
  // Chat assistants
  {
    id: 'chatgpt',
    vendor: 'OpenAI',
    product: 'ChatGPT',
    category: 'chat',
    pricing: 'seat',
    descriptors: ['\\bCHATGPT\\b', '\\bOPENAI\\b.*\\bSUBSCR', '\\bOPENAI \\*CHAT'],
    senderDomains: ['openai.com', 'tm.openai.com', 'email.openai.com'],
    plans: [
      plan('plus', 'Plus', '20.00'),
      plan('pro', 'Pro', '200.00'),
      plan('business', 'Business', '30.00', true),
      plan('enterprise', 'Enterprise', null, true),
    ],
  },
  {
    id: 'claude',
    vendor: 'Anthropic',
    product: 'Claude',
    category: 'chat',
    pricing: 'seat',
    descriptors: [
      '\\bCLAUDE\\.AI\\b',
      '\\bCLAUDE AI\\b',
      '\\bANTHROPIC \\*CLAUDE\\b',
      '\\bANTHROPIC\\b.*\\bCLAUDE\\b.*\\bSUBSCR',
      '\\bCLAUDE (PRO|MAX|TEAM)\\b',
    ],
    senderDomains: ['anthropic.com', 'mail.anthropic.com', 'claude.ai'],
    plans: [
      plan('pro', 'Pro', '20.00'),
      plan('max_5x', 'Max 5x', '100.00'),
      plan('max_20x', 'Max 20x', '200.00'),
      plan('team', 'Team (standard seat)', '30.00', true),
      plan('team_premium', 'Team (premium seat)', '150.00', true),
      plan('enterprise', 'Enterprise', null, true),
    ],
    seatProvider: 'seat:claude_enterprise',
  },
  {
    id: 'gemini',
    vendor: 'Google',
    product: 'Gemini (Google AI plans)',
    category: 'chat',
    pricing: 'seat',
    descriptors: ['\\bGOOGLE\\b.*\\bGEMINI\\b', '\\bGOOGLE \\*GOOGLE ONE\\b.*\\bAI\\b', '\\bGOOGLE AI (PRO|ULTRA)\\b'],
    senderDomains: ['google.com'],
    plans: [
      plan('ai_pro', 'Google AI Pro', '19.99'),
      plan('ai_ultra', 'Google AI Ultra', '249.99'),
      plan('workspace', 'Gemini in Google Workspace', null, true),
    ],
  },
  {
    id: 'microsoft_copilot',
    vendor: 'Microsoft',
    product: 'Microsoft 365 Copilot',
    category: 'chat',
    pricing: 'seat',
    descriptors: ['\\bMICROSOFT\\b.*\\bCOPILOT\\b', '\\bMSFT\\b.*\\bCOPILOT\\b'],
    senderDomains: ['microsoft.com', 'email.microsoft.com'],
    plans: [plan('copilot_pro', 'Copilot Pro', '20.00'), plan('m365_copilot', 'Microsoft 365 Copilot', '30.00', true)],
    seatProvider: 'seat:m365_copilot',
  },
  {
    id: 'perplexity',
    vendor: 'Perplexity',
    product: 'Perplexity',
    category: 'search',
    pricing: 'seat',
    descriptors: ['\\bPERPLEXITY\\b'],
    senderDomains: ['perplexity.ai'],
    plans: [
      plan('pro', 'Pro', '20.00'),
      plan('max', 'Max', '200.00'),
      plan('enterprise_pro', 'Enterprise Pro', '40.00', true),
    ],
  },
  {
    id: 'mistral_le_chat',
    vendor: 'Mistral AI',
    product: 'Le Chat',
    category: 'chat',
    pricing: 'seat',
    descriptors: ['\\bLE CHAT\\b', '\\bMISTRAL\\b.*\\b(PRO|CHAT)\\b'],
    senderDomains: ['mistral.ai'],
    plans: [plan('pro', 'Pro', '14.99'), plan('team', 'Team', '24.99', true)],
  },
  {
    id: 'grok',
    vendor: 'xAI',
    product: 'Grok',
    category: 'chat',
    pricing: 'seat',
    descriptors: ['\\bSUPERGROK\\b', '\\bX\\.AI\\b', '\\bXAI\\b.*\\bGROK\\b'],
    senderDomains: ['x.ai'],
    plans: [plan('supergrok', 'SuperGrok', '30.00')],
  },
  {
    id: 'poe',
    vendor: 'Quora',
    product: 'Poe',
    category: 'chat',
    pricing: 'seat',
    descriptors: ['\\bPOE\\.COM\\b', '\\bQUORA\\b.*\\bPOE\\b'],
    senderDomains: ['poe.com', 'quora.com'],
    plans: [plan('subscription', 'Subscription', '19.99')],
  },
  {
    id: 'character_ai',
    vendor: 'Character.AI',
    product: 'c.ai+',
    category: 'chat',
    pricing: 'seat',
    descriptors: ['\\bCHARACTER\\.AI\\b', '\\bCHARACTER AI\\b'],
    senderDomains: ['character.ai'],
    plans: [plan('plus', 'c.ai+', '9.99')],
  },
  // Coding
  {
    id: 'cursor',
    vendor: 'Anysphere',
    product: 'Cursor',
    category: 'coding',
    pricing: 'seat_plus_usage',
    descriptors: ['\\bCURSOR\\b.*\\b(AI|IDE|USAGE|PRO)\\b', '\\bANYSPHERE\\b', '\\bCURSOR\\.(COM|SH)\\b'],
    senderDomains: ['cursor.com', 'cursor.sh', 'anysphere.inc'],
    plans: [
      plan('pro', 'Pro', '20.00'),
      plan('pro_plus', 'Pro+', '60.00'),
      plan('ultra', 'Ultra', '200.00'),
      plan('teams', 'Teams', '40.00', true),
    ],
    seatProvider: 'seat:cursor',
  },
  {
    id: 'github_copilot',
    vendor: 'GitHub',
    product: 'GitHub Copilot',
    category: 'coding',
    pricing: 'seat_plus_usage',
    descriptors: ['\\bGITHUB\\b.*\\bCOPILOT\\b', '\\bCOPILOT\\b.*\\bGITHUB\\b'],
    senderDomains: ['github.com'],
    plans: [
      plan('pro', 'Pro', '10.00'),
      plan('pro_plus', 'Pro+', '39.00'),
      plan('business', 'Business', '19.00', true),
      plan('enterprise', 'Enterprise', '39.00', true),
    ],
    seatProvider: 'seat:github_copilot',
  },
  {
    id: 'claude_code',
    vendor: 'Anthropic',
    product: 'Claude Code',
    category: 'coding',
    pricing: 'seat_plus_usage',
    descriptors: ['\\bCLAUDE CODE\\b'],
    senderDomains: [],
    plans: [plan('subscription', 'Included in Claude Pro / Max / Team', null), plan('api', 'API billing', null)],
    seatProvider: 'seat:claude_code',
    telemetry: 'claude_code',
  },
  {
    id: 'windsurf',
    vendor: 'Windsurf',
    product: 'Windsurf',
    category: 'coding',
    pricing: 'seat',
    descriptors: ['\\bWINDSURF\\b', '\\bCODEIUM\\b'],
    senderDomains: ['windsurf.com', 'codeium.com'],
    plans: [plan('pro', 'Pro', '15.00'), plan('teams', 'Teams', '30.00', true)],
  },
  {
    id: 'replit',
    vendor: 'Replit',
    product: 'Replit',
    category: 'coding',
    pricing: 'seat_plus_usage',
    descriptors: ['\\bREPLIT\\b'],
    senderDomains: ['replit.com'],
    plans: [plan('core', 'Core', '25.00'), plan('teams', 'Teams', '40.00', true)],
  },
  {
    id: 'lovable',
    vendor: 'Lovable',
    product: 'Lovable',
    category: 'coding',
    pricing: 'seat',
    descriptors: ['\\bLOVABLE\\b'],
    senderDomains: ['lovable.dev'],
    plans: [plan('pro', 'Pro', '25.00'), plan('business', 'Business', '50.00', true)],
  },
  {
    id: 'v0',
    vendor: 'Vercel',
    product: 'v0',
    category: 'coding',
    pricing: 'seat_plus_usage',
    descriptors: ['\\bV0\\.(DEV|APP)\\b', '\\bVERCEL\\b.*\\bV0\\b'],
    senderDomains: ['vercel.com'],
    plans: [plan('premium', 'Premium', '20.00'), plan('team', 'Team', '30.00', true)],
  },
  {
    id: 'bolt',
    vendor: 'StackBlitz',
    product: 'Bolt',
    category: 'coding',
    pricing: 'seat',
    descriptors: ['\\bBOLT\\.NEW\\b', '\\bSTACKBLITZ\\b'],
    senderDomains: ['stackblitz.com', 'bolt.new'],
    plans: [plan('pro', 'Pro', '25.00'), plan('teams', 'Teams', '30.00', true)],
  },
  {
    id: 'devin',
    vendor: 'Cognition',
    product: 'Devin',
    category: 'coding',
    pricing: 'seat_plus_usage',
    descriptors: ['\\bDEVIN\\.AI\\b', '\\bCOGNITION\\b.*\\bDEVIN\\b'],
    senderDomains: ['cognition.ai', 'devin.ai'],
    plans: [plan('core', 'Core', '20.00'), plan('team', 'Team', '500.00', true)],
  },
  {
    id: 'tabnine',
    vendor: 'Tabnine',
    product: 'Tabnine',
    category: 'coding',
    pricing: 'seat',
    descriptors: ['\\bTABNINE\\b'],
    senderDomains: ['tabnine.com'],
    plans: [plan('dev', 'Dev', '9.00'), plan('enterprise', 'Enterprise', '39.00', true)],
  },
  {
    id: 'warp',
    vendor: 'Warp',
    product: 'Warp',
    category: 'coding',
    pricing: 'seat',
    descriptors: ['\\bWARP\\.DEV\\b'],
    senderDomains: ['warp.dev'],
    plans: [plan('pro', 'Pro', '18.00'), plan('business', 'Business', '50.00', true)],
  },
  // Image and video
  {
    id: 'midjourney',
    vendor: 'Midjourney',
    product: 'Midjourney',
    category: 'image',
    pricing: 'seat',
    descriptors: ['\\bMIDJOURNEY\\b'],
    senderDomains: ['midjourney.com'],
    plans: [
      plan('basic', 'Basic', '10.00'),
      plan('standard', 'Standard', '30.00'),
      plan('pro', 'Pro', '60.00'),
      plan('mega', 'Mega', '120.00'),
    ],
  },
  {
    id: 'runway',
    vendor: 'Runway',
    product: 'Runway',
    category: 'video',
    pricing: 'seat_plus_usage',
    descriptors: ['\\bRUNWAY ?ML\\b', '\\bRUNWAYML\\b', '\\bRUNWAY AI\\b'],
    senderDomains: ['runwayml.com'],
    plans: [
      plan('standard', 'Standard', '15.00'),
      plan('pro', 'Pro', '35.00'),
      plan('unlimited', 'Unlimited', '95.00'),
    ],
  },
  {
    id: 'leonardo',
    vendor: 'Leonardo.Ai',
    product: 'Leonardo',
    category: 'image',
    pricing: 'seat',
    descriptors: ['\\bLEONARDO\\.AI\\b', '\\bLEONARDO AI\\b'],
    senderDomains: ['leonardo.ai'],
    plans: [plan('apprentice', 'Apprentice', '12.00'), plan('artisan', 'Artisan', '30.00')],
  },
  {
    id: 'ideogram',
    vendor: 'Ideogram',
    product: 'Ideogram',
    category: 'image',
    pricing: 'seat',
    descriptors: ['\\bIDEOGRAM\\b'],
    senderDomains: ['ideogram.ai'],
    plans: [plan('plus', 'Plus', '20.00'), plan('pro', 'Pro', '60.00')],
  },
  {
    id: 'krea',
    vendor: 'Krea',
    product: 'Krea',
    category: 'image',
    pricing: 'seat',
    descriptors: ['\\bKREA\\.AI\\b', '\\bKREA AI\\b'],
    senderDomains: ['krea.ai'],
    plans: [plan('basic', 'Basic', '10.00'), plan('pro', 'Pro', '35.00')],
  },
  {
    id: 'pika',
    vendor: 'Pika',
    product: 'Pika',
    category: 'video',
    pricing: 'seat',
    descriptors: ['\\bPIKA\\.ART\\b', '\\bPIKA LABS\\b'],
    senderDomains: ['pika.art'],
    plans: [plan('standard', 'Standard', '10.00'), plan('pro', 'Pro', '35.00')],
  },
  {
    id: 'luma',
    vendor: 'Luma AI',
    product: 'Dream Machine',
    category: 'video',
    pricing: 'seat',
    descriptors: ['\\bLUMA ?AI\\b', '\\bLUMALABS\\b'],
    senderDomains: ['lumalabs.ai'],
    plans: [plan('plus', 'Plus', '29.99'), plan('unlimited', 'Unlimited', '94.99')],
  },
  {
    id: 'heygen',
    vendor: 'HeyGen',
    product: 'HeyGen',
    category: 'video',
    pricing: 'seat',
    descriptors: ['\\bHEYGEN\\b'],
    senderDomains: ['heygen.com'],
    plans: [plan('creator', 'Creator', '29.00'), plan('team', 'Team', '39.00', true)],
  },
  {
    id: 'synthesia',
    vendor: 'Synthesia',
    product: 'Synthesia',
    category: 'video',
    pricing: 'seat',
    descriptors: ['\\bSYNTHESIA\\b'],
    senderDomains: ['synthesia.io'],
    plans: [plan('starter', 'Starter', '29.00'), plan('creator', 'Creator', '89.00')],
  },
  {
    id: 'descript',
    vendor: 'Descript',
    product: 'Descript',
    category: 'video',
    pricing: 'seat',
    descriptors: ['\\bDESCRIPT\\b'],
    senderDomains: ['descript.com'],
    plans: [plan('hobbyist', 'Hobbyist', '24.00'), plan('creator', 'Creator', '35.00')],
  },
  // Voice and audio
  {
    id: 'elevenlabs',
    vendor: 'ElevenLabs',
    product: 'ElevenLabs',
    category: 'voice',
    pricing: 'seat_plus_usage',
    descriptors: ['\\bELEVEN ?LABS\\b'],
    senderDomains: ['elevenlabs.io'],
    plans: [plan('starter', 'Starter', '5.00'), plan('creator', 'Creator', '22.00'), plan('pro', 'Pro', '99.00')],
  },
  {
    id: 'suno',
    vendor: 'Suno',
    product: 'Suno',
    category: 'voice',
    pricing: 'seat',
    descriptors: ['\\bSUNO\\b'],
    senderDomains: ['suno.com'],
    plans: [plan('pro', 'Pro', '10.00'), plan('premier', 'Premier', '30.00')],
  },
  // Writing, meetings, productivity
  {
    id: 'notion_ai',
    vendor: 'Notion',
    product: 'Notion AI',
    category: 'writing',
    pricing: 'seat',
    descriptors: ['\\bNOTION\\b.*\\bAI\\b'],
    senderDomains: ['makenotion.com', 'notion.so'],
    plans: [plan('business', 'Business (includes AI)', '20.00', true)],
  },
  {
    id: 'jasper',
    vendor: 'Jasper',
    product: 'Jasper',
    category: 'writing',
    pricing: 'seat',
    descriptors: ['\\bJASPER\\.AI\\b', '\\bJASPER AI\\b'],
    senderDomains: ['jasper.ai'],
    plans: [plan('creator', 'Creator', '49.00'), plan('pro', 'Pro', '69.00', true)],
  },
  {
    id: 'grammarly',
    vendor: 'Grammarly',
    product: 'Grammarly',
    category: 'writing',
    pricing: 'seat',
    descriptors: ['\\bGRAMMARLY\\b'],
    senderDomains: ['grammarly.com'],
    plans: [plan('pro', 'Pro', '12.00'), plan('enterprise', 'Enterprise', null, true)],
  },
  {
    id: 'deepl',
    vendor: 'DeepL',
    product: 'DeepL Pro',
    category: 'writing',
    pricing: 'seat',
    descriptors: ['\\bDEEPL\\b'],
    senderDomains: ['deepl.com'],
    plans: [plan('starter', 'Starter', '10.49'), plan('advanced', 'Advanced', '34.49')],
  },
  {
    id: 'gamma',
    vendor: 'Gamma',
    product: 'Gamma',
    category: 'writing',
    pricing: 'seat',
    descriptors: ['\\bGAMMA\\.APP\\b', '\\bGAMMA TECH\\b'],
    senderDomains: ['gamma.app'],
    plans: [plan('plus', 'Plus', '10.00'), plan('pro', 'Pro', '20.00')],
  },
  {
    id: 'otter',
    vendor: 'Otter.ai',
    product: 'Otter',
    category: 'meetings',
    pricing: 'seat',
    descriptors: ['\\bOTTER\\.AI\\b', '\\bOTTER AI\\b'],
    senderDomains: ['otter.ai'],
    plans: [plan('pro', 'Pro', '16.99'), plan('business', 'Business', '30.00', true)],
  },
  {
    id: 'fireflies',
    vendor: 'Fireflies.ai',
    product: 'Fireflies',
    category: 'meetings',
    pricing: 'seat',
    descriptors: ['\\bFIREFLIES\\b'],
    senderDomains: ['fireflies.ai'],
    plans: [plan('pro', 'Pro', '18.00'), plan('business', 'Business', '29.00', true)],
  },
  {
    id: 'manus',
    vendor: 'Manus',
    product: 'Manus',
    category: 'chat',
    pricing: 'seat',
    descriptors: ['\\bMANUS\\.IM\\b', '\\bMANUS AI\\b'],
    senderDomains: ['manus.im'],
    plans: [plan('starter', 'Starter', '39.00'), plan('pro', 'Pro', '199.00')],
  },
  {
    id: 'raycast',
    vendor: 'Raycast',
    product: 'Raycast Pro',
    category: 'writing',
    pricing: 'seat',
    descriptors: ['\\bRAYCAST\\b'],
    senderDomains: ['raycast.com'],
    plans: [plan('pro', 'Pro', '8.00'), plan('team', 'Team', '12.00', true)],
  },
  // API billing for providers Aperture can connect
  {
    id: 'openai_api',
    vendor: 'OpenAI',
    product: 'OpenAI API',
    category: 'api',
    pricing: 'usage',
    descriptors: ['\\bOPENAI\\b(?!.*\\b(CHATGPT|SUBSCR|CHAT)\\b)'],
    senderDomains: ['openai.com'],
    plans: [plan('api', 'API usage', null)],
    apiProvider: 'openai',
  },
  {
    id: 'anthropic_api',
    vendor: 'Anthropic',
    product: 'Claude API',
    category: 'api',
    pricing: 'usage',
    descriptors: ['\\bANTHROPIC\\b(?!.*\\b(CLAUDE|SUBSCR|PRO|MAX|TEAM)\\b)'],
    senderDomains: ['anthropic.com'],
    plans: [plan('api', 'API usage', null)],
    apiProvider: 'anthropic',
  },
  {
    id: 'google_ai_api',
    vendor: 'Google',
    product: 'Gemini API / Google Cloud AI',
    category: 'api',
    pricing: 'usage',
    descriptors: ['\\bGOOGLE \\*CLOUD\\b', '\\bGOOGLE CLOUD\\b', '\\bGOOGLE \\*AI STUDIO\\b'],
    senderDomains: ['google.com'],
    plans: [plan('api', 'API usage', null)],
    apiProvider: 'google',
  },
  {
    id: 'openrouter',
    vendor: 'OpenRouter',
    product: 'OpenRouter credits',
    category: 'api',
    pricing: 'usage',
    descriptors: ['\\bOPENROUTER\\b'],
    senderDomains: ['openrouter.ai'],
    plans: [plan('credits', 'Credits', null)],
    apiProvider: 'openrouter',
  },
  {
    id: 'huggingface',
    vendor: 'Hugging Face',
    product: 'Hugging Face',
    category: 'api',
    pricing: 'seat_plus_usage',
    descriptors: ['\\bHUGGING ?FACE\\b', '\\bHUGGINGFACE\\b'],
    senderDomains: ['huggingface.co'],
    plans: [plan('pro', 'Pro', '9.00'), plan('team', 'Team', '20.00', true)],
    apiProvider: 'huggingface',
  },
  {
    id: 'replicate',
    vendor: 'Replicate',
    product: 'Replicate',
    category: 'api',
    pricing: 'usage',
    descriptors: ['\\bREPLICATE\\b'],
    senderDomains: ['replicate.com'],
    plans: [plan('api', 'API usage', null)],
  },
  {
    id: 'fal',
    vendor: 'fal',
    product: 'fal.ai',
    category: 'api',
    pricing: 'usage',
    descriptors: ['\\bFAL\\.AI\\b', '\\bFEATURES AND LABELS\\b'],
    senderDomains: ['fal.ai'],
    plans: [plan('api', 'API usage', null)],
  },
  {
    id: 'together',
    vendor: 'Together AI',
    product: 'Together AI',
    category: 'api',
    pricing: 'usage',
    descriptors: ['\\bTOGETHER ?AI\\b', '\\bTOGETHER COMPUTER\\b'],
    senderDomains: ['together.ai'],
    plans: [plan('api', 'API usage', null)],
  },
  {
    id: 'groq',
    vendor: 'Groq',
    product: 'GroqCloud',
    category: 'api',
    pricing: 'usage',
    descriptors: ['\\bGROQ\\b'],
    senderDomains: ['groq.com'],
    plans: [plan('api', 'API usage', null)],
  },
  {
    id: 'mistral_api',
    vendor: 'Mistral AI',
    product: 'Mistral API',
    category: 'api',
    pricing: 'usage',
    descriptors: ['\\bMISTRAL ?AI\\b(?!.*\\b(LE CHAT|PRO|TEAM)\\b)'],
    senderDomains: ['mistral.ai'],
    plans: [plan('api', 'API usage', null)],
  },
];

const TOOLS_BY_ID = new Map(AI_TOOLS.map((tool) => [tool.id, tool]));
const COMPILED = AI_TOOLS.map((tool) => ({ tool, patterns: tool.descriptors.map((p) => new RegExp(p)) }));

export function toolById(id: string): AiTool | undefined {
  return TOOLS_BY_ID.get(id);
}

/** Upper case, card-processor noise (`*`, `#`, repeated spaces) folded, so patterns stay simple. */
export function normalizeDescriptor(descriptor: string): string {
  return descriptor
    .normalize('NFKC')
    .toUpperCase()
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s*\*\s*/g, ' *')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The catalogue entry a statement descriptor belongs to, or undefined. First match wins. */
export function matchDescriptor(descriptor: string): AiTool | undefined {
  const normalized = normalizeDescriptor(descriptor);
  if (normalized === '') return undefined;
  return COMPILED.find(({ patterns }) => patterns.some((pattern) => pattern.test(normalized)))?.tool;
}

/** The catalogue entry whose receipts come from `domain` (or a subdomain of a listed domain). */
export function toolsForSenderDomain(domain: string): AiTool[] {
  const host = domain.toLowerCase();
  return AI_TOOLS.filter((tool) => tool.senderDomains.some((d) => host === d || host.endsWith(`.${d}`)));
}

/** A plan's list price, or undefined when the vendor quotes it per customer. */
export function planPrice(toolId: string, planId: string): string | undefined {
  return toolById(toolId)?.plans.find((p) => p.id === planId)?.monthlyUsd ?? undefined;
}
