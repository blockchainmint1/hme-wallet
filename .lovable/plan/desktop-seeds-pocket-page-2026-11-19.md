# Desktop "Seeds Pocket" page

Desktop only (web desktop view). Phone, APK and extension stay as they are.

## What you'll see
- A new **Seeds Pocket** item in the desktop left menu. It shows up only on a wallet that has a Seeds link. With no link, the item stays hidden.
- **Pocket header:** pocket number (e.g. #1106), when it was linked, and whether Seeds has spending access or approve-only access.
- **One row per coin the wallet supports** (TXC, TSD, BTC, LTC, DOGE, ETH, Base, the BNB/Tron/Solana coins that were shared):
  - the pocket's public address and its public key (xpub), each with a copy button
  - the balance the wallet reads straight from the blockchain, not from Seeds
  - a **"View on explorer"** link (TEXITcoin explorer, mempool.space, Etherscan, Basescan and so on)
- **Move back** on each coin with a balance. It sends that coin from the pocket to your main wallet address #0, using the normal send review (amount, fee, confirm). There's also a **"Move everything back"** option that does this one coin at a time.
- **Revoke Seeds** button. It opens the revoke dialog the Apps page already uses, so the warning stays the same: tick "I moved my coins out".

## Coins the wallet doesn't support (XMR, ADA, ATOM, RUNE, ZEC, XRP, etc.)
Your rule is that the wallet never shows, sends or sweeps these coins. So the page only lists them by name: "Held through Seeds. Check or withdraw them on Seeds." There are no addresses, keys, balances or Move back buttons for them.

## Things to know
- Seeds also holds the spending keys. If you move coins out while Seeds has an open order, that trade could fail. Before moving, the wallet will warn you: "Cancel open orders on Seeds first."
- Revoking stops new access. It can't take back keys Seeds already has, so move your coins out first. The dialog says this.
- Vault (QR) wallets never link to Seeds, so this page won't appear for them.

## Technical section
- New route `src/routes/desktop.seeds.tsx`. Add the nav entry in `DesktopShell.tsx`, shown only when `listDelegateLinks()` finds a record for the Seeds host on the active profile.
- Pocket addresses/xpubs come from the link record (account and branch, plus `chains`), derived with the existing branch derivation. Balances use the existing read-only balance readers (Omni/TSD, Blockbook UTXO, EVM including Base, tokens), following the desktop allowlist rule: no spending quotes.
- Move back reuses the existing safe send builders (UTXO and Omni, EVM), signing with the pocket-branch keys. Destination is pinned to the profile's own address #0, never typed in. Reuse the gather/migrate sweep logic for UTXO.
- Revoke calls the existing `revokeDelegate` and the acknowledgement dialog unchanged.
- Tests: the nav entry is hidden without a link; extra coins never show an address, balance or button; Move back's destination is always own #0; revoke stays gated by the acknowledgement.
- Auditor note in /mnt/documents when the build is done. Nothing gets published without your go-ahead.
