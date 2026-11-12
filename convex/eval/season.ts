/**
 * A season (2026-11-12): many creators, months each, compressed. The operator asked whether Maya is
 * useful over months, whether she's too much, and whether her ideas, sounds and captions are genuinely
 * good or tacky. One season is N living sims (eval/livingSim) started together:
 *
 *   - each clones an onboarded creator (a first-week run's, or a scenario persona) with their REAL posting
 *     history released day by day and their watched accounts' real posts as the moving lane;
 *   - each plays one of eight temperaments (eval/personas) on a model family that isn't hers, who may ask
 *     for less, pause, or text STOP;
 *   - every job a paired person gets runs on each simulated day (the fleet crons skip sim creators);
 *   - their life happens in their own lane (a big event, a rule, a slump, a brand DM, a shift).
 *
 * Then `report` reads it as a population and `judgeTaste` has a third model family (not her writer, not the
 * actor) grade what she sent: ideas, trends, captions and sounds, plans, mornings. Nobody is ever texted:
 * every clone is an `eval-run:` creator with no phone or chat.
 *
 *   start:   npx convex run eval/season:start '{"fromRun":"fw-…","days":90}'
 *   report:  npx convex run eval/season:report '{"season":"season-…"}'
 *   taste:   npx convex run eval/season:judgeTaste '{"season":"season-…"}'  then eval/season:taste
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { clip } from "../lib/clip";
import { PERSONAS, personaFor } from "./personas";
import { claimsIn, numbersIn, unbacked } from "../core/numbers";
import { multipleFor, normalsByPlatform } from "../core/normal";

const D = 86_400_000;
const seasonKey = (season: string) => `season:${season}`;
const tasteKey = (season: string, runId: string) => `season:${season}:taste:${runId}`;

/** The plan each temperament is on: the ones who'd pay for deals get them, so both plans run. */
export const PARTNER_TEMPERAMENTS = new Set(["deal_seeker", "eager", "skeptical"]);

/** The grader for her work: a third model family (her writer is Gemini, the actor DeepSeek). */
export function tasteModel(env: Record<string, string | undefined> = process.env): string {
  return env.SIM_TASTE_MODEL || "anthropic/claude-sonnet-5.5";
}

type SeasonState = { season: string; days: number; startedAt: number; planned: Array<{ i: number; source: string; temperament: string; tier: "solo" | "partner" }>; runs: string[] };

async function readKey<T>(ctx: QueryCtx | MutationCtx, key: string): Promise<T | null> {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
  return row ? (JSON.parse(row.value) as T) : null;
}

async function writeKey(ctx: MutationCtx, key: string, value: unknown): Promise<void> {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const json = JSON.stringify(value);
  if (row) await ctx.db.patch(row._id, { value: json, updatedAt: Date.now() });
  else await ctx.db.insert("syncState", { key, value: json, updatedAt: Date.now() });
}

export const readSeason = internalQuery({ args: { season: v.string() }, handler: async (ctx, a): Promise<SeasonState | null> => await readKey<SeasonState>(ctx, seasonKey(a.season)) });

export const writeSeason = internalMutation({
  args: { season: v.string(), state: v.any() },
  handler: async (ctx, a): Promise<null> => { await writeKey(ctx, seasonKey(a.season), a.state); return null; },
});

/** A living sim of this season has started (called from livingSim.start). */
export const joined = internalMutation({
  args: { season: v.string(), runId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const s = await readKey<SeasonState>(ctx, seasonKey(a.season));
    if (s && !s.runs.includes(a.runId)) await writeKey(ctx, seasonKey(a.season), { ...s, runs: [...s.runs, a.runId] });
    return null;
  },
});

/** The onboarded creators of a first-week run (the clone sources). */
export const sourcesOf = internalQuery({
  args: { fromRun: v.string() },
  handler: async (ctx, a): Promise<string[]> => {
    const s = await readKey<{ creators: Array<{ creatorId?: string }> }>(ctx, `fw:${a.fromRun}:state`);
    return (s?.creators ?? []).map((c) => c.creatorId).filter((x): x is string => Boolean(x));
  },
});

