/**
 * Prediction scoring (plan §13.6). A prediction carries an expected multiple; when
 * the subject post has its 48-hour sample, the outcome multiple is stored beside it.
 * A prediction about their own post scores against that post. A prediction about a
 * draft file scores against the first own post that appeared after it, within seven
 * days (the draft became that post, or nothing did). Links to other people's posts
 * are never scored: their numbers are not the creator's.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

const SAMPLE_MS = 48 * 3_600_000;
const DRAFT_WINDOW_MS = 7 * 86_400_000;

export const scoreDue = internalMutation({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ scored: number }> => {
    const preds = (await ctx.db.query("predictions").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(50)) as Doc<"predictions">[];
    const open = preds.filter((p) => p.scoredAt === undefined);
    if (open.length === 0) return { scored: 0 };
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"ownPosts">[];
    let scored = 0;
    for (const p of open) {
      let post: Doc<"ownPosts"> | undefined;
      if (p.subject.ownPostId) post = posts.find((x) => x._id === p.subject.ownPostId);
      else if (p.subject.draftFileId) post = posts.filter((x) => x.createTime >= p.createdAt && x.createTime <= p.createdAt + DRAFT_WINDOW_MS).sort((x, y) => x.createTime - y.createTime)[0];
      else continue; // someone else's link: never scored
      if (!post) {
        if (p.subject.draftFileId && a.now - p.createdAt > DRAFT_WINDOW_MS) await ctx.db.patch(p._id, { scoredAt: a.now }); // never posted; closed without an outcome
        continue;
      }
      if (a.now - post.createTime < SAMPLE_MS || post.multiple === undefined) continue;
      await ctx.db.patch(p._id, { outcomeMultiple: post.multiple, scoredAt: a.now, subject: { ...p.subject, ownPostId: post._id } });
      scored++;
    }
    return { scored };
  },
});

/** The track record (§13.6): per confidence word, the median actual multiple and the count. */
export const trackRecord = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ confidence: string; expected: number; medianActual: number | null; n: number }>> => {
    const preds = (await ctx.db.query("predictions").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"predictions">[];
    const by = new Map<string, { expected: number; actuals: number[] }>();
    for (const p of preds) {
      if (p.outcomeMultiple === undefined) continue;
      const cur = by.get(p.confidence) ?? { expected: p.expectedMultiple, actuals: [] };
      cur.actuals.push(p.outcomeMultiple);
      by.set(p.confidence, cur);
    }
    return Array.from(by.entries()).map(([confidence, x]) => {
      const s = [...x.actuals].sort((m, n) => m - n);
      return { confidence, expected: x.expected, medianActual: s.length ? s[Math.floor(s.length / 2)] : null, n: s.length };
    });
  },
});
