/**
 * Same-origin proxy for Nectar.Pay invoice endpoints (CSP keeps the wallet
 * from calling partners directly). Hardened per security review: strict
 * invoice/nonce shapes, only `t` forwarded, POST body exactly `{ option }`,
 * per-client rate limit, and the shared bounded JSON forwarder (no redirects,
 * no HTML, size caps). Nothing from the incoming request's headers is sent.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createRateLimiter, nectarPayBody, nectarPayTarget } from "@/lib/security/nectar-pay-policy";

// 20 reads/selections per client per minute is ample for a real checkout.
const allow = createRateLimiter(20, 60_000);

function reject(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function clientKey(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function guard(req: Request, invoiceId: string): Promise<string | Response> {
  const target = nectarPayTarget(invoiceId, new URL(req.url).searchParams);
  if (!target) return reject("Invalid invoice link", 400);
  if (!allow(clientKey(req))) return reject("Too many requests", 429);
  return target;
}

export const Route = createFileRoute("/api/nectar/pay/$invoiceId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const target = await guard(request, params.invoiceId);
        if (target instanceof Response) return target;
        const { forwardJson } = await import("@/lib/security/json-proxy.server");
        return forwardJson(target, { method: "GET", headers: { Accept: "application/json" } });
      },
      POST: async ({ request, params }) => {
        const target = await guard(request, params.invoiceId);
        if (target instanceof Response) return target;
        const { readBoundedText, forwardJson } = await import("@/lib/security/json-proxy.server");
        let body: string | null = null;
        try { body = nectarPayBody(JSON.parse(await readBoundedText(request, 1024))); } catch { body = null; }
        if (!body) return reject("Invalid payment choice", 400);
        return forwardJson(target, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body,
        });
      },
    },
  },
});
