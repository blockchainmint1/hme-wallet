# TXC
- Desktop send-to-many (/desktop/bulk-send, src/lib/txc/bulk-send.ts): TXC is one multi-output tx; Omni tokens use type-7 batches of 7 from the single holder address, chained on change, stopping at the first failure. Why: TXC node relays one 80-byte OP_RETURN per tx and Omni sender must be unambiguous.
