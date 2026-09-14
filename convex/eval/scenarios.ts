/**
 * Scenario creators for the eval suites (plan §17, Sprint 3c), as their own rows.
 *
 * ⚠️ The first scout scenario shared a handle with the live pilot, and every gate run
 * reopened the pilot's real signals (2026-09-06). A scenario creator is never a customer:
 * its own clerk subject, never paired, `plan.status: "paused"` so no cron ever messages
 * it, and the dry runs pass `ignoreRails` on purpose. Seeding runs the same onboarding
 * path a customer takes, so the dossier and the clusters are the real ones.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { startCreator } from "../onboarding/start";
import { addTracked } from "../agent/manage";

export const SCENARIOS: ReadonlyArray<{ handle: string; platform: "tiktok"; admired: string[]; niche: string }> = [
  { handle: "vanessaalopezz", platform: "tiktok", admired: ["andi.renay", "becca_foggia", "nadyaokamoto"], niche: "" },
  { handle: "brettconti", platform: "tiktok", admired: ["drewbinsky", "starterstory", "aliabdaal"], niche: "" },
];

export const subjectFor = (handle: string) => `eval:${handle}`;
const isolatedSubjectFor = (runId: string, sourceId: Id<"creators">) => `eval-run:${runId}:${sourceId}`;

/**
 * Give every durable run fresh creator state. This keeps old eval messages, management
 * commands, and scheduled plans from leaking into a later score while preserving the
 * source creator's dossier, taste, and post evidence.
 */
export const cloneForRun = internalMutation({
  args: { sourceId: v.id("creators"), runId: v.string() },
  handler: async (ctx, a): Promise<Id<"creators">> => {
    const clerkUserId = isolatedSubjectFor(a.runId, a.sourceId);
    const existing = await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId)).first();
    if (existing) return existing._id;
    const source = await ctx.db.get(a.sourceId);
    if (!source) throw new Error(`scenario source ${a.sourceId} is missing`);
    const { _id: _sourceId, _creationTime, ...copy } = source;
    void _sourceId; void _creationTime;
    const creatorId = await ctx.db.insert("creators", {
      ...copy,
      clerkUserId,
      email: `${clerkUserId.replace(/[^a-z0-9-]/gi, "-")}@eval.invalid`,
      phone: undefined,
      phoneVerifiedAt: undefined,
      telegramChatId: undefined,
      pairingToken: undefined,
      pairingExpiresAt: undefined,
      channel: { paired: false },
      plan: { founding: false, status: "paused", tier: source.plan.tier },
      openQuestionId: undefined,
      notes: source.notes.map(({ sourceMessageId: _messageId, ...note }) => { void _messageId; return note; }),
      firstWeek: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const tracked = await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.sourceId)).collect();
    for (const row of tracked) {
      const { _id, _creationTime: _created, creatorId: _oldCreator, ...fields } = row;
      void _id; void _created; void _oldCreator;
      await ctx.db.insert("trackedAccounts", { ...fields, creatorId });
    }
    const posts = await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.sourceId)).order("desc").take(100);
    const postIds = new Map<string, Id<"ownPosts">>();
    for (const row of [...posts].reverse()) {
      const { _id, _creationTime: _created, creatorId: _oldCreator, crossPostOf: _crossPost, ...fields } = row;
      void _created; void _oldCreator; void _crossPost;
      postIds.set(String(_id), await ctx.db.insert("ownPosts", { ...fields, creatorId }));
    }
    const reads = await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", a.sourceId)).collect();
    for (const row of reads) {
      const ownPostId = postIds.get(String(row.ownPostId));
      if (!ownPostId) continue;
      const { _id, _creationTime: _created, creatorId: _oldCreator, ownPostId: _oldPost, ...fields } = row;
      void _id; void _created; void _oldCreator; void _oldPost;
      await ctx.db.insert("ownPostReads", { ...fields, creatorId, ownPostId });
    }
    return creatorId;
  },
});

export const seedOne = internalMutation({
  args: { handle: v.string(), admired: v.array(v.string()), niche: v.string() },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; created: boolean }> => {
    const existing = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", subjectFor(a.handle))).first()) as Doc<"creators"> | null;
    if (existing) return { creatorId: existing._id, created: false };
    const r = await startCreator(ctx, { subject: subjectFor(a.handle), email: `${subjectFor(a.handle)}@eval.invalid`, handles: { tiktok: a.handle }, timezone: "America/New_York" });
    if (!r.ok || !r.creatorId) throw new Error(`could not seed scenario ${a.handle}: ${r.error}`);
    const creatorId = r.creatorId as Id<"creators">;
    const c = (await ctx.db.get(creatorId)) as Doc<"creators">;
    // Paused: the scout gate, the plan, the review and the first-week steps all skip it. Never paired.
    await ctx.db.patch(creatorId, { plan: { ...c.plan, status: "paused" }, niche: a.niche, updatedAt: Date.now() });
    for (const h of a.admired) {
      const rows = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).collect()) as Doc<"trackedAccounts">[];
      await addTracked(ctx as never, creatorId, "tiktok", h, rows);
    }
    return { creatorId, created: true };
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ handle: string; creatorId: Id<"creators">; dossier: boolean; paused: boolean; paired: boolean }>> => {
    const out: Array<{ handle: string; creatorId: Id<"creators">; dossier: boolean; paused: boolean; paired: boolean }> = [];
    for (const s of SCENARIOS) {
      const c = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", subjectFor(s.handle))).first()) as Doc<"creators"> | null;
      if (c) out.push({ handle: s.handle, creatorId: c._id, dossier: Boolean(c.dossier), paused: c.plan.status === "paused", paired: Boolean(c.channel.paired) });
    }
    return out;
  },
});

/** Seed whatever is missing and run their onboarding read inline, so the suite has dossiers to judge against. */
export const ensure = internalAction({
  args: {},
  handler: async (ctx): Promise<Array<{ handle: string; creatorId: Id<"creators">; created: boolean; dossier: boolean }>> => {
    const out: Array<{ handle: string; creatorId: Id<"creators">; created: boolean; dossier: boolean }> = [];
    for (const s of SCENARIOS) {
      const r = await ctx.runMutation(internal.eval.scenarios.seedOne, { handle: s.handle, admired: s.admired, niche: s.niche });
      const before = (await ctx.runQuery(internal.eval.scenarios.list, {})).find((x) => x.creatorId === r.creatorId);
      if (!before?.dossier) await ctx.runAction(internal.onboarding.ingest.run, { creatorId: r.creatorId });
      const after = (await ctx.runQuery(internal.eval.scenarios.list, {})).find((x) => x.creatorId === r.creatorId);
      out.push({ handle: s.handle, creatorId: r.creatorId, created: r.created, dossier: Boolean(after?.dossier) });
    }
    return out;
  },
});
