/** Same-origin JSON-RPC proxy for Solana mainnet. */
import { createFileRoute } from "@tanstack/react-router";
import { shouldTryNextUpstream, solanaUpstreams } from "@/lib/solana/rpc-upstreams";

/** Largest single reply we relay (a batch of parsed transactions stays far below this). */
const MAX_REPLY_BYTES = 4_000_000;
const ALLOWED = new Set([
  "getBalance",
  "getBlockHeight",
  "getLatestBlockhash",
  "getSignaturesForAddress",
  "getTransaction",
  "getParsedTransaction",
  "sendTransaction",
  "getFeeForMessage",
  "getAccountInfo",
  "getMultipleAccounts",
]);

function isAllowedCaller(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host") ?? "";
  const source = origin ?? (referer ? (() => { try { return new URL(referer).origin; } catch { return null; } })() : null);
  if (!source) return false;
  let sourceHost = "";
  try { sourceHost = new URL(source).host; } catch { return false; }
  if (sourceHost === host) return true;
  if (["capacitor://localhost", "ionic://localhost", "https://localhost"].includes(source)) return true;
  if (["hme-mobile.lovable.app", "mobile.honest.money"].includes(sourceHost)) return true;
  if (source.startsWith("chrome-extension://")) return true;
  return process.env.NODE_ENV !== "production" && sourceHost.endsWith(".lovable.app");
}

export const Route = createFileRoute("/api/solana")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAllowedCaller(request)) return new Response("Forbidden", { status: 403 });
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 128_000) return new Response("Request too large", { status: 413 });
        let rawBody: string;
        try { rawBody = await request.text(); } catch { return new Response("Invalid request", { status: 400 }); }
        if (rawBody.length > 128_000) return new Response("Request too large", { status: 413 });
        let body: unknown;
        try { body = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }
        const calls = Array.isArray(body) ? body : [body];
        for (const call of calls) {
          const method = (call as { method?: unknown })?.method;
          if (typeof method !== "string" || !ALLOWED.has(method)) {
            return new Response(`Method not allowed: ${String(method ?? "?")}`, { status: 403 });
          }
        }
        let last: { status: number; body: string } | null = null;
        for (const upstream of solanaUpstreams(process.env.ALCHEMY_KEY)) {
          try {
            const reply = await fetch(upstream.url, {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: rawBody,
              redirect: "error",
              signal: AbortSignal.timeout(12_000),
            });
            const text = await reply.text();
            if (text.length > MAX_REPLY_BYTES) { last = { status: 502, body: "Solana reply too large" }; continue; }
            if (shouldTryNextUpstream(reply.status, text)) { last = { status: reply.status, body: text }; continue; }
            return new Response(text, {
              status: reply.status,
              headers: {
                "content-type": "application/json",
                "cache-control": "no-store",
                "x-hm-upstream": upstream.name,
              },
            });
          } catch {
            last = { status: 502, body: "Solana network unavailable" };
          }
        }
        return new Response(last?.body.startsWith("{") ? last.body : "Solana network unavailable", {
          status: 502,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
