import { describe, expect, it } from "vitest";
import { anyActivity, detectSeedsPockets, type Probe } from "./pocket-found";

const yes: Probe = async () => true;
const no: Probe = async () => false;
const fail: Probe = async () => { throw new Error("indexer down"); };

describe("desktop finds a Seeds pocket linked on another device", () => {
  it("any activity on the pocket counts", async () => {
    expect(await anyActivity([no, fail, yes])).toBe(true);
  });
  it("an empty pocket is not found; all lookups failing is 'unknown', never 'found'", async () => {
    expect(await anyActivity([no, no])).toBe(false);
    expect(await anyActivity([fail, fail])).toBeNull();
  });
  it("checks only the branch honest.money reserves for Seeds (1106)", async () => {
    const asked: number[] = [];
    const found = await detectSeedsPockets({
      registryBranches: [1106],
      probesFor: (a) => { asked.push(a); return [yes]; },
    });
    expect(found).toEqual([1106]);
    expect(asked).toEqual([1106]);
  });
  it("an unverified honest.money list checks nothing", async () => {
    let calls = 0;
    expect(await detectSeedsPockets({ registryBranches: null, probesFor: () => { calls++; return [yes]; } })).toEqual([]);
    expect(calls).toBe(0);
  });
  it("never checks the main wallet (0) or the reserved non-trading branch 1107", async () => {
    const asked: number[] = [];
    await detectSeedsPockets({ registryBranches: [0, 1107, 1106], probesFor: (a) => { asked.push(a); return [no]; } });
    expect(asked).toEqual([1106]);
  });
});
