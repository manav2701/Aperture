import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface PolicyEvaluationResult {
  allowed: boolean;
  status: 
    | "APPROVED"
    | "BLOCKED_PAUSED"
    | "BLOCKED_TIME_WINDOW"
    | "BLOCKED_MODEL_NOT_ALLOWED"
    | "BLOCKED_VELOCITY"
    | "BLOCKED_DAILY_LIMIT"
    | "BLOCKED_MONTHLY_LIMIT"
    | "BLOCKED_PER_TX_LIMIT"
    | "ESCALATED_PENDING";
  reason?: string;
  escalated?: boolean;
  agent?: any;
}

export async function evaluateAgentPolicy(
  virtualApiKey: string,
  modelSlug: string,
  estimatedCostUsd: number = 0.01
): Promise<PolicyEvaluationResult> {
  const agent = await prisma.agent.findUnique({
    where: { virtualApiKey },
    include: {
      team: { include: { org: true } },
      allowedModels: { include: { model: true } }
    }
  });

  if (!agent || !agent.isActive) {
    return {
      allowed: false,
      status: "BLOCKED_PAUSED",
      reason: "Invalid or inactive Agent Virtual API Key"
    };
  }

  if (agent.isPaused) {
    return {
      allowed: false,
      status: "BLOCKED_PAUSED",
      reason: "Agent policy is currently paused",
      agent
    };
  }

  // 1. Time Window Check (UTC)
  if (agent.allowedHoursStart !== null && agent.allowedHoursEnd !== null) {
    const currentHour = new Date().getUTCHours();
    const start = agent.allowedHoursStart;
    const end = agent.allowedHoursEnd;
    const isWithin = start <= end 
      ? (currentHour >= start && currentHour <= end)
      : (currentHour >= start || currentHour <= end);

    if (!isWithin) {
      return {
        allowed: false,
        status: "BLOCKED_TIME_WINDOW",
        reason: `Operation disallowed outside UTC time window (${start}:00 - ${end}:00)`,
        agent
      };
    }
  }

  // 2. Model Allowlist Check
  if (agent.allowedModels.length > 0) {
    const isAllowed = agent.allowedModels.some(
      (m: any) => m.model.slug === modelSlug || m.model.name === modelSlug
    );
    if (!isAllowed) {
      return {
        allowed: false,
        status: "BLOCKED_MODEL_NOT_ALLOWED",
        reason: `Model '${modelSlug}' is not permitted by agent policy allowlist`,
        agent
      };
    }
  }

  // 3. Velocity Cap Check (Max Requests per Hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentRequestsCount = await prisma.agentRequestLog.count({
    where: {
      agentId: agent.id,
      createdAt: { gte: oneHourAgo }
    }
  });

  if (recentRequestsCount >= agent.velocityMaxPerHour) {
    return {
      allowed: false,
      status: "BLOCKED_VELOCITY",
      reason: `Velocity limit exceeded (${recentRequestsCount}/${agent.velocityMaxPerHour} reqs/hr)`,
      agent
    };
  }

  // 4. Daily Spend Reset & Cap Check
  const todayStr = new Date().toISOString().split("T")[0];
  let spentToday = agent.spentTodayUsd;

  if (agent.lastSpendResetDay !== todayStr) {
    spentToday = 0;
    await prisma.agent.update({
      where: { id: agent.id },
      data: { spentTodayUsd: 0, lastSpendResetDay: todayStr }
    });
  }

  if (spentToday + estimatedCostUsd > agent.dailyLimitUsd) {
    return {
      allowed: false,
      status: "BLOCKED_DAILY_LIMIT",
      reason: `Daily budget cap of $${agent.dailyLimitUsd} reached (current: $${spentToday.toFixed(4)})`,
      agent
    };
  }

  // 5. Monthly Spend Cap Check
  if (agent.spentMonthUsd + estimatedCostUsd > agent.monthlyLimitUsd) {
    return {
      allowed: false,
      status: "BLOCKED_MONTHLY_LIMIT",
      reason: `Monthly budget cap of $${agent.monthlyLimitUsd} reached`,
      agent
    };
  }

  // 6. Single Tx Cap Check
  if (estimatedCostUsd > agent.perTxLimitUsd) {
    return {
      allowed: false,
      status: "BLOCKED_PER_TX_LIMIT",
      reason: `Estimated tx cost ($${estimatedCostUsd}) exceeds single transaction limit ($${agent.perTxLimitUsd})`,
      agent
    };
  }

  // 7. Escalation Check
  if (agent.escalationThresholdUsd && estimatedCostUsd >= agent.escalationThresholdUsd) {
    return {
      allowed: false,
      status: "ESCALATED_PENDING",
      escalated: true,
      reason: `Cost ($${estimatedCostUsd}) exceeds escalation threshold ($${agent.escalationThresholdUsd}). Pending human approval.`,
      agent
    };
  }

  return {
    allowed: true,
    status: "APPROVED",
    agent
  };
}
