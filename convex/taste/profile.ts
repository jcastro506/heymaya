/**
 * The taste profile (plan §13.10 (4)): the affinities and the last twenty events turned
 * into ≤ 600 characters of plain language she reads on every turn and they can read
 * and correct in Settings. Weekly, and once after the first three events. The previous
 * version is kept beside the new one, never silently overwritten.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { SOUL } from "../agent/soul";
import { summarize, TASTE, type Affinity } from "./affinities";

export const TASTE_PROFILE_SKILL = `taste-profile
When: weekly, or after their first few reactions. You are writing a private note to yourself about what THIS creator actually takes from you, as opposed to who they are (that's the dossier). Inputs: their affinities (feature, score, count; positive means they took it, negative means they passed) and the last twenty things they did with your ideas.
Write ≤ 600 characters, second person, plain, specific, no bullet points, no numbers you were not given. Cover: what they take, what they pass on, how they like to be talked to (from replies and corrections), and one thing you should try next that you haven't. If a count is 1, say "once", not "always". If there is a house rule about taste, it wins over any score. If there's not enough history, say so in one line and stop.
Output the note only.`;

export const dueForProfile = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Id<"creators">[]> => {
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    const week = 7 * 86_400_000;
    const due: Id<"creators">[] = [];
    for (const c of creators) {
      const events = (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(TASTE.profileMinEvents)) as Doc<"tasteEvents">[];
      if (events.length < TASTE.profileMinEvents) continue;
      const seen = c.taste?.eventsSeen ?? 0;
      const total = (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()).length;
      if (!c.taste || (a.now - c.taste.updatedAt >= week && total > seen)) due.push(c._id);
    }
    return due;
  },
});

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids = await ctx.runQuery(internal.taste.profile.dueForProfile, { now: Date.now() });
    for (const creatorId of ids) await ctx.scheduler.runAfter(0, internal.taste.profile.rewrite, { creatorId });
    return { scheduled: ids.length };
  },
});

export const inputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ creator: Doc<"creators">; events: Array<{ kind: string; weight: number; features: string[]; hook: string | null; daysAgo: number }>; total: number; rules: string[] } | null> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const rows = (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"tasteEvents">[];
    const total = (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()).length;
    const now = Date.now();
    const events = [];
    for (const e of rows) {
      const idea = e.ideaId ? ((await ctx.db.get(e.ideaId)) as Doc<"ideas"> | null) : null;
      events.push({ kind: e.kind, weight: e.weight, features: e.features, hook: (idea?.version as { hook?: string } | undefined)?.hook?.slice(0, 80) ?? null, daysAgo: Math.round((now - e.at) / 86_400_000) });
    }
    const directives = (await ctx.db.query("directives").withIndex("by_creator_and_active", (q) => q.eq("creatorId", a.creatorId).eq("active", true)).collect()) as Doc<"directives">[];
    return { creator, events, total, rules: directives.map((d) => d.verbatim) };
  },
});

export const rewrite = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const inp = await ctx.runQuery(internal.taste.profile.inputs, { creatorId: a.creatorId });
    if (!inp) return { ok: false, reason: "creator not found" };
    const now = Date.now();
    const { likes, dislikes } = summarize((inp.creator.affinities ?? []) as Affinity[], now, 8);
    const spec = REGISTRY.writer;
    const r = await callModel(ctx, {
      creatorId: a.creatorId,
      purpose: "taste_profile",
      model: spec.primary,
      messages: [
        { role: "system", content: `${SOUL}\n\n# Skill\n${TASTE_PROFILE_SKILL}` },
        { role: "user", content: `Their words about what they make: ${JSON.stringify(inp.creator.niche)}\nHouse rules: ${JSON.stringify(inp.rules)}\nThey took (feature, score, count): ${JSON.stringify(likes)}\nThey passed on: ${JSON.stringify(dislikes)}\nLast twenty things they did with your ideas (newest first): ${JSON.stringify(inp.events)}\nPrevious note: ${JSON.stringify(inp.creator.taste?.text ?? null)}` },
      ],
      temperature: 0.3,
      maxTokens: 400,
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    if (!r.ok || !r.content.trim()) return { ok: false, reason: r.ok ? "empty" : r.reason };
    await ctx.runMutation(internal.taste.profile.store, { creatorId: a.creatorId, text: r.content.trim().slice(0, 700), eventsSeen: inp.total });
    return { ok: true };
  },
});

export const store = internalMutation({
  args: { creatorId: v.id("creators"), text: v.string(), eventsSeen: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    await ctx.db.patch(a.creatorId, { taste: { text: a.text, version: (c.taste?.version ?? 0) + 1, updatedAt: Date.now(), previous: c.taste?.text, eventsSeen: a.eventsSeen }, updatedAt: Date.now() });
    return null;
  },
});
