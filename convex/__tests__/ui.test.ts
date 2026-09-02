/**
 * The thin UI reads are scoped by Clerk identity: a creator sees only their own rows,
 * an unknown identity sees nothing, and the write paths refuse rows they don't own.
 * (Mandatory category: cross-tenant isolation.)
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";

async function twoCreators() {
  const t = convexTest(schema, modules);
  const a = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a", handles: { tiktok: "alice" } }));
  const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "user_b", handles: { tiktok: "bob" } }));
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("messages", { creatorId: a, surface: "telegram", direction: "out", body: "alice's idea", ts: now, proactive: true, kind: "idea" });
    await ctx.db.insert("messages", { creatorId: b, surface: "telegram", direction: "out", body: "bob's idea", ts: now, proactive: true, kind: "idea" });
    await ctx.db.insert("directives", { creatorId: b, kind: "never", verbatim: "never mention my ex", active: true, source: "chat", createdAt: now });
  });
  return { t, a, b };
}

describe("thin UI scoping", () => {
  it("today shows only the signed-in creator's messages", async () => {
    const { t } = await twoCreators();
    const asA = t.withIdentity({ subject: "user_a" });
    const today = await asA.query(api.ui.today, {});
    expect(today?.sentToday.map((m) => m.body)).toEqual(["alice's idea"]);
  });

  it("an identity with no creator row sees null, not someone else's data", async () => {
    const { t } = await twoCreators();
    const stranger = t.withIdentity({ subject: "user_zzz" });
    expect(await stranger.query(api.ui.today, {})).toBeNull();
    expect(await stranger.query(api.ui.settings, {})).toBeNull();
    expect(await t.query(api.ui.ideas, {})).toBeNull(); // no identity at all
  });

  it("revoking a rule you don't own is refused and leaves it active", async () => {
    const { t, b } = await twoCreators();
    const rule = await t.run(async (ctx) => (await ctx.db.query("directives").withIndex("by_creator_and_active", (q) => q.eq("creatorId", b).eq("active", true)).first())!);
    const asA = t.withIdentity({ subject: "user_a" });
    expect(await asA.mutation(api.ui.revokeRule, { id: rule._id })).toEqual({ ok: false });
    const after = await t.run((ctx) => ctx.db.get(rule._id));
    expect(after?.active).toBe(true);
    const asB = t.withIdentity({ subject: "user_b" });
    expect(await asB.mutation(api.ui.revokeRule, { id: rule._id })).toEqual({ ok: true });
  });

  it("a settings correction lands as a verbatim, active directive", async () => {
    const { t, a } = await twoCreators();
    const asA = t.withIdentity({ subject: "user_a" });
    await asA.mutation(api.ui.correct, { text: "  I stopped doing gear reviews  " });
    const rows = await t.run((ctx) => ctx.db.query("directives").withIndex("by_creator_and_active", (q) => q.eq("creatorId", a).eq("active", true)).collect());
    expect(rows.map((r) => r.verbatim)).toEqual(["I stopped doing gear reviews"]);
    const s = await asA.query(api.ui.settings, {});
    expect(s?.rules.map((r) => r.text)).toEqual(["I stopped doing gear reviews"]);
  });
});
