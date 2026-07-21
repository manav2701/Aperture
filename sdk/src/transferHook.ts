import {
  Connection,
  PublicKey,
  TransactionInstruction,
  Signer,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";

export class TransferHookHelper {
  /**
   * Helper to construct a transferChecked instruction with transfer hook remaining accounts resolved.
   */
  public static async createTransferInstruction(
    connection: Connection,
    source: PublicKey,
    mint: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    amount: bigint,
    decimals: number,
    multiSigners: (Signer | PublicKey)[] = [],
    tokenProgramId: PublicKey = TOKEN_2022_PROGRAM_ID
  ): Promise<TransactionInstruction> {
    return await createTransferCheckedWithTransferHookInstruction(
      connection,
      source,
      mint,
      destination,
      owner,
      amount,
      decimals,
      multiSigners,
      undefined,
      tokenProgramId
    );
  }
}
