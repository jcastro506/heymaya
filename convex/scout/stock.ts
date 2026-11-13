/**
 * The idea stock (2026-11-12). A season sim (10 creators, 2–3 months each) found about four ideas per creator in
 * the whole season: ideas only came from a lucky breakout or a fresh lane shape, and on 633 of ~730 creator-days
 * the scout had no candidate at all. Plans then repeated the same old idea, and mornings and plans were most of
 * what she sent. An assistant whose job is "what to make next" can't wait for luck.
 *
 * So each creator keeps a small stock of fresh ideas, topped up when it runs low (the Sunday plan tops it up
 * first, so the plan always has something new). One writer call fills it, from evidence code gathers:
 *   - their own proven formats (the dossier, their posts and multiples, in her prefix), put on new topics;
 *   - their lane in the last three weeks: breakouts, shapes and sounds, even ones too old to text about;
 *   - live trends she judged a fit for them;
 *   - moments coming up (onboarding/moments) and their own calendar.
 * Code grounds it: an idea's link must be one it was given, a multiple must be its cited post's, a hook they
 * already have (or passed on) is skipped. What they told her beats what worked, as on day one.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { buildPrefix } from "../agent/context";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { multipleFor, normalsByPlatform } from "../core/normal";
import { bare, clip, clipWords } from "../lib/clip";
import { scrubPostIds } from "../core/plainLanguage";
import { momentsOf } from "../onboarding/moments";
import { multiplesHold } from "../calendar/firstIdeas";
import { pairedRows } from "../core/schedule";
import { isAfterNote } from "../agent/consolidate";
import { spreadDelays, HOURLY_SPREAD_MS } from "../core/fanout";

const D = 86_400_000;

export const STOCK = {
  /** Fresh means sent in the last ten days and still open. */
  freshMs: 10 * D,
  /** At least this many fresh ideas; more for someone who posts more. */
  min: 3,
  max: 6,
  /** How far back her lane evidence reaches. */
  laneMs: 21 * D,
  /** Moments this close are worth planning for. */
  momentsAheadMs: 42 * D,
} as const;

/** Pure: how many fresh ideas they should have, from how often they post. */
export function stockTarget(postsPerWeek: number | null | undefined): number {
  return Math.max(STOCK.min, Math.min(STOCK.max, Math.round((postsPerWeek ?? 2) + 1)));
}

/** Pure: the moments in the next six weeks, soonest first ("Thanksgiving on 2026-11-26"). */
export function upcomingMoments(now: number): Array<{ name: string; date: string; days: number }> {
  const y = new Date(now).getUTCFullYear();
  return [...momentsOf(y), ...momentsOf(y + 1)]
    .filter((m) => m.at.getTime() > now && m.at.getTime() - now <= STOCK.momentsAheadMs)
    .map((m) => ({ name: m.name, date: m.at.toISOString().slice(0, 10), days: Math.round((m.at.getTime() - now) / D) }));
}

/**
 * Pure: which holiday an idea is about, if any. Horizon sim (2026-11-12): with Thanksgiving two weeks out, a cook
 * moving city with a half marathon on their calendar got eight Thanksgiving fixes in twelve ideas and nothing about
 * their own life. A holiday is one idea, not the stock.
 */
