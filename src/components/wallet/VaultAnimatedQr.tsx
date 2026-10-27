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
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  // A new request remounts the player, resetting both selection and playback.
  return <QrPlayer key={text} text={text} size={size} />;
}

function QrPlayer({ text, size }: { text: string; size?: number }) {
  const desktop = useDesktopViewport();
  const px = size ?? (desktop ? desktopQrSize() : PHONE_QR_PX);
  const parts = useMemo(() => toParts(text), [text]);
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (parts.length <= 1 || paused) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % parts.length), 700);
    return () => clearInterval(t);
  }, [parts, paused]);

  const move = (offset: number) => {
    setPaused(true);
    setFrame((f) => (f + offset + parts.length) % parts.length);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <QrCode value={parts[frame] ?? ""} size={px} />
      {parts.length > 1 && (
        <>
          <p className="text-xs text-muted-foreground">
            Part {frame + 1} of {parts.length}{paused ? " · Paused" : ""}
          </p>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Previous QR part" title="Previous QR part" onClick={() => move(-1)}><ChevronLeft /></Button>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={paused ? "Resume QR playback" : "Pause QR playback"} title={paused ? "Resume QR playback" : "Pause QR playback"} onClick={() => setPaused((p) => !p)}>{paused ? <Play /> : <Pause />}</Button>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Next QR part" title="Next QR part" onClick={() => move(1)}><ChevronRight /></Button>
            <select aria-label="QR part" className="h-11 max-w-28 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={frame} onChange={(event) => { setPaused(true); setFrame(Number(event.target.value)); }}>
              {parts.map((_, i) => <option key={i} value={i}>Part {i + 1}</option>)}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
