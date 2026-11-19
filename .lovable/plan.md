# Ideas: prove the Seeds balance is really in your wallet

Seeds shows "Pocket #1106 — confirmed on-chain balances". The coins sit at addresses your wallet's keys control, so the wallet can check them itself, without trusting Seeds' number.

## Ideas (pick any)

1. **"Pocket 1106 — what's really there" panel** (on the Seeds link card, phone + desktop)
   The wallet reads the blockchain directly for the pocket's addresses and shows each coin: TSD, TXC, BTC, ETH (Ethereum + Base), USDC, etc., with $ value and a total. Side by side with what you see on Seeds.
2. **Match check against Seeds** (needs a small read-only endpoint from Seeds)
   Wallet pulls Seeds' reported balance for the pocket and shows a green "Matches" or amber "Seeds shows 850 TSD, chain shows 800" line per coin. Small timing differences (pending trades) shown as "pending", not as a mismatch.
3. **"Check on explorer" links**
   Each coin row opens the public explorer for that pocket address, so anyone can verify with a third party, not just us or Seeds.
4. **Alerts when coins leave the pocket**
   If the pocket balance drops and it wasn't a withdrawal you made, the wallet flags it ("1,000 TXC left pocket 1106 — tx …"). Fits our existing activity screen.
5. **Signed proof from the wallet** (later, optional)
   A "Prove I hold this" button that signs a short message with the pocket key, which Seeds can display as proof of reserves per member.

## Limits to know
- Coins the wallet doesn't support (Seeds' extra coins like XMR, ADA, ATOM) stay blind here, per your earlier rule. The panel would say "11 more coins held via Seeds — check on Seeds/explorer". Monero balances can't be seen from a public explorer at all.
- This proves the coins are in the pocket. It can't stop Seeds from moving them, since Seeds holds spend keys — that's what idea 4 watches for.

## Suggested first build
Ideas 1 + 3 + 4 in the wallet (no Seeds changes needed). Idea 2 after Seeds adds a read-only balance endpoint; I'd write them a handoff.

## Technical notes
- Pocket addresses derived from the branch-1106 keys already in the link record; reuse existing balance readers (Omni/TSD, UTXO, EVM incl. Base, tokens). Read-only, no keys exposed, no spending quotes.
- Applies to web, APK and extension; APK needs a rebuild to show it. Auditor note at the end.