const MOMENT_RES: Array<[string, RegExp]> = [
  ["new year", /\bnew year/i], ["valentine", /\bvalentine/i], ["st patrick", /\b(st\.? )?patrick'?s\b/i],
  ["mother's day", /\bmother'?s day\b/i], ["father's day", /\bfather'?s day\b/i], ["fourth of july", /\b(fourth|4th) of july\b|\bjuly 4(th)?\b/i],
  ["halloween", /\bhalloween\b/i], ["thanksgiving", /\b(thanksgiving|friendsgiving)\b/i], ["christmas", /\b(christmas|xmas)\b/i],
];
export function momentOf(text: string): string | undefined {
  return MOMENT_RES.find(([, re]) => re.test(text))?.[0];
}
export const MOMENT_IDEAS_MAX = 2;

/** Pure: holidays they already have enough fresh ideas for (named as the moment list names them). */
export function momentsFull(haveTexts: string[], names: string[]): Set<string> {
  const n = new Map<string, number>();
  for (const t of haveTexts) { const k = momentOf(t); if (k) n.set(k, (n.get(k) ?? 0) + 1); }
  return new Set(names.filter((name) => (n.get(momentOf(name) ?? "") ?? 0) >= MOMENT_IDEAS_MAX));
}

export const STOCK_SKILL = `idea-stock
When: their list of ideas is running low. You're writing the next few posts they could make, for their Ideas list and next week's plan.
Use what you were given, in this order of trust: what they told you (rules, things they said they don't want, what they're into now) beats what worked; what worked for THEM (their own posts with the biggest multiples and saves, the formats in their dossier) beats what worked for others.
Their own life comes before the calendar's: a goal or date they told you about, or one on their calendar (a race, a launch, a trip, a move), gets ideas that build toward it, tighter as it nears (the prep, the week of, the day), and after it a recap or what's next, never still counting down. A holiday gets at most one idea, and none if they already have ideas for it.
Mix, when the evidence is there: at least one that puts a format of theirs that worked on a NEW topic they'd want; one from their lane (a breakout, shape, sound or trend you were given, with its link); one timely if a moment or something on their calendar is within three weeks. Never a topic or format they ruled out. Never an idea they already have or passed on (listed). No trend talk for its own sake, no "go viral", nothing generic you could send anyone in their lane.
Each idea is filmable this week with what they have: a hook line a person would say, one clause on why (in plain words: "like your rating series", "people in your lane are doing X this week"), and how to shoot it in a few words.
The why says only what you were given: which of their posts it rhymes with, which lane post or trend it comes from, which moment it's for. Never a claim about the platform, search traffic, the algorithm, or "your best numbers" unless that fact is in front of you.
Output ONLY JSON: {"ideas":[{"hook":"≤90 chars","why":"≤140 chars, no numbers unless it's a multiple of the post you cite","shoot":"≤120 chars","evidencePostIds":["their post id, if it rhymes with one"],"link":"one link from the lane or trends list, only if the idea comes from it, else empty"}]}`;

export interface StockIdea { hook: string; why: string; shoot: string; evidencePostIds: string[]; link: string }

/** Pure: the model's JSON, held to what code can ground. A link not given is dropped; a hook they have is skipped. */
export function parseStock(raw: string, n: number, allowedLinks: string[], have: string[], fullMoments: Set<string> = new Set()): StockIdea[] {
  let j: { ideas?: unknown[] } = {};
  try { j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { return []; }
  const allowed = new Set(allowedLinks);
  const seen = new Set(have.map((h) => h.trim().toLowerCase()));
  const full = new Set([...fullMoments].map((m) => momentOf(m)).filter(Boolean));
  const out: StockIdea[] = [];
  for (const x of (Array.isArray(j.ideas) ? j.ideas : []) as Array<Record<string, unknown>>) {
    const hook = String(x.hook ?? "").trim().slice(0, 90);
    if (hook.length < 8 || seen.has(hook.toLowerCase())) continue;
    // One idea per holiday a batch, and none for a holiday they already have enough for.
    const moment = momentOf(`${hook} ${String(x.why ?? "")}`);
    if (moment && full.has(moment)) continue;
    if (moment) full.add(moment);
    seen.add(hook.toLowerCase());
    const link = typeof x.link === "string" && allowed.has(x.link.trim()) ? x.link.trim() : "";
    out.push({ hook, why: scrubPostIds(String(x.why ?? "")).trim().slice(0, 140), shoot: String(x.shoot ?? "").trim().slice(0, 120), evidencePostIds: Array.isArray(x.evidencePostIds) ? x.evidencePostIds.map(String).slice(0, 3) : [], link });
    if (out.length >= n) break;
  }
  return out;
}

export const inputs = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ fresh: number; target: number; have: string[]; passed: string[]; lane: Array<{ kind: string; text: string; link: string }>; trends: Array<{ verdict: string; hook: string; what: string; link: string }>; calendar: string[]; life: string[]; haveTexts: string[] } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("createdAt", a.now - 90 * D)).take(300)) as Doc<"ideas">[];
    const hookOf = (i: Doc<"ideas">) => String((i.version as { hook?: string } | undefined)?.hook ?? i.messageText).trim();
    const fresh = ideas.filter((i) => (i.status === "sent" || i.status === "hearted") && a.now - i.createdAt < STOCK.freshMs).length;
    const dossier = c.dossier as { cadence?: { postsPerWeek?: number } } | undefined;
    const ppw = (["running", "proposed"].includes((c.growthPlan as { status?: string } | undefined)?.status ?? "") ? (c.growthPlan as { postsPerWeek?: number }).postsPerWeek : undefined) ?? dossier?.cadence?.postsPerWeek;
    const signals = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("createdAt", a.now - STOCK.laneMs)).order("desc").take(60)) as Doc<"signals">[];
    const lane = signals.filter((s) => s.url && ["breakout", "shape", "sound"].includes(s.kind) && s.verdict !== "dropped").slice(0, 12).map((s) => ({ kind: s.kind, text: clip(s.detected ?? s.why, 200), link: s.url! }));
    const picks = (c.trendPicks ?? []).filter((p) => p.verdict !== "skip").slice(0, 4);
    const trends: Array<{ verdict: string; hook: string; what: string; link: string }> = [];
    for (const p of picks) {
      const t = (await ctx.db.get(p.trendId)) as Doc<"trends"> | null;
      if (t && t.status === "live" && t.recipe) trends.push({ verdict: p.verdict, hook: p.hook, what: clip(t.recipe.what, 200), link: t.examples[0]?.url ?? "" });
    }
    const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId).gte("start", a.now).lte("start", a.now + STOCK.momentsAheadMs)).take(40)) as Doc<"calendarEvents">[];
    return {
      fresh, target: stockTarget(ppw),
      have: ideas.filter((i) => i.status !== "passed").map(hookOf).slice(0, 60),
      passed: ideas.filter((i) => i.status === "passed").map(hookOf).slice(0, 20),
      lane, trends,
      calendar: events.filter((e) => e.status === "active" && e.class !== "private" && e.class !== "routine").map((e) => `${e.title} (${new Date(e.start).toISOString().slice(0, 10)}, in ${Math.round((e.start - a.now) / D)} days)`).slice(0, 8),
      // What they told her about their life (plans, a move, a race): in the brief, not only deep in the prefix.
      // A change that just happened ("lives in Denver now") stays in the brief for six weeks, then lives in the prefix like any fact.
      life: (c.notes ?? []).filter((n) => !n.tombstonedAt && n.kind !== "bit" && (!n.expiresHint || n.expiresHint > a.now) && (n.kind === "life" || n.after || (isAfterNote(n) && a.now - n.at < STOCK.momentsAheadMs))).slice(-8).map((n) => clip(n.text, 160)),
      // Holiday ideas count over the same six weeks the calendar looks ahead, so a holiday can't refill every ten days.
      haveTexts: ideas.filter((i) => i.status !== "passed" && a.now - i.createdAt < STOCK.momentsAheadMs).map((i) => `${hookOf(i)} ${String((i.version as { why?: string } | undefined)?.why ?? "")}`),
    };
  },
});

