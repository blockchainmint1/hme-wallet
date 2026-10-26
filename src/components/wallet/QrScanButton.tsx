/**
 * QR scan button. Uses an in-app <video> + getUserMedia dialog on every
 * platform (browser and native WKWebView), decoding frames with either the
 * built-in BarcodeDetector or jsQR as a fallback.
 *
 * We used to route native builds through @capacitor-community/barcode-scanner,
 * which draws the camera behind a transparent webview. That approach breaks
 * when the app loads from a remote URL (our current setup — server.url =
 * https://mobile.honest.money) because the community plugin can't reliably
 * make a remotely-hosted webview transparent. Result: tapping the QR icon
 * did nothing / showed a black screen. The getUserMedia path works
 * identically inside WKWebView as long as NSCameraUsageDescription is set
 * (it is) and the page is HTTPS (it is).
 */
import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export function QrScanButton({
  onScan,
  continuous = false,
  progress,
  complete = false,
  onScanStart,
}: {
  onScan: (text: string) => void;
  /** Keep scanning after each code; the caller stops it with complete. */
  continuous?: boolean;
  progress?: { have: number; total: number } | null;
  complete?: boolean;
  onScanStart?: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (complete) setOpen(false); }, [complete]);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => { onScanStart?.(); setOpen(true); }}
        title="Scan QR"
        aria-label="Scan QR"
      >
        <Camera className="h-4 w-4" />
      </Button>
      {open && (
        <ScannerDialog
          progress={progress}
          onClose={() => setOpen(false)}
          onScan={(text) => {
            if (!continuous) setOpen(false);
            onScan(text);
          }}
        />
      )}
    </>
  );
}

function ScannerDialog({ onClose, onScan, progress }: { onClose: () => void; onScan: (t: string) => void; progress?: { have: number; total: number } | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Callers usually pass an inline arrow / locally-declared function, so its
  // identity changes on every parent render. Keeping it in a ref means the
  // camera effect below starts exactly once instead of tearing down and
  // restarting the stream (which looked like the scanner "refreshing a lot").
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    let detector: BarcodeDetectorLike | null = null;
    let jsQR: typeof import("jsqr").default | null = null;

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("Camera not supported on this device.");
        return;
      }
      if (typeof window !== "undefined" && window.BarcodeDetector) {
        try {
          detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      // Load the bundled fallback before asking for the camera, even when a
      // native detector exists: some devices advertise it but fail on frames.
      {
        try {
          const mod = await import("jsqr");
          jsQR = mod.default;
        } catch {
          setError("QR decoder failed to load.");
          return;
        }
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (e) {
        setError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Camera access denied. Allow camera access for this site or HME Wallet, then reopen the scanner. If the preview blocks it, open the wallet in its own tab."
            : e instanceof Error
              ? e.message
              : "Camera unavailable",
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      try {
        await video.play();
      } catch {
        if (!cancelled) setError("Camera preview could not start. Close and reopen the scanner.");
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (cancelled) return;
      setReady(true);

      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      let lastCode = "";
      let lastAt = 0;
      const emit = (text: string) => {
        // The same frame decodes many times per second; only forward new codes
        // (or the same code again after a pause, so single-frame scans repeat).
        const now = Date.now();
        if (text === lastCode && now - lastAt < 1500) return;
        lastCode = text;
        lastAt = now;
        onScanRef.current(text);
      };

      const tick = async () => {
        if (cancelled || !video) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          try {
            if (detector) {
              try {
                const codes = await detector.detect(video);
                if (cancelled) return;
                if (codes.length > 0 && codes[0].rawValue) {
                  emit(codes[0].rawValue);
                  raf = requestAnimationFrame(tick);
                  return;
                }
              } catch { detector = null; }
            }
            if (jsQR && ctx) {
              const w = video.videoWidth;
              const h = video.videoHeight;
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
              if (code && code.data) emit(code.data);
            }
          } catch {
            // ignore per-frame errors
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="pr-8">Scan QR</DialogTitle>
          <DialogDescription className="sr-only">
            Use your device camera to scan a QR code, including animated Vault transfers.
          </DialogDescription>
        </DialogHeader>
        <div className="relative aspect-square bg-muted">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain"
            playsInline
            muted
            autoPlay
          />
          <div className="pointer-events-none absolute inset-8 border-2 border-primary/70 rounded-lg" />
        </div>
        <div className="p-4 text-xs text-muted-foreground min-h-[3rem] space-y-2" role="status" aria-live="polite">
          {progress && progress.total > 0 && <>
            <Progress value={100 * progress.have / progress.total} aria-label="QR transfer progress" />
            <p>{progress.have} of {progress.total} parts · {Math.floor(100 * progress.have / progress.total)}%</p>
          </>}
          {error
            ? error
            : ready
              ? "Keep the entire QR code in view."
              : "Starting camera…"}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Parse a wallet URI like `texitcoin:txc1...?amount=1.23` or a plain address.
 * Returns { address, amount?, tokenId? } where amount is a decimal string and
 * tokenId is an Omni property id (`?omni=39`) when the URI requests a token.
 */
export function parseWalletUri(input: string): { address: string; amount?: string; tokenId?: number } {
  const trimmed = input.trim();
  const schemeMatch = trimmed.match(/^(texitcoin|txc|bitcoin|btc|iskandercoin|isk|litecoin|ltc|dogecoin|doge):([^?]+)(\?(.*))?$/i);
  if (schemeMatch) {
    const address = schemeMatch[2];
    const params = new URLSearchParams(schemeMatch[4] ?? "");
    const amount = params.get("amount") ?? undefined;
    const rawId =
      params.get("omni") ??
      params.get("propertyid") ??
      params.get("property") ??
      params.get("token") ??
      "";
    const n = Number(rawId.trim());
    const tokenId = Number.isInteger(n) && n > 0 ? n : undefined;
    return { address, amount, tokenId };
  }
  return { address: trimmed };
}
