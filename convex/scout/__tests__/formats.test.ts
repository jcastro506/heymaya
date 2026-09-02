/** §13.12: a transferable format outside the lane becomes a worth_seeing signal with a fingerprint; the same shape twice a week does not; the gate lets one a day through and none without the mark. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { fingerprint, parseLabels } from "../formats";

describe("format watch", () => {
  it("keeps only transferable rows the screener named, for posts it was shown", () => {
    const known = new Set(["a", "b", "c"]);
    const out = parseLabels(`[{"postId":"a","transferable":true,"format":"a list where every point cuts to an object","angle":"things nobody tells you","humor":"deadpan","why":"each cut re-hooks","onAnotherSubject":"a runner's shoe rack"},{"postId":"b","transferable":false,"format":"dance"},{"postId":"zzz","transferable":true,"format":"invented post"},{"postId":"c","transferable":true,"format":"x"}]`, known);
    expect(out.map((l) => l.postId)).toEqual(["a"]);
    expect(fingerprint(out[0].format)).toBe("list-where-every-point-cuts-object");
  });

  it("writes one worth_seeing per creator per format, never the same shape twice in a week, and the gate honours the mark and the one-a-day cap", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true }, dossier: { persona: {} } }));
    const now = Date.now();
    const label = (postId: string, format: string) => ({ postId, url: `https://www.tiktok.com/@comic/video/${postId}`, authorHandle: "comic", views: 900_000, format, angle: "x", humor: "", why: "y", onAnotherSubject: "z" });
    const first = await t.mutation(internal.scout.formats.writeWorthSeeing, { creatorIds: [a], labels: [label("1", "interruption bit where a stranger derails the take"), label("2", "list where every point cuts to an object")], now });
    expect(first.written).toBe(2);
    const again = await t.mutation(internal.scout.formats.writeWorthSeeing, { creatorIds: [a], labels: [label("3", "Interruption bit where a stranger derails the take!")], now: now + 3600_000 });
    expect(again.written).toBe(0);
    // an unmarked worth_seeing (no fingerprint) must never reach the scout
    await t.run((ctx) => ctx.db.insert("signals", { creatorId: a, kind: "worth_seeing", sourcePostIds: ["9"], score: 3, corroboration: { accounts: 0, soundRising: false }, verdict: "pending", why: "no mark", thresholdsVersion: "t", createdAt: now }));
    const g = await t.query(internal.scout.gate.railsFor, { creatorId: a, now: now + 13 * 3600_000 });
    const ws = g!.candidates.filter((s) => s.kind === "worth_seeing");
    expect(ws).toHaveLength(1); // one a day, and only marked ones
    expect(ws[0].formatFingerprint).toBeTruthy();
    expect(g!.tasteDropped.some((d) => d.why.includes("no transferable format"))).toBe(true);
  });
});
