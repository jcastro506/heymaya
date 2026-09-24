/**
 * S0 #1, #3: the hourly jobs find who is due from slim `schedule` rows, never by reading the
 * whole creators table (past Convex's 16 MiB read limit at ~1,000 creators), and never with
 * a silent `take(500)` ceiling.
 */
import { convexTest } from "convex-test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { modules } from "../../../tests/_modules";
import { creatorRow, seedCreator } from "../../../tests/lib/creatorRow";
import { scheduleFields, syncSchedule } from "../../lib/scheduleRow";
import { morningHourFor } from "../../agent/cadence";
import { PLAN_HOUR_LOCAL } from "../../calendar/weekPlan";

const CONVEX = join(__dirname, "../..");
function sources(dir = CONVEX): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "_generated" || name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("the schedule row follows its creator through every write path", () => {
  it("a real mutation's patch moves the row; a delete removes it; another creator's row is untouched (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { pairingToken: "tok-a", pairingExpiresAt: Date.now() + 3_600_000 }));
    const b = await t.run((ctx) => seedCreator(ctx, "b"));
    const bBefore = await t.query(internal.core.schedule.rowFor, { creatorId: b });
    expect((await t.query(internal.core.schedule.rowFor, { creatorId: a }))?.paired).toBe(false);

    const paired = await t.mutation(internal.core.pairing.claimPairing, { token: "tok-a", chatId: "chat-a" });
    expect(paired.paired, paired.reason).toBe(true);
    expect((await t.query(internal.core.schedule.rowFor, { creatorId: a }))?.paired, "pairing reached the row through the trigger").toBe(true);

    await t.mutation(internal.agent.manage.setQuietHours, { creatorId: a, start: "23:00", end: "09:00" });
    expect((await t.query(internal.core.schedule.rowFor, { creatorId: a }))?.quietHours).toEqual({ start: "23:00", end: "09:00" });

    await t.mutation(internal.account.deletion.purgeRows, { creatorId: a });
    expect(await t.query(internal.core.schedule.rowFor, { creatorId: a })).toBeNull();
    expect(await t.query(internal.core.schedule.rowFor, { creatorId: b }), "B never moved").toEqual(bBefore);
  });

  it("a patch that touches nothing selected does not rewrite the row", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const r = await t.run(async (ctx) => {
      await ctx.db.patch(a, { notes: [{ id: "n", text: "likes dogs", kind: "fact", at: 1 }] });
      return await syncSchedule(ctx.db, a);
    });
    expect(r).toBe("unchanged");
  });

  it("the nightly reconcile repairs a write that skipped the trigger and prunes an orphan", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const gone = await t.run((ctx) => seedCreator(ctx, "gone"));
    await t.run(async (ctx) => {
      await ctx.db.patch(a, { channel: { paired: true } }); // raw writer: no trigger
      await ctx.db.delete(gone); // raw writer: the row is left behind
    });
    expect((await t.query(internal.core.schedule.rowFor, { creatorId: a }))?.paired).toBe(false);
    expect(await t.action(internal.core.schedule.reconcile, {})).toEqual({ fixed: 1, pruned: 1 });
    expect((await t.query(internal.core.schedule.rowFor, { creatorId: a }))?.paired).toBe(true);
    expect(await t.query(internal.core.schedule.rowFor, { creatorId: gone })).toBeNull();
    expect(await t.action(internal.core.schedule.reconcile, {}), "a clean table reports nothing").toEqual({ fixed: 0, pruned: 0 });
  });

  it("a hostile dossier cannot break the projection (adversarial)", () => {
    const base = { _id: "c" as Id<"creators">, _creationTime: 0, ...creatorRow("x") } as never;
    const withDossier = (dossier: unknown) => scheduleFields({ ...(base as object), dossier } as never);
    expect(withDossier({ keywords: "not an array" }).keywords).toEqual([]);
    expect(withDossier({ keywords: [1, null, { a: 1 }, "  Marathon ", ""] }).keywords).toEqual(["marathon"]);
    expect(withDossier({ keywords: Array.from({ length: 500 }, (_, i) => `k${i}`) }).keywords).toHaveLength(20);
    expect(withDossier(undefined).hasDossier).toBe(false);
    expect(scheduleFields({ ...(base as object), clerkUserId: "user_evalyn" } as never).isEval, "a real user named eval-something is not an eval").toBe(false);
    expect(scheduleFields({ ...(base as object), clerkUserId: "eval-run:r:1" } as never).isEval).toBe(true);
  });
});

