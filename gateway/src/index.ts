import bearer from "@elysiajs/bearer";
import cors from "@elysiajs/cors";
import { PrismaClient } from "@prisma/client";
import { Elysia } from "elysia";
import { Conversation } from "./types";
import { OpenRouterAdapter } from "./llms/OpenRouter";

// Diagnostic logging for environment variables
const dbUrl = process.env.DATABASE_URL || "";
const maskedUrl = dbUrl ? dbUrl.replace(/:[^:@]+@/, ":***@") : "NOT SET";
console.log(`[CONFIG] DATABASE_URL: ${maskedUrl}`);
console.log(`[CONFIG] OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? "CONFIGURED (length " + process.env.OPENROUTER_API_KEY.length + ")" : "NOT SET"}`);
console.log(`[CONFIG] PORT: ${process.env.PORT || 4000}`);

// Lazy Prisma — won't crash on startup if DB isn't ready
let prisma: PrismaClient | null = null;
try {
  if (dbUrl) {
    prisma = new PrismaClient({
      log: ['error', 'warn']
    });
    prisma.$connect().then(() => {
      console.log("✅ [DATABASE] Successfully connected to PostgreSQL!");
    }).catch((e: any) => {
      console.error("⚠️ [DATABASE FAIL] Connection error details:", e);
      console.warn("⚠️ [DATABASE FALLBACK] Enabling in-memory fallback store.");
      prisma = null;
    });
  } else {
    console.warn("⚠️ [DATABASE WARNING] DATABASE_URL is not set. Running in in-memory mode.");
  }
} catch (e: any) {
  console.error("⚠️ [DATABASE CRITICAL] Prisma init error:", e.message);
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
  .onRequest(({ request }) => {
    console.log(`[HTTP ${request.method}] ${request.url}`);
  })
  .onError(({ code, error, set }) => {
    console.error(`[GATEWAY ERROR ${code}]:`, error);
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
    dbUrlConfigured: maskedUrl,
    providers: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet", "google/gemini-1.5-pro", "meta-llama/llama-3.1-8b-instruct:free"],
    docs: "https://openrouter.ai/models"
  }))
  .get("/health", ({ set }) => {
    set.status = 200;
    set.headers['content-type'] = 'application/json';
    console.log(`[HEALTH CHECK SUCCESS] ${new Date().toISOString()}`);
    return JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      dbConnected: prisma !== null
    });
  })

  // --- API: List all Agent Virtual Keys ---
  .get("/api/v1/keys", async () => {
    console.log("[API GET /api/v1/keys] Fetching keys...");
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
        console.log(`[API GET /api/v1/keys] Returning ${allKeys.length} keys (${dbKeys.length} DB, ${inMemoryKeys.length} memory)`);
        return { success: true, keys: allKeys };
      } catch (err: any) {
        console.warn("[API GET /api/v1/keys] DB fetch failed, returning in-memory:", err.message);
      }
    }

    console.log(`[API GET /api/v1/keys] Returning ${inMemoryKeys.length} in-memory keys`);
    return { success: true, keys: inMemoryKeys };
  })

  // --- API: Create new Agent Virtual Key ---
  .post("/api/v1/keys", async ({ body }: any) => {
    console.log("[API POST /api/v1/keys] Creating agent key...", body?.name);
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

    inMemoryKeys.unshift(keyObj);

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

        console.log(`✅ [API POST /api/v1/keys] Created agent key in DB: ${virtualApiKey.slice(0, 20)}...`);
      } catch (err: any) {
        console.warn("⚠️ [API POST /api/v1/keys] DB key creation failed, using in-memory:", err.message);
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
    console.log(`[API POST /api/v1/chat/completions] Model: ${body?.model}`);
    if (!apiKey) {
      return status(401, {
        error: { message: "Missing API key.", type: "authentication_error" }
      });
    }

    const modelSlug = body.model;

    if (apiKey.startsWith("aptr_live_")) {
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

      if (agentFromDb?.isPaused) {
        return status(403, {
          error: { message: "Agent is paused", code: "BLOCKED_PAUSED", type: "policy_enforcement_error" }
        });
      }

      if (agentFromDb && agentFromDb.spentTodayUsd >= agentFromDb.dailyLimitUsd) {
        return status(403, {
          error: { message: `Daily budget of $${agentFromDb.dailyLimitUsd} reached`, code: "BLOCKED_DAILY_LIMIT", type: "policy_enforcement_error" }
        });
      }

      let response;
      try {
        console.log(`[OpenRouter Dispatch] Sending request to model '${modelSlug}' via openrouter.ai...`);
        response = await OpenRouterAdapter.chat(modelSlug, body.messages);
        console.log(`[OpenRouter Success] Response received for '${modelSlug}'`);
      } catch (err: any) {
        console.error("❌ [OpenRouter Error]:", err.message);
        return status(502, {
          error: { message: err.message || "Failed to reach AI provider", type: "provider_error" }
        });
      }

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
            modelDb = await prisma.model.create({ data: { name: slug, slug: modelSlug, companyId: company.id } });
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

    // Fallback standard key path
    return status(403, { message: "Invalid API key or database unavailable" });
  }, {
    body: Conversation
  }).listen({
    port: Number(process.env.PORT) || 4000,
    hostname: "0.0.0.0"
  });

console.log(`🦊 Aperture AI Gateway running on port ${app.server?.port} (0.0.0.0)`);
