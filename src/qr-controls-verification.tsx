import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { VaultAnimatedQr } from "./components/wallet/VaultAnimatedQr";
import { QrScanButton } from "./components/wallet/QrScanButton";
import { PartCollector } from "./lib/vault-link/qr-parts";

function Check() {
  const collector = useRef(new PartCollector());
  const [progress, setProgress] = useState<{ have: number; total: number; received: number[] } | null>(null);
  const [text, setText] = useState("q".repeat(600 * 96));
  return <div className="p-4 space-y-4">
    <VaultAnimatedQr text={text} />
    <input aria-label="Test payload" value={text} onChange={(e) => setText(e.target.value)} />
    <QrScanButton continuous progress={progress} complete={progress?.have === 96} onScan={(code) => {
      collector.current.add(code);
      setProgress({ ...collector.current.progress, received: collector.current.receivedParts });
    }} />
  </div>;
}

export function mount() {
  const el = document.createElement("div");
  el.id = "qr-controls-check";
  document.body.replaceChildren(el);
  createRoot(el).render(<Check />);
}