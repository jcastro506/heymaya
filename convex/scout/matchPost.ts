/**
 * match-post (plan §13.5): a judgment, not a formula. When a new own post appears,
 * code prefilters the candidates (ideas sent in the last fourteen days, not yet
 * matched), the screener sees the post's caption and card beside each candidate and
 * answers which one, if any, they made, with a confidence word. `certain` and
 * `likely` become the strongest taste event there is, scaled by how the post did
 * against their normal; `unsure` becomes one question with two buttons; `no` is
 * remembered so the same post is never asked about twice. A post matches at most
 * one idea.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { THRESHOLDS } from "../config/thresholds";
import { WEIGHTS } from "../taste/affinities";
import { deliverNow } from "../core/scheduler";

const CONFIDENCE = v.union(v.literal("certain"), v.literal("likely"), v.literal("unsure"), v.literal("no"));

/** §13.10: a posted idea that beat their normal counts more; one that fell below counts less. */
export function postedWeight(multiple: number | null | undefined): number {
  if (multiple === null || multiple === undefined) return WEIGHTS.posted;
  if (multiple >= 1.2) return WEIGHTS.posted * 1.5;
  if (multiple < 0.8) return WEIGHTS.posted * 0.5;
  return WEIGHTS.posted;
}

export const candidates = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ posts: Array<{ id: Id<"ownPosts">; url: string; caption: string; createTime: number; multiple: number | null; card: unknown }>; ideas: Array<{ id: Id<"ideas">; hook: string | null; message: string; sentAt: number; features: unknown }> }> => {
    const window = THRESHOLDS.matchWindowDays * 86_400_000;
    const ideasAll = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("createdAt", a.now - window)).collect()) as Doc<"ideas">[];
    const ideas = ideasAll.filter((i) => i.sentAt && !i.matchedPostId && i.status !== "posted");
    const matched = new Set(ideasAll.map((i) => i.matchedPostId).filter(Boolean));
    const postsAll = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("createTime", a.now - window)).collect()) as Doc<"ownPosts">[];
    const posts = postsAll.filter((p) => !p.matchCheckedAt && !matched.has(p._id));
    if (ideas.length === 0 || posts.length === 0) return { posts: [], ideas: [] };
    const reads = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(80)) as Doc<"ownPostReads">[];
    const cardFor = new Map(reads.map((r) => [r.ownPostId, r.card]));
    return {
      posts: posts.slice(0, 5).map((p) => ({ id: p._id, url: p.url, caption: p.caption.slice(0, 300), createTime: p.createTime, multiple: p.multiple ?? null, card: cardFor.get(p._id) ?? null })),
      ideas: ideas.map((i) => ({ id: i._id, hook: (i.version as { hook?: string } | undefined)?.hook ?? null, message: i.messageText.slice(0, 400), sentAt: i.sentAt!, features: i.features ?? null })),
    };
  },
});

/** The verdict as rows: the idea, the post, the taste event; `no` and `unsure` only mark the post as judged. */
export const apply = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.optional(v.id("ideas")), ownPostId: v.id("ownPosts"), confidence: CONFIDENCE, why: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const post = (await ctx.db.get(a.ownPostId)) as Doc<"ownPosts"> | null;
    if (!post || post.creatorId !== a.creatorId) return { ok: false, reason: "post is not theirs" };
    const now = Date.now();
    await ctx.db.patch(post._id, { matchCheckedAt: now });
    if (!a.ideaId) return { ok: true };
    const idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
    if (!idea || idea.creatorId !== a.creatorId) return { ok: false, reason: "idea is not theirs" };
    if (a.confidence === "no") {
      // A negative example the skill sees next time; taste is unaffected (§13.10 table).
      await ctx.db.patch(idea._id, { matchConfidence: "no" });
      return { ok: true };
    }
    if (a.confidence === "unsure") return { ok: true }; // the question was asked; their tap decides
    if (idea.matchedPostId && idea.matchedPostId !== post._id) return { ok: false, reason: "idea already matched" };
    await ctx.db.patch(idea._id, { matchedPostId: post._id, matchConfidence: a.confidence, postedAt: post.createTime, status: "posted" });
    return { ok: true };
  },
});

export const MATCH_SKILL = `match-post
When: a new post of theirs appeared and there are ideas you sent them in the last two weeks. Decide which idea, if any, this post is: the same premise or hook, not just the same topic. Default is "no". "certain" only when the hook or premise is unmistakably the one you sent; "likely" when the premise matches and the shape does; "unsure" when it might be, and you'd want to ask.
Output ONLY JSON: {"ideaId": "<id or null>", "confidence": "certain|likely|unsure|no", "why": "≤120"}`;

export const run = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ judged: number; matched: number; asked: number }> => {
    const now = Date.now();
    const c = await ctx.runQuery(internal.scout.matchPost.candidates, { creatorId: a.creatorId, now });
    let judged = 0, matched = 0, asked = 0;
    for (const post of c.posts) {
      const spec = REGISTRY.screener;
      const r = await callModel(ctx, {
        creatorId: a.creatorId,
        purpose: "match_post",
        model: spec.primary,
        messages: [
          { role: "system", content: MATCH_SKILL },
          { role: "user", content: `Their new post:\n${JSON.stringify({ caption: post.caption, card: post.card, postedDaysAgo: Math.round((now - post.createTime) / 86_400_000) })}\n\nIdeas you sent (id, hook, message, sentDaysAgo):\n${JSON.stringify(c.ideas.filter((i) => i.sentAt <= post.createTime + 3_600_000).map((i) => ({ id: i.id, hook: i.hook, message: i.message, sentDaysAgo: Math.round((now - i.sentAt) / 86_400_000) })))}` },
        ],
        temperature: 0,
        maxTokens: 200,
        apiKey: process.env.OPENROUTER_API_KEY ?? "",
      });
      let out: { ideaId?: string | null; confidence?: string; why?: string } = {};
      if (r.ok) {
        try {
          const m = r.content.match(/\{[\s\S]*\}/);
          out = JSON.parse(m ? m[0] : "{}") as typeof out;
        } catch {
          out = {};
        }
      }
      const known = c.ideas.find((i) => i.id === out.ideaId);
      const confidence = (["certain", "likely", "unsure", "no"] as const).includes(out.confidence as never) && known ? (out.confidence as "certain" | "likely" | "unsure" | "no") : "no";
      const res = await ctx.runMutation(internal.scout.matchPost.apply, { creatorId: a.creatorId, ideaId: known?.id, ownPostId: post.id, confidence, why: (out.why ?? "").slice(0, 120) });
      judged++;
      if (!res.ok || !known) continue;
      if (confidence === "certain" || confidence === "likely") {
        await ctx.runMutation(internal.taste.events.record, { creatorId: a.creatorId, kind: "posted", ideaId: known.id, weight: postedWeight(post.multiple) });
        matched++;
      } else if (confidence === "unsure") {
        await ctx.runMutation(internal.core.messages.send, {
          creatorId: a.creatorId,
          surface: "telegram",
          body: `is this one from the "${(known.hook ?? known.message).slice(0, 60)}" idea? ${post.url}`,
          dedupeKey: `match:${post.id}`,
          proactive: false,
          kind: "match",
          links: [post.url],
          buttons: [
            { id: `match:${known.id}:${post.id}:yes`, label: "yes, that's it" },
            { id: `match:${known.id}:${post.id}:no`, label: "no" },
          ],
        });
        await deliverNow(ctx as never);
        asked++;
      }
    }
    return { judged, matched, asked };
  },
});
