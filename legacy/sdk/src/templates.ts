import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PolicyParams } from "./types";

export interface PolicyCodeConfig {
  name: string;
  dailyLimitSol: number;
  perTxLimitSol: number;
  monthlyLimitSol?: number;
  velocityMaxTxPerHour: number;
  cooldownSeconds?: number;
  escalationThresholdSol?: number;
  allowlist: string[];
}

export const POLICY_TEMPLATES: Record<string, PolicyCodeConfig> = {
  ResearchAgent: {
    name: "Research Agent Preset",
    dailyLimitSol: 50.0,
    perTxLimitSol: 10.0,
    monthlyLimitSol: 500.0,
    velocityMaxTxPerHour: 5,
    cooldownSeconds: 10,
    escalationThresholdSol: 15.0,
    allowlist: [],
  },
  ProcurementAgent: {
    name: "Procurement Agent Preset",
    dailyLimitSol: 1000.0,
    perTxLimitSol: 200.0,
    monthlyLimitSol: 10000.0,
    velocityMaxTxPerHour: 10,
    cooldownSeconds: 5,
    escalationThresholdSol: 200.0,
    allowlist: [],
  },
  ArbitrageBot: {
    name: "Arbitrage Bot Preset",
    dailyLimitSol: 500.0,
    perTxLimitSol: 100.0,
    monthlyLimitSol: 5000.0,
    velocityMaxTxPerHour: 30,
    cooldownSeconds: 0,
    escalationThresholdSol: 150.0,
    allowlist: [],
  },
  CustomerSupportBot: {
    name: "Customer Support Bot Preset",
    dailyLimitSol: 20.0,
    perTxLimitSol: 5.0,
    monthlyLimitSol: 200.0,
    velocityMaxTxPerHour: 2,
    cooldownSeconds: 30,
    escalationThresholdSol: 10.0,
    allowlist: [],
  },
};

export function exportPolicyAsCode(config: PolicyCodeConfig): string {
  return JSON.stringify(config, null, 2);
}

export function importPolicyFromCode(jsonStr: string): PolicyParams {
  const parsed: PolicyCodeConfig = JSON.parse(jsonStr);
  return {
    dailyLimit: new BN(parsed.dailyLimitSol * 1_000_000_000),
    perTxLimit: new BN(parsed.perTxLimitSol * 1_000_000_000),
    allowlist: parsed.allowlist.map((addr) => new PublicKey(addr)),
    velocityMaxTxPerHour: parsed.velocityMaxTxPerHour,
  };
}
