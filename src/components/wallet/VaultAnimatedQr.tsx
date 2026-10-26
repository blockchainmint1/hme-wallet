/**
 * Animated QR display for Vault signing requests. Short payloads show a
 * single static QR; long ones cycle through HMQR2 frames (~700ms each),
 * matching HME Vault's scanner.
 *
 * Desktop draws the code about twice as large as the phone: the Vault camera
 * has to read it across a desk, and a wide window has the room for it. Only
 * the picture grows — the frame bytes handed to the scanner are untouched, so
 * HME Vault still receives exactly the same data.
 */
import { useEffect, useMemo, useState } from "react";
import { QrCode } from "@/components/wallet/QrCode";
import { useDesktopViewport } from "@/hooks/use-desktop-viewport";
import { toParts } from "@/lib/vault-link/qr-parts";

const PHONE_QR_PX = 260;
const DESKTOP_QR_PX = 520;

/**
 * Desktop size, eased back on a short window so the signing panel keeps the
 * whole code on screen instead of pushing it past the fold.
 */
function desktopQrSize(): number {
  if (typeof window === "undefined") return DESKTOP_QR_PX;
  return Math.max(PHONE_QR_PX, Math.min(DESKTOP_QR_PX, Math.floor(window.innerHeight * 0.55)));
}

export function VaultAnimatedQr({ text, size }: { text: string; size?: number }) {
  const desktop = useDesktopViewport();
  const px = size ?? (desktop ? desktopQrSize() : PHONE_QR_PX);
  const parts = useMemo(() => toParts(text), [text]);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (parts.length <= 1) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % parts.length), 700);
    return () => clearInterval(t);
  }, [parts]);

  return (
    <div className="flex flex-col items-center gap-2">
      <QrCode value={parts[frame] ?? ""} size={px} />
      {parts.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Part {frame + 1} of {parts.length} — keep the Vault camera pointed here
        </p>
      )}
    </div>
  );
}
