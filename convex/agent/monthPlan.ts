/**
 * The month (2026-10-01). Twenty minutes after her read she proposes a plan for the next four weeks:
 * their goal in their words, what it's built on (what they're genuinely good at, never a one-off's
 * setting), how often, which formats, one thing to test, and why this gets them to the goal. It rides
 * as the opener of the first week's plan, so it's one text with the sessions to book. She proposes;
 * they react. "sounds good" or a tweak sets it (the growth_plan tool); silence leaves it proposed and
 * it still shapes the weeks. Weeks are booked one at a time (Sunday evening); the month is reviewed
 * out loud on its review date and the next one proposed.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "./registry";
import { buildPrefix } from "./context";
import { critique, tooLong } from "./critic";
import { investigate } from "./investigate";
import { clip } from "../lib/clip";
import { GROWTH, type GrowthPlan } from "./growth";

export const MONTH_PLAN_SKILL = `month-plan
When: once, right after your read, as the start of the text that carries their first week.
The judgment: propose how the next four weeks go, the way a friend in the industry would sketch it over coffee. Build it on what they're genuinely good at wherever they are (the dossier's strengths and "skill" works, and their real routines), never on the setting of a one-off. Shape it around what they've told you (what gets in the way, what they won't do on camera). Keep the number of posts a week to what they can really do: their current pace or one more, never a jump that becomes homework.
Before you propose, you may look things up (you have a small budget): the comments on their one or two best recent posts tell you what people come for, the topic or them as a person. If the comments say it's them (their humor, their look, how they talk, someone in their life), build the plan on that as much as the topic. With few comments, don't dig: lean on the posts.
Size it to them from their own numbers, not a bucket: their pace or one step more, one shoot can be several posts, and if their goal is paid work, the step that fits their normal views (proof first at a small normal; at a large normal, the brand categories that fit their world and a media kit, priced from their own numbers, never a market rate as fact).
Open with their goal in their words. If they haven't said one, say what you're assuming ("i'm guessing you mainly want…, tell me if not"). Then the plan, then one plain sentence on how it gets them to that goal. One thing to test, so the month teaches you both something. Say you'll check back on the review date with what the numbers say. End by inviting a tweak, not a yes/no form. Lowercase, the way you text. Under 90 words for the message, as two or three short bubbles with a line of only --- between them (the goal and the plan, then how it helps and the test). Plain words: no multiples, decimals or stats; say "almost twice your usual" if a number matters at all.
Output ONLY JSON: {"goal": "their words, or what you're assuming", "goalStated": true|false, "builtOn": ["≤60 chars each, what they're good at"], "formats": ["≤40 chars each, at most 3"], "postsPerWeek": 3, "test": "≤120, one thing to try", "howItHelps": "≤200, how this reaches the goal", "lane": "≤60", "keywords": ["3-8 lane keywords"], "message": "the text"}`;

export type MonthPlan = GrowthPlan & { goal: string; goalStated: boolean; builtOn: string[]; howItHelps: string };

/** Pure: the model's JSON, held to what code can promise. Null when it can't be a plan. */
export function parseMonthPlan(raw: string, fallback: { keywords: string[]; postsPerWeek: number }, now: number): { plan: MonthPlan; message: string } | null {
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "") as Record<string, unknown>; } catch { return null; }
  const str = (x: unknown, n: number) => (typeof x === "string" ? clip(x.trim(), n) : "");
  const list = (x: unknown, n: number, each: number) => (Array.isArray(x) ? x.map((y) => str(y, each)).filter(Boolean).slice(0, n) : []);
  const message = typeof j.message === "string" ? j.message.trim() : "";
  const goal = str(j.goal, 200);
  if (!message || !goal) return null;
  // Their pace or one more: a plan that doubles their output is homework (the skill says so; code holds it).
  const ceiling = Math.max(2, Math.min(7, Math.round(fallback.postsPerWeek) + 1));
  const ppw = Math.max(1, Math.min(ceiling, Math.round(Number(j.postsPerWeek) || fallback.postsPerWeek)));
  const keywords = Array.from(new Set([...list(j.keywords, 8, 40), ...fallback.keywords].map((k) => k.toLowerCase().replace(/^#/, "")).filter((k) => k.length >= 3))).slice(0, 8);
  if (!keywords.length) return null;
  return {
    message,
    plan: {
      lane: str(j.lane, 60) || keywords.slice(0, 2).join(" "),
      keywords,
      formats: list(j.formats, 3, 40),
      postsPerWeek: ppw,
      hypothesis: str(j.test, 200) || `${ppw} a week built on what they do best`,
      startedAt: now,
      reviewAt: now + GROWTH.planWeeks * 7 * 86_400_000,
      status: "proposed" as GrowthPlan["status"],
      setBy: "review",
      goal,
      goalStated: j.goalStated === true,
      builtOn: list(j.builtOn, 3, 60),
      howItHelps: str(j.howItHelps, 200),
    },
  };
}

export const inputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ hasPlan: boolean; keywords: string[]; postsPerWeek: number } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const p = c.growthPlan as GrowthPlan | undefined;
    const d = c.dossier as { keywords?: string[]; cadence?: { postsPerWeek?: number } } | undefined;
    return { hasPlan: Boolean(p && (p.status === "running" || p.status === "proposed")), keywords: d?.keywords ?? [], postsPerWeek: d?.cadence?.postsPerWeek || GROWTH.defaultPostsPerWeek };
  },
});

