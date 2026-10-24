import { describe, it, expect } from "vitest";
import { appendBalancePoint, balanceHistoryKey } from "./history";
describe("desktop balance history", () => {
  it("isolates two wallet profiles without changing envelope keys", () => { expect(balanceHistoryKey("default")).toBe("hme.desktop.balance-history.v1"); expect(balanceHistoryKey("second")).toBe("p:second:hme.desktop.balance-history.v1"); });
  it("never records incomplete outage values as losses", () => { const saved = [{at: 1, usd: 100, coverage: "btc"}]; expect(appendBalancePoint(saved, {at: 600001, usd: 0, coverage: "btc"}, false)).toEqual(saved); });
  it("does not compare different asset coverage as performance", () => { expect(appendBalancePoint([{at: 1, usd: 100, coverage: "btc"}], {at: 600001, usd: 50, coverage: "btc,eth"}, true)).toEqual([{at:600001, usd:50, coverage:"btc,eth"}]); });
});
