/**
 * Settings writes must not fail because optional chart history filled the
 * browser's storage. On a quota error, trim the largest balance-history
 * records (oldest samples first) and retry. Never touches wallet data.
 */
const HISTORY_MARK = "hme.desktop.balance-history.";

function isQuota(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
}

/** Halve the largest chart-history records, dropping their oldest samples. Returns bytes freed (approx). */
export function trimChartHistory(storage: Storage = localStorage): number {
  const keys: { key: string; size: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.includes(HISTORY_MARK)) keys.push({ key, size: storage.getItem(key)?.length ?? 0 });
  }
  keys.sort((a, b) => b.size - a.size);
  let freed = 0;
  for (const { key, size } of keys.slice(0, Math.max(1, Math.ceil(keys.length / 2)))) {
    try {
      const data: unknown = JSON.parse(storage.getItem(key) ?? "[]");
      if (!Array.isArray(data) || data.length < 2) { storage.removeItem(key); freed += size; continue; }
      const kept = JSON.stringify(data.slice(Math.floor(data.length / 2)));
      storage.setItem(key, kept);
      freed += size - kept.length;
    } catch { storage.removeItem(key); freed += size; }
  }
  return freed;
}

export class StorageFullError extends Error {
  constructor() { super("This browser's storage for Honest Money is full, so the change couldn't be saved."); }
}

export function safeSetItem(key: string, value: string, storage: Storage = localStorage): void {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { storage.setItem(key, value); return; }
    catch (e) {
      if (!isQuota(e)) throw e;
      if (trimChartHistory(storage) <= 0) break;
    }
  }
  throw new StorageFullError();
}
