# Desktop custom-token settings review

## Scope
Adds TXC Omni and EVM/Base token management to /desktop/settings. Reuses existing token dialogs, validation, persistence and browser events. Both catalogs are device-wide and shared with Phone view; no wallet envelopes, signing logic, contracts, backend or dependencies changed.

EVM supports existing Ethereum, Base and BNB Smart Chain options: contract address, symbol and decimals. TXC accepts existing Omni property ID, symbol, optional name and divisibility fields. Visibility and custom removal controls remain available; TSD remains always on. Compact controls are unframed desktop sections. Optional showSpamToggle defaults true to preserve existing phone UI; desktop omits the duplicate toggle.

## Evidence
- Fresh disposable Vault profile unlocked through actual UI; added TXC test property 12345 and a synthetic Base ERC-20 address with six decimals. Both read back after reload, then removed successfully.
- No page errors or horizontal overflow at 1280px; screenshot inspected.
- Existing settings-scope tests: 5 passed. Latest preview build OK.
- No real token lookup, funded transaction or signing performed. Metadata remains user supplied as in existing phone settings; adding does not verify legitimacy or pricing.

## Limitations
Desktop holdings currently query built-in EVM assets and TSD, not these custom catalogs. This change makes custom-token configuration available in desktop settings; it does not add custom portfolio rows or invent dollar prices. EVM/Vault swaps and Earn gates unchanged. Not published; APK/extension packages not rebuilt. Shared control source retains phone defaults for later package delivery.

## Auditor files
Review src/routes/desktop.settings.tsx and src/components/wallet/TokensCard.tsx. TxcTokensCard.tsx, token-prefs.ts and txc/tokens.ts are unchanged dependencies, included for review context. Confirm no new storage keys and no changes to spend authorization or token validation.