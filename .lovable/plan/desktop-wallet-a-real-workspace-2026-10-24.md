# Desktop wallet: a real workspace

## Direction
Rebuild `/desktop` using your Ledger Live screen as the layout reference: a compact persistent menu, a spacious portfolio chart, useful allocation detail and readable transactions. Keep Honest Money’s identity and the existing phone experience.

## Pages
- **Portfolio — `/desktop`:** total balance, balance-history chart with date ranges, asset allocation, holdings and recent transactions. Distinguish missing prices or unavailable balances from zero.
- **Activity — `/desktop/activity`:** transaction table with asset/network filters, incoming/outgoing direction, dates, status and transaction details. Keep suspicious-activity hiding recoverable and preserve cached history during outages.
- **Send — `/desktop/send`:** asset/network selection, recipient, amount and review in a desktop layout; use existing signing, fee and validation logic.
- **Receive — `/desktop/receive`:** asset/network selection, real receiving address, QR and copy controls, with the correct network clearly identified.
- **Swap — `/desktop/swap`:** supported swap pairs, quotes and saved orders in one workspace. Keep paused routes unavailable. Do not enable the unresolved Vault THORChain signing flow.
- **HME Vault — `/desktop/vault`:** paired wallet overview, supported accounts, balances and pairing status, with the existing offline QR-signing experience where supported. This is a view of the paired Vault wallet, not a remote controller or access to its private keys. Vault ecosystem linking remains excluded.
- **Stablecoins — `/desktop/stablecoins`:** dedicated balances grouped by stablecoin and network, including TSD, and correctly selected Send/Receive actions. Dollar pegs are estimates, not guaranteed market prices.
- **Earn — `/desktop/earn`:** sUSDS as the first named asset, with its yield mechanism, network, liquidity and risk information. Prepare the acquisition/swap experience, but keep execution unavailable until a supported route and contract checks pass independent review. No invented yield percentages or unselected investment products.
- **Apps & links — `/desktop/apps`:** available Honest Money ecosystem apps, existing links and the same explicit link-approval flows. App discovery never grants spending access.

## Honest balance history
Use actual historical balances and prices where available. If complete past portfolio values cannot be reconstructed reliably, record new profile-isolated snapshots on this device and clearly show when the history began. Never invent a past curve, label today's prices as historical performance, or save incomplete outage values as real portfolio losses. Hide chart values when balance privacy is enabled.

## Keep the phone separate
- Desktop gets its own pages, navigation and presentation components.
- Reuse the existing wallet engine and safety checks, not a second copy of signing code.
- Do not change wallet storage, existing profiles, mobile navigation, bottom actions, APK defaults or extension defaults.
- Desktop links retain the desktop workspace throughout supported tasks rather than dropping users into the phone layout.

## Delivery and verification
1. Build the desktop shell, portfolio, activity and stablecoin views.
2. Add dedicated desktop Send, Receive, Swap, Vault and apps views using shared trusted flows.
3. Add the Earn page and explicitly identify any route/review blocker before enabling money movement.
4. Test an unlocked isolated wallet across desktop and phone widths, profile switching, privacy, navigation, real address/QR display and unavailable-data states. Exercise quote/review preparation without sending funds.
5. Provide an auditor-shareable source/change pack with tests, limitations and the existing Vault swap restrictions. Do not publish or release APK/extension packages before third-party review.

## Technical approach
Promote `src/routes/desktop.tsx` to an inline-unlocking layout with an `Outlet`; move portfolio content to `desktop.index.tsx` and create a route file for each page above. Extract focused desktop data/presentation modules, keeping existing shared services and query caches. Add profile-isolated balance-history storage only if historical reconstruction is unavailable, with tests for profile isolation and rejecting incomplete snapshots. Give every new content route its own page metadata.