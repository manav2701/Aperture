import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import {
  PolicyManagerClient,
  SessionTrackerClient,
  AgentPolicyGuard,
  AutoSessionRenewer,
  PolicyParams,
} from "../src";

describe("Aperture SDK Test Suite", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const policyManagerProgram = anchor.workspace.PolicyManager as Program;
  const sessionTrackerProgram = anchor.workspace.SessionTracker as Program;

  const policyClient = new PolicyManagerClient(policyManagerProgram);
  const sessionClient = new SessionTrackerClient(sessionTrackerProgram);
  const autoRenewer = new AutoSessionRenewer(sessionClient);

  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const allowlistedRecipient = Keypair.generate();
  const unauthorizedRecipient = Keypair.generate();

  let policyPDA: PublicKey;
  let sessionPDA: PublicKey;

  before(async () => {
    // Airdrop SOL to owner and agent
    const airdropOwner = await provider.connection.requestAirdrop(owner.publicKey, 10 * 1_000_000_000);
    await provider.connection.confirmTransaction(airdropOwner);

    const airdropAgent = await provider.connection.requestAirdrop(agent.publicKey, 5 * 1_000_000_000);
    await provider.connection.confirmTransaction(airdropAgent);
  });

  it("SDK: Creates a policy for an agent", async () => {
    const params: PolicyParams = {
      dailyLimit: new BN(500 * 1_000_000),
      perTxLimit: new BN(100 * 1_000_000),
      allowlist: [allowlistedRecipient.publicKey],
      velocityMaxTxPerHour: 5,
    };

    const res = await policyClient.createPolicy(owner, agent.publicKey, params);
    policyPDA = res.policyPDA;

    const state = await policyClient.getPolicy(policyPDA);
    expect(state.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(state.agent.toBase58()).to.equal(agent.publicKey.toBase58());
    expect(state.dailyLimit.toNumber()).to.equal(500 * 1_000_000);
    expect(state.perTxLimit.toNumber()).to.equal(100 * 1_000_000);
    expect(state.allowlist[0].toBase58()).to.equal(allowlistedRecipient.publicKey.toBase58());
  });

  it("SDK: Pre-flight policy guard passes valid transfer and blocks violations", async () => {
    const policyState = await policyClient.getPolicy(policyPDA);

    // 1. Valid transfer pre-flight
    expect(() => {
      AgentPolicyGuard.validatePreflight(
        policyState,
        new BN(50 * 1_000_000),
        allowlistedRecipient.publicKey
      );
    }).to.not.throw();

    // 2. Exceed single tx limit
    expect(() => {
      AgentPolicyGuard.validatePreflight(
        policyState,
        new BN(150 * 1_000_000),
        allowlistedRecipient.publicKey
      );
    }).to.throw("exceeds single tx limit");

    // 3. Non-allowlisted recipient
    expect(() => {
      AgentPolicyGuard.validatePreflight(
        policyState,
        new BN(50 * 1_000_000),
        unauthorizedRecipient.publicKey
      );
    }).to.throw("is not in policy allowlist");
  });

  it("SDK: Session Tracker Client opens and fetches session budget", async () => {
    const sessionId = Keypair.generate().publicKey;
    const budget = new BN(200 * 1_000_000);
    const now = Math.floor(Date.now() / 1000);
    const startsAt = new BN(now);
    const expiresAt = new BN(now + 3600);

    const res = await sessionClient.openSession(
      owner,
      policyPDA,
      sessionId,
      budget,
      startsAt,
      expiresAt,
      true
    );
    sessionPDA = res.sessionPDA;

    const sessionState = await sessionClient.getSession(sessionPDA);
    expect(sessionState.budget.toNumber()).to.equal(200 * 1_000_000);
    expect(sessionState.spent.toNumber()).to.equal(0);
    expect(sessionState.autoRenew).to.be.true;
  });

  it("SDK: AutoSessionRenewer detects and manages session renewals", async () => {
    const newSessionId = Keypair.generate().publicKey;
    const budget = new BN(300 * 1_000_000);
    const minRemainingBudget = new BN(50 * 1_000_000);

    const activeSessionPDA = await autoRenewer.ensureActiveSession(
      owner,
      policyPDA,
      newSessionId,
      budget,
      3600,
      minRemainingBudget
    );

    expect(activeSessionPDA.toBase58()).to.equal(sessionPDA.toBase58());
  });

  it("SDK: Pauses and Resumes agent policy", async () => {
    await policyClient.pauseAgent(owner, agent.publicKey);
    let state = await policyClient.getPolicy(policyPDA);
    expect(state.isPaused).to.be.true;

    await policyClient.resumeAgent(owner, agent.publicKey);
    state = await policyClient.getPolicy(policyPDA);
    expect(state.isPaused).to.be.false;
  });
});
