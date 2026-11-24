import { describe, expect, it, vi } from "vitest";
import { Psbt, Transaction, payments } from "bitcoinjs-lib";
import { rootFromSeed } from "@/lib/txc/wallet";
import { prepareVaultThorSwap, verifyVaultThorResult, validateVaultThorQuote, vaultThorAddress, sumVaultUtxos } from "./thor-swap";
import { deriveVaultAddress, VAULT_CHAIN_META } from "./derive";
import type { VaultPairing } from "./pairing";
import type { ThorCatalogQuote } from "@/lib/thorchain/catalog";
import { chainIo } from "./scan";
import { vaultSwapExecutionAllowed } from "@/lib/security/vault-swap-policy";
import { privateKeyToAccount } from "viem/accounts";
import * as evmModule from "@/lib/chains/evm";
import { THOR_EVM_ROUTERS } from "@/lib/thorchain/catalog";

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
  it("prepares exact ERC-20 approval/reset/deposit requests without broadcasting", async () => {
    const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const p = {...pairing,evm:{address:signer.address,path:"m/44'/60'/0'/0/0"}};
    const q: ThorCatalogQuote = {...quote("btc"),from:"usdc-eth",to:"btc",rawIn:"1000000000",amountIn:"100000000000",inbound:"0x2222222222222222222222222222222222222222",router:THOR_EVM_ROUTERS.eth,destination:deriveVaultAddress(pairing,"btc",84,0,0).address};
    q.memo=`=:b:${q.destination}:99000000/1/0`;
    let allowance=0n;
    const broadcast = vi.fn(() => {throw new Error("No broadcast allowed")});
    const client = { readContract:vi.fn(async (args:{functionName:string}) => args.functionName === "allowance" ? allowance : 1000000000n), getTransactionCount:vi.fn(async()=>7),estimateGas:vi.fn(async()=>65000n),estimateFeesPerGas:vi.fn(async()=>({maxFeePerGas:30000000000n,maxPriorityFeePerGas:1000000000n})),getBalance:vi.fn(async()=>1000000000000000000n),sendRawTransaction:broadcast };
    const mock=vi.spyOn(evmModule,"evmClient").mockReturnValue(client as unknown as ReturnType<typeof evmModule.evmClient>);
    for (const [value,action] of [[0n,"approval"],[1n,"approval-reset"],[1000000000n,"evm-deposit"]] as const) {
      allowance=value;
      const prepared=await prepareVaultThorSwap(p,q,[],0);
      expect(prepared.action).toBe(action);
      expect(JSON.parse(prepared.payload).format).toBe("hm-thor-swap");
      const tx=prepared.evm;
      if (!tx) throw new Error("Missing EVM plan");
      const sign = (overrides={}) => signer.signTransaction({to:tx.to,value:BigInt(tx.value),data:tx.data,nonce:tx.nonce,chainId:tx.chainId,gas:BigInt(tx.gas),type:"eip1559",maxFeePerGas:BigInt(tx.maxFeePerGas ?? "0"),maxPriorityFeePerGas:BigInt(tx.maxPriorityFeePerGas ?? "0"),...overrides});
      await expect(verifyVaultThorResult(await sign(),prepared)).resolves.toBeUndefined();
      for (const change of [{chainId:8453},{nonce:8},{data:"0x"},{gas:1n},{value:1n},{maxFeePerGas:40000000000n},{to:signer.address}]) await expect(verifyVaultThorResult(await sign(change),prepared)).rejects.toThrow();
    }
    expect(broadcast).not.toHaveBeenCalled();mock.mockRestore();
  });
});

describe("sumVaultUtxos available-balance total", () => {
  const utxo = (txid: string, vout: number, value: number, confirmed?: boolean) => ({ txid, vout, value, purpose: 84 as const, change: 0 as const, index: 0, path: "m/84'/0'/0'/0/0", address: "bc1qtest", pubkey: new Uint8Array(33), ...(confirmed === undefined ? {} : { confirmed }) });
  const scan = (utxos: ReturnType<typeof utxo>[], complete = true, scanned = 40) => ({ chain: "btc" as const, purpose: 84 as const, balanceSats: 0, nextReceive: "", nextReceiveIndex: 0, utxos, used: [], scanned, complete });
  it("sums deduped coins across branches", () => {
    const a = utxo("aa", 0, 100_000), b = utxo("bb", 1, 50_000);
    expect(sumVaultUtxos([scan([a, b]), scan([a])], 2).total).toBe(150_000n);
  });
  it("reports pending coins separately but inside the spendable total", () => {
    const r = sumVaultUtxos([scan([utxo("aa", 0, 100_000, true), utxo("bb", 0, 25_000, false)])], 1);
    expect(r).toEqual({ total: 125_000n, confirmed: 100_000n, pending: 25_000n });
  });
  it("refuses an empty, incomplete or missing-branch scan, regardless of address count", () => {
    expect(() => sumVaultUtxos([], 0)).toThrow(/incomplete/);
    expect(() => sumVaultUtxos([scan([utxo("aa", 0, 1)], false, 400)], 1)).toThrow(/incomplete/);
    expect(() => sumVaultUtxos([scan([utxo("aa", 0, 1)])], 2)).toThrow(/incomplete/);
    expect(sumVaultUtxos([scan([utxo("aa", 0, 1)], true, 7)], 1).total).toBe(1n);
  });
});
