import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, TransactionSignature, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { SessionState } from "./types";

export const SESSION_TRACKER_PROGRAM_ID = new PublicKey("DiaiUEypUnGti22wFmKLC9V4NDHmdQgHvpzsXw9e5r14");

export class SessionTrackerClient {
  public program: Program;
  public provider: AnchorProvider;

  constructor(program: Program) {
    this.program = program;
    this.provider = program.provider as AnchorProvider;
  }

  /**
   * Derive the Session Account PDA for a given Policy Account.
   */
  public static getSessionPDA(policyPDA: PublicKey, programId: PublicKey = SESSION_TRACKER_PROGRAM_ID): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("session"), policyPDA.toBuffer()],
      programId
    );
  }

  /**
   * Open a new session budget.
   */
  public async openSession(
    owner: Keypair,
    policyPDA: PublicKey,
    sessionId: PublicKey,
    budget: BN,
    startsAt: BN,
    expiresAt: BN,
    autoRenew: boolean = false
  ): Promise<{ tx: TransactionSignature; sessionPDA: PublicKey }> {
    const [sessionPDA] = SessionTrackerClient.getSessionPDA(policyPDA, this.program.programId);

    const tx = await this.program.methods
      .openSession(sessionId, budget, startsAt, expiresAt, autoRenew)
      .accounts({
        owner: owner.publicKey,
        policy: policyPDA,
        sessionAccount: sessionPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    return { tx, sessionPDA };
  }

  /**
   * Deduct budget from an active session.
   */
  public async spendSession(
    policyPDA: PublicKey,
    amount: BN
  ): Promise<TransactionSignature> {
    const [sessionPDA] = SessionTrackerClient.getSessionPDA(policyPDA, this.program.programId);

    return await this.program.methods
      .spendSession(amount)
      .accounts({
        policy: policyPDA,
        sessionAccount: sessionPDA,
      })
      .rpc();
  }

  /**
   * Close a session account and recover rent lamports.
   */
  public async closeSession(
    owner: Keypair,
    policyPDA: PublicKey
  ): Promise<TransactionSignature> {
    const [sessionPDA] = SessionTrackerClient.getSessionPDA(policyPDA, this.program.programId);

    return await this.program.methods
      .closeSession()
      .accounts({
        owner: owner.publicKey,
        policy: policyPDA,
        sessionAccount: sessionPDA,
      })
      .signers([owner])
      .rpc();
  }

  /**
   * Fetch session account state.
   */
  public async getSession(sessionPDA: PublicKey): Promise<SessionState> {
    const acc = await (this.program.account as any).sessionAccount.fetch(sessionPDA);
    return acc as SessionState;
  }
}
