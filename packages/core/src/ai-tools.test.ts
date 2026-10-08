import { describe, expect, it } from 'vitest';
import { AI_TOOLS, matchDescriptor, normalizeDescriptor, planPrice, toolById, toolsForSenderDomain } from './ai-tools';

/**
 * Labelled statement descriptors in the shapes card processors print them (Visa/Mastercard
 * merchant names, often truncated, with `*` separators). `null` means "not an AI tool".
 * VERIFY: re-measure against the design partner's redacted statements (plan §11.4).
 */
const LABELLED: [string, string | null][] = [
  ['OPENAI *CHATGPT SUBSCR', 'chatgpt'],
  ['OPENAI *CHATGPT SUBSCR SAN FRANCISCO US', 'chatgpt'],
  ['CHATGPT PLUS', 'chatgpt'],
  ['OpenAI ChatGPT Team', 'chatgpt'],
  ['OPENAI', 'openai_api'],
  ['OPENAI LLC 415-555 CA', 'openai_api'],
  ['OPENAI *API', 'openai_api'],
  ['CLAUDE.AI SUBSCRIPTION', 'claude'],
  ['Claude.ai Subscription Anthropic', 'claude'],
  ['ANTHROPIC *CLAUDE', 'claude'],
  ['CLAUDE TEAM', 'claude'],
  ['ANTHROPIC', 'anthropic_api'],
  ['ANTHROPIC, PBC', 'anthropic_api'],
  ['CURSOR, AI POWERED IDE', 'cursor'],
  ['CURSOR USAGE MID SEP', 'cursor'],
  ['ANYSPHERE INC', 'cursor'],
  ['GITHUB *COPILOT', 'github_copilot'],
  ['GITHUB, INC. COPILOT BUSINESS', 'github_copilot'],
  ['MIDJOURNEY INC.', 'midjourney'],
  ['PERPLEXITY.AI', 'perplexity'],
  ['PERPLEXITY AI INC', 'perplexity'],
  ['ELEVENLABS.IO', 'elevenlabs'],
  ['ELEVEN LABS', 'elevenlabs'],
  ['RUNWAYML.COM', 'runway'],
  ['RUNWAY AI, INC.', 'runway'],
  ['NOTION LABS AI ADD-ON', 'notion_ai'],
  ['MSFT * COPILOT PRO', 'microsoft_copilot'],
  ['MICROSOFT*COPILOT 365', 'microsoft_copilot'],
  ['GOOGLE *GEMINI', 'gemini'],
  ['GOOGLE *GOOGLE ONE AI PREMIUM', 'gemini'],
  ['GOOGLE *CLOUD 4F2K9', 'google_ai_api'],
  ['OPENROUTER, INC', 'openrouter'],
  ['HUGGINGFACE', 'huggingface'],
  ['HUGGING FACE INC.', 'huggingface'],
  ['REPLICATE', 'replicate'],
  ['FAL.AI', 'fal'],
  ['TOGETHER AI', 'together'],
  ['GROQ INC', 'groq'],
  ['MISTRAL AI', 'mistral_api'],
  ['LE CHAT PRO MISTRAL', 'mistral_le_chat'],
  ['SUPERGROK', 'grok'],
  ['WINDSURF', 'windsurf'],
  ['REPLIT, INC.', 'replit'],
  ['LOVABLE.DEV', 'lovable'],
  ['V0.DEV', 'v0'],
  ['BOLT.NEW', 'bolt'],
  ['SUNO INC', 'suno'],
  ['JASPER.AI', 'jasper'],
  ['GRAMMARLY', 'grammarly'],
  ['DEEPL SE', 'deepl'],
  ['OTTER.AI', 'otter'],
  ['FIREFLIES.AI', 'fireflies'],
  ['HEYGEN TECHNOLOGY', 'heygen'],
  ['SYNTHESIA LIMITED', 'synthesia'],
  ['IDEOGRAM AI', 'ideogram'],
  ['LEONARDO.AI', 'leonardo'],
  ['CHARACTER.AI', 'character_ai'],
  // Look-alikes that must not be flagged.
  ['OPENTABLE', null],
  ['OPEN AIR CINEMA DUBAI', null],
  ['CARREFOUR MOE', null],
  ['CAREEM RIDE', null],
  ['TALABAT', null],
  ['AMAZON.AE', null],
  ['NOON.COM', null],
  ['GITHUB', null],
  ['GITHUB, INC.', null],
  ['GOOGLE *YOUTUBE PREMIUM', null],
  ['GOOGLE *GOOGLE ONE', null],
  ['MICROSOFT*365 BUSINESS', null],
  ['MSFT * AZURE', null],
  ['NOTION LABS', null],
  ['CURSORY CAFE', null],
  ['RUNWAY FASHION LLC', null],
  ['APPLE.COM/BILL', null],
  ['NETFLIX.COM', null],
  ['SPOTIFY', null],
  ['ADNOC', null],
  ['ETISALAT', null],
  ['DEWA', null],
  ['SALIK', null],
  ['CLAUDETTE BEAUTY SALON', null],
  ['ANTHROPOLOGIE', null],
  ['', null],
];

