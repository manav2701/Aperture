import bearer from "@elysiajs/bearer";
import { PrismaClient } from "@prisma/client";
import { Elysia } from "elysia";
import { Conversation } from "./types";
import { OpenRouterAdapter } from "./llms/OpenRouter";
import { evaluateAgentPolicy } from "./middleware/policyPipeline";

const prisma = new PrismaClient();

const app = new Elysia()
  .use(bearer())
  .get("/", () => ({
    service: "Aperture AI Gateway",
    version: "1.0.0",
    status: "online",
    providers: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet", "google/gemini-1.5-pro", "meta-llama/llama-3.1-8b-instruct:free"],
    docs: "https://openrouter.ai/models"
  }))
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))
  .post("/api/v1/chat/completions", async ({ status, bearer: apiKey, body }) => {
    if (!apiKey) {
      return status(401, {
        error: {
          message: "Missing API key. Provide your Aperture agent key as the Bearer token.",
          type: "authentication_error"
        }
      });
    }

    const modelSlug = body.model;

    // --- APERTURE GOVERNED AGENT KEY PATH ---
    if (apiKey.startsWith("aptr_live_")) {
      const policyResult = await evaluateAgentPolicy(apiKey, modelSlug);

      if (!policyResult.allowed) {
        // Write blocked/escalated audit log
        if (policyResult.agent) {
          try {
            let modelDb = await prisma.model.findFirst({ where: { slug: modelSlug } });
            if (!modelDb) {
              const company = await prisma.company.findFirst() || await prisma.company.create({
                data: { name: "Default", website: "https://aperture.finance" }
              });
              modelDb = await prisma.model.create({
                data: { name: modelSlug, slug: modelSlug, companyId: company.id }
              });
            }
            await prisma.agentRequestLog.create({
              data: {
                agentId: policyResult.agent.id,
                modelId: modelDb.id,
                status: policyResult.status,
                blockedReason: policyResult.reason || "Policy violation",
                escalated: policyResult.escalated || false,
                costUsd: 0.0
              }
            });
          } catch (e) {
            console.warn("Failed to write audit log:", e);
          }
        }

        return status(403, {
          error: {
            message: policyResult.reason || "Request blocked by Aperture spending policy",
            code: policyResult.status,
            type: "policy_enforcement_error"
          }
        });
      }

      // Policy passed — route through OpenRouter.ai
      let response;
      try {
        response = await OpenRouterAdapter.chat(modelSlug, body.messages);
      } catch (err: any) {
        console.error("OpenRouter call failed:", err);
        return status(502, {
          error: {
            message: err.message || "Failed to reach AI provider via OpenRouter",
            type: "provider_error"
          }
        });
      }

      // Compute cost & update spend counters
      const inputTokens = response.inputTokensConsumed || 0;
      const outputTokens = response.outputTokensConsumed || 0;
      // OpenRouter cost estimation: rough average of $0.000003/token
      const costUsd = (inputTokens + outputTokens) * 0.000003;

      const agent = policyResult.agent;
      if (agent) {
        try {
          let modelDb = await prisma.model.findFirst({ where: { slug: modelSlug } });
          if (!modelDb) {
            const company = await prisma.company.findFirst() || await prisma.company.create({
              data: { name: "Default", website: "https://aperture.finance" }
            });
            modelDb = await prisma.model.create({
              data: { name: modelSlug, slug: modelSlug, companyId: company.id }
            });
          }

          await prisma.agent.update({
            where: { id: agent.id },
            data: {
              spentTodayUsd: { increment: costUsd },
              spentMonthUsd: { increment: costUsd }
            }
          });

          await prisma.agentRequestLog.create({
            data: {
              agentId: agent.id,
              modelId: modelDb.id,
              inputTokens,
              outputTokens,
              costUsd,
              status: "APPROVED"
            }
          });
        } catch (e) {
          console.warn("Failed to update spend counters:", e);
        }
      }

      return response;
    }

    // --- FALLBACK: Standard User API Key path (credit-based) ---
    const apiKeyDb = await prisma.apiKey.findFirst({
      where: { apiKey, disabled: false, deleted: false },
      select: { user: true }
    });

    if (!apiKeyDb) {
      return status(403, { message: "Invalid API key" });
    }

    if (apiKeyDb.user.credits <= 0) {
      return status(403, { message: "Insufficient credits. Top up at aperture.finance/treasury" });
    }

    let response;
    try {
      response = await OpenRouterAdapter.chat(modelSlug, body.messages);
    } catch (err: any) {
      return status(502, { error: { message: err.message || "Provider error", type: "provider_error" } });
    }

    const creditsUsed = Math.ceil((response.inputTokensConsumed + response.outputTokensConsumed) * 0.003);
    await prisma.user.update({
      where: { id: apiKeyDb.user.id },
      data: { credits: { decrement: creditsUsed } }
    });

    return response;
  }, {
    body: Conversation
  }).listen(process.env.PORT || 4000);

console.log(`🦊 Aperture AI Gateway running on port ${app.server?.port}`);
