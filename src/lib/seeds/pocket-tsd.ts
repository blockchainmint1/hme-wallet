/**
 * Move TSD out of the Seeds Trading pocket back to the main wallet (desktop
 * Seeds Pocket page). Desktop only; the wallet already holds this pocket's keys.
 *
 * One transaction per pocket address that holds TSD:
 *   inputs  = that address's own TXC coins FIRST (TEXITcoin Omni Class C takes
 *             the sender from the first input), then — only if they can't pay
 *             the fee — the fewest, largest coins from other pocket addresses
 *             that hold no TSD;
 *   outputs = [0] OP_RETURN Omni Simple Send of property 39 for the address's
 *             whole TSD balance, [1] the main wallet's TSD address
 *             (m/44'/696969'/0'/0/0) with all input TXC minus the fee — the
 *             sole non-data output, so it is the unambiguous Omni recipient.
 * Nothing ever goes anywhere but the member's own main address #0.
 */
import { address as addr, payments, Psbt, Transaction } from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { TXC_NETWORK } from "@/lib/txc/network";
import { buildSimpleSendPayload } from "@/lib/txc/tokens";
import { TXC_MAX_FEE_RATE } from "@/lib/txc/wallet";
import * as txcApi from "@/lib/txc/mempool";
import { mainReceiveAddress, pocketAddresses, type PocketAddress } from "./pocket";

export const POCKET_TSD_PROPERTY = 39;
/** TXC dust floor; the recipient output must be at least this. */
export const POCKET_TSD_MIN_OUTPUT = 10_000;
const IN_VB = 149;

export interface PocketCoin { a: PocketAddress; txid: string; vout: number; value: number }

export const pocketTsdFee = (inputs: number, feeRate: number) => (10 + inputs * IN_VB + 34 + 31) * feeRate;

function checkRate(feeRate: number) {
  if (!Number.isSafeInteger(feeRate) || feeRate < 1 || feeRate >= TXC_MAX_FEE_RATE)
    throw new Error("The TXC network fee estimate is unavailable or unusually high, so nothing was sent.");
}

const p2pkh = (pubkey: Uint8Array) => {
  const s = payments.p2pkh({ pubkey, network: TXC_NETWORK }).output;
  if (!s) throw new Error("Could not derive the TXC address script.");
  return s;
};
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Fewest, largest-first coins from TSD-free pocket addresses, only if the holder's own TXC can't pay. */
export function selectPocketFeeCoins(holderCoins: readonly PocketCoin[], candidates: readonly PocketCoin[], feeRate: number): PocketCoin[] {
  checkRate(feeRate);
  let total = holderCoins.reduce((s, u) => s + u.value, 0);
  const picked: PocketCoin[] = [];
  const enough = () => total - pocketTsdFee(holderCoins.length + picked.length, feeRate) >= POCKET_TSD_MIN_OUTPUT;
  if (enough()) return picked;
  for (const u of [...candidates].sort((x, y) => y.value - x.value)) {
    picked.push(u);
    total += u.value;
    if (enough()) return picked;
  }
  throw new Error("There isn't enough TXC in the pocket to pay the fee for moving the TSD. Nothing was sent.");
}

