/**
 * When they tell her what they're NOT (2026-11-04). A tester said "i don't want to be a food creator" twenty
 * minutes into day one. Her niche changed and the sentence was remembered, and nothing else did: eight hours
 * later her week plan was a breakfast sandwich and a dinner spot, built from ideas and a growth plan written
 * before she spoke. Being heard means everything downstream changes, so a correction runs this once:
 *
 *   1. the dossier is rewritten with their words in front of it (a format that works stays; its topic may go)
 *   2. unfilmed ideas that go against what they said are passed, with the plan slots she only proposed
 *   3. the growth plan is dropped and proposed again, with this week, as her next text
 *
 * Which ideas conflict is the model's call (it reads meaning, not keywords); code passes them. At most once
 * in 12 hours per creator: a second correction that soon waits for the weekly rewrite.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { dayKeyInZone } from "../core/cadence";

export const REDIRECT = { everyMs: 12 * 3_600_000, ideasAgeMs: 30 * 86_400_000 } as const;

/** Pure: the ids the model named that are really among the candidates (a model id it invented is ignored). */
export function conflictingIds(raw: string, candidates: string[]): string[] {
  const named = raw.match(/[a-z0-9]{20,}/gi) ?? [];
  const ok = new Set(candidates);
  return Array.from(new Set(named.filter((x) => ok.has(x))));
}

export const CONFLICT_PROMPT = `A content creator told their assistant what they don't want. Below are content ideas the assistant had planned for them, one per line as "id: idea". List the ids of the ideas that go against what they said (by meaning, not just words). Output only the ids, comma-separated, or "none".`;

export const inputs = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ timezone: string; recent: boolean; ideas: Array<{ id: Id<"ideas">; hook: string }> } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const recent = (c.milestonesSaid ?? []).some((s) => {
      const m = /^redirect:(\d+)$/.exec(s);
      return m ? a.now - Number(m[1]) < REDIRECT.everyMs : false;
    });
    const rows = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"ideas">[];
    const open = rows.filter((i) => (i.status === "sent" || i.status === "hearted") && !i.postedAt && a.now - i.createdAt < REDIRECT.ideasAgeMs);
    return { timezone: c.timezone, recent, ideas: open.map((i) => ({ id: i._id, hook: ((i.version as { hook?: string } | undefined)?.hook ?? i.messageText).slice(0, 160) })) };
  },
});

/** Pass the conflicting ideas and drop the plan slots she only proposed for them; booked sessions stay theirs. */
export const pass = internalMutation({
  args: { creatorId: v.id("creators"), ideaIds: v.array(v.id("ideas")), now: v.number() },
  handler: async (ctx, a): Promise<{ ideas: number; blocks: number }> => {
    let ideas = 0, blocks = 0;
    for (const id of a.ideaIds) {
      const i = (await ctx.db.get(id)) as Doc<"ideas"> | null;
      if (!i || i.creatorId !== a.creatorId) continue; // never another creator's, whatever the model said
      await ctx.db.patch(id, { status: "passed" });
      ideas++;
      const rows = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("start", a.now)).take(100)) as Doc<"calendarBlocks">[];
      for (const b of rows.filter((b) => b.ideaId === id && !b.consentAt && b.status !== "deleted")) {
        await ctx.db.patch(b._id, { status: "deleted", rev: (b.rev ?? 0) + 1 });
        blocks++;
      }
    }
    return { ideas, blocks };
  },
});

export const mark = internalMutation({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (c) await ctx.db.patch(a.creatorId, { milestonesSaid: [...(c.milestonesSaid ?? []).filter((s) => !s.startsWith("redirect:")), `redirect:${a.now}`] });
    return null;
  },
});

export const run = internalAction({
  // dryRun: rewrite and judge, report what would be passed, change and send nothing else (evals, the operator).
  args: { creatorId: v.id("creators"), said: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; passed?: string[]; blocks?: number }> => {
    const now = Date.now();
    const i = await ctx.runQuery(internal.onboarding.redirect.inputs, { creatorId: a.creatorId, now });
    if (!i) return { ok: false, reason: "creator not found" };
    if (i.recent && !a.dryRun) return { ok: false, reason: "redirected in the last 12 hours; the weekly rewrite takes it from here" };
    if (!a.dryRun) await ctx.runMutation(internal.onboarding.redirect.mark, { creatorId: a.creatorId, now });

    let passed: Id<"ideas">[] = [];
    if (i.ideas.length) {
      const r = await callModel(ctx, { creatorId: a.creatorId, purpose: "redirect_ideas", model: REGISTRY.screener.primary, messages: [{ role: "system", content: CONFLICT_PROMPT }, { role: "user", content: `They said: ${a.said.slice(0, 400)}\n\n${i.ideas.map((x) => `${x.id}: ${x.hook}`).join("\n")}` }], temperature: 0, maxTokens: 400, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (r.ok) passed = conflictingIds(r.content, i.ideas.map((x) => String(x.id))) as Id<"ideas">[];
    }
    if (a.dryRun) return { ok: true, passed: passed.map((id) => i.ideas.find((x) => x.id === id)?.hook ?? String(id)) };

    const synth = await ctx.runAction(internal.onboarding.ingest.synthesize, { creatorId: a.creatorId, reason: "correction", said: a.said });
    if (!synth.ok) console.error(`[redirect] dossier rewrite failed for ${a.creatorId}: ${synth.reason}`);
    const p = passed.length ? await ctx.runMutation(internal.onboarding.redirect.pass, { creatorId: a.creatorId, ideaIds: passed, now }) : { ideas: 0, blocks: 0 };
    await ctx.runMutation(internal.agent.growth.dropPlan, { creatorId: a.creatorId });
    // Her next text: the month proposed again around what they said, with this week (agent/monthPlan).
    await ctx.runAction(internal.agent.monthPlan.proposeThenWeek, { creatorId: a.creatorId });
    console.log(`[redirect] ${a.creatorId} ${dayKeyInZone(now, i.timezone)}: passed ${p.ideas} ideas, ${p.blocks} slots`);
    return { ok: true, passed: passed.map(String), blocks: p.blocks };
  },
});
