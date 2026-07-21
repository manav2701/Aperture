import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PolicyState } from "../types";

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export class AgentPolicyGuard {
  /**
   * Perform client-side pre-flight checks against an agent's policy state.
   */
  public static validatePreflight(
    policy: PolicyState,
    amount: BN,
    recipient: PublicKey
  ): void {
    if (policy.isPaused) {
      throw new PolicyViolationError("Agent policy is currently paused");
    }

    if (amount.gt(policy.perTxLimit)) {
      throw new PolicyViolationError(
        `Transaction amount ${amount.toString()} exceeds single tx limit ${policy.perTxLimit.toString()}`
      );
    }

    if (policy.spentToday.add(amount).gt(policy.dailyLimit)) {
      throw new PolicyViolationError(
        `Transaction amount ${amount.toString()} exceeds remaining daily limit ${policy.dailyLimit.sub(policy.spentToday).toString()}`
      );
    }

    if (policy.allowlist.length > 0) {
      const isAllowed = policy.allowlist.some((allowed) => allowed.equals(recipient));
      if (!isAllowed) {
        throw new PolicyViolationError(`Recipient ${recipient.toBase58()} is not in policy allowlist`);
      }
    }

    if (policy.velocityMaxTxPerHour > 0 && policy.txCountThisHour >= policy.velocityMaxTxPerHour) {
      throw new PolicyViolationError(`Hourly velocity cap of ${policy.velocityMaxTxPerHour} tx/hr exceeded`);
    }
  }
}
