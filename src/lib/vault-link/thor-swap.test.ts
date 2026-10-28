import { describe, expect, it, vi } from "vitest";
import { Psbt, Transaction, payments } from "bitcoinjs-lib";
import { rootFromSeed } from "@/lib/txc/wallet";
import { prepareVaultThorSwap, verifyVaultThorResult, validateVaultThorQuote, vaultThorAddress } from "./thor-swap";
import { deriveVaultAddress, VAULT_CHAIN_META } from "./derive";
import type { VaultPairing } from "./pairing";
import type { ThorCatalogQuote } from "@/lib/thorchain/catalog";
import { chainIo } from "./scan";
import { vaultSwapExecutionAllowed } from "@/lib/security/vault-swap-policy";

const root = rootFromSeed(new Uint8Array(32).fill(13));
const pairing: VaultPairing = { v: 1, fp: Array.from(root.fingerprint, b => b.toString(16).padStart(2,"0")).join(""), pairedAt: 0, chains: { btc: { "84": root.derivePath("m/84'/0'/0'").neutered().toBase58() }, doge: { "44": root.derivePath("m/44'/3'/0'").neutered().toBase58() } }, evm: { address: "0x1111111111111111111111111111111111111111", path: "m/44'/60'/0'/0/0" } };
function quote(coin: "btc" | "doge"): ThorCatalogQuote {
  return { provider: "thorchain", from: coin, to: "usdc-eth", rawIn: "100000000", amountIn: "100000000", destination: pairing.evm?.address ?? "", inbound: deriveVaultAddress(pairing,coin, coin === "btc" ? 84 : 44,0,1).address, router: null, memo: "=:ETH.USDC:0x1111111111111111111111111111111111111111:99000000/1/0", expiry: Math.floor(Date.now()/1000)+900, expectedOut:"100000000", minimumOut:"99000000", feeOut:"1000000", seconds:60, toleranceBps:100, quotedAt:Date.now() };
}
async function fixture(coin: "btc" | "doge") {
  const holder = deriveVaultAddress(pairing,coin,coin === "btc" ? 84 : 44,0,0);
  const previous = new Transaction(); previous.addInput(new Uint8Array(32).fill(4),0);
  const output = coin === "btc" ? payments.p2wpkh({ pubkey:holder.pubkey,network:VAULT_CHAIN_META[coin].network }).output : payments.p2pkh({pubkey:holder.pubkey,network:VAULT_CHAIN_META[coin].network}).output;
  if (!output) throw new Error("Missing fixture script");
  previous.addOutput(output, 400_000_000n);
  const mock = vi.spyOn(chainIo(coin),"txHex").mockResolvedValue(previous.toHex());
  const input = {...holder,txid:previous.getId(),vout:0,value:400_000_000};
  const prepared = await prepareVaultThorSwap(pairing,quote(coin),[input],coin === "btc" ? 1 : 1000);
  const psbt = Psbt.fromBase64(prepared.payload,{network:VAULT_CHAIN_META[coin].network});
  return { prepared, psbt, holder, mock };
}
describe("review-only Vault THORChain preparation", () => {
  it("keeps all-build Vault execution blocked", () => expect(vaultSwapExecutionAllowed("vault")).toBe(false));
  it("auto-fills paired addresses, never the wrapping root", () => {
    expect(vaultThorAddress(pairing,"usdc-eth")).toBe(pairing.evm?.address);
    expect(vaultThorAddress(pairing,"btc")).toBe(deriveVaultAddress(pairing,"btc",84,0,0).address);
    expect(vaultThorAddress({...pairing,evm:undefined},"eth")).toBeNull();
  });
  it("refuses changed payout and affiliate instructions", () => {
    expect(() => validateVaultThorQuote({...quote("btc"),destination:"0x2222222222222222222222222222222222222222"})).toThrow();
    expect(() => validateVaultThorQuote({...quote("btc"),memo:quote("btc").memo+":affiliate:10"})).toThrow();
  });
  it("refuses expiry and altered native amount", () => {
    expect(() => validateVaultThorQuote({...quote("btc"),expiry:0})).toThrow();
    expect(() => validateVaultThorQuote({...quote("btc"),rawIn:"2"})).toThrow();
  });
  for (const coin of ["btc","doge"] as const) {
    it(`${coin}: deposit is first, change returns to input holder, memo is last`, async () => {
      const { prepared,psbt,holder,mock } = await fixture(coin);
      expect(psbt.txOutputs[0].address).toBe(prepared.quote.inbound);
      expect(psbt.txOutputs[0].value).toBe(100_000_000n);
      expect(psbt.txOutputs[1].address).toBe(holder.address);
      expect(psbt.txOutputs[2].script[0]).toBe(106);
      expect(prepared.refundAddress).toBe(holder.address);
      expect(psbt.data.inputs[0].sighashType).toBe(Transaction.SIGHASH_ALL);
      psbt.signInput(0,root.derivePath(holder.path)); psbt.finalizeAllInputs();
      const tx = psbt.extractTransaction(true);
      await expect(verifyVaultThorResult(tx.toHex(),prepared)).resolves.toBeUndefined();
      tx.outs[0].value -= 1n;
      await expect(verifyVaultThorResult(tx.toHex(),prepared)).rejects.toThrow();
      mock.mockRestore();
    });
  }
  it("refuses fake signature bytes even when outputs match", async () => {
    const { prepared,psbt,holder,mock } = await fixture("btc");
    const tx = new Transaction(); tx.version=psbt.version;tx.locktime=psbt.locktime;
    for (const i of psbt.txInputs) tx.addInput(i.hash,i.index,i.sequence);
    for (const o of psbt.txOutputs) tx.addOutput(o.script,o.value);
    tx.setWitness(0,[new Uint8Array([1]),holder.pubkey]);
    await expect(verifyVaultThorResult(tx.toHex(),prepared)).rejects.toThrow(); mock.mockRestore();
  });
  it("refuses a BTC fee at the fixed Vault cap", async () => {
    await expect(prepareVaultThorSwap(pairing,quote("btc"),[],5000)).rejects.toThrow(/safety limit/);
  });
});