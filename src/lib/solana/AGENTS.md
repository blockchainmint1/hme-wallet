# Solana

- /api/solana tries ordered upstreams (keyed Alchemy, PublicNode, then Solana's public endpoint) and fails over only on refusals, rate limits, outages or non-JSON replies (src/lib/solana/rpc-upstreams.ts). Why: Solana's public endpoint blocks our hosting provider, and identical signed sends are de-duplicated by signature.