export const write = internalMutation({
  args: { creatorId: v.id("creators"), ideas: v.array(v.object({ hook: v.string(), why: v.string(), shoot: v.string(), evidencePostIds: v.array(v.string()), link: v.string() })), model: v.string() },
  handler: async (ctx, a): Promise<{ ideaIds: Id<"ideas">[] }> => {
    const now = Date.now();
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(300)) as Doc<"ownPosts">[];
    const normals = normalsByPlatform(posts, now);
    const have = new Set(((await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(300)) as Doc<"ideas">[]).map((x) => String((x.version as { hook?: string } | undefined)?.hook ?? "").trim().toLowerCase()).filter(Boolean));
    const ideaIds: Id<"ideas">[] = [];
    for (const raw of a.ideas) {
      if (have.has(raw.hook.trim().toLowerCase())) continue;
      have.add(raw.hook.trim().toLowerCase());
      // A multiple in the why must be its cited post's (firstIdeas.multiplesHold); otherwise code says it plainly.
      const ev = raw.evidencePostIds.map((id) => posts.find((p) => p.postId === id || p.url.includes(`/${id}`))).filter((p): p is Doc<"ownPosts"> => Boolean(p));
      const mults = ev.map((p) => multipleFor(p, normals)).filter((m): m is number => m !== undefined);
      const why = multiplesHold(raw.why, mults) ? raw.why : ev[0] ? `rhymes with your "${clipWords(bare(ev[0].caption.split("\n")[0] ?? ""), 50)}"` : raw.why.replace(/\s*\(?\d+(?:\.\d+)?\s?[x×][^,.;)]*\)?/gi, "").trim();
      ideaIds.push(await ctx.db.insert("ideas", {
        creatorId: a.creatorId,
        evidenceLinks: raw.link ? [raw.link] : [],
        fit: "yes",
        fitWhy: why,
        version: { hook: raw.hook, why, evidencePostIds: raw.evidencePostIds },
        ...(raw.shoot ? { shotList: raw.shoot } : {}),
        messageText: `${raw.hook} — ${why}`,
        produced: { skillVersion: "idea-stock/1", model: a.model, thresholdsVersion: "n/a" },
        sentAt: now,
        status: "sent",
        createdAt: now,
      } as never));
    }
    return { ideaIds };
  },
});

