# Official Earn deposits on the desktop

## What you will get
- Sky **USDS → sUSDS**, with withdrawal back to USDS.
- Aave **USDC → interest-earning USDC receipt tokens**, with withdrawal back to USDC.
- Amount entry, actual wallet balances, live estimates, current variable rates, network fees, approval review and transaction progress on the Earn page.
- Accurate holdings: Sky share redemption value and Aave's interest-accruing balance.

Start on Ethereum using the official savings and lending contracts. These are direct deposits, not cross-network bridges, and do not depend on reopening general EVM swaps.

## Safety and delivery
- Verify official deployment addresses and current on-chain configuration before implementing each route.
- Limit approvals to the precise amount and verified spender. Bind every payment to the selected wallet, network, asset and recipient.
- Check simulation, confirmation receipts and actual received balances; handle approval-only or partially completed flows without retrying a payment blindly.
- Keep execution blocked by a shared enforcement gate until independent review and release acceptance. Do not enable Vault signing, borrowing, collateral management, general swaps or new site access.
- Preserve existing wallets, phone settings and phone screens. Shared safety code must apply to web, APK and extension; new packages require separate verification.
- Supply clean source, tests and deployment evidence for the auditor. After approval, verify a separately authorized small deposit and withdrawal on a real device.

## Sky USDC conversion
Investigate Sky's official **USDC → USDS** conversion as an additional step. Its fees can change and its basic interface does not enforce a minimum received. Only prepare a spending route if output and fee bounds can be enforced safely; otherwise leave this conversion unavailable and document the specific blocker. Do not deploy a new intermediary contract without separate approval and review.

## Technical approach
- Create a browser-safe, chain-specific protocol registry and shared direct Earn transaction builders/executor, separate from LI.FI.
- Use existing public EVM clients, wallet signing and per-attempt guards; use fixed reviewed ABIs rather than provider-supplied executable instructions.
- Read current balances, vault previews and Aave reserve configuration through the existing query patterns. Never invent yield or assume Ethereum deployment behavior on another chain.
- Add focused hostile-input, exact-approval, wallet-change, withdrawal, receipt and execution-gate tests; verify the unlocked desktop flow and unchanged phone behavior.

## Out of scope
Cross-chain bridges, Base deployment support, offline Vault Earn signing, cold-storage section redesign and guaranteed returns.