import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import {
  PolicyManagerClient,
  SessionTrackerClient,
  AgentPolicyGuard,
  AutoSessionRenewer,
  PolicyParams,
} from "../sdk/src";

async function main() {
  console.log("==================================================");
  console.log("🤖 Aperture v2 AI Agent Policy & Session Demo");
  console.log("==================================================\n");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const policyManagerProgram = anchor.workspace.PolicyManager as Program;
  const sessionTrackerProgram = anchor.workspace.SessionTracker as Program;

  const policyClient = new PolicyManagerClient(policyManagerProgram);
  const sessionClient = new SessionTrackerClient(sessionTrackerProgram);
  const autoRenewer = new AutoSessionRenewer(sessionClient);

  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const approvedDEX = Keypair.generate();
  const maliciousRecipient = Keypair.generate();

  console.log("1. Airdrop SOL to owner and agent wallets...");
  const airdrop1 = await provider.connection.requestAirdrop(owner.publicKey, 5 * 1_000_000_000);
  await provider.connection.confirmTransaction(airdrop1);
  const airdrop2 = await provider.connection.requestAirdrop(agent.publicKey, 2 * 1_000_000_000);
  await provider.connection.confirmTransaction(airdrop2);
  console.log("   Done!\n");

  console.log("2. Creating Policy for AI Agent wallet...");
  const policyParams: PolicyParams = {
    dailyLimit: new BN(100 * 1_000_000_000),      // 100 SOL daily
    perTxLimit: new BN(20 * 1_000_000_000),       // 20 SOL max per tx
    allowlist: [approvedDEX.publicKey],           // Approved DEX pool only
    velocityMaxTxPerHour: 10,
  };

  const { policyPDA } = await policyClient.createPolicy(owner, agent.publicKey, policyParams);
  console.log(`   Policy Account created: ${policyPDA.toBase58()}\n`);

  console.log("3. Pre-flight Guard Check for AI Agent Transaction:");
  const policyState = await policyClient.getPolicy(policyPDA);

  // Valid pre-flight check
  console.log("   Checking valid transfer of 10 SOL to Approved DEX...");
  AgentPolicyGuard.validatePreflight(
    policyState,
    new BN(10 * 1_000_000_000),
    approvedDEX.publicKey
  );
  console.log("   ✅ Pre-flight passed!\n");

  // Blocked per-tx limit
  console.log("   Checking transfer of 50 SOL (exceeds 20 SOL limit)...");
  try {
    AgentPolicyGuard.validatePreflight(
      policyState,
      new BN(50 * 1_000_000_000),
      approvedDEX.publicKey
    );
  } catch (err: any) {
    console.log(`   🛑 BLOCKED by AgentPolicyGuard: ${err.message}\n`);
  }

  // Blocked non-allowlisted recipient
  console.log("   Checking transfer to unauthorized address...");
  try {
    AgentPolicyGuard.validatePreflight(
      policyState,
      new BN(5 * 1_000_000_000),
      maliciousRecipient.publicKey
    );
  } catch (err: any) {
    console.log(`   🛑 BLOCKED by AgentPolicyGuard: ${err.message}\n`);
  }

  console.log("4. Opening Session Budget for Autonomous Execution...");
  const sessionId = Keypair.generate().publicKey;
  const budget = new BN(50 * 1_000_000_000);
  const now = Math.floor(Date.now() / 1000);

  const { sessionPDA } = await sessionClient.openSession(
    owner,
    policyPDA,
    sessionId,
    budget,
    new BN(now),
    new BN(now + 3600),
    true
  );
  console.log(`   Session Account created: ${sessionPDA.toBase58()}\n`);

  console.log("5. Auto-Session Renewer verification...");
  const activeSessionPDA = await autoRenewer.ensureActiveSession(
    owner,
    policyPDA,
    Keypair.generate().publicKey,
    new BN(50 * 1_000_000_000),
    3600,
    new BN(10 * 1_000_000_000)
  );
  console.log(`   Session active and verified: ${activeSessionPDA.toBase58()}\n`);

  console.log("==================================================");
  console.log("🎉 Aperture v2 End-to-End Demo Completed Successfully!");
  console.log("==================================================");
}

describe("Aperture v2 AI Agent End-to-End Demo", () => {
  it("Runs full end-to-end demo flow", async () => {
    await main();
  });
});