describe("at fleet scale", () => {
  it("2,000 creators across 24 timezones, each with a heavy document: the morning finds exactly who is at their morning hour", async () => {
    const t = convexTest(schema, modules);
    const zones = Array.from({ length: 24 }, (_, i) => `Etc/GMT${i - 12 >= 0 ? "+" : ""}${i - 12}`); // Etc/GMT-12 … Etc/GMT+11
    const heavy = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, text: "x".repeat(200), kind: "fact" as const, at: 1 }));
    const byZone = new Map<string, Id<"creators">[]>();
    await t.run(async (ctx) => {
      for (let i = 0; i < 2000; i++) {
        const tz = zones[i % 24];
        const id = await seedCreator(ctx, `c${i}`, { timezone: tz, channel: { paired: true }, plan: { status: "active", founding: false }, notes: heavy, dossier: { keywords: [`kw${i % 7}`] } });
        byZone.set(tz, [...(byZone.get(tz) ?? []), id]);
      }
    });
    const morning = morningHourFor({ start: "22:00", end: "07:00" });
    const now = Date.UTC(2026, 8, 24, 12, 0);
    const expected = zones.filter((tz) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now)) === morning).flatMap((tz) => byZone.get(tz)!);
    expect(expected.length, "the clock lands on at least one zone").toBeGreaterThan(0);

    const due = await t.query(internal.agent.cadence.dueNow, { now });
    expect(new Set(due.filter((d) => d.touch === "morning").map((d) => d.creatorId))).toEqual(new Set(expected));
    const keywords = await t.query(internal.scout.sweep.distinctKeywords, {});
    expect(keywords.map((k) => k.keyword).sort()).toEqual(["kw0", "kw1", "kw2", "kw3", "kw4", "kw5", "kw6"]);
    expect(keywords.reduce((n, k) => n + k.creatorIds.length, 0), "every creator, not the first 500").toBe(2000);
  }, 120_000);

  it("S0 #3: creator 501 gets a week plan (this read creators.take(500))", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 520; i++) await seedCreator(ctx, `w${i}`, { timezone: "UTC", channel: { paired: true }, dossier: {} });
    });
    const sunday = Date.UTC(2026, 8, 27, PLAN_HOUR_LOCAL, 0);
    expect(await t.query(internal.calendar.weekPlan.due, { now: sunday })).toHaveLength(520);
  }, 60_000);
});

describe("sibling coherence", () => {
  it("no fleet job reads the whole creators table", () => {
    // The two left are operator-only, on demand, never on a cron: /ops metrics and a dev helper.
    const allowed = new Set(["ops.ts", "onboarding/suggest.ts"]);
    const offenders = sources().filter((p) => /query\("creators"\)\s*\.(collect|take)\(/.test(readFileSync(p, "utf8"))).map((p) => relative(CONVEX, p)).filter((p) => !allowed.has(p));
    expect(offenders).toEqual([]);
  });

  it("every mutation goes through the trigger-wrapped builders", () => {
    const raw = sources().filter((p) => !p.endsWith(join("lib", "functions.ts"))).filter((p) => /import\s*\{[^}]*\b(internalMutation|mutation)\b[^}]*\}\s*from\s*"[./]*_generated\/server"/.test(readFileSync(p, "utf8")));
    expect(raw.map((p) => relative(CONVEX, p))).toEqual([]);
  });

  it("the projection writes exactly the schedule table's fields", () => {
    const declared = Object.keys((schema.tables.schedule.validator as unknown as { fields: Record<string, unknown> }).fields).sort();
    const projected = Object.keys(scheduleFields({ _id: "c" as Id<"creators">, _creationTime: 0, ...creatorRow("x") } as never)).sort();
    expect(projected).toEqual(declared);
  });
});