export const start = internalAction({
  args: { fromRun: v.optional(v.string()), sources: v.optional(v.array(v.id("creators"))), personas: v.optional(v.array(v.string())), days: v.number(), offset: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ season: string; creators: SeasonState["planned"] }> => {
    const ids: string[] = [...(a.sources ?? [])];
    if (a.fromRun) ids.push(...(await ctx.runQuery(internal.eval.season.sourcesOf, { fromRun: a.fromRun })));
    for (const p of a.personas ?? []) {
      const id = await ctx.runQuery(internal.eval.expertBench.personaSource, { clerkUserId: p });
      if (id) ids.push(id);
    }
    if (!ids.length) throw new Error("no creators to clone");
    const season = `season-${Date.now()}`;
    // `offset` rotates temperaments, so a second season gives each account a different person.
    const planned = ids.map((source, i) => {
      const temperament = personaFor(i + (a.offset ?? 0)).id;
      return { i, source, temperament, tier: (PARTNER_TEMPERAMENTS.has(temperament) ? "partner" : "solo") as "solo" | "partner" };
    });
    await ctx.runMutation(internal.eval.season.writeSeason, { season, state: { season, days: a.days, startedAt: Date.now(), planned, runs: [] } satisfies SeasonState });
    // Today's trends, once, for everyone (the daily cron's work; each person's read of them is per day in the sim).
    try { await ctx.runAction(internal.scout.trends.run, { skipJudging: true }); } catch (e) { console.error(`[season] trends: ${e instanceof Error ? e.message : String(e)}`); }
    for (const p of planned) {
      await ctx.scheduler.runAfter(p.i * 20_000, internal.eval.livingSim.start, { sourceId: p.source as Id<"creators">, days: a.days, seed: 11 + p.i, temperament: p.temperament, tier: p.tier, season });
    }
    return { season, creators: planned };
  },
});

/**
 * Stop a season: each creator's state row goes, so their next scheduled step finds nothing and ends (every
 * living-sim step returns when its state is missing). Their rows stay for reading; the season row records why.
 */
export const stop = internalMutation({
  args: { season: v.string(), why: v.string() },
  handler: async (ctx, a): Promise<{ stopped: number }> => {
    const s = await readKey<SeasonState>(ctx, seasonKey(a.season));
    if (!s) return { stopped: 0 };
    let stopped = 0;
    for (const runId of s.runs) {
      const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", `sim:${runId}:state`)).unique();
      if (row) { await ctx.db.delete(row._id); stopped++; }
    }
    await writeKey(ctx, seasonKey(a.season), { ...s, stopped: { at: Date.now(), why: a.why } });
    return { stopped };
  },
});

/**
 * Dev only: live trends whose watch failed wait 20 hours to be tried again (scout/trends toWatch). After an
 * outage (2026-11-12: Gemini had no credit) a season would start with nothing to judge; this clears the wait.
 */
export const rewatch = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ cleared: number }> => {
    if (!process.env.ENVIRONMENT_NAME || /prod/i.test(process.env.ENVIRONMENT_NAME)) throw new Error("dev and staging only");
    const rows = (await ctx.db.query("trends").withIndex("by_status", (q) => q.eq("status", "live")).take(60)) as Doc<"trends">[];
    let cleared = 0;
    for (const t of rows.filter((x) => !x.recipe && x.watchedAt)) { await ctx.db.patch(t._id, { watchedAt: undefined }); cleared++; }
    return { cleared };
  },
});

// ------------------------------------------------------------------ the population

type Day = { d: number; snap?: { outProactive?: number; outKinds?: string[]; out?: number; ideasSaved?: number; ideasPassed?: number; ideasPosted?: number; ideasTotal?: number; costUsdLast30m?: number; memory?: { rules?: string[] } }; actor?: { mood: number | null; why: string; action: string; answered: boolean } | null; left?: { d: number; why: string } | null; probes?: Array<{ q: string; a: string; verdict?: { remembers?: number; invented?: string[] } | null }>; jobs?: Record<string, string>; said?: string[] };

