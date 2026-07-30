import bearer from "@elysiajs/bearer";
import cors from "@elysiajs/cors";
import { PrismaClient } from "@prisma/client";
import { Elysia } from "elysia";
import { Conversation } from "./types";
import { OpenRouterAdapter } from "./llms/OpenRouter";

// Lazy Prisma — won't crash on startup if DB isn't ready
let prisma: PrismaClient | null = null;
try {
  prisma = new PrismaClient();
  // Test connection immediately
  prisma.$connect().then(() => {
    console.log("✅ Database connected successfully");
  }).catch((e: any) => {
    console.warn("⚠️ Database connection deferred:", e.message);
    prisma = null;
  });
} catch (e) {
  console.warn("⚠️ Prisma init deferred:", (e as Error).message);
  prisma = null;
}

// In-memory fallback store
const inMemoryKeys: any[] = [];

const app = new Elysia()
  .use(cors({
    origin: "*",
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }))
  .use(bearer())
  .onError(({ code, error, set }) => {
    console.error(`[Gateway Error ${code}]:`, error);
    set.status = 200;
    return {
      success: false,
      error: error?.message || "Internal gateway error",
      keys: inMemoryKeys
    };
  })
  .get("/", () => ({
    service: "Aperture AI Gateway",
    version: "1.0.0",
    status: "online",
    dbConnected: prisma !== null,
    providers: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet", "google/gemini-1.5-pro", "meta-llama/llama-3.1-8b-instruct:free"],
    docs: "https://openrouter.ai/models"
  }))
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString(), dbConnected: prisma !== null }))

  // --- API: List all Agent Virtual Keys ---
  .get("/api/v1/keys", async () => {
    // Try database first
    if (prisma) {
      try {
        const agents = await prisma.agent.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            allowedModels: { include: { model: true } }
          }
        });

        const dbKeys = agents.map((a) => ({
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
        }));

        const allKeys = [...dbKeys, ...inMemoryKeys.filter(mem => !dbKeys.some(db => db.virtualKey === mem.virtualKey))];
        return { success: true, keys: allKeys };
      } catch (err: any) {
        console.warn("DB keys fetch failed, using in-memory:", err.message);
      }
    }

    return { success: true, keys: inMemoryKeys };
  })

  // --- API: Create new Agent Virtual Key ---
  .post("/api/v1/keys", async ({ body }: any) => {
    const {
      name = "AI Agent",
      agentAddress = `agent_${Math.random().toString(36).slice(2, 8)}`,
      dailyLimitUsd = 100.0,
      perTxLimitUsd = 10.0,
      velocityMaxPerHour = 60,
      allowedModels = ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"]
    } = body || {};

    const virtualApiKey = `aptr_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;

    const keyObj = {
      id: String(Date.now()),
      name,
      agentAddress,
      virtualKey: virtualApiKey,
      dailyLimitUsd: Number(dailyLimitUsd),
      perTxLimitUsd: Number(perTxLimitUsd),
      monthlyLimitUsd: 2000,
      spentTodayUsd: 0,
      velocityMaxPerHour: Number(velocityMaxPerHour),
      allowedModels,
      createdAt: new Date().toISOString()
    };

    // Always store in memory first (instant, guaranteed)
    inMemoryKeys.unshift(keyObj);

    // Attempt to persist to database
    if (prisma) {
      try {
        let org = await prisma.org.findFirst();
        if (!org) {
          org = await prisma.org.create({ data: { name: "Default Organization", ownerWallet: agentAddress } });
        }

        let team = await prisma.team.findFirst({ where: { orgId: org.id } });
        if (!team) {
          team = await prisma.team.create({ data: { orgId: org.id, name: "Default Team" } });
        }

        let company = await prisma.company.findFirst();
        if (!company) {
          company = await prisma.company.create({ data: { name: "Default AI", website: "https://openrouter.ai" } });
        }

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

        keyObj.id = agent.id;

        for (const slug of allowedModels) {
          let model = await prisma.model.findFirst({ where: { slug } });
          if (!model) {
            model = await prisma.model.create({ data: { name: slug, slug, companyId: company.id } });
          }
          await prisma.agentModelAllowlist.create({ data: { agentId: agent.id, modelId: model.id } });
        }

        console.log(`✅ Agent key created in DB: ${virtualApiKey.slice(0, 20)}...`);
      } catch (err: any) {
        console.warn("DB key creation fallback to in-memory:", err.message);
      }
    }

    return {
      success: true,
      virtualKey: virtualApiKey,
      agent: keyObj
    };
  })

  // --- API: Governed Chat Completion Proxy ---
  .post("/api/v1/chat/completions", async ({ status, bearer: apiKey, body }) => {
    if (!apiKey) {
      return status(401, {
        error: { message: "Missing API key.", type: "authentication_error" }
      });
    }

    const modelSlug = body.model;

    if (apiKey.startsWith("aptr_live_")) {
      // Check if key exists (in-memory or DB)
      const memKey = inMemoryKeys.find(k => k.virtualKey === apiKey);
      let agentFromDb: any = null;

      if (prisma) {
        try {
          agentFromDb = await prisma.agent.findUnique({
            where: { virtualApiKey: apiKey },
            include: { allowedModels: { include: { model: true } } }
          });
        } catch (e) {
          console.warn("DB agent lookup failed:", (e as Error).message);
        }
      }

      if (!memKey && !agentFromDb) {
        return status(403, {
          error: { message: "Invalid Agent API key", type: "authentication_error" }
        });
      }

      // Check paused
      if (agentFromDb?.isPaused) {
        return status(403, {
          error: { message: "Agent is paused", code: "BLOCKED_PAUSED", type: "policy_enforcement_error" }
        });
      }

      // Check daily limit from DB agent
      if (agentFromDb && agentFromDb.spentTodayUsd >= agentFromDb.dailyLimitUsd) {
        return status(403, {
          error: { message: `Daily budget of $${agentFromDb.dailyLimitUsd} reached`, code: "BLOCKED_DAILY_LIMIT", type: "policy_enforcement_error" }
        });
      }

      // Route through OpenRouter.ai
      let response;
      try {
        response = await OpenRouterAdapter.chat(modelSlug, body.messages);
      } catch (err: any) {
        console.error("OpenRouter call failed:", err);
        return status(502, {
          error: { message: err.message || "Failed to reach AI provider", type: "provider_error" }
        });
      }

      // Update spend counters in DB if available
      const inputTokens = response.inputTokensConsumed || 0;
      const outputTokens = response.outputTokensConsumed || 0;
      const costUsd = (inputTokens + outputTokens) * 0.000003;

      if (prisma && agentFromDb) {
        try {
          let modelDb = await prisma.model.findFirst({ where: { slug: modelSlug } });
          if (!modelDb) {
            const company = await prisma.company.findFirst() || await prisma.company.create({
              data: { name: "Default", website: "https://aperture.finance" }
            });
            modelDb = await prisma.model.create({ data: { name: modelSlug, slug: modelSlug, companyId: company.id } });
          }

          await prisma.agent.update({
            where: { id: agentFromDb.id },
            data: { spentTodayUsd: { increment: costUsd }, spentMonthUsd: { increment: costUsd } }
          });

          await prisma.agentRequestLog.create({
            data: { agentId: agentFromDb.id, modelId: modelDb.id, inputTokens, outputTokens, costUsd, status: "APPROVED" }
          });
        } catch (e) {
          console.warn("Failed to log request:", (e as Error).message);
        }
      }

      return response;
    }

    // --- FALLBACK: Standard API Key path ---
    if (prisma) {
      try {
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

        let response;
        try {
          response = await OpenRouterAdapter.chat(modelSlug, body.messages);
        } catch (err: any) {
          return status(502, { error: { message: err.message, type: "provider_error" } });
        }

        const creditsUsed = Math.ceil((response.inputTokensConsumed + response.outputTokensConsumed) * 0.003);
        await prisma.user.update({
          where: { id: apiKeyDb.user.id },
          data: { credits: { decrement: creditsUsed } }
        });

        return response;
      } catch (e) {
        console.warn("Standard key path error:", (e as Error).message);
      }
    }

    return status(403, { message: "Invalid API key or database unavailable" });
  }, {
    body: Conversation
  }).listen(process.env.PORT || 4000);

console.log(`🦊 Aperture AI Gateway running on port ${app.server?.port}`);
