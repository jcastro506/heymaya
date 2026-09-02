/**
 * The weekly review (plan §11.2 #14, §13.7, §13.10 (5), §21.5). Sunday, on the
 * creator's clock: the week's own posts next to their numbers, the rung as a
 * computed fact she may disagree with in words, what they liked against what
 * worked, the verdict on last week's experiment, one new experiment, and the
 * prediction track record when there is one. Then the pilot's three-question
 * check-in as one open question. Everything she says is in the inputs.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { buildPrefix, personalFor, producedStamp } from "../agent/context";
import { critique, tooLong } from "../agent/critic";
import { computeRung, engagement, type RungFacts } from "./rung";
import { localHourMinute } from "../scout/gate";
import { summarize, type Affinity } from "../taste/affinities";
import { laneBenchmarkFor } from "../scout/benchmarks";
import { investigate } from "../agent/investigate";
import { LOOKUPS } from "../agent/playbooks";

const WEEK_MS = 7 * 86_400_000;

export const WEEKLY_REVIEW_SKILL = `weekly-review
When: Sunday. You are telling them what happened this week and why, in under 900 characters, no bullets, no headers, like a text from someone who watched every post.
Order: (1) the week in one line with a number they were given (posts, median multiple); (2) the one thing that most explains it, from the cards and numbers, not from theory; (3) LIKED vs WORKED: which ideas they took and which posts actually performed, and if those disagree say so plainly, because results beat taste and you owe them that; (4) last week's experiment: held, failed, or unknown, with the number; (5) one new experiment for next week, small enough to do in one post; (6) if you have a scored prediction record, one honest line on how your calls have been running. (7) The pulse tells you how they've been with you this week, read from what they did, never from asking. If it is cooling or silent, end with ONE specific question about their content that a reply would answer in a sentence (which of two hooks, whether a post is still planned); never ask how they feel about you, whether they'd miss you, or whether anything was useless. If warm or steady, no question unless one is genuinely useful.
The rung is a computed fact you were given. You may disagree with it, but then say why in "rungOverride".
Never invent a metric. If the week is thin (under three posts with a 48 h sample), say so and make the review about the one thing you can see.
Output ONLY JSON:
{"message": "≤900 chars", "experimentVerdict": "held|failed|unknown|none", "experimentVerdictWhy": "≤120", "newExperiment": "≤140, one post, measurable", "rungOverride": {"rung": "L0|L1|L2|healthy|unknown", "why": "≤120"} | null}` + LOOKUPS.review;

export const dueForReview = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Id<"creators">[]> => {
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    const due: Id<"creators">[] = [];
    for (const c of creators) {
      if (!c.channel.paired || c.plan.status === "paused" || c.plan.status === "canceled" || c.plan.status === "deleting") continue;
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone: c.timezone, weekday: "short" }).format(a.now);
      const { hour } = localHourMinute(a.now, c.timezone);
      if (weekday !== "Sun" || hour < 9 || hour >= 20) continue;
      const recent = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", a.now - 6 * 86_400_000)).collect()) as Doc<"messages">[];
      if (recent.some((m) => m.direction === "out" && m.kind === "review")) continue;
      due.push(c._id);
    }
    return due;
  },
});

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids = await ctx.runQuery(internal.review.weekly.dueForReview, { now: Date.now() });
    for (const creatorId of ids) await ctx.scheduler.runAfter(0, internal.review.weekly.run, { creatorId });
    return { scheduled: ids.length };
  },
});

export const inputs = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a) => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const since = a.now - WEEK_MS;
    const all = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(80)) as Doc<"ownPosts">[];
    const week = all.filter((p) => p.createTime >= since);
    const history = all.filter((p) => p.createTime < since).slice(0, 40);
    const reads = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(80)) as Doc<"ownPostReads">[];
    const cardFor = new Map(reads.map((r) => [r.ownPostId, r.card]));
    const planned = (creator.dossier as { cadence?: { postsPerWeek?: number } } | undefined)?.cadence?.postsPerWeek ?? null;
    const rung: RungFacts = computeRung({
      week: week.map((p) => ({ views: p.metrics.views, multiple: p.multiple ?? null, likes: p.metrics.likes, comments: p.metrics.comments, shares: p.metrics.shares, saves: p.metrics.saves ?? 0, ageHours: (a.now - p.createTime) / 3_600_000 })),
      planned: planned && planned > 0 ? planned : null,
      history: history.map((p) => ({ views: p.metrics.views, comments: p.metrics.comments, shares: p.metrics.shares, saves: p.metrics.saves ?? 0 })),
    });
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("createdAt", since - WEEK_MS)).collect()) as Doc<"ideas">[];
    const posted = ideas.filter((i) => i.status === "posted");
    const postFor = new Map(all.map((p) => [p._id, p]));
    const directives = (await ctx.db.query("directives").withIndex("by_creator_and_active", (q) => q.eq("creatorId", a.creatorId).eq("active", true)).collect()) as Doc<"directives">[];
    const lastExperiment = [...(creator.experiments ?? [])].sort((x, y) => y.proposedAt - x.proposedAt)[0] ?? null;
    const lane = await laneBenchmarkFor(ctx, a.creatorId, a.now);
    return {
      creator,
      directives,
      personal: await personalFor(ctx, creator),
      rung,
      lane,
      week: week.map((p) => ({ url: p.url, daysAgo: Math.round((a.now - p.createTime) / 86_400_000), views: p.metrics.views, multiple: p.multiple ?? null, engagementPerView: engagement({ views: p.metrics.views, comments: p.metrics.comments, shares: p.metrics.shares, saves: p.metrics.saves ?? 0 }), caption: p.caption.slice(0, 100), card: cardFor.get(p._id) ?? null, sampled: a.now - p.createTime >= 48 * 3_600_000 })),
      liked: ideas.filter((i) => i.status === "hearted" || i.status === "posted" || i.reaction).map((i) => ({ hook: (i.version as { hook?: string } | undefined)?.hook ?? i.messageText.slice(0, 80), status: i.status, features: i.features ?? null })),
      passed: ideas.filter((i) => i.status === "passed").map((i) => ({ hook: (i.version as { hook?: string } | undefined)?.hook ?? i.messageText.slice(0, 80), features: i.features ?? null })),
      worked: posted.map((i) => ({ hook: (i.version as { hook?: string } | undefined)?.hook ?? i.messageText.slice(0, 80), multiple: i.matchedPostId ? (postFor.get(i.matchedPostId)?.multiple ?? null) : null })),
      taste: summarize((creator.affinities ?? []) as Affinity[], a.now, 4),
      lastExperiment,
      ideasSent: ideas.filter((i) => i.sentAt && i.sentAt >= since).length,
    };
  },
});

export const finish = internalMutation({
  args: { creatorId: v.id("creators"), experimentVerdict: v.union(v.literal("held"), v.literal("failed"), v.literal("unknown"), v.literal("none")), newExperiment: v.string(), rungOverride: v.optional(v.object({ rung: v.string(), why: v.string() })), rung: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const now = Date.now();
    const experiments = [...(c.experiments ?? [])].sort((x, y) => y.proposedAt - x.proposedAt);
    if (experiments[0] && !experiments[0].verdictAt && a.experimentVerdict !== "none") experiments[0] = { ...experiments[0], verdictAt: now, result: a.experimentVerdict };
    if (a.newExperiment.trim()) experiments.unshift({ id: `exp_${now}`, text: a.newExperiment.trim().slice(0, 200), proposedAt: now });
    await ctx.db.patch(c._id, { experiments: experiments.slice(0, 20), updatedAt: now });
    // §13.7: the override is stored beside the computed value so the operator can see how often she disagrees.
    if (a.rungOverride) {
      const latest = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").first()) as Doc<"ownPostReads"> | null;
      if (latest) await ctx.db.patch(latest._id, { modelOverride: { rung: a.rungOverride.rung, why: a.rungOverride.why } });
    }
    return null;
  },
});

export const run = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ sent: boolean; reason?: string }> => {
    const now = Date.now();
    const inp = await ctx.runQuery(internal.review.weekly.inputs, { creatorId: a.creatorId, now });
    if (!inp) return { sent: false, reason: "creator not found" };
    const record = await ctx.runQuery(internal.review.predictions.trackRecord, { creatorId: a.creatorId });
    const pulse = await ctx.runQuery(internal.review.pulse.pulseFor, { creatorId: a.creatorId, now });
    const prefix = buildPrefix({ creator: inp.creator, directives: inp.directives, skill: WEEKLY_REVIEW_SKILL, personal: inp.personal });
    const spec = REGISTRY.writer;
    const evidence = { rung: inp.rung, lane: inp.lane, week: inp.week, liked: inp.liked, passed: inp.passed, worked: inp.worked, taste: inp.taste, ideasSent: inp.ideasSent, lastExperiment: inp.lastExperiment, trackRecord: record.filter((r) => r.n >= 3), pulse: pulse ? { word: pulse.word, why: pulse.why } : null };
    const user = `This week's evidence (everything you may cite is here):\n${JSON.stringify(evidence)}`;
    const inv = await investigate(ctx, { creatorId: a.creatorId, purpose: "weekly_review", prefix, user, budget: { calls: 2, credits: 10, deadlineAt: Date.now() + 45_000 }, temperature: 0.5, maxTokens: 1600 });
    const r = inv.content ? { ok: true as const, content: inv.content } : { ok: false as const, reason: `review ${inv.ended}` };
    if (!r.ok) return { sent: false, reason: r.reason };
    type Out = { message: string; experimentVerdict?: string; experimentVerdictWhy?: string; newExperiment?: string; rungOverride?: { rung: string; why: string } | null };
    let out: Out | null = null;
    try {
      const m = r.content.match(/\{[\s\S]*\}/);
      out = m ? (JSON.parse(m[0]) as Out) : null;
    } catch {
      out = null;
    }
    if (!out?.message?.trim()) return { sent: false, reason: "review returned no message" };

    const dossierVoice = inp.creator.dossier as { voice?: unknown; persona?: unknown } | undefined;
    let text = out.message.trim();
    let verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "over the length cap" } : await critique(ctx, { creatorId: a.creatorId, kind: "review", text, evidence, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: inp.directives.map((d) => d.verbatim) });
    let criticSkipped = Boolean(verdict.skipped);
    if (!verdict.pass) {
      const rw = await callModel(ctx, { creatorId: a.creatorId, purpose: "weekly_review_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `${user}\n\nYour previous review was rejected by the critic for: ${verdict.problems.join(", ")} (${verdict.note}). Rewrite ONLY the message text, fixing exactly that. Output the text only.` }], temperature: 0.4, maxTokens: 1200, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (rw.ok && rw.content.trim()) {
        text = rw.content.trim();
        verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "still over" } : await critique(ctx, { creatorId: a.creatorId, kind: "review", text, evidence, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: inp.directives.map((d) => d.verbatim) });
        criticSkipped = criticSkipped || Boolean(verdict.skipped);
      }
      if (!verdict.pass) return { sent: false, reason: `critic: ${verdict.problems.join(", ")}` };
    }

    const produced = producedStamp(spec.primary);
    const ev = (["held", "failed", "unknown", "none"] as const).includes(out.experimentVerdict as never) ? (out.experimentVerdict as "held" | "failed" | "unknown" | "none") : "none";
    await ctx.runMutation(internal.review.weekly.finish, { creatorId: a.creatorId, experimentVerdict: ev, newExperiment: out.newExperiment ?? "", rungOverride: out.rungOverride && out.rungOverride.rung !== inp.rung.rung ? { rung: String(out.rungOverride.rung), why: String(out.rungOverride.why ?? "").slice(0, 120) } : undefined, rung: inp.rung.rung });
    const weekKey = new Date(now).toISOString().slice(0, 10);
    await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: text, dedupeKey: `review:${weekKey}`, proactive: true, kind: "review", links: inp.week.slice(0, 3).map((p) => p.url), produced, criticSkipped });
    await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId: a.creatorId, step: "first_review" });
    // learn-creator: the weekly dossier rewrite, after the review, with the week's corrections in front of it (§15.7).
    await ctx.scheduler.runAfter(60_000, internal.onboarding.ingest.synthesize, { creatorId: a.creatorId, reason: "weekly" });
    return { sent: true };
  },
});
