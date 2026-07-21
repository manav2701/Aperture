import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { SessionTrackerClient } from "../session";
import { SessionState } from "../types";

export class AutoSessionRenewer {
  private sessionClient: SessionTrackerClient;

  constructor(sessionClient: SessionTrackerClient) {
    this.sessionClient = sessionClient;
  }

  /**
   * Check if a session needs renewal based on remaining budget or time.
   */
  public isRenewalRequired(session: SessionState, nowSeconds: number, minRemainingBudget: BN): boolean {
    if (!session.autoRenew) {
      return false;
    }

    const remainingBudget = session.budget.sub(session.spent);
    if (remainingBudget.lte(minRemainingBudget)) {
      return true;
    }

    if (new BN(nowSeconds).gte(session.expiresAt)) {
      return true;
    }

    return false;
  }

  /**
   * Automatically close old session and open a new session budget if renewal is required.
   */
  public async ensureActiveSession(
    owner: Keypair,
    policyPDA: PublicKey,
    newSessionId: PublicKey,
    budget: BN,
    durationSeconds: number,
    minRemainingBudget: BN
  ): Promise<PublicKey> {
    const [sessionPDA] = SessionTrackerClient.getSessionPDA(policyPDA, this.sessionClient.program.programId);
    
    try {
      const currentSession = await this.sessionClient.getSession(sessionPDA);
      const now = Math.floor(Date.now() / 1000);

      if (this.isRenewalRequired(currentSession, now, minRemainingBudget)) {
        // Close expired/depleted session
        await this.sessionClient.closeSession(owner, policyPDA);

        // Open new session
        const startsAt = new BN(now);
        const expiresAt = new BN(now + durationSeconds);
        await this.sessionClient.openSession(
          owner,
          policyPDA,
          newSessionId,
          budget,
          startsAt,
          expiresAt,
          true
        );
      }
    } catch {
      // Session account doesn't exist yet, open initial session
      const now = Math.floor(Date.now() / 1000);
      const startsAt = new BN(now);
      const expiresAt = new BN(now + durationSeconds);
      await this.sessionClient.openSession(
        owner,
        policyPDA,
        newSessionId,
        budget,
        startsAt,
        expiresAt,
        true
      );
    }

    return sessionPDA;
  }
}