/** Pure: one creator's season in numbers. */
export function seasonRow(days: Day[], total: number): Record<string, unknown> {
  const weeks = Math.ceil(total / 7);
  const perWeek = Array.from({ length: weeks }, (_, w) => days.filter((x) => x.d > w * 7 && x.d <= (w + 1) * 7).reduce((n, x) => n + (x.snap?.outProactive ?? 0), 0));
  const moods = days.map((x) => x.actor?.mood).filter((m): m is number => typeof m === "number");
  const moodByMonth = [0, 1, 2, 3, 4, 5].map((m) => days.filter((x) => x.d > m * 30 && x.d <= (m + 1) * 30).map((x) => x.actor?.mood).filter((n): n is number => typeof n === "number")).filter((xs) => xs.length).map((xs) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10);
  const left = days.find((x) => x.left)?.left ?? null;
  const kinds = days.flatMap((x) => x.snap?.outKinds ?? []).reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});
  const last = [...days].reverse().find((x) => x.snap)?.snap;
  const proactiveDays = days.filter((x) => (x.snap?.outProactive ?? 0) > 0).length;
  const failedJobs = days.flatMap((x) => Object.entries(x.jobs ?? {}).filter(([, r]) => r.startsWith("failed")).map(([k, r]) => `${k}: ${r}`.slice(0, 120)));
  return {
    daysDone: days.length,
    herTextsPerWeek: perWeek,
    maxInADay: Math.max(0, ...days.map((x) => x.snap?.outProactive ?? 0)),
    daysWithAText: proactiveDays,
    kinds,
    moodByMonth, moodFirst: moods[0] ?? null, moodLast: moods.at(-1) ?? null,
    answeredTurns: days.filter((x) => x.actor?.answered).length,
    askedLess: days.filter((x) => x.actor?.action === "less").length,
    paused: days.filter((x) => x.actor?.action === "pause").length,
    leftDay: left?.d ?? null, leftWhy: left?.why ?? null,
    textsAfterStop: left ? days.filter((x) => x.d > left.d).reduce((n, x) => n + (x.snap?.out ?? 0), 0) : 0,
    ideas: { total: last?.ideasTotal ?? 0, saved: last?.ideasSaved ?? 0, passed: last?.ideasPassed ?? 0, posted: last?.ideasPosted ?? 0 },
    rulesKept: last?.memory?.rules ?? [],
    probes: days.flatMap((x) => (x.probes ?? []).map((p) => ({ q: clip(p.q, 60), remembers: p.verdict?.remembers ?? null, invented: p.verdict?.invented ?? [] }))),
    lastWhy: [...days].reverse().find((x) => x.actor?.why)?.actor?.why ?? null,
    failedJobs: failedJobs.length, failedJobSamples: Array.from(new Set(failedJobs)).slice(0, 4),
  };
}

export const report = internalQuery({
  args: { season: v.string() },
  handler: async (ctx, a): Promise<Record<string, unknown> | null> => {
    const s = await readKey<SeasonState>(ctx, seasonKey(a.season));
    if (!s) return null;
    const rows: Array<Record<string, unknown>> = [];
    for (const runId of s.runs) {
      const st = await readKey<{ creatorId: Id<"creators">; persona: string; temperament?: string; tier?: string; days: number }>(ctx, `sim:${runId}:state`);
      if (!st) continue;
      const dayRows = await ctx.db.query("syncState").withIndex("by_key", (q) => q.gte("key", `sim:${runId}:day:`).lt("key", `sim:${runId}:day:~`)).collect();
      const days = dayRows.map((r) => JSON.parse(r.value) as Day).filter((x) => x.d > 0).sort((x, y) => x.d - y.d);
      const costs = (await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", st.creatorId)).take(8000)) as Doc<"costEvents">[];
      const model = costs.filter((c) => c.vendor !== "scrapecreators").reduce((n, c) => n + c.costUsd, 0);
      const credits = costs.filter((c) => c.vendor === "scrapecreators").reduce((n, c) => n + c.units, 0);
      rows.push({ runId, handle: st.persona, temperament: st.temperament, tier: st.tier, days: st.days, ...seasonRow(days, st.days), costUsd: Math.round(model * 100) / 100, credits });
    }
    const by = new Map<string, Array<Record<string, unknown>>>();
    for (const r of rows) by.set(String(r.temperament), [...(by.get(String(r.temperament)) ?? []), r]);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((x, y) => x + y, 0) / xs.length) * 10) / 10 : null);
    return {
      season: a.season, days: s.days, planned: s.planned.length, started: s.runs.length,
      byTemperament: PERSONAS.map((p) => p.id).filter((id) => by.has(id)).map((id) => {
        const rs = by.get(id)!;
        return { temperament: id, n: rs.length, left: rs.filter((r) => r.leftDay !== null).length, askedLess: rs.reduce((n, r) => n + Number(r.askedLess) + Number(r.paused), 0), moodLast: avg(rs.map((r) => r.moodLast as number | null).filter((m): m is number => m !== null)) };
      }),
      creators: rows,
    };
  },
});

