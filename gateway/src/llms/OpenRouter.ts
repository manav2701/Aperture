import { Messages } from "../types";
import { LlmResponse } from "./Base";

/**
 * OpenRouterAdapter
 * 
 * Routes all LLM requests through openrouter.ai using a single API key.
 * OpenRouter provides access to 300+ models (GPT-4o, Claude, Gemini, Llama, etc.)
 * via a single OpenAI-compatible endpoint.
 * 
 * Get your free key at: https://openrouter.ai
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterAdapter {
  static async chat(model: string, messages: Messages): Promise<LlmResponse> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set. Get your free key at https://openrouter.ai");
    }

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "https://aperture.finance",
        "X-Title": "Aperture AI Agent Governance Platform",
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errBody}`);
    }

    const data = await response.json() as any;

    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const content = data.choices?.[0]?.message?.content || "";

    return {
      inputTokensConsumed: inputTokens,
      outputTokensConsumed: outputTokens,
      completions: {
        choices: [{ message: { content } }],
      },
    };
  }
}
