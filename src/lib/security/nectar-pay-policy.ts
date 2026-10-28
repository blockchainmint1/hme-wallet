/**
 * Bounds for the same-origin NectarPay invoice relay. Only well-formed
 * invoice IDs with a tap nonce are forwarded, only `t` is forwarded, POST
 * bodies are exactly `{ option }`, and each client gets a small request budget.
 */
const INVOICE_ID = /^[A-Za-z0-9_-]{6,64}$/;
const NONCE = /^[A-Za-z0-9._~-]{8,256}$/;
const OPTION = /^[A-Za-z0-9:._-]{1,64}$/;

export function nectarPayTarget(invoiceId: string, search: URLSearchParams): string | null {
  if (!INVOICE_ID.test(invoiceId)) return null;
  const keys = [...search.keys()];
  if (keys.length !== 1 || keys[0] !== "t") return null;
  const t = search.get("t") ?? "";
  if (!NONCE.test(t)) return null;
  return `https://nectar-pay.com/api/public/v1/pay/${invoiceId}?t=${encodeURIComponent(t)}`;
}

export function nectarPayBody(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  const option = (raw as { option?: unknown }).option;
  if (keys.length !== 1 || keys[0] !== "option" || typeof option !== "string" || !OPTION.test(option)) return null;
  return JSON.stringify({ option });
}

/** Fixed-window limiter per client key (best effort per server instance). */
export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000) {
  const hits = new Map<string, { start: number; count: number }>();
  return (key: string, now = Date.now()): boolean => {
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      if (hits.size >= maxKeys) hits.clear();
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}
