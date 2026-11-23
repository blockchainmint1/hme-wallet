/**
 * Desktop Swap routes through TSD Bridge (tsd.honest.money):
 *  - Buy TSD: pay USDC/USDT/PYUSD on Ethereum or USDC/USDT on Base, receive
 *    TSD at a legacy T… address. The member's own TSD Swap key opens a mint
 *    order; the reply is verified on the server and again here, re-polled
 *    right before signing, and the signed bytes must be exactly one ERC-20
 *    transfer of the reviewed amount to the order's deposit address.
 *  - Sell TSD: TSD → USDC on Ethereum stays on the audited cash-out in Send.
 * Vault wallets may Buy TSD from their Ethereum/Base address #0: the same
 * order checks run, then HME Vault signs the one ERC-20 transfer by QR and
 * the signed bytes are verified and the order re-polled before broadcast.
 * Watch-only wallets never reach this panel.
 */
import { useMemo, useState } from "react";
import { getAddress } from "viem";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createWalletClient, erc20Abi, formatUnits, http, type Hex } from "viem";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWallet } from "@/lib/txc/wallet-context";
import { getOmniDepositAddress } from "@/lib/txc/tokens";
import { deriveAddresses } from "@/lib/txc/wallet";
import { assertTsdMintEvmExecution } from "@/lib/security/execution-policy";
import { EVM_CHAINS, deriveEvmAccount, evmClient } from "@/lib/chains/evm";
import { sendEvmTransaction } from "@/lib/chains/evm-send";
import { confirmWithBiometric } from "@/lib/native/biometric";
import { hapticError, hapticSuccess } from "@/lib/native/ui";
import { friendlyBroadcastError } from "@/lib/broadcast-error";
import { TsdCashoutKeyCard } from "@/components/wallet/TsdCashoutKeyCard";
import {
  bindCashoutKey, cashoutBindingHolds, cashoutKeyFingerprint, useCashoutApiKey,
} from "@/lib/cashout/api-key";
import { isLegacyTxcP2pkh } from "@/lib/cashout/one-time";
import {
  MINT_SOURCES, MINT_TRANSFER_GAS_CEILING, TSD_BRIDGE_LATE_DEPOSIT_POLICY, assertMintTransferRequest,
  availableMintSources, mintContractsConfirmed, buildMintTransfer, confirmLockedMintOrder, estimateTsdOut, formatUnitsPlain,
  mintAmountInLimits, mintGasCovered, mintOrderStillOpen, mintSource, mintStatusLabel, parseMintAmount, recheckMintOrder,
  type MintSourceId, type TsdBridgeTerms, type VerifiedMintOrder,
} from "@/lib/cashout/mint";
import { createTsdMintOrder, getTsdBridgeTerms, getTsdMintOrder } from "@/lib/cashout/tsd.functions";
import { isTerminalCashoutStatus } from "@/lib/cashout/tsd";
import {
  findReusableMintOrder, lockedFromRecord, readMintHistory, recordMintOrder, reviewedRecord,
  staleReviewedOrders, updateMintRecord,
} from "@/lib/cashout/mint-history";
import type { CashoutKeyBinding } from "@/lib/cashout/api-key";
import { loadPairing, type VaultPairing } from "@/lib/vault-link/pairing";
import { deriveVaultAddress } from "@/lib/vault-link/derive";
import { vaultTsdReceiveAddress } from "@/lib/vault-link/tsd-send";
import { vaultEvmAccount } from "@/lib/vault-link/evm-accounts";
import { buildErc20Intent, type EvmIntent } from "@/lib/vault-link/evm-intent";
import { intentTransaction } from "@/lib/vault-link/evm-send";
import { readFees, VAULT_FEE_CEILING_WEI } from "@/lib/vault-link/evm-roundup";
import { VaultEvmSigning } from "@/components/wallet/VaultEvmSigning";
import { loadSession } from "@/lib/txc/session-cache";
import { getActiveProfileId } from "@/lib/txc/storage";

const OTHER = "__other";
const TSD = "tsd";

