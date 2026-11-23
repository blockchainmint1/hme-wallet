# Seeds pocket
- Pocket Move back (sweepPocket) refuses fees at or above TXC_MAX_FEE_RATE and below 1 sat per signed vbyte, checked before building and after signing; the public extra-coin balance lookup is limited per visitor (best effort per server instance). Why: auditor 23 Nov — a bad estimate must not drain a pocket, and one unauthenticated call fans out to many metered services.
