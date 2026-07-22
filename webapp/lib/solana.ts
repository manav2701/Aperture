import { PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import BN from "bn.js";

export const POLICY_MANAGER_PROGRAM_ID = new PublicKey("H23GKLcVrnYoEC7s7Ju4nxk2LXLbuGn441YNQsFC2WdG");
export const SESSION_TRACKER_PROGRAM_ID = new PublicKey("DiaiUEypUnGti22wFmKLC9V4NDHmdQgHvpzsXw9e5r14");

export const SOLANA_RPC_ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "http://127.0.0.1:8899";

export function getSolanaConnection(): Connection {
  return new Connection(SOLANA_RPC_ENDPOINT, "confirmed");
}

export function getPolicyPDA(agent: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), agent.toBuffer()],
    POLICY_MANAGER_PROGRAM_ID
  );
}

export function getDelegatePDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegate"), owner.toBuffer()],
    POLICY_MANAGER_PROGRAM_ID
  );
}

export function getExtraAccountMetaListPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    POLICY_MANAGER_PROGRAM_ID
  );
}

export function getSessionPDA(policyPDA: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("session"), policyPDA.toBuffer()],
    SESSION_TRACKER_PROGRAM_ID
  );
}

export interface PolicyAccountData {
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

export interface SessionAccountData {
  policy: PublicKey;
  sessionId: PublicKey;
  budget: BN;
  spent: BN;
  startsAt: BN;
  expiresAt: BN;
  autoRenew: boolean;
  bump: number;
}

export function formatSol(lamports: BN | number): string {
  const val = typeof lamports === "number" ? lamports : lamports.toNumber();
  return (val / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}