/** Build and sign one pocket TSD move. Pure: no network. */
export function buildPocketTsdMove(req: {
  holder: PocketAddress;
  holderCoins: PocketCoin[];
  feeCoins: PocketCoin[];
  prevTxHex: Record<string, string>;
  units: bigint;
  to: string;
  feeRate: number;
}): { hex: string; txid: string; feeSats: number; txcSats: number } {
  checkRate(req.feeRate);
  if (req.units <= 0n) throw new Error("This address holds no TSD.");
  if (req.holderCoins.length === 0)
    throw new Error(`Pocket address ${req.holder.address} holds TSD but no TXC to send it with. Withdraw that TSD on Seeds instead.`);
  try { addr.toOutputScript(req.to, TXC_NETWORK); } catch { throw new Error("The main wallet's TSD address is invalid."); }
  const holderScript = p2pkh(req.holder.node.publicKey);
  if (req.holderCoins.some((u) => u.a.address !== req.holder.address)) throw new Error("The TSD sender's coins must all be on the TSD address.");
  if (req.feeCoins.some((u) => u.a.address === req.holder.address)) throw new Error("Fee coins must come from other pocket addresses.");
  const psbt = new Psbt({ network: TXC_NETWORK, maximumFeeRate: 10_000_000 });
  const seen = new Set<string>();
  let total = 0;
  const coins = [...req.holderCoins, ...req.feeCoins]; // holder FIRST: it is the Omni sender
  for (const u of coins) {
    const key = `${u.txid}:${u.vout}`;
    if (seen.has(key)) throw new Error("Duplicate TXC input.");
    seen.add(key);
    if (!Number.isSafeInteger(u.value) || u.value <= 0 || !Number.isSafeInteger(u.vout) || u.vout < 0) throw new Error("Invalid TXC coin.");
    const raw = req.prevTxHex[u.txid];
    if (!raw || !/^(?:[0-9a-fA-F]{2})+$/.test(raw)) throw new Error("Missing previous TXC transaction.");
    const prev = Transaction.fromHex(raw);
    const out = prev.outs[u.vout];
    if (prev.getId() !== u.txid || !out || out.value !== BigInt(u.value) || !same(out.script, p2pkh(u.a.node.publicKey)))
      throw new Error("A previous TXC transaction doesn't match the pocket coin. Nothing was sent.");
    psbt.addInput({ hash: u.txid, index: u.vout, nonWitnessUtxo: prev.toBuffer() });
    total += u.value;
  }
  if (!same(p2pkh(req.holderCoins[0]!.a.node.publicKey), holderScript)) throw new Error("The first coin must be on the TSD address.");
  const feeSats = pocketTsdFee(coins.length, req.feeRate);
  const txcSats = total - feeSats;
  if (!Number.isSafeInteger(txcSats) || txcSats < POCKET_TSD_MIN_OUTPUT)
    throw new Error("There isn't enough TXC in the pocket to pay the fee for moving the TSD. Nothing was sent.");
  const data = payments.embed({ data: [buildSimpleSendPayload(POCKET_TSD_PROPERTY, req.units) as unknown as Buffer] }).output;
  if (!data) throw new Error("Could not encode the TSD transfer.");
  psbt.addOutput({ script: data, value: 0n });
  psbt.addOutput({ address: req.to, value: BigInt(txcSats) });
  coins.forEach((u, i) => psbt.signInput(i, { publicKey: u.a.node.publicKey, sign: (h) => ecc.sign(h, u.a.node.privateKey!) }));
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  if (feeSats / tx.virtualSize() >= TXC_MAX_FEE_RATE) throw new Error("The TXC network fee is unusually high, so nothing was sent.");
  return { hex: tx.toHex(), txid: tx.getId(), feeSats, txcSats };
}

export interface PocketTsdResult { address: string; units: bigint; txid?: string; error?: string }

/**
 * Move every pocket address's TSD to the main wallet's TSD address, one
 * transaction per holder, stopping at the first failure.
 * `perAddress` = TSD units per pocket TXC address, read just before.
 */
export async function movePocketTsd(seed: Uint8Array, account: number, perAddress: Record<string, bigint>): Promise<PocketTsdResult[]> {
  const to = mainReceiveAddress(seed, "TXC");
  const addrs = pocketAddresses(seed, "TXC", account);
  const holders = addrs.filter((a) => (perAddress[a.address] ?? 0n) > 0n);
  if (holders.length === 0) return [];
  const holderSet = new Set(holders.map((h) => h.address));
  const fees = await txcApi.getFeeEstimates().catch(() => null);
  const feeRate = Math.max(10, Math.ceil(fees?.halfHourFee ?? 10));
  const used = new Set<string>();
  const results: PocketTsdResult[] = [];
  for (const holder of holders) {
    const units = perAddress[holder.address]!;
    try {
      const lists = await Promise.all(addrs.map((a) => txcApi.getAddressUtxos(a.address).then((l) => l.map((u) => ({ a, txid: u.txid, vout: u.vout, value: u.value })))));
      const all = lists.flat().filter((u) => !used.has(`${u.txid}:${u.vout}`));
      const holderCoins = all.filter((u) => u.a.address === holder.address).sort((x, y) => y.value - x.value);
      const feeCoins = selectPocketFeeCoins(holderCoins, all.filter((u) => !holderSet.has(u.a.address)), feeRate);
      const prevTxHex: Record<string, string> = {};
      for (const u of [...holderCoins, ...feeCoins]) prevTxHex[u.txid] ??= await txcApi.getTxHexCached(u.txid);
      const built = buildPocketTsdMove({ holder, holderCoins, feeCoins, prevTxHex, units, to, feeRate });
      const sent = (await txcApi.broadcastTx(built.hex)).trim();
      if (sent && sent !== built.txid) throw new Error("The network returned a different transaction ID. Check the explorer before trying again.");
      for (const u of [...holderCoins, ...feeCoins]) used.add(`${u.txid}:${u.vout}`);
      results.push({ address: holder.address, units, txid: built.txid });
    } catch (e) {
      results.push({ address: holder.address, units, error: (e as Error).message.slice(0, 200) });
      break;
    }
  }
  return results;
}