/** Top their stock up if it's low. Nothing is texted here: the ideas go to their list, the plan and the editor. */
export const topUp = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ added: number; reason: string }> => {
    const now = a.now ?? Date.now();
    const i = await ctx.runQuery(internal.scout.stock.inputs, { creatorId: a.creatorId, now });
    if (!i) return { added: 0, reason: "creator not found" };
    const need = i.target - i.fresh;
    if (need <= 0) return { added: 0, reason: `stock is full (${i.fresh} fresh)` };
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!g) return { added: 0, reason: "creator not found" };
    const prefix = buildPrefix({ creator: g.creator, directives: g.directives, skill: STOCK_SKILL, personal: g.personal, voice: g.voice, history: g.history });
    const moments = upcomingMoments(now);
    const full = momentsFull(i.haveTexts, moments.map((m) => m.name));
    const brief = [
      `Write ${need} ideas.`,
      `Their life right now (what they told you, and their calendar, next six weeks) — this comes first:\n${[...i.life.map((l) => `- ${l}`), ...i.calendar.map((e) => `- on their calendar: ${e}`)].join("\n") || "nothing they've mentioned"}`,
      `Their lane in the last three weeks:\n${i.lane.map((l) => `- ${l.kind}: ${l.text} · ${l.link}`).join("\n") || "nothing new"}`,
      `Trends you judged for them:\n${i.trends.map((t) => `- ${t.verdict}: ${t.what} · their version: ${t.hook}${t.link ? ` · ${t.link}` : ""}`).join("\n") || "none live"}`,
      `Holidays coming up (one idea at most, if it fits them): ${moments.filter((m) => !full.has(m.name)).map((m) => `${m.name} in ${m.days} days`).join(", ") || "none to write for"}${full.size ? ` · they already have ideas for ${[...full].join(", ")}: no more` : ""}`,
      `Ideas they already have (don't repeat):\n${i.have.slice(0, 30).map((h) => `- ${h}`).join("\n") || "none"}`,
      `Ideas they passed on (not these, nor close to them):\n${i.passed.map((h) => `- ${h}`).join("\n") || "none"}`,
      "JSON only.",
    ].join("\n\n");
    const spec = REGISTRY.writer;
    const r = await callModel(ctx, { creatorId: a.creatorId, purpose: "idea_stock", model: spec.primary, temperature: 0.6, maxTokens: 1400, timeoutMs: 45_000, apiKey: process.env.OPENROUTER_API_KEY ?? "", messages: [{ role: "system", content: prefix }, { role: "user", content: brief }] });
    if (!r.ok) return { added: 0, reason: `no answer: ${r.reason ?? "model error"}` };
    const allowed = [...i.lane.map((l) => l.link), ...i.trends.map((t) => t.link)].filter(Boolean);
    const ideas = parseStock(r.content, need, allowed, [...i.have, ...i.passed], full);
    if (!ideas.length) return { added: 0, reason: "the model gave no usable ideas" };
    const w = await ctx.runMutation(internal.scout.stock.write, { creatorId: a.creatorId, ideas, model: spec.primary });
    return { added: w.ideaIds.length, reason: `topped up to ${i.fresh + w.ideaIds.length} of ${i.target}` };
  },
});

/**
 * Daily, its own job (2026-11-12, horizon sim): the stock used to top up only inside the Sunday plan, and the plan
 * stops for people who never book one, so exactly they never got a fresh idea again (weeks of "0 ideas, no plan").
 * One action per creator, spread over the hour; a full stock costs nothing.
 */
export const due = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators">[]> => (await pairedRows(ctx, { activeOnly: true })).filter((r) => r.hasDossier).map((r) => r.creatorId),
});

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ creators: number }> => {
    const ids = await ctx.runQuery(internal.scout.stock.due, {});
    const delays = spreadDelays(ids.length, HOURLY_SPREAD_MS);
    for (let k = 0; k < ids.length; k++) await ctx.scheduler.runAfter(delays[k], internal.scout.stock.topUp, { creatorId: ids[k] });
    return { creators: ids.length };
  },
});
