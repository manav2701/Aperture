// Debug script: inspect how addExtraAccountMetasForExecute builds the instruction
const anchor = require("@coral-xyz/anchor");
const {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
  addExtraAccountMetasForExecute,
  getTransferHook,
  getMint,
} = require("@solana/spl-token");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const policyManager = anchor.workspace.PolicyManager;
  const sessionTracker = anchor.workspace.SessionTracker;

  // We need the mint address. Let's read the existing state to get it.
  // For now, just print the function source to understand the account ordering
  console.log("=== Inspecting addExtraAccountMetasForExecute ===");
  console.log("Function source:");
  console.log(addExtraAccountMetasForExecute.toString().substring(0, 2000));
}

main().catch(console.error);
