import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, TransactionSignature, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { PolicyParams, PolicyState } from "./types";

export const POLICY_MANAGER_PROGRAM_ID = new PublicKey("H23GKLcVrnYoEC7s7Ju4nxk2LXLbuGn441YNQsFC2WdG");
import { SESSION_TRACKER_PROGRAM_ID } from "./session";

export class PolicyManagerClient {
  public program: Program;
  public provider: AnchorProvider;

  constructor(program: Program) {
    this.program = program;
    this.provider = program.provider as AnchorProvider;
  }

  /**
   * Derive the Policy Account PDA for a given agent wallet.
   */
  public static getPolicyPDA(agent: PublicKey, programId: PublicKey = POLICY_MANAGER_PROGRAM_ID): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), agent.toBuffer()],
      programId
    );
  }

  /**
   * Derive the Permanent Delegate PDA for a policy owner.
   */
  public static getDelegatePDA(owner: PublicKey, programId: PublicKey = POLICY_MANAGER_PROGRAM_ID): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("delegate"), owner.toBuffer()],
      programId
    );
  }

  /**
   * Derive the ExtraAccountMetaList PDA for a token mint.
   */
  public static getExtraAccountMetaListPDA(mint: PublicKey, programId: PublicKey = POLICY_MANAGER_PROGRAM_ID): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mint.toBuffer()],
      programId
    );
  }

  /**
   * Create a new policy for an agent.
   */
  public async createPolicy(
    owner: Keypair,
    agent: PublicKey,
    params: PolicyParams
  ): Promise<{ tx: TransactionSignature; policyPDA: PublicKey }> {
    const [policyPDA] = PolicyManagerClient.getPolicyPDA(agent, this.program.programId);

    const tx = await this.program.methods
      .createPolicy(
        params.dailyLimit,
        params.perTxLimit,
        params.allowlist,
        params.velocityMaxTxPerHour
      )
      .accounts({
        owner: owner.publicKey,
        agent: agent,
        policyAccount: policyPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    return { tx, policyPDA };
  }

  /**
   * Update an existing policy's limits and allowlist.
   */
  public async updatePolicy(
    owner: Keypair,
    agent: PublicKey,
    params: PolicyParams
  ): Promise<TransactionSignature> {
    const [policyPDA] = PolicyManagerClient.getPolicyPDA(agent, this.program.programId);

    return await this.program.methods
      .updatePolicy(
        params.dailyLimit,
        params.perTxLimit,
        params.allowlist,
        params.velocityMaxTxPerHour
      )
      .accounts({
        owner: owner.publicKey,
        policyAccount: policyPDA,
      })
      .signers([owner])
      .rpc();
  }

  /**
   * Pause an agent's policy.
   */
  public async pauseAgent(owner: Keypair, agent: PublicKey): Promise<TransactionSignature> {
    const [policyPDA] = PolicyManagerClient.getPolicyPDA(agent, this.program.programId);

    return await this.program.methods
      .pauseAgent()
      .accounts({
        owner: owner.publicKey,
        policyAccount: policyPDA,
      })
      .signers([owner])
      .rpc();
  }

  /**
   * Resume a paused agent policy.
   */
  public async resumeAgent(owner: Keypair, agent: PublicKey): Promise<TransactionSignature> {
    const [policyPDA] = PolicyManagerClient.getPolicyPDA(agent, this.program.programId);

    return await this.program.methods
      .resumeAgent()
      .accounts({
        owner: owner.publicKey,
        policyAccount: policyPDA,
      })
      .signers([owner])
      .rpc();
  }

  /**
   * Execute emergency clawback using the Permanent Delegate.
   */
  public async emergencyClawback(
    owner: Keypair,
    agent: PublicKey,
    agentTokenAccount: PublicKey,
    recoveryTokenAccount: PublicKey,
    mint: PublicKey,
    sessionPDA: PublicKey,
    amount: BN,
    sessionTrackerProgramId: PublicKey = SESSION_TRACKER_PROGRAM_ID
  ): Promise<TransactionSignature> {
    const [policyPDA] = PolicyManagerClient.getPolicyPDA(agent, this.program.programId);
    const [delegatePDA] = PolicyManagerClient.getDelegatePDA(owner.publicKey, this.program.programId);
    const [extraAccountMetaListPDA] = PolicyManagerClient.getExtraAccountMetaListPDA(mint, this.program.programId);

    return await this.program.methods
      .emergencyClawback(amount)
      .accounts({
        owner: owner.publicKey,
        agent: agent,
        policyAccount: policyPDA,
        agentTokenAccount: agentTokenAccount,
        recoveryTokenAccount: recoveryTokenAccount,
        tokenMint: mint,
        delegatePda: delegatePDA,
        extraAccountMetaList: extraAccountMetaListPDA,
        policyManagerProgram: this.program.programId,
        sessionTrackerProgram: sessionTrackerProgramId,
        sessionAccount: sessionPDA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
  }

  /**
   * Fetch policy state account.
   */
  public async getPolicy(policyPDA: PublicKey): Promise<PolicyState> {
    const acc = await (this.program.account as any).policyAccount.fetch(policyPDA);
    return acc as PolicyState;
  }
}
