/**
 * Operator-only seams for `npx convex run`, used to exercise the pipeline on a dev
 * deployment without the web. Internal: not reachable from a client.
 *
 *   arch -arm64 npx convex run onboarding/dev:seed '{"tiktok":"leahruns","niche":"marathon training"}'
 *   arch -arm64 npx convex run onboarding/dev:status '{"creatorId":"..."}'
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

export const seed = internalMutation({
  args: { tiktok: v.optional(v.string()), instagram: v.optional(v.string()), niche: v.optional(v.string()), timezone: v.optional(v.string()), email: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ creatorId: string }> => {
    const now = Date.now();
    const creatorId = await ctx.db.insert("creators", {
      clerkUserId: `dev_${now}`,
      email: a.email ?? "dev@example.com",
      handles: { tiktok: a.tiktok, instagram: a.instagram },
      ownership: "unverified",
      niche: a.niche ?? "",
      timezone: a.timezone ?? "America/Los_Angeles",
      quietHours: { start: "22:00", end: "07:00" },
      tone: "friend",
      mode: "full",
      dossierVersion: 0,
      notes: [],
      affinities: [],
      experiments: [],
      channel: { paired: false },
      plan: { status: "comped", founding: true },
      createdAt: now,
    });
    await ctx.runMutation(internal.core.jobs.enqueue, {
      kind: "ingest_catalogue",
      idempotencyKey: `ingest:${creatorId}:v0`,
      creatorId,
      payloadJson: JSON.stringify({ reason: "dev seed" }),
    });
    return { creatorId };
  },
});

export const status = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a) => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ownPosts">[];
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"jobs">[];
    const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(10)) as Doc<"messages">[];
    const costs = await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", a.creatorId)).collect();
    return {
      mode: creator.mode,
      dossierVersion: creator.dossierVersion,
      dossierSummary: (creator.dossier as { persona?: { summary?: string } } | undefined)?.persona?.summary ?? null,
      posts: posts.length,
      transcripts: posts.filter((p) => p.transcript).length,
      baselineSample: posts.slice(0, 3).map((p) => ({ id: p.postId, views: p.metrics.views, multiple: p.multiple, sample: p.sample })),
      jobs: jobs.map((j) => ({ kind: j.kind, status: j.status, attempts: j.attempts, lastError: j.lastError })),
      messages: messages.map((m) => ({ dir: m.direction, kind: m.kind, body: m.body.slice(0, 160), delivered: m.deliveredAt ? true : m.deliveryError ?? "pending" })),
      spendUsd: costs.reduce((s, c) => s + c.costUsd, 0),
    };
  },
});

/** Pull a creator's queued jobs forward so a drain claims them now. */
export const retryNow = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ moved: number }> => {
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"jobs">[];
    let moved = 0;
    for (const j of jobs) {
      if (j.status === "queued" || j.status === "dead") {
        await ctx.db.patch(j._id, { status: "queued", runAfter: Date.now(), updatedAt: Date.now() });
        moved += 1;
      }
    }
    return { moved };
  },
});

/** Bind a Telegram chat to a dev creator without the web flow (the operator's own chat, for a live smoke). */
export const pairChat = internalMutation({
  args: { creatorId: v.id("creators"), chatId: v.string() },
  handler: async (ctx, a): Promise<{ paired: boolean }> => {
    await ctx.db.patch(a.creatorId, { telegramChatId: a.chatId, channel: { paired: true, pairedAt: Date.now() }, updatedAt: Date.now() });
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"jobs">[];
    for (const j of jobs) if (j.kind === "deliver_message" && j.status !== "succeeded") await ctx.db.patch(j._id, { status: "queued", runAfter: Date.now(), updatedAt: Date.now() });
    return { paired: true };
  },
});
