/**
 * Taste events (plan §13.10 (1)): the write path every hook calls. One row per signal,
 * the idea's status updated where the event implies one, and the creator's affinities
 * folded forward in the same transaction. A model never calls this; code does, at the
 * moment the creator acts.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { applyEvent, featureKeys, TASTE, WEIGHTS, type Affinity } from "./affinities";
import { creatorForIdentity } from "../core/identity";
import { THRESHOLDS } from "../config/thresholds";

const STATUS_FOR: Record<string, Doc<"ideas">["status"] | undefined> = { posted: "posted", heart: "hearted", notme: "passed", thumbs_down: "passed", ignored: "expired" };

export const record = internalMutation({
  args: {
    creatorId: v.id("creators"),
    kind: v.string(),
    ideaId: v.optional(v.id("ideas")),
    messageId: v.optional(v.id("messages")),
    weight: v.optional(v.number()), // override, e.g. posted × performance
    extraKeys: v.optional(v.array(v.string())), // features known only to the caller (a block's hour, an account)
    reaction: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; eventId?: Id<"tasteEvents"> }> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return { ok: false, reason: "creator not found" };
    let idea: Doc<"ideas"> | null = null;
    if (a.ideaId) {
      idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
      if (!idea || idea.creatorId !== a.creatorId) return { ok: false, reason: "idea is not theirs" }; // cross-tenant guard
    }
    const baseWeight = a.weight ?? WEIGHTS[a.kind];
    if (baseWeight === undefined) return { ok: false, reason: `unknown taste event kind ${a.kind}` };
    // An explore idea (§13.10 (6)): ignoring it costs nothing, taking it counts double.
    const weight = idea?.newForYou ? (baseWeight < 0 ? (a.kind === "ignored" ? 0 : baseWeight) : baseWeight * 2) : baseWeight;
    const keys = Array.from(new Set([...featureKeys(idea?.features), ...(a.extraKeys ?? [])]));
    const now = Date.now();
    const eventId = await ctx.db.insert("tasteEvents", { creatorId: a.creatorId, ideaId: a.ideaId, messageId: a.messageId, kind: a.kind, weight, features: keys, at: now });
    if (keys.length && weight !== 0) {
      const affinities = applyEvent((creator.affinities ?? []) as Affinity[], keys, weight, now);
      await ctx.db.patch(a.creatorId, { affinities, updatedAt: now });
    }
    if (idea) {
      const status = STATUS_FOR[a.kind];
      const patch: Partial<Doc<"ideas">> = {};
      // A stronger fact never regresses: posted stays posted.
      if (status && idea.status !== "posted" && !(status === "expired" && idea.status !== "sent")) patch.status = status;
      if (a.kind === "posted") patch.postedAt = idea.postedAt ?? now;
      if (a.reaction) patch.reaction = a.reaction;
      if (Object.keys(patch).length) await ctx.db.patch(idea._id, patch);
    }
    return { ok: true, eventId };
  },
});

/** The last N events, for the profile writer and Settings. */
export const recent = internalQuery({
  args: { creatorId: v.id("creators"), limit: v.optional(v.number()) },
  handler: async (ctx, a): Promise<Doc<"tasteEvents">[]> =>
    (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(a.limit ?? 20)) as Doc<"tasteEvents">[],
});

/** Ideas sent more than 72 h ago with no sign of life expire, and the silence is an event (§13.10 `ignored`). */
export const expireIgnored = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ expired: number }> => {
    const now = a.now ?? Date.now();
    const cutoff = now - TASTE.ignoreAfterHours * 3_600_000;
    const stale = (await ctx.db.query("ideas").filter((q) => q.and(q.eq(q.field("status"), "sent"), q.lt(q.field("createdAt"), cutoff))).take(200)) as Doc<"ideas">[];
    let expired = 0;
    for (const idea of stale) {
      if (!idea.sentAt || idea.sentAt > cutoff) continue;
      // Anything they did on it (a tap, a reply) already wrote an event; silence is only silence if nothing did.
      const touched = (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", idea.creatorId)).order("desc").take(100)) as Doc<"tasteEvents">[];
      if (touched.some((e) => e.ideaId === idea._id)) {
        await ctx.db.patch(idea._id, { status: "expired" });
        continue;
      }
      const creator = (await ctx.db.get(idea.creatorId)) as Doc<"creators"> | null;
      if (!creator) continue;
      const keys = featureKeys(idea.features);
      const weight = idea.newForYou ? 0 : WEIGHTS.ignored;
      await ctx.db.insert("tasteEvents", { creatorId: idea.creatorId, ideaId: idea._id, kind: "ignored", weight, features: keys, at: now });
      if (keys.length && weight !== 0) await ctx.db.patch(creator._id, { affinities: applyEvent((creator.affinities ?? []) as Affinity[], keys, weight, now), updatedAt: now });
      await ctx.db.patch(idea._id, { status: "expired" });
      expired++;
    }
    // Unanswered questions older than the threshold close too; silence is an answer, and an open row must not mute the scout.
    const qCutoff = now - THRESHOLDS.openQuestionHours * 3_600_000;
    const creators = (await ctx.db.query("creators").take(500)) as Doc<"creators">[];
    for (const c of creators) {
      const open = (await ctx.db.query("messages").withIndex("by_creator_and_awaiting", (q) => q.eq("creatorId", c._id).eq("awaitingAnswer", true)).take(10)) as Doc<"messages">[];
      for (const m of open) if (m.ts < qCutoff) await ctx.db.patch(m._id, { awaitingAnswer: false });
    }
    return { expired };
  },
});

/** Their own "posted it" from the Ideas tab: the strongest signal, self-reported. */
export const markPosted = mutation({
  args: { ideaId: v.id("ideas") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await creatorForIdentity(ctx);
    const idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
    if (!c || !idea || idea.creatorId !== c._id) return { ok: false };
    if (idea.status === "posted") return { ok: true };
    const now = Date.now();
    const keys = featureKeys(idea.features);
    const weight = idea.newForYou ? WEIGHTS.posted * 2 : WEIGHTS.posted;
    await ctx.db.insert("tasteEvents", { creatorId: c._id, ideaId: idea._id, kind: "posted", weight, features: keys, at: now });
    if (keys.length) await ctx.db.patch(c._id, { affinities: applyEvent((c.affinities ?? []) as Affinity[], keys, weight, now), updatedAt: now });
    await ctx.db.patch(idea._id, { status: "posted", postedAt: now, matchConfidence: "certain" });
    return { ok: true };
  },
});
