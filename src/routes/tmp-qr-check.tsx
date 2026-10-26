import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import jsQR from "jsqr";
import { VaultAnimatedQr } from "@/components/wallet/VaultAnimatedQr";
import { toParts } from "@/lib/vault-link/qr-parts";

// Temporary verification harness: a payload past one frame so the code cycles.
const PAYLOAD = "A".repeat(650) + "B".repeat(650);

export const Route = createFileRoute("/tmp-qr-check")({
  component: Page,
});

function Page() {
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__qr = {
      parts: toParts(PAYLOAD),
      decode: () => {
        const img = document.querySelector("img") as HTMLImageElement | null;
        if (!img) return null;
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const r = jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" });
        return { text: r?.data ?? null, natural: [img.naturalWidth, img.naturalHeight] };
      },
    };
  }, []);
  return (
    <div id="wrap" className="flex justify-center p-8">
      <VaultAnimatedQr text={PAYLOAD} />
    </div>
  );
}
