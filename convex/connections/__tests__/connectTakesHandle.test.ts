/**
 * 2026-11-23: a second account connected a TikTok that an older account still held. The handle was skipped in
 * silence, her read died with "no handles to read" after she'd said "give me a few minutes", and nobody heard.
 * Categories: cross-tenant isolation (the old holder keeps nothing of the account) · fail-closed (a dead read
 * is said, once, in plain words) · adversarial input (sims stay silent) · sibling coherence (hello and the
 * dead-read text agree on what to do).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { READ_DEAD_TEXT, READ_NO_ACCOUNT_TEXT } from "../../core/jobs";
import { helloParts } from "../../onboarding/hello";
import { NEEDS_ACCOUNT_LINE } from "../../onboarding/conversation";
import type { Id } from "../../_generated/dataModel";

const acct = { accountId: "tt1", platform: "tiktok", username: "kev.makes", needsReconnect: false, canFetchAnalytics: true };

describe("connecting a TikTok takes its handle", () => {
  it("moves the handle from the account that held it, with that account's read of it, and starts the new read", async () => {
    const t = convexTest(schema, modules);
    const { old, fresh } = await t.run(async (ctx) => {
      const old = await seedCreator(ctx, "old", { clerkUserId: "user_old", handles: { tiktok: "kev.makes" }, ownership: "verified" } as never);
      await ctx.db.insert("connections", { creatorId: old, provider: "zernio", status: "connected", zernioProfileId: "p_old", updatedAt: 1, zernioAccounts: [{ ...acct }] } as never);
      const fresh = await seedCreator(ctx, "new", { clerkUserId: "user_new", handles: {} } as never);
      return { old, fresh };
    });
    await t.mutation(internal.connections.zernio.ensureProfileRow, { creatorId: fresh, zernioProfileId: "p_new" });
    await t.mutation(internal.connections.zernio.applyAccounts, { creatorId: fresh, accounts: [acct] });
    const s = await t.run(async (ctx) => ({
      fresh: await ctx.db.get(fresh), old: await ctx.db.get(old),
      oldConn: await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", old).eq("provider", "zernio")).first(),
      job: await ctx.db.query("jobs").collect(),
    }));
    expect(s.fresh?.handles.tiktok).toBe("kev.makes");
    expect(s.fresh?.ownership).toBe("verified");
    expect(s.old?.handles.tiktok).toBeUndefined();
    expect(s.old?.ownership).toBe("unverified");
    expect(s.oldConn?.zernioAccounts).toEqual([]);
    expect(s.oldConn?.status).toBe("attention");
    expect(s.job.some((j) => j.kind === "ingest_catalogue" && j.creatorId === fresh)).toBe(true);
  });

  it("an old holder with other accounts keeps those and stays connected", async () => {
    const t = convexTest(schema, modules);
    const { old, fresh } = await t.run(async (ctx) => {
      const old = await seedCreator(ctx, "old", { clerkUserId: "user_old", handles: { tiktok: "kev.makes" } } as never);
      await ctx.db.insert("connections", { creatorId: old, provider: "zernio", status: "connected", zernioProfileId: "p_old", updatedAt: 1, zernioAccounts: [{ ...acct }, { ...acct, accountId: "tt2", username: "other.one" }] } as never);
      return { old, fresh: await seedCreator(ctx, "new", { clerkUserId: "user_new", handles: {} } as never) };
    });
    await t.mutation(internal.connections.zernio.ensureProfileRow, { creatorId: fresh, zernioProfileId: "p_new" });
    await t.mutation(internal.connections.zernio.applyAccounts, { creatorId: fresh, accounts: [acct] });
    const conn = await t.run((ctx) => ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", old).eq("provider", "zernio")).first());
    expect(conn?.zernioAccounts?.map((x) => x.accountId)).toEqual(["tt2"]);
    expect(conn?.status).toBe("connected");
  });
});

describe("a read that dies is said, once, with what to do", () => {
  const die = async (t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, error: string) => {
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, { kind: "ingest_catalogue", idempotencyKey: `ingest:${creatorId}:${error}`, creatorId, maxAttempts: 1 });
    await t.run((ctx) => ctx.db.patch(jobId, { attempts: 1 }));
    return await t.mutation(internal.core.jobs.fail, { jobId, error });
  };
  const outs = (t: ReturnType<typeof convexTest>, creatorId: Id<"creators">) => t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.creatorId === creatorId && m.direction === "out").map((m) => m.body.toLowerCase())); // sending capitalizes sentences

  it("no TikTok: tells them to connect it; twice dead is still one text", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a", handles: {}, channel: { paired: true } } as never));
    expect((await die(t, c, "no handles to read")).status).toBe("dead");
    await die(t, c, "no handles to read ");
    expect(await outs(t, c)).toEqual([READ_NO_ACCOUNT_TEXT.toLowerCase()]);
  });

  it("our failure: says it's on her side", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "user_b", handles: { tiktok: "bee" }, channel: { paired: true } } as never));
    await die(t, c, "dossier synthesis failed: model_error");
    expect(await outs(t, c)).toEqual([READ_DEAD_TEXT.toLowerCase()]);
  });

  it("a sim hears nothing", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "s", { clerkUserId: "eval-run:fw-x:0", handles: {}, channel: { paired: true } } as never));
    await die(t, c, "no handles to read");
    expect(await outs(t, c)).toEqual([]);
  });
});

describe("her hello never promises a read she can't do", () => {
  it("without their TikTok she says what to do instead of 'going through your posts'", () => {
    const parts = helloParts("hey Kev! it's Maya 👋", false, false, false);
    expect(parts[1]).toBe(NEEDS_ACCOUNT_LINE);
    expect(parts.join(" ")).not.toMatch(/watching your posts now/);
    expect(helloParts("hey! it's Maya", false)[1]).toMatch(/watching your posts now/);
  });
});

