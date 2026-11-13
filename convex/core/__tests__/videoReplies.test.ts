/** "just say lol cool" is a row (2026-11-12): the setting is theirs only, and her context says it. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

describe("video replies", () => {
  it("react sets it for them only; full clears it", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    expect((await t.mutation(internal.core.routines.setVideoReplies, { creatorId: a, mode: "react" })).ok).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(a)))?.videoReplies).toBe("react");
    expect((await t.run((ctx) => ctx.db.get(b)))?.videoReplies).toBeUndefined();
    await t.mutation(internal.core.routines.setVideoReplies, { creatorId: a, mode: "full" });
    expect((await t.run((ctx) => ctx.db.get(a)))?.videoReplies).toBeUndefined();
  });
});
