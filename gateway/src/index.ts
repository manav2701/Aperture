import bearer from "@elysiajs/bearer";
import cors from "@elysiajs/cors";
import { PrismaClient } from "@prisma/client";
import { Elysia } from "elysia";
import { Conversation } from "./types";
import { OpenRouterAdapter } from "./llms/OpenRouter";
import { evaluateAgentPolicy } from "./middleware/policyPipeline";

const prisma = new PrismaClient();

const app = new Elysia()
  .use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
  }))
  .use(bearer())
  .get("/", () => ({
    service: "Aperture AI Gateway",
    version: "1.0.0",
    status: "online",
    providers: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet", "google/gemini-1.5-pro", "meta-llama/llama-3.1-8b-instruct:free"],
    docs: "https://openrouter.ai/models"
  }))
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))

  // --- API: List all Agent Virtual Keys ---
  .get("/api/v1/keys", async () => {
    try {
      const agents = await prisma.agent.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          allowedModels: {
            include: { model: true }
          }
        }
      });

      return {
        success: true,
        keys: agents.map((a) => ({
          id: a.id,
          name: a.name,
          agentAddress: a.solanaWallet,
          virtualKey: a.virtualApiKey,
          dailyLimitUsd: a.dailyLimitUsd,
          perTxLimitUsd: a.perTxLimitUsd,
          monthlyLimitUsd: a.monthlyLimitUsd,
          spentTodayUsd: a.spentTodayUsd,
          velocityMaxPerHour: a.velocityMaxPerHour,
          allowedModels: a.allowedModels.map((m) => m.model.slug),
          createdAt: a.createdAt.toISOString()
        }))
      };
    } catch (err: any) {
      return { success: false, keys: [], error: err.message };
    }
  })

  // --- API: Create new Agent Virtual Key ---
  .post("/api/v1/keys", async ({ body }: any) => {
    try {
      const {
        name = "AI Agent",
        agentAddress = `agent_${Math.random().toString(36).slice(2, 8)}`,
        dailyLimitUsd = 100.0,
        perTxLimitUsd = 10.0,
        velocityMaxPerHour = 60,
        allowedModels = ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"]
      } = body || {};

      // Ensure default Org & Team exist
      let org = await prisma.org.findFirst();
      if (!org) {
        org = await prisma.org.create({
          data: {
            name: "Default Organization",
            ownerWallet: agentAddress
          }
        });
      }

      let team = await prisma.team.findFirst({ where: { orgId: org.id } });
      if (!team) {
        team = await prisma.team.create({
          data: {
            orgId: org.id,
            name: "Default Team"
          }
        });
      }

      // Ensure default Company exists
      let company = await prisma.company.findFirst();
      if (!company) {
        company = await prisma.company.create({
          data: { name: "Default AI", website: "https://openrouter.ai" }
        });
      }

      // Generate virtual key
      const virtualApiKey = `aptr_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;

      // Create Agent in Database
      const agent = await prisma.agent.create({
        data: {
          teamId: team.id,
          name,
          virtualApiKey,
          solanaWallet: agentAddress,
          policyPDA: `pda_${virtualApiKey.slice(10, 20)}`,
          dailyLimitUsd: Number(dailyLimitUsd),
          perTxLimitUsd: Number(perTxLimitUsd),
          velocityMaxPerHour: Number(velocityMaxPerHour)
        }
      });

      // Create model allowlists
      for (const slug of allowedModels) {
        let model = await prisma.model.findFirst({ where: { slug } });
        if (!model) {
          model = await prisma.model.create({
            data: { name: slug, slug, companyId: company.id }
          });
        }
        await prisma.agentModelAllowlist.create({
          data: {
            agentId: agent.id,
            modelId: model.id
          }
        });
      }

      return {
        success: true,
        virtualKey: virtualApiKey,
        agent: {
          id: agent.id,
          name: agent.name,
          agentAddress: agent.solanaWallet,
          virtualKey: virtualApiKey,
          dailyLimitUsd: agent.dailyLimitUsd,
          perTxLimitUsd: agent.perTxLimitUsd,
          velocityMaxPerHour: agent.velocityMaxPerHour,
          createdAt: agent.createdAt.toISOString()
        }
      };
    } catch (err: any) {
      console.error("Failed to create agent key:", err);
      return { success: false, error: err.message };
    }
  })

  // --- API: Governed Chat Completion Proxy ---
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

    // --- FALLBACK: Standard User API Key path ---
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
