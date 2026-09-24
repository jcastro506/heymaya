/** L1 living simulation: the pure parts (time shifting, the script, determinism) and the isolation guard. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { lifeScript, rng, shiftTimes } from "../livingSim";

const NOW = Date.UTC(2026, 8, 24);
describe("ageing the world", () => {
  it("shifts timestamps, deep; leaves ids, durations, strings and _fields alone", () => {
    const x = { ts: NOW - 5_000, n: 42, dur: 91_000, id: "7679774266925124384", _creationTime: NOW, nested: { at: NOW, list: [NOW - 1, 3] } };
    expect(shiftTimes(x, -86_400_000, NOW)).toEqual({ ts: NOW - 5_000 - 86_400_000, n: 42, dur: 91_000, id: "7679774266925124384", _creationTime: NOW, nested: { at: NOW - 86_400_000, list: [NOW - 1 - 86_400_000, 3] } });
  });
  it("the script scales with the run and ends with the probes; a run is repeatable", () => {
    const s = lifeScript(42);
    expect(s.filter((e) => e.kind === "probe").map((e) => e.day)).toEqual([40, 41, 42]);
    expect(s.every((e) => e.day >= 1 && e.day <= 42)).toBe(true);
    const a = rng(7), b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("refuses to age or release for anyone but a sim clone", async () => {
    const t = convexTest(schema, modules);
    const real = await t.run((ctx) => seedCreator(ctx, "real"));
    await expect(t.mutation(internal.eval.livingSim.ageTable, { creatorId: real, table: "messages", delta: -1 })).rejects.toThrow("living-sim");
    await expect(t.mutation(internal.eval.livingSim.releasePost, { creatorId: real, doc: { createTime: NOW }, createTime: NOW })).rejects.toThrow("living-sim");
  });
});
