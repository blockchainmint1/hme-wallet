# Cold Storage preview — independent review

## Change
The desktop /desktop/vault page now lists linked watch-only addresses from each stored profile and previews paired HME Vaults without selecting or unlocking them. Coin cards show public address, network, label, owning profile and native balance. Vault cards show label, fingerprint, pairing date, networks and public EVM address; View balances loads native UTXO/EVM and enabled ERC-20 balances. No dollar valuation or combined total is invented. TXC Omni balances are not included in these previews.

## Boundaries to evaluate
- Only profile summaries, public pairing metadata and public watch-address stores are read. No preview calls switchProfile, saves envelopes, derives private keys, signs, creates orders or broadcasts.
- listWatchWallets has an optional explicit profile ID; callers omitting it retain the existing active-profile behavior across web/APK/extension.
- Query keys isolate profile ID and address/pairing content. Existing balance privacy preference masks numeric balances. Public addresses and fingerprints remain visible.
- Vault UTXO previews use a separate read-only public-xpub scan: receive/change, all paired purposes, 20-address gap, 2,000-address cap per branch. Any failed stats call rejects the chain; previous query data remains marked last-known. This is not a spend authorization or a replacement for existing signing scans.
- Vault scans start only when expanded. This can generate many public address requests and disclose queried addresses to existing indexers. No external decoder or new service is introduced.
- Pairing add and address add links remain under /desktop. Phone screens are unchanged. No APK/extension packages were built and nothing was published.
- Manifesto metadata received missing Open Graph type and Twitter card tags; unrelated to signing.

## Evidence
10 tests pass across cold-storage.test.ts, wallet-removal.test.ts and settings-scope.test.ts. Tests cover explicit-profile collection without writes, failed scan rejection, confirmed/pending amounts and existing preservation/scope behavior.

Playwright created an isolated wallet through the normal UI, added a Bitcoin watch address through the desktop form, read it back on Cold Storage and fetched its public balance. An isolated Vault metadata fixture exposed balances from public EVM address 0x0000000000000000000000000000000000000001 (not Bobby's wallet). Vault expansion and privacy were exercised. Original encrypted envelope and active-profile pointer remained byte-identical. No page errors or horizontal overflow at 1280x1800. Physical Vault pairing, funded spending, APK/extension acceptance are not verified by this test.

Latest preview build: OK. Independent approval is still required before publication.

## Review source
src/components/desktop/ColdStoragePreview.tsx; src/lib/desktop/cold-storage.ts and its test; src/lib/watch-only.ts; src/routes/desktop.vault.tsx. Existing pairing/derive/watch adapters are included in the package for context.