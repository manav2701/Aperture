import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface PolicyParams {
  dailyLimit: BN;
  perTxLimit: BN;
  allowlist: PublicKey[];
  velocityMaxTxPerHour: number;
}

export interface PolicyState {
  owner: PublicKey;
  agent: PublicKey;
  dailyLimit: BN;
  perTxLimit: BN;
  spentToday: BN;
  lastResetTs: BN;
  allowlist: PublicKey[];
  isPaused: boolean;
  velocityMaxTxPerHour: number;
  txCountThisHour: number;
  hourWindowStart: BN;
  bump: number;
}

export interface SessionParams {
  sessionId: PublicKey;
  budget: BN;
  startsAt: BN;
  expiresAt: BN;
  autoRenew: boolean;
}

export interface SessionState {
  policy: PublicKey;
  sessionId: PublicKey;
  budget: BN;
  spent: BN;
  startsAt: BN;
  expiresAt: BN;
  autoRenew: boolean;
  bump: number;
}
