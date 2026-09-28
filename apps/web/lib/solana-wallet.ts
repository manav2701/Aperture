'use client';

import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';

/*
 * Signing treasury transactions in the browser with any Wallet Standard wallet (Phantom,
 * Solflare, Backpack, Squads…). Aperture builds the transaction; the wallet shows it, signs and
 * sends it. The treasury key never leaves the wallet.
 */

type Chain = 'solana:devnet' | 'solana:mainnet';

interface ConnectFeature {
  connect: () => Promise<{ accounts: readonly WalletAccount[] }>;
}
interface SignAndSendFeature {
  signAndSendTransaction: (
    ...inputs: { account: WalletAccount; chain: Chain; transaction: Uint8Array }[]
  ) => Promise<{ signature: Uint8Array }[]>;
}

const CONNECT = 'standard:connect';
const SIGN_AND_SEND = 'solana:signAndSendTransaction';

export function solanaWallets(): Wallet[] {
  return getWallets()
    .get()
    .filter((wallet) => SIGN_AND_SEND in wallet.features && CONNECT in wallet.features);
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = (BASE58[Number(value % 58n)] ?? '') + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/**
 * Connects (if needed) to the wallet holding `treasury`, then signs and sends the base64
 * transaction. Returns the transaction signature (base58).
 */
export async function signAndSend(wallet: Wallet, treasury: string, base64: string, network: 'devnet' | 'mainnet') {
  const connect = wallet.features[CONNECT] as ConnectFeature;
  const { accounts } = await connect.connect();
  const account = accounts.find((candidate) => candidate.address === treasury);
  if (account === undefined) {
    throw new Error(
      `Switch the wallet to the treasury account ${treasury.slice(0, 4)}…${treasury.slice(-4)} and try again.`,
    );
  }
  const transaction = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const feature = wallet.features[SIGN_AND_SEND] as SignAndSendFeature;
  const [result] = await feature.signAndSendTransaction({ account, chain: `solana:${network}`, transaction });
  if (result === undefined) throw new Error('the wallet returned no signature');
  return base58(result.signature);
}

export const explorerUrl = (signature: string, network: string) =>
  `https://explorer.solana.com/tx/${signature}${network === 'mainnet' ? '' : `?cluster=${network}`}`;
