<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Desktop workspace
- Desktop overview refresh uses an explicit balance/price query allowlist; privacy hides funded allocation rankings and counts, and Tron/Solana display retains address-only results. Why: viewing must not refresh spending quotes, disclose allocation, or retain unnecessary signing material.
- Desktop management stays under /desktop with inline unlock, header picker and wallet library; shared forms retain phone defaults. Create/import use managed-seed-save: immutable add intent, fresh session checks at submission/save, initial setup refuses existing envelopes. Why: expired sessions cannot replace wallets.
- Charts use deletable profile/fingerprint history; portfolio requires coverage. Changed totals record immediately; unchanged throttle. After 24h thin by coverage to real five-minute samples, cap 2000. Explicit time/value bounds. Why: bounded history without invention.
- Desktop Earn stays paused; shared UTXO swap entry blocks Vault mode before quotes/orders/signing on all builds. Why: phone cannot bypass independent acceptance.
- Direct Earn shares Ethereum-only fixed ABIs, public-address reads and an unconditional execution gate. Sky conversion estimates are bigint-only, distinguishing USDC, USDS and shares; intermediate-asset bounds never authorize final-share promises. Why: official contracts and previews do not enforce user minimums or attest upgrade safety.
- Desktop features are profile-scoped, chains device-wide, separate from phone; token controls/catalogs are shared. Portfolio EVM customs use contract keys, no assumed peg; desktop custom sends reuse the shared EVM send, selected by exact contract (never symbol). Why: preserve storage, valuation and signing boundaries.

## Shared platform capabilities and layout
- Wide fine-pointer web browsers land on /desktop from /wallet unless "Phone view" was chosen (src/lib/desktop-pref.ts); APK and extension never redirect. Why: desktop default must never alter phone/APK/extension behavior.
- Desktop's locked state stays at /desktop and unlocks inline via the shared WalletProvider. Why: hard navigation loses the ephemeral session key and must not bounce users into the mobile workspace.
- Capability helpers stay unrestricted across builds; callers share features.
- QR: local JS/media, one close, progress, stop on completion; 240-char Vault frames, frame-independent hash, bound unique chunks; desktop codes grow, never phone/APK/extension. Why: safe decoding.
- Public footer stays inside the content scroller. Why: legal links must not pin over or reduce readable homepage content.
- Keep wallet Send/Receive outside the home content scroller; safe-area spacing applies once; hidden footers take no space. Why: phone actions stay at the bottom without an extra gap.

## Release delivery is database-driven

`/api/public/apk` serves the newest `app_releases` row's CID/version (or `?v=`), falling back to baked-in bytes only if lookup fails. Pin then record its endpoint download URL; never hardcode the live CID. Why: releases need no website redeploy.

## Chrome extension

The extension packages the full web app: `bun scripts/build-extension.mjs` runs `vite build`, renders the SPA shell into `extension/popup.html`/`index.html` with inline scripts externalised (MV3 CSP), and `server-fn-bridge` forwards `/_serverFn`+`/api` to mobile.honest.money when `isExtension()`. `src/extension/popup.tsx` is only the approval window (`approve.html`). Why: one app, every fix ships to web, APK and extension.

- Extension web provider: `src/extension/inpage.ts` (EIP-6963 + `window.honestMoney`, `window.ethereum` only if free) → `content.ts` → `background.ts`; keys stay in approval popup. Why: sites never touch keys and signatures need approval.
- Popup theme follows system; light/dark override stays in extension localStorage. Why: don't change web/mobile settings or wallet data.

## Trusted ecosystem sites come from honest.money
Registry/Hub use ecosystem-credential.server (current per-site HME convention); do not migrate partner signing implicitly. Spending requires fresh exact registry membership. Why: site recognition cannot authenticate payments.

## Trading links (hm-link-delegate)
- Trading links get only the branch(es) and modes the fresh signed honest.money registry reserves for that exact `delegate: true` site; a per-wallet branch book (src/lib/xpub-link/branches.ts) never gives a branch to another site (a revoked branch only returns to its own site, access only). Why: HME alone decides who may spend, and a shared key can't be taken back.
- The top camera routes safe bare HTTPS ecosystem manifests through the same link approval page as Settings, after payment and sign-in recognition; recognition never grants trust or shares keys. Why: Seeds uses bare manifest URLs and must not require a different scanner.

