/** A queue advances only after a verified broadcast, never after QR preparation. */
export interface GatherQueue {
  indexes: number[];
  cursor: number;
  active: boolean;
  sent: { index: number; txid: string }[];
}

export function createGatherQueue(indexes: number[]): GatherQueue {
  if (!indexes.length || new Set(indexes).size !== indexes.length || indexes.some(i => !Number.isSafeInteger(i) || i < 1 || i > 999)) throw new Error("Invalid consolidation address list.");
  return { indexes: [...indexes], cursor: 0, active: true, sent: [] };
}

export function advanceGatherQueue(queue: GatherQueue, index: number, txid: string): GatherQueue {
  if (!queue.active || queue.indexes[queue.cursor] !== index || !/^[a-f0-9]{64}$/i.test(txid)) throw new Error("Consolidation step does not match the queue.");
  const cursor = queue.cursor + 1;
  return { ...queue, cursor, active: cursor < queue.indexes.length, sent: [...queue.sent, { index, txid }] };
}

export function stopGatherQueue(queue: GatherQueue): GatherQueue {
  return { ...queue, active: false };
}

export function unspentGatherInputs<T extends { txid: string; vout: number }>(inputs: T[], spent: ReadonlySet<string>): T[] {
  return inputs.filter(i => !spent.has(`${i.txid}:${i.vout}`));
}