export const store = internalMutation({
  args: { creatorId: v.id("creators"), plan: v.any() },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.patch(a.creatorId, { growthPlan: a.plan, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Day one, twenty minutes after the read: propose the month, then send it with the first week as one
 * text. Any failure still sends the week (the plan is a bonus on top of ideas, never a gate).
 */
export const proposeThenWeek = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ proposed: boolean; reason: string }> => {
    const week = async (opener?: string) => { await ctx.runAction(internal.calendar.weekPlan.draft, { creatorId: a.creatorId, horizon: "first", opener }); };
    const quiet = await ctx.runQuery(internal.core.messages.quietNow, { creatorId: a.creatorId, now: Date.now() });
    if (quiet.quiet) {
      await ctx.scheduler.runAt(quiet.endsAt + 15 * 60_000, internal.agent.monthPlan.proposeThenWeek, { creatorId: a.creatorId });
      return { proposed: false, reason: "quiet hours; proposing in the morning" };
    }
    const inp = await ctx.runQuery(internal.agent.monthPlan.inputs, { creatorId: a.creatorId });
    if (!inp) return { proposed: false, reason: "creator not found" };
    if (inp.hasPlan) { await week(); return { proposed: false, reason: "they already have a plan" }; }
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!g) return { proposed: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: g.creator, directives: g.directives, skill: MONTH_PLAN_SKILL, personal: g.personal, voice: g.voice, history: g.history });
    const spec = REGISTRY.writer;
    const convo = `# Recent conversation\n${g.recent.slice(-10).map((m) => `${m.direction === "in" ? "them" : "you"}: ${clip(m.body, 300)}`).join("\n")}\n\nPropose the month now.`;
    // She may read what people come for first (their best posts' comments), on a small budget (2026-10-01:
    // for a 450K account her read said "people are there watching you", then the plan built only on gear).
    const inv = await investigate(ctx, { creatorId: a.creatorId, purpose: "month_plan", prefix, user: convo, budget: { calls: 3, credits: 6, deadlineAt: Date.now() + 60_000 }, temperature: 0.5, maxTokens: 1200 });
    const ask = (extra?: string) => callModel(ctx, { creatorId: a.creatorId, purpose: "month_plan_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `${convo}${inv.trace.length ? `\n\nWhat you looked up:\n${inv.trace.map((t) => `${t.tool}: ${clip(t.result ?? "", 600)}`).join("\n")}` : ""}${extra ?? ""}` }], temperature: 0.5, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    const now = Date.now();
    let r = inv.ended === "answer" && inv.content ? { ok: true as const, content: inv.content } : await ask();
    let parsed = r.ok ? parseMonthPlan(r.content, inp, now) : null;
    if (parsed) {
      const d = g.creator.dossier as { strengths?: unknown; works?: unknown; oneOffs?: unknown; cadence?: unknown } | undefined;
      const verdict = tooLong(parsed.message) ? { pass: false, problems: ["too_long"], note: "over the length cap" } : await critique(ctx, { creatorId: a.creatorId, kind: "month_plan", text: parsed.message, evidence: { dossier: d, history: g.history.slice(0, 6000) }, voice: {}, directives: g.directives.map((x) => x.verbatim) });
      if (!verdict.pass) {
        r = await ask(` Your last draft was rejected for: ${verdict.problems.join(", ")} (${verdict.note}). Fix exactly that.`);
        const again = r.ok ? parseMonthPlan(r.content, inp, now) : null;
        if (again) parsed = again;
      }
    }
    if (!parsed) { await week(); return { proposed: false, reason: "no usable plan; sent the week alone" }; }
    await ctx.runMutation(internal.agent.monthPlan.store, { creatorId: a.creatorId, plan: parsed.plan });
    await week(parsed.message);
    return { proposed: true, reason: "proposed" };
  },
});
