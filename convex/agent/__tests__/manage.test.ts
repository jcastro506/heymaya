/** §1 chat is complete: the sentence writes the same row as the control; the rule is shared; destructive asks confirm first. */
import { readsAsInstruction } from "../manage";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

describe("manage", () => {
  it("quiet hours: validates, applies, and reads back in plain words", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    expect((await t.mutation(internal.agent.manage.setQuietHours, { creatorId, start: "9pm", end: "09:00" })).ok).toBe(false);
    const r = await t.mutation(internal.agent.manage.setQuietHours, { creatorId, start: "22:00", end: "09:00" });
    expect(r.body).toMatch(/10pm and 9am/);
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.quietHours).toEqual({ start: "22:00", end: "09:00" });
  });

  it("tone and niche land on the row", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    await t.mutation(internal.agent.manage.setTone, { creatorId, tone: "blunt" });
    await t.mutation(internal.agent.manage.setNiche, { creatorId, text: "gear reviews for late starters" });
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.tone).toBe("blunt");
    expect(c?.niche).toBe("gear reviews for late starters");
  });

  it("adding from chat and from the web share one rule: lowercase, revive a removed one, ten at most", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a" }));
    expect((await t.mutation(internal.agent.manage.addAdmired, { creatorId, platform: "tiktok", handle: "@RunWithCarly" })).ok).toBe(true);
    expect((await t.withIdentity({ subject: "user_a" }).mutation(api.onboarding.admired.add, { platform: "tiktok", handle: "runwithcarly" })).ok).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("trackedAccounts").collect())).toHaveLength(1); // same account, once
    for (let i = 0; i < 9; i++) await t.mutation(internal.agent.manage.addAdmired, { creatorId, platform: "tiktok", handle: `acct${i}` });
    const eleventh = await t.mutation(internal.agent.manage.addAdmired, { creatorId, platform: "tiktok", handle: "onemore" });
    expect(eleventh.ok).toBe(false);
    expect(eleventh.body).toMatch(/ten/);
    expect((await t.mutation(internal.agent.manage.addAdmired, { creatorId, platform: "tiktok", handle: "not a handle!" })).ok).toBe(false);
  });

  it("stop watching confirms with the same buttons as the three-passes question", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    await t.mutation(internal.agent.manage.addAdmired, { creatorId, platform: "tiktok", handle: "fastguy" });
    const r = await t.mutation(internal.agent.manage.stopWatchingButtons, { creatorId, handle: "@fastguy" });
    expect(r.ok).toBe(true);
    expect(r.buttons?.map((b) => b.id.split(":").pop())).toEqual(["stop", "keep"]);
    const miss = await t.mutation(internal.agent.manage.stopWatchingButtons, { creatorId, handle: "nobody" });
    expect(miss.ok).toBe(false);
    expect(miss.body).toContain("@fastguy");
  });
});

describe("a rule is never what they make (live 2026-09-09)", () => {
  it("refuses to set the niche from an instruction, so the turn falls through and the rule is kept as a rule", () => {
    expect(readsAsInstruction("i hate talking-head videos, never suggest those")).toBe(true);
    expect(readsAsInstruction("never suggest dance trends")).toBe(true);
    expect(readsAsInstruction("don't text me before 10")).toBe(true);
    expect(readsAsInstruction("going all in on solo travel, hostels, the whv life")).toBe(false);
    expect(readsAsInstruction("i do gear reviews now")).toBe(false);
  });
});
