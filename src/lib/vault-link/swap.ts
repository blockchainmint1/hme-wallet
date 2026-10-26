/** Deposit-address swaps use paired UTXOs and offline signing, never the wrapping anchor. */
import type { UtxoSwapCoin } from "@/lib/thorchain/assets";
import type { VaultPairing } from "./pairing";
import type { VaultChainScan, VaultUtxo } from "./scan";
import { chainIo } from "./scan";
import { buildVaultPsbt, nextVaultChangeIndex, verifySignedAgainstPsbt } from "./psbt-build";

export function vaultSwapAccount(scans: VaultChainScan[]) {
  const primary = scans.find((s) => s.purpose === 44) ?? scans[0];
  const utxos = [...new Map(scans.flatMap((s) => s.utxos).map((u) => [`${u.txid}:${u.vout}`, u])).values()];
  return { utxos, nextReceiveAddress: primary?.nextReceive ?? "", primary };
}

export function vaultSwapVsize(inputs: VaultUtxo[], memo: boolean): number {
  return 11 + inputs.reduce((n, u) => n + (u.purpose === 84 ? 68 : u.purpose === 49 ? 91 : 148), 0) + 68 + (memo ? 90 : 0);
}

export async function prepareVaultSwap(args: {
  pairing: VaultPairing; coin: UtxoSwapCoin; scans: VaultChainScan[];
  inputs: VaultUtxo[]; depositAddress: string; amountSats: number; feeSats: number; memo: string | null;
}) {
  const { primary } = vaultSwapAccount(args.scans);
  if (!primary) throw new Error("Pair this Vault's source coin before swapping.");
  const prevTxHex: Record<string, string> = {};
  await Promise.all(args.inputs.filter((u) => u.purpose === 44).map(async (u) => {
    prevTxHex[`${u.txid}:${u.vout}`] = await chainIo(args.coin).txHex(u.txid);
  }));
  const changeIndex = nextVaultChangeIndex(primary);
  return buildVaultPsbt({
    pairing: args.pairing, chain: args.coin, inputs: args.inputs, prevTxHex,
    outputs: [{ address: args.depositAddress, valueSats: args.amountSats }], feeSats: args.feeSats,
    changePurpose: primary.purpose, changeIndex,
    opReturnData: args.memo ? new TextEncoder().encode(args.memo) : undefined,
  });
}

/** Compare every input, output (including memo/change), sequence, version and locktime. */
export function verifySignedVaultSwap(hex: string, psbtBase64: string): string {
  return verifySignedAgainstPsbt(hex, psbtBase64, "swap");
}