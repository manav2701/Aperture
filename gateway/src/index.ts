import bearer from "@elysiajs/bearer";
import { PrismaClient } from "@prisma/client";
import { Elysia } from "elysia";
import { Conversation } from "./types";
import { Gemini } from "./llms/Gemini";
import { OpenAi } from "./llms/OpenAi";
import { Claude } from "./llms/Claude";
import { LlmResponse } from "./llms/Base";
import { evaluateAgentPolicy } from "./middleware/policyPipeline";

const prisma = new PrismaClient();

const app = new Elysia()
  .use(bearer())
  .post("/api/v1/chat/completions", async ({ status, bearer: apiKey, body }) => {
    if (!apiKey) {
      return status(401, {
        error: {
          message: "Missing Bearer API key in Authorization header",
          type: "authentication_error"
        }
      });
    }

    const modelSlug = body.model;

    // Check if this is an Aperture Virtual Agent Key (aptr_live_...)
    if (apiKey.startsWith("aptr_live_")) {
      // 1. Evaluate Aperture Policy Guardrails
      const policyResult = await evaluateAgentPolicy(apiKey, modelSlug);

      if (!policyResult.allowed) {
        // Record blocked or escalated log
        if (policyResult.agent) {
          const modelDb = await prisma.model.findFirst({ where: { slug: modelSlug } });
          if (modelDb) {
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
          }
        }

        return status(403, {
          error: {
            message: policyResult.reason || "Request blocked by Aperture Agent Policy",
            code: policyResult.status,
            type: "policy_enforcement_error"
          }
        });
      }

      // 2. Fetch Model & Provider Mappings
      let modelDb = await prisma.model.findFirst({ where: { slug: modelSlug } });
      if (!modelDb) {
        const defaultCompany = await prisma.company.findFirst() || await prisma.company.create({
          data: { name: "Default", website: "https://aperture.finance" }
        });
        modelDb = await prisma.model.create({
          data: { name: modelSlug, slug: modelSlug, companyId: defaultCompany.id }
        });
      }

      let providers = await prisma.modelProviderMapping.findMany({
        where: { modelId: modelDb.id },
        include: { provider: true }
      });

      if (providers.length === 0) {
        let defaultProvider = await prisma.provider.findFirst() || await prisma.provider.create({
          data: { name: "OpenAI", website: "https://openai.com" }
        });
        const mapping = await prisma.modelProviderMapping.create({
          data: {
            modelId: modelDb.id,
            providerId: defaultProvider.id,
            inputTokenCost: 15,
            outputTokenCost: 60
          },
          include: { provider: true }
        });
        providers = [mapping];
      }

      const provider = providers[Math.floor(Math.random() * providers.length)];
      const [, providerModelName] = modelSlug.includes("/") ? modelSlug.split("/") : ["", modelSlug];

      // 3. Dispatch to Provider LLM Router
      let response: LlmResponse | null = null;
      try {
        if (provider.provider.name.includes("Google")) {
          response = await Gemini.chat(providerModelName || modelSlug, body.messages);
        } else if (provider.provider.name.includes("Claude") || provider.provider.name.includes("Anthropic")) {
          response = await Claude.chat(providerModelName || modelSlug, body.messages);
        } else {
          response = await OpenAi.chat(providerModelName || modelSlug, body.messages);
        }
      } catch (err: any) {
        console.error("Provider execution error:", err);
        return status(500, { error: { message: err.message || "Provider error", type: "provider_error" } });
      }

      if (!response) {
        return status(502, { error: { message: "Failed to get response from LLM provider", type: "provider_error" } });
      }

      // 4. Calculate Token Costs & Update Spend Counters
      const inputTokens = response.inputTokensConsumed || 0;
      const outputTokens = response.outputTokensConsumed || 0;
      const costUsd = (inputTokens * provider.inputTokenCost + outputTokens * provider.outputTokenCost) / 1000000;

      const agent = policyResult.agent;
      if (agent) {
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
      }

      return response;
    }

    // Fallback: Standard User API Key logic
    const apiKeyDb = await prisma.apiKey.findFirst({
      where: { apiKey, disabled: false, deleted: false },
      select: { user: true }
    });

    if (!apiKeyDb) {
      return status(403, { message: "Invalid API key" });
    }

    if (apiKeyDb.user.credits <= 0) {
      return status(403, { message: "Insufficient credits" });
    }

    const modelDb = await prisma.model.findFirst({ where: { slug: modelSlug } });
    if (!modelDb) {
      return status(403, { message: "Invalid model" });
    }

    const providers = await prisma.modelProviderMapping.findMany({
      where: { modelId: modelDb.id },
      include: { provider: true }
    });

    const provider = providers[Math.floor(Math.random() * providers.length)];
    const [, providerModelName] = modelSlug.includes("/") ? modelSlug.split("/") : ["", modelSlug];

    let response: LlmResponse | null = null;
    if (provider.provider.name === "Google API" || provider.provider.name === "Google Vertex") {
      response = await Gemini.chat(providerModelName, body.messages);
    } else if (provider.provider.name === "OpenAI") {
      response = await OpenAi.chat(providerModelName, body.messages);
    } else if (provider.provider.name === "Claude API") {
      response = await Claude.chat(providerModelName, body.messages);
    }

    if (!response) {
      return status(403, { message: "No provider found for model" });
    }

    const creditsUsed = Math.ceil((response.inputTokensConsumed * provider.inputTokenCost + response.outputTokensConsumed * provider.outputTokenCost) / 10);
    await prisma.user.update({
      where: { id: apiKeyDb.user.id },
      data: { credits: { decrement: creditsUsed } }
    });

    await prisma.apiKey.update({
      where: { apiKey },
      data: { creditsConsumed: { increment: creditsUsed } }
    });

    return response;
  }, {
    body: Conversation
  }).listen(4000);

console.log(`🦊 Governed Aperture Gateway running on port ${app.server?.port}`);