describe('matchDescriptor', () => {
  it('reaches the precision and recall targets on the labelled descriptors', () => {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    const misses: string[] = [];
    for (const [descriptor, expected] of LABELLED) {
      const actual = matchDescriptor(descriptor)?.id ?? null;
      if (actual === expected && actual !== null) truePositive += 1;
      else if (actual !== null && actual !== expected) {
        falsePositive += 1;
        misses.push(`${descriptor} → ${actual} (expected ${String(expected)})`);
      } else if (actual === null && expected !== null) {
        falseNegative += 1;
        misses.push(`${descriptor} → missed (expected ${expected})`);
      }
    }
    const precision = truePositive / (truePositive + falsePositive);
    const recall = truePositive / (truePositive + falseNegative);
    expect(misses).toEqual([]);
    expect(precision).toBeGreaterThanOrEqual(0.98);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  it('separates subscriptions from API billing for the same vendor', () => {
    expect(matchDescriptor('OPENAI *CHATGPT SUBSCR')?.apiProvider).toBeUndefined();
    expect(matchDescriptor('OPENAI')?.apiProvider).toBe('openai');
    expect(matchDescriptor('CLAUDE.AI SUBSCRIPTION')?.apiProvider).toBeUndefined();
    expect(matchDescriptor('ANTHROPIC')?.apiProvider).toBe('anthropic');
  });

  it('normalizes processor noise', () => {
    expect(normalizeDescriptor('  openai*chatgpt   subscr\t')).toBe('OPENAI *CHATGPT SUBSCR');
  });
});

describe('the catalogue', () => {
  it('has unique ids, valid patterns, and decimal prices', () => {
    expect(new Set(AI_TOOLS.map((t) => t.id)).size).toBe(AI_TOOLS.length);
    expect(AI_TOOLS.length).toBeGreaterThanOrEqual(45);
    for (const tool of AI_TOOLS) {
      for (const pattern of tool.descriptors) expect(() => new RegExp(pattern)).not.toThrow();
      for (const p of tool.plans) {
        if (p.monthlyUsd !== null) expect(p.monthlyUsd, `${tool.id}/${p.id}`).toMatch(/^\d+\.\d{2}$/);
      }
    }
  });

  it('finds tools by receipt sender domain, including subdomains', () => {
    expect(toolsForSenderDomain('tm.openai.com').map((t) => t.id)).toContain('chatgpt');
    expect(toolsForSenderDomain('mail.anthropic.com').map((t) => t.id)).toContain('claude');
    expect(toolsForSenderDomain('evil-openai.com')).toEqual([]);
  });

  it('looks up plans and prices', () => {
    expect(toolById('cursor')?.seatProvider).toBe('seat:cursor');
    expect(planPrice('chatgpt', 'plus')).toBe('20.00');
    expect(planPrice('chatgpt', 'enterprise')).toBeUndefined();
    expect(planPrice('nope', 'plus')).toBeUndefined();
  });
});
