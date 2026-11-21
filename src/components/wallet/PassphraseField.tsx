import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * BIP39 passphrase input that password managers leave alone: a plain text box
 * (masked with CSS where supported) carrying the common "ignore me" markers,
 * read-only until the member clicks into it so nothing autofills on page load.
 */
export function PassphraseField({ id, value, onChange, disabled, className }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const [masked, setMasked] = useState(true);
  const [armed, setArmed] = useState(false);
  // Browsers without CSS text masking fall back to a password box (still read-only until focused).
  useEffect(() => {
    setMasked(typeof CSS !== "undefined" && (CSS.supports("-webkit-text-security", "disc") || CSS.supports("text-security", "disc")));
  }, []);
  const style = !show && masked ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined;
  return (
    <div className={`relative ${className ?? ""}`}>
      <Input
        id={id}
        name="hm-bip39-extra-words"
        type={!show && !masked ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={() => setArmed(true)}
        onFocus={() => setArmed(true)}
        readOnly={!armed}
        placeholder="Leave blank if you didn't set one"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        disabled={disabled}
        style={style}
        className="pr-10 font-mono"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide passphrase" : "Show passphrase"}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Shown when the passphrase field isn't empty: Clear it, or confirm it on purpose. */
export function PassphraseConfirm({ warning, confirmed, onClear, onConfirm }: {
  warning: string;
  confirmed: boolean;
  onClear: () => void;
  onConfirm: () => void;
}) {
  return (
    <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p>{warning}</p>
      {confirmed ? (
        <p className="text-xs text-muted-foreground">You confirmed this passphrase.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onClear} className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">
            Clear it — I didn't set one
          </button>
          <button type="button" onClick={onConfirm} className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">
            Keep it — I set this passphrase
          </button>
        </div>
      )}
    </div>
  );
}
