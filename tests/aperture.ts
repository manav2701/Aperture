import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  TOKEN_2022_PROGRAM_ID,
  createAccount,
  mintTo,
  createInitializeTransferHookInstruction,
  createInitializePermanentDelegateInstruction,
  ExtensionType,
  getMintLen,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";

import { PolicyManager } from "../target/types/policy_manager";
import { SessionTracker } from "../target/types/session_tracker";

describe("Aperture Compliance Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const policyManager = anchor.workspace.PolicyManager as Program<PolicyManager>;
  const sessionTracker = anchor.workspace.SessionTracker as Program<SessionTracker>;

  const owner = anchor.web3.Keypair.generate();
  const agent = anchor.web3.Keypair.generate();
  const recipient = anchor.web3.Keypair.generate();
  const badRecipient = anchor.web3.Keypair.generate();
  const recoveryAccountOwner = anchor.web3.Keypair.generate();

  let mint: anchor.web3.PublicKey;
  let agentTokenAccount: anchor.web3.PublicKey;
  let recipientTokenAccount: anchor.web3.PublicKey;
  let badRecipientTokenAccount: anchor.web3.PublicKey;
  let recoveryTokenAccount: anchor.web3.PublicKey;

  let policyPDA: anchor.web3.PublicKey;
  let policyBump: number;
  let delegatePDA: anchor.web3.PublicKey;
  let delegateBump: number;
  let extraAccountMetaListPDA: anchor.web3.PublicKey;
  let extraAccountMetaListBump: number;
  let sessionPDA: anchor.web3.PublicKey;

  before(async () => {
    // Airdrop SOL to owner and agent for transaction fees
    const ownerSig = await provider.connection.requestAirdrop(owner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(ownerSig);

    const agentSig = await provider.connection.requestAirdrop(agent.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(agentSig);

    // Derive PDAs
    [policyPDA, policyBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), agent.publicKey.toBuffer()],
      policyManager.programId
    );

    [delegatePDA, delegateBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("delegate"), owner.publicKey.toBuffer()],
      policyManager.programId
    );

    // Derive Session PDA statically using policyPDA as seed
    [sessionPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("session"), policyPDA.toBuffer()],
      sessionTracker.programId
    );

    // Generate a fresh Token-2022 Mint with Transfer Hook and Permanent Delegate extensions
    const mintKeypair = anchor.web3.Keypair.generate();
    mint = mintKeypair.publicKey;

    [extraAccountMetaListPDA, extraAccountMetaListBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mint.toBuffer()],
      policyManager.programId
    );

    // Create the mint account with exact Extensions space layout
    const extensionTypes = [ExtensionType.PermanentDelegate, ExtensionType.TransferHook];
    const space = getMintLen(extensionTypes);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(space);

    const initializeTransferHookIx = createInitializeTransferHookInstruction(
      mint,
      owner.publicKey, // authority
      policyManager.programId,
      TOKEN_2022_PROGRAM_ID
    );

    const initializePermanentDelegateIx = createInitializePermanentDelegateInstruction(
      mint,
      delegatePDA,
      TOKEN_2022_PROGRAM_ID
    );

    // We build the actual mint creation transaction manually to combine the extensions initialization
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mint,
        space,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      initializePermanentDelegateIx,
      initializeTransferHookIx,
      // Initialize Mint
      {
        keys: [
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        programId: TOKEN_2022_PROGRAM_ID,
        data: Buffer.from([
          0, // InitializeMint instruction discriminator
          9, // decimals
          ...owner.publicKey.toBuffer(), // mint authority
          1, // freeze authority option (1 = Some)
          ...owner.publicKey.toBuffer(), // freeze authority
        ]),
      }
    );

    await provider.sendAndConfirm(tx, [mintKeypair]);

    // Create Token Accounts using Token-2022
    agentTokenAccount = await createAccount(
      provider.connection,
      owner, // payer
      mint,
      agent.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    recipientTokenAccount = await createAccount(
      provider.connection,
      owner,
      mint,
      recipient.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    badRecipientTokenAccount = await createAccount(
      provider.connection,
      owner,
      mint,
      badRecipient.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    recoveryTokenAccount = await createAccount(
      provider.connection,
      owner,
      mint,
      recoveryAccountOwner.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Mint some initial tokens to the Agent account
    await mintTo(
      provider.connection,
      owner,
      mint,
      agentTokenAccount,
      owner,
      10_000 * 1_000_000_000, // 10,000 tokens
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("Initializes ExtraAccountMetaList", async () => {
    await policyManager.methods
      .initializeExtraAccountMetaList()
      .accounts({
        payer: owner.publicKey,
        extraAccountMetaList: extraAccountMetaListPDA,
        mint: mint,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // Verify extra account meta list account exists
    const accountInfo = await provider.connection.getAccountInfo(extraAccountMetaListPDA);
    expect(accountInfo).to.not.be.null;
  });

  it("Creates a Policy", async () => {
    const dailyLimit = new anchor.BN(1000 * 1_000_000_000); // 1000 tokens
    const perTxLimit = new anchor.BN(100 * 1_000_000_000); // 100 tokens
    const allowlist = [recipient.publicKey];
    const velocityMaxTxPerHour = 5;

    await policyManager.methods
      .createPolicy(dailyLimit, perTxLimit, allowlist, velocityMaxTxPerHour)
      .accounts({
        owner: owner.publicKey,
        agent: agent.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const policyState = await policyManager.account.policyAccount.fetch(policyPDA);
    expect(policyState.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(policyState.agent.toBase58()).to.equal(agent.publicKey.toBase58());
    expect(policyState.dailyLimit.toString()).to.equal(dailyLimit.toString());
    expect(policyState.perTxLimit.toString()).to.equal(perTxLimit.toString());
    expect(policyState.allowlist[0].toBase58()).to.equal(recipient.publicKey.toBase58());
    expect(policyState.isPaused).to.be.false;
  });

  it("Executes a Compliant Transfer Hook Gated Transfer", async () => {
    const amount = new anchor.BN(50 * 1_000_000_000); // 50 tokens (under limits)

    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      agentTokenAccount,
      mint,
      recipientTokenAccount,
      agent.publicKey,
      amount.toNumber(),
      9,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction().add(transferIx);
    await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [agent]);

    // Check balance update
    const recipientBalance = await provider.connection.getTokenAccountBalance(recipientTokenAccount);
    expect(recipientBalance.value.uiAmount).to.equal(50);

    const policyState = await policyManager.account.policyAccount.fetch(policyPDA);
    expect(policyState.spentToday.toString()).to.equal(amount.toString());
  });

  it("Rejects Transfer Exceeding Single Tx Limit", async () => {
    const amount = new anchor.BN(150 * 1_000_000_000); // 150 tokens (limit is 100)

    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      agentTokenAccount,
      mint,
      recipientTokenAccount,
      agent.publicKey,
      amount.toNumber(),
      9,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction().add(transferIx);
    try {
      await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [agent]);
      expect.fail("Should have failed with single tx limit violation");
    } catch (err: any) {
      expect(err.logs.toString()).to.include("Single transaction cap exceeded");
    }
  });

  it("Rejects Transfer to Non-Allowlisted Recipient", async () => {
    const amount = new anchor.BN(10 * 1_000_000_000);

    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      agentTokenAccount,
      mint,
      badRecipientTokenAccount,
      agent.publicKey,
      amount.toNumber(),
      9,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction().add(transferIx);
    try {
      await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [agent]);
      expect.fail("Should have failed with allowlist violation");
    } catch (err: any) {
      expect(err.logs.toString()).to.include("Recipient is not in the approved allowlist");
    }
  });

  it("Creates a Session Budget", async () => {
    const sessionId = anchor.web3.Keypair.generate().publicKey;
    const budget = new anchor.BN(80 * 1_000_000_000); // 80 tokens session budget
    const startsAt = new anchor.BN(0);
    const expiresAt = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour active window

    await sessionTracker.methods
      .openSession(sessionId, budget, startsAt, expiresAt, false)
      .accounts({
        owner: owner.publicKey,
        policy: policyPDA,
        sessionAccount: sessionPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const sessionState = await sessionTracker.account.sessionAccount.fetch(sessionPDA);
    expect(sessionState.policy.toBase58()).to.equal(policyPDA.toBase58());
    expect(sessionState.budget.toString()).to.equal(budget.toString());
    expect(sessionState.spent.toString()).to.equal("0");
  });

  it("Enforces Session Budget dynamically through Remaining Accounts", async () => {
    const sessionId = anchor.web3.Keypair.generate().publicKey;
    const budget = new anchor.BN(80 * 1_000_000_000); // 80 tokens session budget
    const startsAt = new anchor.BN(0);
    const expiresAt = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);

    // Since the session PDA is static, we first close the old session before opening a new one
    try {
      await sessionTracker.methods
        .closeSession()
        .accounts({
          owner: owner.publicKey,
          policy: policyPDA,
          sessionAccount: sessionPDA,
        })
        .signers([owner])
        .rpc();
    } catch {}

    // 1. Open the session budget
    await sessionTracker.methods
      .openSession(sessionId, budget, startsAt, expiresAt, false)
      .accounts({
        owner: owner.publicKey,
        policy: policyPDA,
        sessionAccount: sessionPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // 2. Perform a transfer (the extraAccountMetaList dynamically resolves sessionPDA and includes it!)
    const amount = new anchor.BN(30 * 1_000_000_000); // 30 tokens (under 80 session limit)
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      agentTokenAccount,
      mint,
      recipientTokenAccount,
      agent.publicKey,
      amount.toNumber(),
      9,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction().add(transferIx);
    await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [agent]);

    // Check that session budget spent is updated
    const sessionState = await sessionTracker.account.sessionAccount.fetch(sessionPDA);
    expect(sessionState.spent.toString()).to.equal(amount.toString());

    // 3. Perform another transfer exceeding session remaining budget (e.g. 60 tokens)
    const overAmount = new anchor.BN(60 * 1_000_000_000);
    const badTransferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      agentTokenAccount,
      mint,
      recipientTokenAccount,
      agent.publicKey,
      overAmount.toNumber(),
      9,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    try {
      const badTx = new anchor.web3.Transaction().add(badTransferIx);
      await anchor.web3.sendAndConfirmTransaction(provider.connection, badTx, [agent]);
      expect.fail("Should have failed with session budget violation");
    } catch (err: any) {
      expect(err.logs.toString()).to.include("Session budget exceeded");
    }
  });

  it("Executes Emergency Clawback and Bypasses Policy", async () => {
    // Recover 1000 tokens from the agent account using clawback CPI
    const recoverAmount = new anchor.BN(1000 * 1_000_000_000);

    // Call clawback instruction using owner authority
    await policyManager.methods
      .emergencyClawback(recoverAmount)
      .accounts({
        owner: owner.publicKey,
        agent: agent.publicKey,
        policyAccount: policyPDA,
        agentTokenAccount: agentTokenAccount,
        recoveryTokenAccount: recoveryTokenAccount,
        tokenMint: mint,
        delegatePda: delegatePDA,
        extraAccountMetaList: extraAccountMetaListPDA,
        policyManagerProgram: policyManager.programId,
        sessionTrackerProgram: sessionTracker.programId,
        sessionAccount: sessionPDA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    // Verify recovery token balance
    const recoveryBalance = await provider.connection.getTokenAccountBalance(recoveryTokenAccount);
    expect(recoveryBalance.value.uiAmount).to.equal(1000);
  });
});
