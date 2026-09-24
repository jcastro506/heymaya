/** §7 S3: she says "behind today" once when her own work died and nothing reached them; never at night; never twice. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

describe("creator status", () => {
  it("behind today: due once after a dead scout with no outbound, not at night, not twice", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true } }));
    const noon = Date.UTC(2026, 8, 2, 12, 0);
    await t.run((ctx) => ctx.db.insert("jobs", { creatorId, kind: "scout", idempotencyKey: "s1", status: "dead", attempts: 3, maxAttempts: 3, runAfter: noon, deadlineAt: noon, createdAt: noon - 3_600_000, updatedAt: noon - 3_600_000, lastError: "boom" }));
    expect(await t.query(internal.core.status.dueStatus, { now: Date.UTC(2026, 8, 2, 3, 0) })).toEqual([]); // 03:00: no
    const due = await t.query(internal.core.status.dueStatus, { now: noon });
    expect(due).toEqual([{ creatorId, kind: "behind", day: "2026-09-02" }]);
    await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "behind", dedupeKey: "status:behind:2026-09-02", proactive: false, kind: "status" });
    expect(await t.query(internal.core.status.dueStatus, { now: noon + 3_600_000 })).toEqual([]);
  });

  it("couldn't see TikTok: due when the vendor smoke failed within six hours", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true } }));
    const noon = Date.UTC(2026, 8, 2, 12, 0);
    await t.run((ctx) => ctx.db.insert("vendorHealth", { vendor: "scrapecreators", check: "credit-balance", ok: false, detail: "503", at: noon - 3_600_000 }));
    const due = await t.query(internal.core.status.dueStatus, { now: noon });
    expect(due.map((d) => d.kind)).toEqual(["cannot_see"]);
    expect(due[0].creatorId).toBe(creatorId);
  });
});
