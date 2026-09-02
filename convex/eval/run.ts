/**
 * The suites (plan Sprint 3c). `recent`: last night's real outbound through the
 * checks and the judge, nightly. `scout`: dry runs over the seeded scenario creators,
 * before any prompt or model change. `one`: a single message, from the console.
 * Every result is an evalRuns row; the console reads them; labels come from people.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { passed, runChecks } from "./checks";
import { judge, judgePass } from "./judge";

const EVAL_KINDS = new Set(["scout", "opinion", "explain", "review", "reply", "status"]);

export const record = internalMutation({
  args: { suite: v.string(), skill: v.string(), creatorId: v.optional(v.id("creators")), messageId: v.optional(v.id("messages")), text: v.string(), checks: v.array(v.object({ name: v.string(), pass: v.boolean(), detail: v.string() })), judge: v.optional(v.object({ corny: v.number(), generic: v.number(), flattering: v.number(), toolSpeak: v.number(), specific: v.number(), wouldSend: v.number(), note: v.string(), model: v.string() })), pass: v.boolean(), trace: v.optional(v.any()) },
  handler: async (ctx, a): Promise<Id<"evalRuns">> => await ctx.db.insert("evalRuns", { ...a, at: Date.now() }),
});

/** Evaluate one message with the evidence it had. The evidence is whatever the caller can reconstruct; empty evidence fails any number. */
export const evaluate = internalAction({
  args: { suite: v.string(), skill: v.string(), text: v.string(), evidence: v.any(), creatorId: v.optional(v.id("creators")), messageId: v.optional(v.id("messages")), creatorUsesEmoji: v.optional(v.boolean()), trace: v.optional(v.any()) },
  handler: async (ctx, a): Promise<{ id: Id<"evalRuns">; pass: boolean }> => {
    const checks = runChecks({ text: a.text, evidence: a.evidence, kind: a.skill, creatorUsesEmoji: a.creatorUsesEmoji });
    const j = await judge(ctx, { creatorId: a.creatorId, text: a.text, kind: a.skill, evidence: a.evidence });
    const pass = passed(checks) && judgePass(j);
    const id = await ctx.runMutation(internal.eval.run.record, { suite: a.suite, skill: a.skill, creatorId: a.creatorId, messageId: a.messageId, text: a.text, checks, judge: j ?? undefined, pass, trace: a.trace });
    return { id, pass };
  },
});

/** Last night's outbound, with what evidence can be reconstructed: the prediction's opinion, the idea's evidence, the signal's investigation. */
export const recentOutbound = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, a): Promise<Array<{ messageId: Id<"messages">; creatorId: Id<"creators">; skill: string; text: string; evidence: unknown; usesEmoji: boolean }>> => {
    const done = new Set((await ctx.db.query("evalRuns").withIndex("by_at", (q) => q.gte("at", a.since)).collect()).map((r) => r.messageId).filter(Boolean));
    const out: Array<{ messageId: Id<"messages">; creatorId: Id<"creators">; skill: string; text: string; evidence: unknown; usesEmoji: boolean }> = [];
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    for (const c of creators) {
      const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", a.since)).collect()) as Doc<"messages">[];
      const inbound = rows.filter((m) => m.direction === "in");
      const usesEmoji = inbound.some((m) => /[\u{1F300}-\u{1FAFF}]/u.test(m.body));
      for (const m of rows) {
        if (m.direction !== "out" || !EVAL_KINDS.has(m.kind ?? "reply") || done.has(m._id)) continue;
        let evidence: unknown = null;
        if (m.ideaId) {
          const idea = (await ctx.db.get(m.ideaId)) as Doc<"ideas"> | null;
          const signal = idea?.signalId ? ((await ctx.db.get(idea.signalId)) as Doc<"signals"> | null) : null;
          evidence = { idea: idea ? { evidenceLinks: idea.evidenceLinks, version: idea.version, features: idea.features } : null, signal: signal ? { why: signal.why, score: signal.score, investigation: signal.investigation } : null };
        } else if (m.kind === "opinion" || m.kind === "explain") {
          const pred = (await ctx.db.query("predictions").withIndex("by_creator", (q) => q.eq("creatorId", c._id).lte("createdAt", m.ts + 60_000)).order("desc").first()) as Doc<"predictions"> | null;
          evidence = pred ? { opinion: pred.opinion, confidence: pred.confidence } : null;
        } else if (m.kind === "review") {
          const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id).gte("createTime", m.ts - 8 * 86_400_000)).collect()) as Doc<"ownPosts">[];
          evidence = { week: posts.map((p) => ({ views: p.metrics.views, multiple: p.multiple ?? null })), experiments: c.experiments };
        } else {
          // A reply: the evidence is the conversation and what she knows; numbers must come from there.
          const before = rows.filter((x) => x.ts < m.ts).slice(-6).map((x) => x.body);
          evidence = { conversation: before, dossier: c.dossier ?? null, notes: (c.notes ?? []).map((n) => n.text) };
        }
        out.push({ messageId: m._id, creatorId: c._id, skill: m.kind ?? "reply", text: m.body, evidence, usesEmoji });
      }
    }
    return out.slice(0, 60);
  },
});

export const recent = internalAction({
  args: { hours: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ evaluated: number; passed: number }> => {
    const since = Date.now() - (a.hours ?? 26) * 3_600_000;
    const rows = await ctx.runQuery(internal.eval.run.recentOutbound, { since });
    let evaluated = 0, ok = 0;
    for (const r of rows) {
      const res = await ctx.runAction(internal.eval.run.evaluate, { suite: "recent", skill: r.skill, text: r.text, evidence: r.evidence, creatorId: r.creatorId, messageId: r.messageId, creatorUsesEmoji: r.usesEmoji });
      evaluated++;
      if (res.pass) ok++;
    }
    return { evaluated, passed: ok };
  },
});

