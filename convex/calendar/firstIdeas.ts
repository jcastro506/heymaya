/**
 * Day one has no ideas to plan with (plan 4f addendum, live 2026-09-06: "nothing to plan
 * with: no ideas and no experiment"). Before the scout has found anything, the first plan
 * is seeded from what she has already read: their own posts that worked, the lane she
 * proposed, and the growth plan. The model writes the hooks; code grounds, caps and stores
 * them as idea rows so the planner, the taps and the outcomes treat them like any other.
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { buildPrefix } from "../agent/context";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";

export const FIRST_IDEAS_SKILL = `first-plan-ideas
When: once, right after first contact, so the first plan has posts in it.
The judgment: from THEIR OWN posts (the dossier's works claims, the recent posts with their multiples, the lane you proposed and the growth plan if there is one), write the next few posts they should make. Each one is a specific, filmable idea in their voice: a hook line a person would say, and one clause on why, citing the post of theirs it rhymes with. Lead with the lane you recommended; at most one idea may sit outside it. No trend talk, no "viral", no generic advice. If their history is thin, say so in the why and keep the ideas close to what already worked.
Output ONLY JSON, lowercase the way you text: {"ideas":[{"hook":"≤90 chars, the line", "why":"≤140 chars, one clause, cites their post", "evidencePostIds":["their post id"]}]}`;

const lower = (t: string) => (t ? t[0].toLowerCase() + t.slice(1) : t);

export interface SeededIdea { hook: string; why: string; evidencePostIds: string[] }

/** Pure. The model's JSON, validated and capped; anything malformed is dropped, never invented. */
export function parseFirstIdeas(content: string, n: number): SeededIdea[] {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]) as { ideas?: Array<{ hook?: unknown; why?: unknown; evidencePostIds?: unknown }> };
    return (j.ideas ?? [])
      // Her voice is lowercase; the model capitalises JSON strings. The first letter is hers.
      .map((i) => ({ hook: lower(String(i.hook ?? "").trim().slice(0, 90)), why: lower(String(i.why ?? "").trim().slice(0, 140)), evidencePostIds: Array.isArray(i.evidencePostIds) ? i.evidencePostIds.map(String).slice(0, 3) : [] }))
      .filter((i) => i.hook.length >= 8)
      .slice(0, Math.max(1, Math.min(5, n)));
  } catch {
    return [];
  }
}

export const write = internalMutation({
  args: { creatorId: v.id("creators"), ideas: v.array(v.object({ hook: v.string(), why: v.string(), evidencePostIds: v.array(v.string()) })), model: v.string() },
  handler: async (ctx, a): Promise<{ ideaIds: Id<"ideas">[] }> => {
    const now = Date.now();
    const ideaIds: Id<"ideas">[] = [];
    for (const i of a.ideas) {
      ideaIds.push(await ctx.db.insert("ideas", {
        creatorId: a.creatorId,
        evidenceLinks: [],
        fit: "yes",
        fitWhy: "seeded from their own posts for the first plan",
        version: { hook: i.hook, why: i.why, evidencePostIds: i.evidencePostIds },
        messageText: `${i.hook} — ${i.why}`,
        produced: { skillVersion: "first-plan-ideas/1", model: a.model, thresholdsVersion: "n/a" },
        sentAt: now,
        status: "sent",
        createdAt: now,
      } as never));
    }
    return { ideaIds };
  },
});

export const seed = internalAction({
  args: { creatorId: v.id("creators"), n: v.number() },
  handler: async (ctx, a): Promise<{ seeded: number; reason?: string }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!g) return { seeded: 0, reason: "creator not found" };
    const prefix = buildPrefix({ creator: g.creator, directives: g.directives, skill: FIRST_IDEAS_SKILL, personal: g.personal, voice: g.voice, history: g.history });
    const spec = REGISTRY.writer;
    const r = await callModel(ctx, {
      creatorId: a.creatorId, purpose: "first_plan_ideas", model: spec.primary, temperature: 0.5, maxTokens: 900, timeoutMs: 40_000,
      messages: [{ role: "system", content: prefix }, { role: "user", content: `Write ${Math.max(1, Math.min(5, a.n))} ideas. JSON only.` }],
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    if (!r.ok) return { seeded: 0, reason: r.reason };
    const ideas = parseFirstIdeas(r.content, a.n);
    if (ideas.length === 0) return { seeded: 0, reason: "the model gave no usable ideas" };
    await ctx.runMutation(internal.calendar.firstIdeas.write, { creatorId: a.creatorId, ideas, model: spec.primary });
    return { seeded: ideas.length };
  },
});
