# Custom EVM portfolio visibility — review handoff

## Requested correction
Custom sUSDS configured in desktop settings did not appear in the portfolio because DesktopData read BUILTIN_TOKENS_BY_CHAIN only. It now reads the enabled device catalog on each enabled EVM chain and subscribes to token-setting changes. Existing balance reads use chain, contract and wallet address. Custom rows remain visible at zero or unavailable balance; hiding/removing a token removes the row. Phone implementation and token storage keys unchanged.

## Identity and valuation
New token-assets helper assigns custom keys by chain + lowercased contract. Canonical built-ins retain their prior keys and $1 peg estimates. Custom symbols never confer stablecoin classification or dollar pricing, including sUSDS: its balance is shown but price unavailable. No USDS/USD source was added. A zero custom holding contributes $0; a funded unpriced token pauses complete portfolio history through existing coverage checks. Existing asset history storage prefix and deletion remain unchanged. ERC-20 history maps contracts through the known catalog to this same identity; advisory spam filtering is unchanged.

## Safety scope
No signing, approval, Earn or swap gate changes. Custom desktop send selection is explicitly unavailable because shared sends select by symbol, which cannot safely disambiguate same-symbol contracts. Receive uses existing network receive flow. Dedicated currency description no longer falsely calls customs dollar-pegged. TXC custom Omni portfolio integration was not changed in this task.

## Verification
17 focused tests passed: exact sUSDS contract identity/no assumed dollar peg, same-symbol USDC impostor isolation, and existing display/history rules. Preview build OK. Fresh browser created a disposable seed wallet through UI, unlocked desktop, added sUSDS through custom-token dialog, navigated to portfolio and observed the row with balance zero, price unavailable and value $0. Saved encrypted envelope remained byte-identical; no page errors. Screenshot inspected. No funded transaction or user wallet accessed. Failed dedicated currency-page navigation checks retained the portfolio screen; direct-page acceptance remains unverified and outside the requested row correction. No claim of verified live funded sUSDS balance or market price.

## Release
Shared source only; website not published, APK/extension not rebuilt. Independent review and device acceptance required. Review DesktopData, token-assets/helper tests, Activity, AssetFlow and CurrencyPage. No server, backend, dependency or environment changes.