export const scenarioCreators = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators">[]> => {
    const rows = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    return rows.filter((c) => c.channel.paired && c.dossier).map((c) => c._id);
  },
});

/** Dry runs of the scout over the scenario creators, N times each: variance is the point. */
export const scout = internalAction({
  args: { n: v.optional(v.number()), creatorId: v.optional(v.id("creators")) },
  handler: async (ctx, a): Promise<{ runs: number; sent: number; passed: number }> => {
    const ids = a.creatorId ? [a.creatorId] : await ctx.runQuery(internal.eval.run.scenarioCreators, {});
    let runs = 0, sent = 0, ok = 0;
    for (const creatorId of ids) {
      for (let i = 0; i < (a.n ?? 1); i++) {
        const r = await ctx.runAction(internal.scout.scout.run, { creatorId, dryRun: true });
        runs++;
        if (!r.dry?.message) continue;
        sent++;
        const res = await ctx.runAction(internal.eval.run.evaluate, { suite: "scout", skill: "scout", text: r.dry.message, evidence: r.dry.evidence, creatorId, trace: r.dry.trace });
        if (res.pass) ok++;
      }
    }
    return { runs, sent, passed: ok };
  },
});

/** The console's read: the last runs, the pass rate and judge means per skill, the worst five. */
export const report = query({
  args: { token: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    if (!process.env.OPS_TOKEN || a.token !== process.env.OPS_TOKEN) return null;
    const rows = (await ctx.db.query("evalRuns").withIndex("by_at").order("desc").take(a.limit ?? 200)) as Doc<"evalRuns">[];
    const bySkill = new Map<string, { n: number; pass: number; corny: number; generic: number; specific: number; wouldSend: number; judged: number }>();
    for (const r of rows) {
      const s = bySkill.get(r.skill) ?? { n: 0, pass: 0, corny: 0, generic: 0, specific: 0, wouldSend: 0, judged: 0 };
      s.n++;
      if (r.pass) s.pass++;
      if (r.judge) {
        s.judged++;
        s.corny += r.judge.corny;
        s.generic += r.judge.generic;
        s.specific += r.judge.specific;
        s.wouldSend += r.judge.wouldSend;
      }
      bySkill.set(r.skill, s);
    }
    const labels = (await ctx.db.query("evalLabels").withIndex("by_at").order("desc").take(200)) as Doc<"evalLabels">[];
    const labeled = new Map(labels.map((l) => [String(l.evalRunId ?? l.messageId), l.label]));
    const worst = [...rows].sort((x, y) => Number(x.pass) - Number(y.pass) || ((x.judge?.wouldSend ?? 3) - (y.judge?.wouldSend ?? 3))).slice(0, 8);
    return {
      perSkill: Array.from(bySkill.entries()).map(([skill, s]) => ({ skill, n: s.n, passRate: Math.round((s.pass / s.n) * 100), corny: s.judged ? Math.round((s.corny / s.judged) * 10) / 10 : null, generic: s.judged ? Math.round((s.generic / s.judged) * 10) / 10 : null, specific: s.judged ? Math.round((s.specific / s.judged) * 10) / 10 : null, wouldSend: s.judged ? Math.round((s.wouldSend / s.judged) * 10) / 10 : null })),
      recent: rows.slice(0, 40).map((r) => ({ id: r._id, suite: r.suite, skill: r.skill, pass: r.pass, at: r.at, text: r.text.slice(0, 500), failed: r.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`), judge: r.judge ? { corny: r.judge.corny, generic: r.judge.generic, flattering: r.judge.flattering, toolSpeak: r.judge.toolSpeak, specific: r.judge.specific, wouldSend: r.judge.wouldSend, note: r.judge.note } : null, label: labeled.get(String(r._id)) ?? labeled.get(String(r.messageId)) ?? null, messageId: r.messageId ?? null })),
      worst: worst.map((r) => ({ id: r._id, skill: r.skill, text: r.text.slice(0, 300), note: r.judge?.note ?? r.checks.filter((c) => !c.pass).map((c) => c.detail).join("; ") })),
      labels: labels.length,
      agreement: (() => {
        const both = rows.filter((r) => labeled.has(String(r._id)));
        if (both.length < 5) return null;
        const agree = both.filter((r) => (labeled.get(String(r._id)) === "good") === r.pass).length;
        return Math.round((agree / both.length) * 100);
      })(),
    };
  },
});

/** The operator's word. Token-gated; becomes the golden set. */
export const label = mutation({
  args: { token: v.string(), evalRunId: v.optional(v.id("evalRuns")), messageId: v.optional(v.id("messages")), skill: v.string(), label: v.union(v.literal("good"), v.literal("bad")), reason: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    if (!process.env.OPS_TOKEN || a.token !== process.env.OPS_TOKEN) return { ok: false };
    let creatorId: Id<"creators"> | undefined;
    if (a.evalRunId) creatorId = ((await ctx.db.get(a.evalRunId)) as Doc<"evalRuns"> | null)?.creatorId;
    if (a.messageId) creatorId = ((await ctx.db.get(a.messageId)) as Doc<"messages"> | null)?.creatorId ?? creatorId;
    await ctx.db.insert("evalLabels", { evalRunId: a.evalRunId, messageId: a.messageId, creatorId, skill: a.skill, label: a.label, reason: a.reason.slice(0, 300), by: "operator", at: Date.now() });
    return { ok: true };
  },
});
