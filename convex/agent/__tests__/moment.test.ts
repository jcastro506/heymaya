/** Sprint 3d: the moment idea row, edits that touch only their field, block-now sizing, tenant scope. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const produced = { skillVersion: "t", model: "t", thresholdsVersion: "t" };

describe("moment", () => {
  it("writes the recommended angle as an idea from the moment, then edits only the named field", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const messageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "at a ramen place in the rain", ts: Date.now(), kind: "inbound" }));
    const ideaId = await t.mutation(internal.agent.moment.writeMomentIdea, { creatorId, messageId, idea: { hook: "the bowl you earn at mile 20", shots: ["steam over the bowl", "you, soaked, grinning"], lengthSec: 18, onScreenText: "post-long-run ritual" }, messageText: "two angles…", features: { format: "pov", topics: ["ramen", "long run"], tone: "warm", lengthBucket: "15-30", sound: "original" }, produced });
    const idea = await t.run((ctx) => ctx.db.get(ideaId));
    expect(idea?.features?.source).toBe("moment");
    expect((idea?.version as { shotList: string[] }).shotList).toHaveLength(2);
    expect((await t.query(internal.agent.moment.latestIdea, { creatorId }))?.id).toBe(ideaId);
    await t.mutation(internal.agent.moment.editIdea, { creatorId, ideaId, field: "lengthSec", value: "make it 15 seconds" });
    await t.mutation(internal.agent.moment.editIdea, { creatorId, ideaId, field: "hook", value: "nobody trains for the ramen part" });
    const after = (await t.run((ctx) => ctx.db.get(ideaId)))?.version as { hook: string; lengthSec: number; shotList: string[]; onScreenText: string };
    expect(after.lengthSec).toBe(15);
    expect(after.hook).toBe("nobody trains for the ramen part");
    expect(after.shotList).toHaveLength(2);
    expect(after.onScreenText).toBe("post-long-run ritual");
    await t.mutation(internal.agent.moment.editIdea, { creatorId, ideaId, field: "lengthSec", value: "9999" });
    expect(((await t.run((ctx) => ctx.db.get(ideaId)))?.version as { lengthSec: number }).lengthSec).toBe(180); // clamped
  });

  it("block-now proposes a block fifteen minutes out, sized to the idea, and never on another creator's idea", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    const messageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId: a, direction: "in", surface: "telegram", body: "x", ts: Date.now(), kind: "inbound" }));
    const ideaId = await t.mutation(internal.agent.moment.writeMomentIdea, { creatorId: a, messageId, idea: { hook: "h", shots: ["s"], lengthSec: 30, onScreenText: "" }, messageText: "m", produced });
    expect(await t.mutation(internal.agent.moment.blockNow, { creatorId: b, ideaId })).toBeNull();
    expect((await t.mutation(internal.agent.moment.editIdea, { creatorId: b, ideaId, field: "hook", value: "stolen" })).ok).toBe(false);
    const blk = await t.mutation(internal.agent.moment.blockNow, { creatorId: a, ideaId });
    expect(blk).not.toBeNull();
    const row = await t.run((ctx) => ctx.db.get(blk!.blockId));
    expect(row?.status).toBe("proposed");
    expect(row!.start - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(row!.end - row!.start).toBe(60 * 60_000); // 30 s idea → 60 min block
  });
});