// ------------------------------------------------------------------ taste: is the work good?

export const TASTE_PROMPT = `You are a sharp, experienced TikTok content strategist reviewing the work an assistant named Maya sent one creator. You get who the creator is (their lane, a summary, their own recent captions with views) and a numbered list of what she sent: content ideas, trend picks, caption and sound suggestions for a video they filmed, week plans, and short check-in texts.

Grade each item as a demanding coach would, for THIS creator, today. Be strict: most assistant output is generic. Score:
- good 0–3: 0 = useless or wrong, 1 = generic (could be sent to anyone in the lane), 2 = solid and specific to them, 3 = genuinely sharp: you'd be proud to have sent it.
- tacky (true/false): cringe, try-hard, cheesy, hashtag-bait, forced hype, "AI voice" (em-dash-laden, "game-changer", "level up", emoji soup), or a trend a creator their age and lane would be embarrassed to do.
- filmable (true/false, ideas/trends only, else null): could they film it this week with what they have?
- fits (0–2): 0 = not them, 1 = loosely, 2 = clearly their lane and voice.
- flag: one of "", "generic", "tacky", "wrong", "repeat", "too long", "not them", "unclear", "pushy".
- note: ≤ 100 chars, the one thing a coach would say.

Return ONLY JSON: {"items": [{"n": 1, "good": 0-3, "tacky": bool, "filmable": bool|null, "fits": 0-2, "flag": "", "note": ""}], "overall": "two honest sentences on her work for this creator"}`;

export type TasteItem = { n: number; type: "idea" | "trend" | "caption" | "sound" | "plan" | "morning" | "other"; day: number; text: string };

export const tasteInputs = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; about: string; captions: string; items: TasteItem[] } | null> => {
    const st = await readKey<{ creatorId: Id<"creators">; t0?: number; startedAt: number; days: number }>(ctx, `sim:${a.runId}:state`);
    if (!st) return null;
    const c = (await ctx.db.get(st.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const dossier = c.dossier as { lane?: string; persona?: { summary?: string } } | undefined;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", st.creatorId)).order("desc").take(12)) as Doc<"ownPosts">[];
    // Day of the season an item landed on: the world was aged, so measure from the creator's own clock (createdAt moved with it).
    const day = (ts: number) => Math.max(1, Math.ceil((ts - c.createdAt) / D));
    const items: Omit<TasteItem, "n">[] = [];
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", st.creatorId)).take(2000)) as Doc<"messages">[];
    for (const m of msgs.filter((x) => x.direction === "out" && x.proactive)) {
      const kind = m.kind ?? "";
      const type: TasteItem["type"] = /scout|idea|trend/.test(kind) ? "idea" : /plan/.test(kind) ? "plan" : /morning/.test(kind) ? "morning" : "other";
      items.push({ type, day: day(m.ts), text: clip(`[${kind}] ${m.body}`, 700) });
    }
    for (const f of (await ctx.db.query("finishes").withIndex("by_creator", (q) => q.eq("creatorId", st.creatorId)).take(200)) as Doc<"finishes">[]) {
      if (f.captions.length) items.push({ type: "caption", day: day(f.createdAt), text: clip(`captions for a video they filmed: ${f.captions.map((x, i) => `${i + 1}. ${x.text}`).join(" | ")}`, 600) });
      if (f.sounds.length) items.push({ type: "sound", day: day(f.createdAt), text: clip(`sounds for that video: ${f.sounds.map((x) => `${x.name} (${x.why}; ${x.howToUse})`).join(" | ")}`, 600) });
    }
    for (const t of c.trendPicks ?? []) if (t.verdict !== "skip") items.push({ type: "trend", day: day(t.at), text: clip(`trend pick (${t.verdict}): ${t.hook}${t.onScreenText ? ` · on screen: ${t.onScreenText}` : ""} · why: ${t.why}`, 500) });
    items.sort((x, y) => x.day - y.day);
    return {
      creatorId: st.creatorId,
      about: clip(`lane: ${dossier?.lane ?? c.niche ?? "?"}. ${dossier?.persona?.summary ?? ""}`, 700),
      captions: posts.map((p) => `- ${clip(p.caption.split("\n")[0], 120)} (${p.metrics.views} views${p.multiple ? `, ${p.multiple}× their normal` : ""})`).join("\n"),
      items: items.map((x, n) => ({ ...x, n: n + 1 })),
    };
  },
});

