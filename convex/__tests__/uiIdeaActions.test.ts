/**
 * The app's idea actions (app spec §8): cross-tenant refusal, and taste parity with chat —
 * "not for me" and "save" teach her taste from the app exactly as they do in chat.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await seedCreator(ctx, "a", { clerkUserId: "user_a" });
    const b = await seedCreator(ctx, "b", { clerkUserId: "user_b" });
    const idea = (creatorId: typeof a) => ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "fits", version: { hook: "the bus to the start line" }, messageText: "try this", status: "sent", newForYou: false, features: { format: "skit", topics: ["running"], tone: "deadpan", lengthBucket: "<15", sound: "original", source: "breakout" }, produced: { skillVersion: "t", model: "t", thresholdsVersion: "t" }, createdAt: Date.now(), sentAt: Date.now() } as never);
    return { a, b, ideaA: await idea(a), ideaB: await idea(b) };
  });
  return { t, ...ids };
}

describe("idea actions from the app", () => {
  it("refuses another creator's idea for both pass and save", async () => {
    const { t, ideaB } = await setup();
    const asA = t.withIdentity({ subject: "user_a" });
    expect(await asA.mutation(api.ui.passIdea, { id: ideaB })).toEqual({ ok: false });
    expect(await asA.mutation(api.ui.saveIdea, { id: ideaB, saved: true })).toEqual({ ok: false });
    const b = await t.run((ctx) => ctx.db.get(ideaB));
    expect(b?.status).toBe("sent");
    expect(b?.savedAt).toBeUndefined();
  });

  it("not for me passes the idea and records a notme taste event", async () => {
    const { t, a, ideaA } = await setup();
    await t.withIdentity({ subject: "user_a" }).mutation(api.ui.passIdea, { id: ideaA });
    await t.finishAllScheduledFunctions(() => {});
    const events = await t.run((ctx) => ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", a)).collect());
    expect(events.map((e) => e.kind)).toEqual(["notme"]);
    expect((await t.run((ctx) => ctx.db.get(ideaA)))?.status).toBe("passed");
  });

  it("save marks it saved once and records one save event; unsave clears it", async () => {
    const { t, a, ideaA } = await setup();
    const asA = t.withIdentity({ subject: "user_a" });
    await asA.mutation(api.ui.saveIdea, { id: ideaA, saved: true });
    await asA.mutation(api.ui.saveIdea, { id: ideaA, saved: true }); // idempotent
    await t.finishAllScheduledFunctions(() => {});
    const events = await t.run((ctx) => ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", a)).collect());
    expect(events.filter((e) => e.kind === "save")).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(ideaA)))?.savedAt).toBeTypeOf("number");
    await asA.mutation(api.ui.saveIdea, { id: ideaA, saved: false });
    expect((await t.run((ctx) => ctx.db.get(ideaA)))?.savedAt).toBeUndefined();
  });
});
