import { createHash } from 'node:crypto';
import { getCreateAccountWithSeedInstruction } from '@solana-program/system';
import {
  getApproveCheckedInstruction,
  getInitializeAccount3Instruction,
  getRevokeInstruction,
  getTokenSize,
  getTransferCheckedInstruction,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createAddressWithSeed,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';

/*
 * Budget accounts (plan/phases/phase-09 §9.1): one SPL token account per agent, owned by the
 * customer's treasury wallet, derived with a seed so the treasury is the only signer needed.
 * The agent's delegate key may spend at most the approved allowance — the on-chain hard cap.
 * Aperture builds these transactions; the treasury wallet signs and sends them. Aperture never
 * holds the treasury key.
 */

export const TOKEN_ACCOUNT_SPACE = getTokenSize();

/** ≤ 32 characters, stable per (principal, mint). */
export function budgetSeed(principalId: string, mint: string): string {
  return `aperture:${createHash('sha256').update(`${principalId}|${mint}`).digest('hex').slice(0, 22)}`;
}

export async function budgetAccountAddress(treasury: string, principalId: string, mint: string): Promise<Address> {
  return createAddressWithSeed({
    baseAddress: address(treasury),
    programAddress: TOKEN_PROGRAM_ADDRESS,
    seed: budgetSeed(principalId, mint),
  });
}

export async function treasuryTokenAccount(treasury: string, mint: string): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner: address(treasury),
    mint: address(mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return ata;
}

interface Lifetime {
  blockhash: string;
  lastValidBlockHeight: bigint;
}

function unsigned(treasury: string, instructions: Instruction[], lifetime: Lifetime): string {
  const payer = createNoopSigner(address(treasury));
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: lifetime.blockhash as Blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

export interface SetupInput {
  treasury: string;
  principalId: string;
  mint: string;
  decimals: number;
  delegate: string;
  /** Tokens moved from the treasury into the budget account (atomic units). */
  float: bigint;
  /** What the delegate may spend (atomic units): the most this agent can ever lose. */
  allowance: bigint;
  rentLamports: bigint;
}

/** Create the seeded token account, fund it, and approve the agent's delegate. */
export async function buildSetupTransaction(input: SetupInput, lifetime: Lifetime) {
  const treasury = createNoopSigner(address(input.treasury));
  const budget = await budgetAccountAddress(input.treasury, input.principalId, input.mint);
  const mint = address(input.mint);
  const instructions: Instruction[] = [
    getCreateAccountWithSeedInstruction({
      payer: treasury,
      newAccount: budget,
      base: address(input.treasury),
      seed: budgetSeed(input.principalId, input.mint),
      amount: input.rentLamports,
      space: BigInt(TOKEN_ACCOUNT_SPACE),
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeAccount3Instruction({ account: budget, mint, owner: address(input.treasury) }),
  ];
  if (input.float > 0n) {
    instructions.push(
      getTransferCheckedInstruction({
        source: await treasuryTokenAccount(input.treasury, input.mint),
        mint,
        destination: budget,
        authority: treasury,
        amount: input.float,
        decimals: input.decimals,
      }),
    );
  }
  instructions.push(
    getApproveCheckedInstruction({
      source: budget,
      mint,
      delegate: address(input.delegate),
      owner: treasury,
      amount: input.allowance,
      decimals: input.decimals,
    }),
  );
  return { budgetAccount: budget, transaction: unsigned(input.treasury, instructions, lifetime) };
}

/** Add float and/or reset the allowance (approve replaces the previous allowance). */
export async function buildTopUpTransaction(
  input: {
    treasury: string;
    budgetAccount: string;
    mint: string;
    decimals: number;
    delegate: string;
    add: bigint;
    allowance: bigint;
  },
  lifetime: Lifetime,
) {
  const treasury = createNoopSigner(address(input.treasury));
  const mint = address(input.mint);
  const instructions: Instruction[] = [];
  if (input.add > 0n) {
    instructions.push(
      getTransferCheckedInstruction({
        source: await treasuryTokenAccount(input.treasury, input.mint),
        mint,
        destination: address(input.budgetAccount),
        authority: treasury,
        amount: input.add,
        decimals: input.decimals,
      }),
    );
  }
  instructions.push(
    getApproveCheckedInstruction({
      source: address(input.budgetAccount),
      mint,
      delegate: address(input.delegate),
      owner: treasury,
      amount: input.allowance,
      decimals: input.decimals,
    }),
  );
  return unsigned(input.treasury, instructions, lifetime);
}

/** Revoke the delegate and optionally sweep the remaining balance back to the treasury. */
export async function buildRevokeTransaction(
  input: { treasury: string; budgetAccount: string; mint: string; decimals: number; sweep: bigint },
  lifetime: Lifetime,
) {
  const treasury = createNoopSigner(address(input.treasury));
  const instructions: Instruction[] = [getRevokeInstruction({ source: address(input.budgetAccount), owner: treasury })];
  if (input.sweep > 0n) {
    instructions.push(
      getTransferCheckedInstruction({
        source: address(input.budgetAccount),
        mint: address(input.mint),
        destination: await treasuryTokenAccount(input.treasury, input.mint),
        authority: treasury,
        amount: input.sweep,
        decimals: input.decimals,
      }),
    );
  }
  return unsigned(input.treasury, instructions, lifetime);
}