export const saveTaste = internalMutation({
  args: { season: v.string(), runId: v.string(), result: v.any() },
  handler: async (ctx, a): Promise<null> => { await writeKey(ctx, tasteKey(a.season, a.runId), a.result); return null; },
});

/** Pure: the grader's JSON, kept to what the report reads. */
export function parseTaste(raw: string): { items: Array<{ n: number; good: number; tacky: boolean; filmable: boolean | null; fits: number; flag: string; note: string }>; overall: string } {
  let j: { items?: unknown[]; overall?: unknown } = {};
  try { j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { /* an unreadable grade is no grade */ }
  const num = (x: unknown, hi: number) => Math.max(0, Math.min(hi, Math.round(Number(x) || 0)));
  return {
    items: (Array.isArray(j.items) ? j.items : []).map((x) => x as Record<string, unknown>).map((x) => ({ n: num(x.n, 9999), good: num(x.good, 3), tacky: x.tacky === true, filmable: typeof x.filmable === "boolean" ? x.filmable : null, fits: num(x.fits, 2), flag: String(x.flag ?? "").slice(0, 20), note: clip(String(x.note ?? ""), 120) })),
    overall: clip(String(j.overall ?? ""), 400),
  };
}

async function gradeRun(ctx: ActionCtx, season: string, runId: string): Promise<{ graded: number }> {
  const i = await ctx.runQuery(internal.eval.season.tasteInputs, { runId });
  if (!i || !i.items.length) return { graded: 0 };
  const graded: Array<TasteItem & ReturnType<typeof parseTaste>["items"][number]> = [];
  const overall: string[] = [];
  // Batches of 12 so the grader sees context without losing the thread.
  for (let k = 0; k < i.items.length; k += 12) {
    const batch = i.items.slice(k, k + 12);
    const r = await callModel(ctx, { creatorId: i.creatorId, purpose: "season_taste", model: tasteModel(), temperature: 0, maxTokens: 2000, apiKey: process.env.OPENROUTER_API_KEY ?? "", messages: [
      { role: "system", content: TASTE_PROMPT },
      { role: "user", content: `The creator: ${i.about}\n\nTheir own recent posts:\n${i.captions}\n\nWhat she sent (day of the season, type, text):\n${batch.map((x) => `${x.n}. day ${x.day} · ${x.type}: ${x.text}`).join("\n")}` },
    ] });
    if (!r.ok) continue;
    const out = parseTaste(r.content);
    if (out.overall) overall.push(out.overall);
    for (const g of out.items) { const it = batch.find((x) => x.n === g.n); if (it) graded.push({ ...it, ...g }); }
  }
  await ctx.runMutation(internal.eval.season.saveTaste, { season, runId, result: { graded, overall } });
  return { graded: graded.length };
}

export const judgeTaste = internalAction({
  args: { season: v.string(), runId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ runs: number }> => {
    const s = await ctx.runQuery(internal.eval.season.readSeason, { season: a.season });
    if (!s) return { runs: 0 };
    const runs = a.runId ? [a.runId] : s.runs;
    // One action per creator: grading a whole season in one action would outrun the ten-minute limit.
    for (const [k, runId] of runs.entries()) await ctx.scheduler.runAfter(k * 5_000, internal.eval.season.judgeOne, { season: a.season, runId });
    return { runs: runs.length };
  },
});

export const judgeOne = internalAction({
  args: { season: v.string(), runId: v.string() },
  handler: async (ctx, a): Promise<{ graded: number }> => await gradeRun(ctx, a.season, a.runId),
});

/** The grades, per creator and per type of work, plus the worst and best examples to read. */
export const taste = internalQuery({
  args: { season: v.string() },
  handler: async (ctx, a): Promise<Record<string, unknown> | null> => {
    const s = await readKey<SeasonState>(ctx, seasonKey(a.season));
    if (!s) return null;
    type G = TasteItem & { good: number; tacky: boolean; filmable: boolean | null; fits: number; flag: string; note: string };
    const all: Array<G & { runId: string; temperament?: string }> = [];
    const overall: Record<string, string[]> = {};
    for (const runId of s.runs) {
      const t = await readKey<{ graded: G[]; overall: string[] }>(ctx, tasteKey(a.season, runId));
      const st = await readKey<{ temperament?: string; persona: string }>(ctx, `sim:${runId}:state`);
      if (!t) continue;
      overall[`${st?.persona} (${st?.temperament})`] = t.overall;
      all.push(...t.graded.map((g) => ({ ...g, runId, temperament: st?.temperament })));
    }
    const summarize = (xs: G[]) => ({
      n: xs.length,
      good: xs.length ? Math.round((xs.reduce((n, x) => n + x.good, 0) / xs.length) * 100) / 100 : null,
      sharp: xs.filter((x) => x.good === 3).length, solid: xs.filter((x) => x.good === 2).length, generic: xs.filter((x) => x.good === 1).length, useless: xs.filter((x) => x.good === 0).length,
      tacky: xs.filter((x) => x.tacky).length,
      notFilmable: xs.filter((x) => x.filmable === false).length,
      notThem: xs.filter((x) => x.fits === 0).length,
      flags: xs.reduce<Record<string, number>>((acc, x) => (x.flag ? ((acc[x.flag] = (acc[x.flag] ?? 0) + 1), acc) : acc), {}),
    });
    const types = ["idea", "trend", "caption", "sound", "plan", "morning", "other"] as const;
    // Does the work hold up over the months, or go stale? Average grade by month of the season.
    const byMonth = [0, 1, 2, 3, 4, 5].map((m) => all.filter((x) => x.day > m * 30 && x.day <= (m + 1) * 30)).filter((xs) => xs.length).map((xs) => summarize(xs).good);
    return {
      season: a.season,
      all: summarize(all),
      byType: Object.fromEntries(types.map((t) => [t, summarize(all.filter((x) => x.type === t))]).filter(([, v]) => (v as { n: number }).n)),
      byMonth,
      tackiest: all.filter((x) => x.tacky).slice(0, 12).map((x) => ({ type: x.type, day: x.day, text: clip(x.text, 260), note: x.note })),
      worst: all.filter((x) => x.good === 0).slice(0, 10).map((x) => ({ type: x.type, text: clip(x.text, 260), note: x.note })),
      best: all.filter((x) => x.good === 3).slice(0, 10).map((x) => ({ type: x.type, text: clip(x.text, 260), note: x.note })),
      overall,
    };
  },
});

/** Dev: every text she sent a season's creators, through the code number check (core/numbers), flagged ones listed. */
export const numberAudit = internalQuery({
  args: { season: v.string() },
  handler: async (ctx, a): Promise<{ texts: number; withClaims: number; flagged: Array<{ who: string; kind: string; bad: string[]; text: string }> }> => {
    const s = await readKey<SeasonState>(ctx, seasonKey(a.season));
    if (!s) return { texts: 0, withClaims: 0, flagged: [] };
    let texts = 0, withClaims = 0;
    const flagged: Array<{ who: string; kind: string; bad: string[]; text: string }> = [];
    for (const runId of s.runs) {
      const st = await readKey<{ creatorId: Id<"creators">; persona: string }>(ctx, `sim:${runId}:state`);
      if (!st) continue;
      const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", st.creatorId)).order("desc").take(300)) as Doc<"ownPosts">[];
      const normals = normalsByPlatform(posts, Date.now());
      const counts = posts.flatMap((p) => [p.metrics.views, p.metrics.likes, p.metrics.comments, p.metrics.shares, p.metrics.saves ?? 0]).filter((n) => n > 0);
      for (const n of normals.values()) if (n) counts.push(n.value);
      const multiples = posts.flatMap((p) => [multipleFor(p, normals), p.multiple, p.reachMultiple]).filter((m): m is number => typeof m === "number");
      const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", st.creatorId)).take(2000)) as Doc<"messages">[];
      const theirs = numbersIn(msgs.filter((m) => m.direction === "in").map((m) => m.body).join(" "));
      for (const m of msgs.filter((x) => x.direction === "out")) {
        texts++;
        const c = claimsIn(m.body);
        if (!c.length) continue;
        withClaims++;
        const bad = unbacked(c, { counts, multiples, free: theirs });
        if (bad.length) flagged.push({ who: st.persona, kind: m.kind ?? "?", bad: bad.map((b) => b.text), text: m.body.slice(0, 220) });
      }
    }
    return { texts, withClaims, flagged };
  },
});
