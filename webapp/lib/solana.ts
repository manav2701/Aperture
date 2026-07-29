import { PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";

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
  org?: PublicKey;
  team?: PublicKey;
  monthlyLimit?: BN;
  spentThisMonth?: BN;
  lastMonthResetTs?: BN;
  cooldownSeconds?: number;
  lastTxTs?: BN;
  requireKyc?: boolean;
  escalationThreshold?: BN;
  parentPolicy?: PublicKey;
  delegatedBudget?: BN;
  canRedelegate?: boolean;
  delegationDepth?: number;
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

export async function fetchPolicyAccountOnChain(
  connection: Connection,
  policyPDA: PublicKey
): Promise<PolicyAccountData | null> {
  try {
    const accInfo = await connection.getAccountInfo(policyPDA);
    if (!accInfo || accInfo.data.length < 8 + 32 + 32 + 8 + 8 + 8 + 8) return null;

    let offset = 8; // skip 8-byte Anchor discriminator
    const owner = new PublicKey(accInfo.data.slice(offset, offset + 32));
    offset += 32;
    const agent = new PublicKey(accInfo.data.slice(offset, offset + 32));
    offset += 32;
    const dailyLimit = new BN(accInfo.data.slice(offset, offset + 8), "le");
    offset += 8;
    const perTxLimit = new BN(accInfo.data.slice(offset, offset + 8), "le");
    offset += 8;
    const spentToday = new BN(accInfo.data.slice(offset, offset + 8), "le");
    offset += 8;
    const lastResetTs = new BN(accInfo.data.slice(offset, offset + 8), "le");
    offset += 8;

    const allowlistLen = accInfo.data.readUInt32LE(offset);
    offset += 4;
    const allowlist: PublicKey[] = [];
    for (let i = 0; i < allowlistLen; i++) {
      allowlist.push(new PublicKey(accInfo.data.slice(offset, offset + 32)));
      offset += 32;
    }

    const isPaused = accInfo.data[offset] !== 0;
    offset += 1;
    const velocityMaxTxPerHour = accInfo.data[offset];
    offset += 1;
    const txCountThisHour = accInfo.data[offset];
    offset += 1;
    const hourWindowStart = new BN(accInfo.data.slice(offset, offset + 8), "le");
    offset += 8;
    const bump = accInfo.data[offset];

    return {
      owner,
      agent,
      dailyLimit,
      perTxLimit,
      spentToday,
      lastResetTs,
      allowlist,
      isPaused,
      velocityMaxTxPerHour,
      txCountThisHour,
      hourWindowStart,
      bump,
    };
  } catch (e) {
    console.warn("Could not fetch or decode policy account on-chain:", e);
    return null;
  }
}

export async function fetchSessionAccountOnChain(
  connection: Connection,
  sessionPDA: PublicKey
): Promise<SessionAccountData | null> {
  try {
    const accInfo = await connection.getAccountInfo(sessionPDA);
    if (!accInfo || accInfo.data.length < 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1) return null;

    let offset = 8; // skip 8-byte Anchor discriminator
    const policy = new PublicKey(accInfo.data.slice(offset, offset + 32));
    offset += 32;
    const sessionId = new PublicKey(accInfo.data.slice(offset, offset + 32));
    offset += 32;
    const budget = new BN(accInfo.data.slice(offset, offset + 8), "le");
    offset += 8;
    const spent = new BN(accInfo.data.slice(offset, offset + 8), "le");
    offset += 8;
    const startsAt = new BN(accInfo.data.slice(offset, offset + 8), "le");
    offset += 8;
    const expiresAt = new BN(accInfo.data.slice(offset, offset + 8), "le");
    offset += 8;
    const autoRenew = accInfo.data[offset] !== 0;
    offset += 1;
    const bump = accInfo.data[offset];

    return {
      policy,
      sessionId,
      budget,
      spent,
      startsAt,
      expiresAt,
      autoRenew,
      bump,
    };
  } catch (e) {
    console.warn("Could not fetch or decode session account on-chain:", e);
    return null;
  }
}