export function TsdBridgeSwap({
  direction, evmSwapOn, onDirection, onLeave, vaultMode = false, initialSourceId, initialAmount,
}: {
  direction: "mint" | "redeem";
  evmSwapOn: boolean;
  onDirection: (d: "mint" | "redeem") => void;
  onLeave: () => void;
  /** Vault wallet: Buy TSD only, signed by HME Vault. */
  vaultMode?: boolean;
  initialSourceId?: MintSourceId;
  initialAmount?: string;
}) {
  const [apiKey] = useCashoutApiKey();
  const fetchTerms = useServerFn(getTsdBridgeTerms);
  const terms = useQuery({ queryKey: ["tsd-bridge-terms"], queryFn: () => fetchTerms(), staleTime: 60_000, retry: 1 });

  const [sourceId, setSourceId] = useState<MintSourceId>(initialSourceId ?? "usdc-eth");
  const sources = availableMintSources(terms.data);
  const source = mintSource(sourceId) ?? MINT_SOURCES[0];

  const payValue = direction === "mint" ? sourceId : TSD;
  const receiveValue = direction === "mint" ? TSD : "usdc-eth-out";

  function pickPay(v: string) {
    if (v === OTHER) return onLeave();
    if (v === TSD) return vaultMode ? undefined : onDirection("redeem");
    setSourceId(v as MintSourceId);
    if (direction !== "mint") onDirection("mint");
  }
  function pickReceive(v: string) {
    if (v === OTHER) return onLeave();
    if (v === TSD) return onDirection("mint");
    if (vaultMode) return;
    if (direction !== "redeem") onDirection("redeem");
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="tsd-from">Pay with</Label>
            <Select value={payValue} onValueChange={pickPay}>
              <SelectTrigger id="tsd-from" aria-label="Pay with"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(sources.length ? sources : MINT_SOURCES).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
                {!vaultMode && <SelectItem value={TSD}>TSD on TEXITcoin</SelectItem>}
                <SelectItem value={OTHER}>{vaultMode ? "Back to round-up" : "Other coins (THORChain)…"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tsd-to">Receive</Label>
            <Select value={receiveValue} onValueChange={pickReceive}>
              <SelectTrigger id="tsd-to" aria-label="Receive"><SelectValue /></SelectTrigger>
              <SelectContent>
                {direction === "mint"
                  ? <SelectItem value={TSD}>TSD on TEXITcoin</SelectItem>
                  : <SelectItem value="usdc-eth-out">USDC on Ethereum</SelectItem>}
                {!vaultMode && (
                  <SelectItem value={direction === "mint" ? "usdc-eth-out" : TSD}>
                    {direction === "mint" ? "USDC on Ethereum (sell TSD)" : "TSD on TEXITcoin (buy TSD)"}
                  </SelectItem>
                )}
                <SelectItem value={OTHER}>{vaultMode ? "Back to round-up" : "Other coins (THORChain)…"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {!apiKey ? (
          <div className="mt-6 max-w-xl">
            <p className="text-sm text-muted-foreground">
              TSD routes use your own TSD Swap account. Create one at tsd.honest.money, make an API key on your
              account page, and paste it below — it is saved for this wallet only.
            </p>
            <TsdCashoutKeyCard />
          </div>
        ) : direction === "redeem" && !vaultMode ? (
          <RedeemRoute redeemFeeBps={terms.data?.redeemFeeBps ?? null} />
        ) : !mintContractsConfirmed() ? (
          <p className="mt-6 max-w-xl text-sm text-muted-foreground">
            Buying TSD with stablecoins is awaiting TSD Bridge's written confirmation of the token contracts it
            watches. Until it arrives, this route stays off so no payment can reach a contract TSD Bridge hasn't
            confirmed. Selling TSD works today.
          </p>
        ) : !evmSwapOn ? (
          <div className="mt-6">
            <p className="text-sm text-muted-foreground">Paying with stablecoins needs EVM swaps turned on in desktop settings.</p>
            <Button asChild variant="outline" className="mt-4"><Link to="/desktop/settings">Desktop settings</Link></Button>
          </div>
        ) : terms.isError ? (
          <p className="mt-6 text-sm text-destructive">{terms.error instanceof Error ? terms.error.message : "TSD Bridge is unavailable."}</p>
        ) : terms.data && !terms.data.live ? (
          <p className="mt-6 text-sm text-muted-foreground">TSD Bridge has paused new TSD purchases. Try again later.</p>
        ) : terms.data && !sources.some((s) => s.id === source.id) ? (
          <p className="mt-6 text-sm text-muted-foreground">TSD Bridge isn't accepting {source.label} right now — pick another stablecoin.</p>
        ) : terms.data ? (
          <MintRoute key={`${source.id}:${apiKey.slice(-6)}`} apiKey={apiKey} sourceId={source.id} terms={terms.data} evmSwapOn={evmSwapOn}
            initialAmount={source.id === initialSourceId ? initialAmount : undefined} />
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">Loading TSD Bridge terms…</p>
        )}
      </section>

      <aside className="min-w-0 border-t border-border pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
        <h3 className="text-sm font-medium">TSD Bridge</h3>
        {terms.data && (
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Rate</dt><dd>1 stablecoin = 1 TSD</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Buy fee</dt><dd>{terms.data.mintFeeBps / 100}%</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Sell fee</dt><dd>{terms.data.redeemFeeBps / 100}% standard</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Limits</dt><dd>{terms.data.minAmount.toLocaleString()}–{terms.data.maxAmount.toLocaleString()}</dd></div>
          </dl>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          TSD is a dollar token on TEXITcoin, backed 1:1 by stablecoins TSD Bridge holds in reserve. Unlike THORChain
          swaps, TSD Bridge holds the stablecoins you pay in. Honest Money adds no fee.
        </p>
      </aside>
    </div>
  );
}

function RedeemRoute({ redeemFeeBps }: { redeemFeeBps: number | null }) {
  return (
    <div className="mt-6 max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Selling TSD for USDC on Ethereum uses the TSD cash-out on the Send page: enter the amount, choose where the
        USDC goes, and review the order before anything is signed.
        {redeemFeeBps != null && ` Your account's fee is shown there (standard fee ${redeemFeeBps / 100}%).`}
      </p>
      <Button asChild size="lg"><Link to="/desktop/send" search={{ asset: "tsd" }}>Cash out TSD</Link></Button>
    </div>
  );
}

function MintRoute({ apiKey, sourceId, terms, evmSwapOn, initialAmount }: {
  apiKey: string;
  sourceId: MintSourceId;
  terms: TsdBridgeTerms;
  evmSwapOn: boolean;
  initialAmount?: string | undefined;
}) {
  const { root, unlocked, activeProfileId } = useWallet();
  const qc = useQueryClient();
  const createOrder = useServerFn(createTsdMintOrder);
  const fetchOrder = useServerFn(getTsdMintOrder);
  const source = mintSource(sourceId)!;
  const nativeSymbol = source.chain === "eth" ? "ETH" : "Base ETH";
  const isLocalSigner = !!root && unlocked?.mode !== "vault" && unlocked?.mode !== "keyonly";
  // Vault: pay from the paired Ethereum address #0 only; never derive from the random wrapping anchor.
  const [pairing] = useState<VaultPairing | null>(() => (unlocked?.mode === "vault" ? loadPairing(activeProfileId) : null));
  const [pairingIdentity] = useState(() => JSON.stringify(pairing));
  const isVault = unlocked?.mode === "vault" && !!pairing?.evm && !!pairing.chains.txc?.["44"];
  const evmAddress = useMemo(() => {
    if (isLocalSigner && root) return deriveEvmAccount(root).address;
    if (isVault && pairing?.evm) return getAddress(pairing.evm.address);
    return null;
  }, [isLocalSigner, isVault, root, pairing]);
  /** Every Ethereum address of this wallet we know (deposit addresses must never be ours). */
  const ownEvm = useMemo(() => {
    if (!evmAddress) return [] as string[];
    if (!isVault || !pairing?.evm?.xpub) return [evmAddress];
    return Array.from({ length: 50 }, (_, i) => vaultEvmAccount(pairing, i).address);
  }, [evmAddress, isVault, pairing]);
  const ownTsd = useMemo(() => {
    if (isLocalSigner && root) return getOmniDepositAddress(root).address;
    if (isVault) return vaultTsdReceiveAddress(pairing);
    return null;
  }, [isLocalSigner, isVault, root, pairing]);
  /** This wallet's own legacy TEXITcoin addresses (first 50 receive, 20 change). */
  const ownTxc = useMemo(() => {
    if (isLocalSigner && root) {
      return new Set([
        ...deriveAddresses(root, "bip44", 0, 50).map((a) => a.address),
        ...deriveAddresses(root, "bip44", 1, 20).map((a) => a.address),
      ]);
    }
    if (isVault && pairing) {
      return new Set([
        ...Array.from({ length: 50 }, (_, i) => deriveVaultAddress(pairing, "txc", 44, 0, i).address),
        ...Array.from({ length: 20 }, (_, i) => deriveVaultAddress(pairing, "txc", 44, 1, i).address),
      ]);
    }
    return new Set<string>();
  }, [isLocalSigner, isVault, root, pairing]);
  const [vaultSigning, setVaultSigning] = useState<{ payload: string; locked: VerifiedMintOrder; binding: CashoutKeyBinding } | null>(null);

  const [amount, setAmount] = useState(initialAmount ?? "");
  const [recipientOverride, setRecipientOverride] = useState<string | null>(null);
  const [order, setOrder] = useState<{ locked: VerifiedMintOrder; binding: CashoutKeyBinding; reused: boolean } | null>(null);
  const [checkedOther, setCheckedOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ hash: string; locked: VerifiedMintOrder; state: "waiting" | "confirmed" | "pending" } | null>(null);

  const recipient = (recipientOverride ?? ownTsd ?? "").trim();
  const recipientValid = isLegacyTxcP2pkh(recipient);
  const recipientOwn = recipientValid && ownTxc.has(recipient);
  const units = parseMintAmount(amount, source);
  const inLimits = units !== null && mintAmountInLimits(units, source, terms);

  const balance = useQuery({
    queryKey: ["tsd-mint-balance", source.id, evmAddress],
    enabled: (isLocalSigner || isVault) && !!evmAddress,
    queryFn: async () => {
      const pub = evmClient(source.chain);
      const [token, native, maxFeePerGas] = await Promise.all([
        pub.readContract({ address: source.contract, abi: erc20Abi, functionName: "balanceOf", args: [evmAddress!] }) as Promise<bigint>,
        pub.getBalance({ address: evmAddress! }),
        currentMaxFee(source.chain),
      ]);
      return { token, native, maxFeePerGas };
    },
    staleTime: 20_000,
  });
  const tokenEnough = units !== null && !!balance.data && balance.data.token >= units;
  const gasEnough = !!balance.data && mintGasCovered(balance.data.native, balance.data.maxFeePerGas);
  const gasNeeded = balance.data ? (MINT_TRANSFER_GAS_CEILING * balance.data.maxFeePerGas * 5n) / 4n : 0n;
  const outUnits = units ? estimateTsdOut(units, source, terms.mintFeeBps) : 0n;

  async function review() {
    if (!units || !recipientValid || !evmAddress || busy) return;
    setBusy(true);
    setError(null);
    setCheckedOther(false);
    try {
      const binding = bindCashoutKey(apiKey);
      if (!binding) throw new Error("Wallet changed — start again.");
      // Network fee check before opening anything at TSD Bridge.
      const pub = evmClient(source.chain);
      const [native, maxFee] = await Promise.all([pub.getBalance({ address: evmAddress }), currentMaxFee(source.chain)]);
      if (!mintGasCovered(native, maxFee)) throw new Error(`Not enough ${nativeSymbol} for the network fee. Nothing was opened.`);

      const keyFp = cashoutKeyFingerprint(apiKey);
      const history = readMintHistory(activeProfileId);
      const ctx = { ownEvmAddresses: ownEvm, priorOrders: history };
      const expected = { sourceId: source.id, amount: amount.trim(), recipient };

      // Reuse an identical unpaid order with more than two hours left.
      const reusable = findReusableMintOrder(history, { sourceId: source.id, units: units.toString(), recipient, keyFp });
      if (reusable) {
        const locked = lockedFromRecord(reusable);
        try {
          if (!locked) throw new Error("incomplete record");
          confirmLockedMintOrder(locked, expected, ctx);
          recheckMintOrder(locked, await fetchOrder({ data: { apiKey, id: locked.id } }));
          for (const r of staleReviewedOrders(history, keyFp, locked.id)) updateMintRecord(activeProfileId, r.orderId, { state: "abandoned" });
          setOrder({ locked, binding, reused: true });
          return;
        } catch {
          updateMintRecord(activeProfileId, reusable.orderId, { state: "abandoned" });
        }
      }

      const locked = await createOrder({
        data: { apiKey, sourceId: source.id, amount: amount.trim(), recipient, ownEvmAddresses: ownEvm.slice(0, 8) },
      });
      // Keep our own record of what was agreed before checking it, so a
      // refused order's deposit address still counts as "seen".
      recordMintOrder(activeProfileId, reviewedRecord(locked, keyFp, recipientOwn));
      try {
        confirmLockedMintOrder(locked, expected, ctx);
      } catch (e) {
        updateMintRecord(activeProfileId, locked.id, { state: "abandoned" });
        throw e;
      }
      for (const r of staleReviewedOrders(readMintHistory(activeProfileId), keyFp, locked.id)) {
        updateMintRecord(activeProfileId, r.orderId, { state: "abandoned" });
      }
      setOrder({ locked, binding, reused: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open a TSD Bridge order.");
    } finally {
      setBusy(false);
    }
  }

  async function assertVaultSession() {
    const s = await loadSession();
    if (!s || s.mode !== "vault" || getActiveProfileId() !== activeProfileId || JSON.stringify(loadPairing(activeProfileId)) !== pairingIdentity) {
      throw new Error("Wallet locked or changed. Nothing was sent — reopen this page from the intended Vault.");
    }
  }

  /** Vault: same checks as a local send, then hand HME Vault exactly one ERC-20 transfer. */
  async function prepareVault() {
    if (!order || !isVault || !pairing || !evmAddress || busy) return;
    const { locked, binding } = order;
    setBusy(true);
    setError(null);
    try {
      assertTsdMintEvmExecution(evmSwapOn);
      await assertVaultSession();
      if (!cashoutBindingHolds(binding)) throw new Error("Wallet or TSD Swap key changed. Nothing was sent — start again.");
      if (amount.trim() !== locked.amount || recipient !== locked.recipient) {
        throw new Error("The amount or TSD address changed. Nothing was sent — start again.");
      }
      if (!recipientOwn && !checkedOther) throw new Error("Confirm you checked the TSD address. Nothing was sent.");
      confirmLockedMintOrder(
        locked,
        { sourceId: source.id, amount: locked.amount, recipient },
        { ownEvmAddresses: ownEvm, priorOrders: readMintHistory(activeProfileId) },
      );
      recheckMintOrder(locked, await fetchOrder({ data: { apiKey, id: locked.id } }));
      const pub = evmClient(source.chain);
      const transfer = buildMintTransfer(locked);
      const [bal, native, nonce, estimate, fees] = await Promise.all([
        pub.readContract({ address: source.contract, abi: erc20Abi, functionName: "balanceOf", args: [evmAddress] }) as Promise<bigint>,
        pub.getBalance({ address: evmAddress }),
        pub.getTransactionCount({ address: evmAddress, blockTag: "pending" }),
        pub.estimateGas({ account: evmAddress, to: transfer.to, data: transfer.data }),
        readFees(source.chain),
      ]);
      if (bal < BigInt(locked.units)) throw new Error(`Not enough ${source.symbol}. Nothing was sent.`);
      const gas = (estimate * 120n + 99n) / 100n;
      if (gas > MINT_TRANSFER_GAS_CEILING) throw new Error("This transfer needs more gas than expected. Nothing was sent.");
      if (gas * fees.maxFeePerGas > VAULT_FEE_CEILING_WEI[source.chain]) throw new Error("Network fees are above HME Vault's safety limit right now. Try again later.");
      if (native < gas * fees.maxFeePerGas) throw new Error(`Not enough ${nativeSymbol} for the network fee. Nothing was sent.`);
      const payload = buildErc20Intent({
        pairing, chainId: EVM_CHAINS[source.chain].viemChain.id, token: source.contract, to: locked.depositAddress as `0x${string}`,
        amountRaw: BigInt(locked.units), nonce, gas, fees: { type: "eip1559", ...fees },
      });
      const intent = JSON.parse(payload) as EvmIntent;
      assertMintTransferRequest(locked, { ...intentTransaction(intent), chainId: intent.chainId });
      setVaultSigning({ payload, locked, binding });
      setOrder(null);
    } catch (e) {
      hapticError();
      setOrder(null);
      setError(e instanceof Error ? e.message : "Couldn't prepare the Vault payment.");
    } finally {
      setBusy(false);
    }
  }

  /** Runs after Vault's signature is verified, right before broadcast. */
  async function vaultBeforeBroadcast() {
    if (!vaultSigning) throw new Error("Nothing to send.");
    const { locked, binding } = vaultSigning;
    assertTsdMintEvmExecution(evmSwapOn);
    await assertVaultSession();
    if (!cashoutBindingHolds(binding)) throw new Error("Wallet or TSD Swap key changed. Nothing was sent — start again.");
    recheckMintOrder(locked, await fetchOrder({ data: { apiKey, id: locked.id } }));
    if (!mintOrderStillOpen(locked.expiresAt)) {
      throw new Error("This order is too close to its deadline. Nothing was sent — start again for a fresh order.");
    }
  }

  async function vaultSent(hash: Hex) {
    if (!vaultSigning) return;
    const { locked } = vaultSigning;
    updateMintRecord(activeProfileId, locked.id, { state: "sent", txHash: hash });
    setVaultSigning(null);
    setSent({ hash, locked, state: "waiting" });
    try {
      const state = await waitForMintPayment(source.chain, hash);
      updateMintRecord(activeProfileId, locked.id, { state });
      hapticSuccess();
      setSent({ hash, locked, state });
      void qc.invalidateQueries({ queryKey: ["tsd-mint-balance"] });
    } catch (e) {
      hapticError();
      if (e instanceof MintPaymentReverted) {
        updateMintRecord(activeProfileId, locked.id, { state: "failed" });
        setSent(null);
      }
      setError(friendlyBroadcastError(e));
    }
  }

  async function send() {
    if (isVault) return prepareVault();
    if (!order || !root || !isLocalSigner || busy) return;
    const { locked, binding } = order;
    setBusy(true);
    setError(null);
    try {
      assertTsdMintEvmExecution(evmSwapOn);
      if (!cashoutBindingHolds(binding)) throw new Error("Wallet or TSD Swap key changed. Nothing was sent — start again.");
      if (amount.trim() !== locked.amount || recipient !== locked.recipient) {
        throw new Error("The amount or TSD address changed. Nothing was sent — start again.");
      }
      if (!recipientOwn && !checkedOther) throw new Error("Confirm you checked the TSD address. Nothing was sent.");
      const account = deriveEvmAccount(root);
      confirmLockedMintOrder(
        locked,
        { sourceId: source.id, amount: locked.amount, recipient },
        { ownEvmAddresses: [account.address], priorOrders: readMintHistory(activeProfileId) },
      );
      // Re-poll right before signing: still open, same deposit, same amount, >2h left.
      const fresh = await fetchOrder({ data: { apiKey, id: locked.id } });
      recheckMintOrder(locked, fresh);
      const ok = await confirmWithBiometric(`Confirm paying ${locked.amount} ${source.symbol} for TSD`);
      if (!ok) throw new Error("Confirmation was cancelled. Nothing was sent.");
      // The confirmation prompt can sit open; check the deadline again after it.
      if (!mintOrderStillOpen(locked.expiresAt)) {
        throw new Error("This order is too close to its deadline. Nothing was sent — start again for a fresh order.");
      }
      const pub = evmClient(source.chain);
      const [bal, native, maxFee] = await Promise.all([
        pub.readContract({ address: source.contract, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
        pub.getBalance({ address: account.address }),
        currentMaxFee(source.chain),
      ]);
      if (bal < BigInt(locked.units)) throw new Error(`Not enough ${source.symbol}. Nothing was sent.`);
      if (!mintGasCovered(native, maxFee)) throw new Error(`Not enough ${nativeSymbol} for the network fee. Nothing was sent.`);
      const walletClient = createWalletClient({
        account, chain: EVM_CHAINS[source.chain].viemChain, transport: http(`/api/evm/${source.chain}`),
      });
      const hash = await sendEvmTransaction(source.chain, walletClient, buildMintTransfer(locked), (req) =>
        assertMintTransferRequest(locked, req),
      );
      updateMintRecord(activeProfileId, locked.id, { state: "sent", txHash: hash });
      setSent({ hash, locked, state: "waiting" });
      setOrder(null);
      // "Sent" means mined: wait for the receipt before saying so.
      const state = await waitForMintPayment(source.chain, hash);
      updateMintRecord(activeProfileId, locked.id, { state });
      hapticSuccess();
      setSent({ hash, locked, state });
      void qc.invalidateQueries({ queryKey: ["tsd-mint-balance"] });
    } catch (e) {
      hapticError();
      setOrder(null);
      if (e instanceof MintPaymentReverted) {
        updateMintRecord(activeProfileId, order.locked.id, { state: "failed" });
        setSent(null);
      }
      setError(friendlyBroadcastError(e));
    } finally {
      setBusy(false);
    }
  }

  if (vaultSigning) {
    const l = vaultSigning.locked;
    return (
      <div className="mt-6 max-w-xl space-y-4">
        <h2 className="text-xl font-semibold">Sign on your Vault</h2>
        <dl className="space-y-1.5 text-sm">
          <div><dt className="text-muted-foreground">Pay</dt><dd className="font-medium">{l.amount} {source.symbol} ({source.label}) from your address #0</dd></div>
          <div><dt className="text-muted-foreground">To TSD Bridge deposit address</dt><dd className="break-all font-mono text-xs">{l.depositAddress}</dd></div>
          <div><dt className="text-muted-foreground">Token contract (check on the Vault)</dt><dd className="break-all font-mono text-xs">{source.contract}</dd></div>
          <div><dt className="text-muted-foreground">TSD goes to</dt><dd className="break-all font-mono text-xs">{l.recipient}</dd></div>
        </dl>
        <p className="text-xs text-muted-foreground">
          HME Vault shows the contract and the amount in raw units ({BigInt(l.units).toString()} = {l.amount} {source.symbol}). After the
          signature comes back, the wallet checks it is exactly this transfer and checks the order is still open before sending.
        </p>
        <VaultEvmSigning payload={vaultSigning.payload} chain={source.chain} beforeBroadcast={vaultBeforeBroadcast}
          onSent={(h) => void vaultSent(h)} onBack={() => setVaultSigning(null)} />
      </div>
    );
  }

  if (sent) {
    const tsdOut = formatUnitsPlain(estimateTsdOut(BigInt(sent.locked.units), source, sent.locked.feeBps), 8);
    return (
      <div className="mt-6">
        <h2 className="text-xl font-semibold">
          {sent.state === "waiting" ? "Waiting for your payment to confirm…"
            : sent.state === "confirmed" ? "Payment confirmed"
            : "Payment sent — not confirmed yet"}
        </h2>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          {sent.state === "waiting" && "Your payment was broadcast. Keep this page open until it confirms. "}
          {sent.state === "pending" && "We couldn't see the confirmation yet — check the payment link before trying again. "}
          {sent.locked.amount} {source.symbol} {sent.state === "confirmed" ? "reached" : "is on its way to"} TSD Bridge. It sends about{" "}
          {tsdOut} TSD to <span className="font-mono text-xs">{sent.locked.recipient}</span> once{" "}
          {source.chain === "eth" ? "Ethereum" : "Base"} has enough confirmations — usually 5–15 minutes, longer for large amounts.
        </p>
        <MintTracker apiKey={apiKey} orderId={sent.locked.id} />
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <a href={EVM_CHAINS[source.chain].explorerTx(sent.hash)} target="_blank" rel="noreferrer">
              View payment <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
          {sent.state !== "waiting" && (
            <Button variant="ghost" onClick={() => { setSent(null); setAmount(""); }}>Buy more TSD</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-5">
        <Label htmlFor="tsd-amount">Amount ({source.symbol})</Label>
        <Input id="tsd-amount" inputMode="decimal" placeholder="0.0" value={amount}
          onChange={(e) => { setAmount(e.target.value); setOrder(null); setError(null); }} className="mt-1.5 text-lg" />
        {balance.data && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Available{isVault ? " on address #0" : ""}: {formatUnitsPlain(balance.data.token, source.decimals)} {source.symbol}
            {balance.data.token > 0n && (
              <button type="button" className="ml-2 underline underline-offset-2"
                onClick={() => { setAmount(maxMintAmount(balance.data!.token, source.decimals, terms.maxAmount)); setOrder(null); setError(null); }}>
                Use all{BigInt(Math.floor(terms.maxAmount)) * 10n ** BigInt(source.decimals) < balance.data.token ? ` (up to ${terms.maxAmount.toLocaleString()} per order)` : ""}
              </button>
            )}
          </p>
        )}
        {amount && units === null && <p className="mt-1.5 text-xs text-destructive">Enter an amount with up to {source.decimals} decimals.</p>}
        {units !== null && !inLimits && (
          <p className="mt-1.5 text-xs text-destructive">TSD Bridge accepts {terms.minAmount.toLocaleString()}–{terms.maxAmount.toLocaleString()} {source.symbol} per order.</p>
        )}
      </div>

      <div className="mt-5">
        <Label htmlFor="tsd-recipient">TSD goes to (TEXITcoin)</Label>
        <Input id="tsd-recipient" value={recipient}
          onChange={(e) => { setRecipientOverride(e.target.value); setOrder(null); setCheckedOther(false); }}
          placeholder="T…" className="mt-1.5 font-mono text-xs" />
        {recipientValid && !recipientOwn ? (
          <p className="mt-1.5 text-xs text-destructive">
            This isn't one of this wallet's TSD addresses. TSD sent there can't be recovered by this wallet — double-check every character.
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {recipientOverride == null
              ? "Auto-filled with this wallet's TSD address. You can paste a different legacy T… address."
              : "One of this wallet's own TSD addresses."}
          </p>
        )}
        {recipient && !recipientValid && <p className="mt-1.5 text-xs text-destructive">TSD can only go to a legacy T… TEXITcoin address.</p>}
      </div>

      {error && <p className="mt-4 break-words text-sm text-destructive">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={busy || !inLimits || !recipientValid || !tokenEnough || !gasEnough} onClick={() => void review()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Review purchase
        </Button>
        {units !== null && balance.data && !tokenEnough && (
          <span className="text-xs text-destructive">Not enough {source.symbol}.</span>
        )}
        {balance.data && !gasEnough && (
          <span className="text-xs text-destructive">
            Not enough {nativeSymbol} for the network fee (about {formatUnitsPlain(gasNeeded, 18)} {nativeSymbol} needed).
          </span>
        )}
      </div>

      <AlertDialog open={!!order} onOpenChange={(o) => { if (!o && !busy) setOrder(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm TSD purchase</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {order && (
                  <>
                    <p>You send <strong>{order.locked.amount} {source.symbol}</strong> ({source.label}) to TSD Bridge's deposit address for this order:</p>
                    <p className="break-all font-mono text-xs">{order.locked.depositAddress}</p>
                    <p>You receive about <strong>{formatUnitsPlain(estimateTsdOut(BigInt(order.locked.units), source, order.locked.feeBps), 8)} TSD</strong> (fee {order.locked.feeBps / 100}%) at:</p>
                    <p className="break-all font-mono text-xs">{order.locked.recipient}</p>
                    {!recipientOwn && (
                      <label className="flex items-start gap-2 rounded-md border border-destructive/50 p-2 text-xs text-destructive">
                        <Checkbox checked={checkedOther} onCheckedChange={(v) => setCheckedOther(v === true)} className="mt-0.5" aria-label="I checked this TSD address" />
                        <span>This address isn't part of this wallet. I checked it — TSD sent there can't be recovered by this wallet.</span>
                      </label>
                    )}
                    <p className="text-xs">
                      TSD Bridge holds the stablecoins you pay as reserves; TSD is a claim on those reserves, not a self-custody swap.
                      {TSD_BRIDGE_LATE_DEPOSIT_POLICY ? ` ${TSD_BRIDGE_LATE_DEPOSIT_POLICY}` : ""}
                    </p>
                    <p className="text-xs">
                      Order {order.locked.id}{order.reused ? " (your open order, reused)" : ""} · open until {new Date(order.locked.expiresAt).toLocaleString()}.
                      The wallet checks the order again right before signing and only signs this exact transfer on the {source.symbol} contract{" "}
                      <span className="font-mono">{source.contract.slice(0, 6)}…{source.contract.slice(-4)}</span>.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
            <AlertDialogAction disabled={busy || (!recipientOwn && !checkedOther)} onClick={(e) => { e.preventDefault(); void send(); }}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{isVault ? "Confirm and sign on Vault" : "Confirm and send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {units !== null && inLimits && (
        <p className="mt-4 text-xs text-muted-foreground">
          Estimated: {formatUnitsPlain(outUnits, 8)} TSD. TSD Bridge mints for exactly what arrives.
        </p>
      )}
    </>
  );
}

class MintPaymentReverted extends Error {}

/** Whole balance as a plain decimal, capped at TSD Bridge's per-order maximum. */
export function maxMintAmount(balance: bigint, decimals: number, maxAmount: number): string {
  const cap = BigInt(Math.floor(maxAmount)) * 10n ** BigInt(decimals);
  // Plain digits only: this goes into the amount box, which refuses thousands separators.
  return formatUnits(balance < cap ? balance : cap, decimals);
}

/** Current max fee per gas on a chain (EIP-1559 estimate, else legacy gas price). */
async function currentMaxFee(chain: "eth" | "base"): Promise<bigint> {
  const pub = evmClient(chain);
  try {
    const f = await pub.estimateFeesPerGas();
    if (f.maxFeePerGas && f.maxFeePerGas > 0n) return f.maxFeePerGas;
  } catch { /* fall back */ }
  return pub.getGasPrice();
}

/**
 * "confirmed" only on a successful receipt; "pending" when confirmation could
 * not be observed in time (the payment may still land). A reverted payment throws.
 */
async function waitForMintPayment(chain: "eth" | "base", hash: Hex): Promise<"confirmed" | "pending"> {
  let receipt;
  try {
    receipt = await evmClient(chain).waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
  } catch {
    return "pending";
  }
  if (receipt.status !== "success") {
    throw new MintPaymentReverted(`The payment failed on-chain (${hash}). Your stablecoins did not leave your wallet; only the network fee was spent.`);
  }
  return "confirmed";
}

function MintTracker({ apiKey, orderId }: { apiKey: string; orderId: string }) {
  const fetchOrder = useServerFn(getTsdMintOrder);
  const order = useQuery({
    queryKey: ["tsd-mint-order", orderId],
    queryFn: () => fetchOrder({ data: { apiKey, id: orderId } }),
    refetchInterval: (q) => (q.state.data && isTerminalCashoutStatus(q.state.data.status) ? false : 15_000),
    retry: 2,
  });
  const status = order.data?.status;
  const done = status ? isTerminalCashoutStatus(status) : false;
  return (
    <p className="mt-3 flex items-center gap-1.5 text-sm">
      {!done && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      <span className="text-muted-foreground">Order status:</span>
      <span className="font-medium">{status ? mintStatusLabel(status) : order.isError ? "Couldn't check" : "Checking…"}</span>
    </p>
  );
}
