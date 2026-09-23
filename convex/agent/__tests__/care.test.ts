/**
 * B4: care, not content, when someone may not be okay. The B0 baseline failed this
 * ("close the app and take a break"). Mandatory categories: safety fail-closed (the resource
 * is guaranteed by code), cross-tenant (one creator's pause never touches another).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { hasResource, resourceLine } from "../care";
import { checkRails } from "../../scout/gate";

beforeEach(() => { vi.stubEnv("MODEL_FAKE", "1"); vi.stubEnv("OPENROUTER_API_KEY", "fake"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("the crisis line", () => {
  it("is local where we know it, and never missing", () => {
    expect(resourceLine("America/New_York")).toMatch(/988/);
    expect(resourceLine("Australia/Brisbane")).toMatch(/13 11 14/);
    expect(resourceLine("Asia/Tokyo")).toMatch(/local emergency number/);
    for (const tz of ["America/Chicago", "Europe/London", "Africa/Lagos"]) expect(hasResource(resourceLine(tz))).toBe(true);
  });
});

describe("care path", () => {
  it("distress gets a check-in with a crisis line, a 24h proactive pause, and nothing about content", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await t.run(async (ctx) => ({
      a: await seedCreator(ctx, "a", { clerkUserId: "user_a", timezone: "America/New_York", channel: { paired: true } }),
      b: await seedCreator(ctx, "b", { clerkUserId: "user_b", channel: { paired: true } }),
    }));
    const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId: a, surface: "telegram", body: "honestly i don't see the point anymore. of any of it." });
    const r = await t.action(internal.agent.converse.run, { creatorId: a, messageId });
    expect(r).toMatchObject({ ok: true, reason: "care" });
    const out = await t.run((ctx) => ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a)).collect());
    const care = out.find((m) => m.direction === "out" && m.kind === "care");
    expect(care?.body).toMatch(/988/); // the fake model omits it; code must have added it
    const [ca, cb] = await t.run(async (ctx) => [await ctx.db.get(a), await ctx.db.get(b)]);
    expect(ca?.careUntil).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(cb?.careUntil).toBeUndefined();
    const noon = Date.UTC(2026, 8, 23, 17); // midday in New York, outside quiet hours
    expect(checkRails({ creator: { ...ca!, careUntil: noon + 3_600_000 }, sentToday: 0, openQuestion: false, now: noon }).reason).toMatch(/care pause/);
  });

  it("frustration about content is not distress: it goes to the normal conversation", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a", channel: { paired: true } }));
    const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId: a, surface: "telegram", body: "i'm so over tiktok today, my post flopped" });
    const r = await t.action(internal.agent.converse.run, { creatorId: a, messageId });
    expect(r.reason).not.toBe("care");
    expect((await t.run((ctx) => ctx.db.get(a)))?.careUntil).toBeUndefined();
  });
});