## Tap card (NFC) service
- Partners pay via `/api/public/card/pay` signed with `HME_ECOSYSTEM`; over-limit taps go to Telegram approvers via `/api/public/telegram/webhook`. Owner actions are wallet-signed envelopes, never accounts. Why: no extra service and no email logins.

## Vault wallets (offline signing via HME Vault)
- Read `src/lib/vault-link/AGENTS.md`: TSD is token-aware; THORChain Vault preparation never broadcasts. Cold Storage reads explicit profiles without switching and rejects failed scans. Why: protect wallets.
- Swap history retains key/profile ownership (legacy: payout address). Review records instant orders opened/not-sent with expiry; broadcast upgrades matching profile/provider/order; only txid rows poll. Why: no invented payments or cross-wallet records.
- Vault Send to many reuses VaultTsdGather in an exclusive in-page consolidation view, preserves the recipient list, and refreshes the sending balance on broadcast/return. Why: avoid concurrent spending flows and duplicate signing logic.
- Vault Consolidate all queues one existing gather per holder; advances only after verified broadcast, reserves attempted inputs locally, and uses fresh confirmed fee coins without chaining pending outputs. Why: avoid duplicate spends and stop visibly when remaining confirmed fee money is insufficient.

## Security boundaries
- LI.FI shares immutable intent/bytes and session/deployment/server signing checks; nested semantic review is mandatory, no fallback. Single-block hop allowlisting adds compatibility only; distinct spenders use the approval-only sentinel. Omit integrator config; remain paused until independent route/release/device acceptance. Why: permitted entrypoints cannot authorize opaque instructions.
- Swap choices never silently fall back; returned orders must match the requested provider. FixedFloat HTML 403 means refusal; no alternate-host retries or body exposure. Why: honor payment intent, avoid duplicate orders and leaks.
- THORChain quotes and order refreshes use liquidity_tolerance_bps against expected after-fee output, never feeless tolerance_bps; why: liquidity fees must not consume price protection or reject valid streaming quotes.
- Read nested AGENTS.md in security, chains, vault-link, thorchain, card and txc before edits; shared rules cover all builds.
- Card PIN verification and payment reservation run atomically in the database; why: concurrent taps cannot race limits or lockout.

## Settings scope (app-wide vs per-wallet)
- Chains, EVM token catalog and token-spam visibility are device-wide; migrate copy-only, never touching profiles/envelopes. Why: choices follow wallets safely.
- Key-tied features, address prefs, watch-only, WIF, delegate/Seeds, card, Vault and labels remain profile-scoped. Why: key-bound settings cannot leak across wallets.
- TSD cash-out key rules: src/lib/cashout/AGENTS.md.
- Settings page is grouped "This device" (app-wide) vs "This wallet — <label>" (per-wallet). Why: users must see which scope they're editing.
- Activity filtering is independent, device-wide and recoverable; counterfeit contracts override claimed direction; pending tracking uses raw history. Why: logs cannot prove signatures.

## UTXO history
- BTC/LTC/DOGE broadcasts use blockbookBroadcast: GET short/POST long hex, local txid, "already known" = success, failures txid-checked; the proxy re-sends long GET sendtx as POST for older builds. Why: long URLs 520; failures don't prove absence.
- Per-address history fetches merge through fetchMergedAddressTxs (src/lib/address-txs.ts); when every address fetch fails it throws so React Query keeps the last-known list. Why: an indexer outage must never overwrite good cached history with an empty list.
- Address-poisoning checks (src/lib/address-lookalike.ts, RecipientSafety) trust only destinations the member's key signed (native or verified-contract sends) plus contacts; history load failures show "couldn't compare", never safe. Why: fake Transfer events can claim any sender/recipient.
- Custom token lists save through safeSetItem (src/lib/storage/safe-set.ts), which trims only desktop chart history on a full-storage error; chart samples store a short coverage id, not the full asset list. Why: chart history once filled browser storage and silently blocked adding tokens.
