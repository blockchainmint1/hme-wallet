# Trading links
- Coins the wallet doesn't support (delegate-keys.ts) are shared only when the site lists them, only in access links, at the same branch, standard xpub/xprv (SOL raw SLIP-0010, ADA Icarus, XMR Trezor-method spend key), and are never shown, sent or swept. Why: the site trades them; approve mode can't sign them.
- The extra-coin list is fixed in wallet code; sites only choose from it, and unknown optional coins are skipped. Why: a new key type needs reviewed derivation code and an audited release.
