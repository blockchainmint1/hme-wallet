# TXC rejection follow-ups (review of 88d4dec)

1. **Rejection vs lost reply** (`src/lib/txc/broadcast-submit.ts`): HTTP 400/422 with node text, followed by an exact-txid 404, throws `TxcBroadcastRejectedError` with the reason; `broadcastTx` releases the journal entry. Network errors, timeouts, 404/401/403/408/429, 5xx, HTML and non-matching OK replies stay uncertain. Bulk and Vault bulk mark refused batches "Not sent" (`notSent`, never re-marked uncertain on reload); Vault gather releases its reserved inputs.
2. **Safe exit** (`src/lib/txc/broadcast-recheck.ts`): `recheckTxcAttempt` returns not-sent only when the txid is 404, every reserved input is unspent per `/outspends` (mempool-aware), and a final txid lookup is still 404. Any failed read = unknown. User-triggered "Check again" on: shared TXC send screen (lists journal entries), desktop Send to many, Vault Send to many, Vault Consolidate TSD.
3. **Malformed journal entries** are skipped and counted on the send screen; they never block valid sends.
4. **Card server**: new column `nfc_card_payments.attempt_inputs` saved with the txid before submission. A node rejection marks the row failed (frees invoice + daily limit). A pending row with a txid is released on the next status poll only by the same two-negative rule. A claim update returning a database error code returns `failed`; ambiguous replies still return `sending`.

Tests: 848 pass (8 new). Type-check and lint clean on changed files.
