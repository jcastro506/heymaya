/**
 * L1, the living simulation (plan "L1"): months of one creator, compressed, so we can watch Maya
 * work: grow, change her suggestions, learn the person, remember, and change course.
 *
 * How it stays real:
 * - REAL HISTORY, REPLAYED. A scenario persona is cloned; her real posts after the start date are
 *   held back and released on the simulated day they really went out, with their real numbers.
 * - THE CLOCK MOVES BY AGEING THE WORLD. Maya's code reads the real clock, so instead of faking
 *   time, every simulated day shifts each of the clone's rows (every timestamp in every table that
 *   belongs to her, and the creator row) one day into the past. Maya's own daily jobs then run
 *   unchanged: scout, the human cadence, the week plan, the Sunday review, finish lessons, deals.
 * - A CREATOR ACTOR. A model plays her from her own captions and a hidden life script (a race, a
 *   slump, a rule, a brand DM, a shift in what she likes). She replies or ignores, saves or passes
 *   ideas, and before some real posts go out she sends the video as a camera-roll draft, so B7's
 *   loop (captions offered → what she really posted) runs on what she actually wrote.
 * - MEASURED DAILY, PROBED AT THE END. A snapshot per day (messages, ideas, memory, taste, lane,
 *   caps, cost) and probes that only a real memory can answer, judged.
 *
 * Isolation: the clone is an `eval-run:` creator, so no text is delivered to anyone and the fleet
 * crons skip it; every mutation here refuses a creator that isn't a sim clone.
 * Run: `eval/livingSim:start {"persona":"eval:vanessaalopezz","days":42}`; read `eval/livingSim:report {"runId"}`.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { parseJson } from "../agent/opinion";
import { TABLES_BY_CREATOR } from "../account/deletion";
import { applyIdeaAct } from "../core/ideaActs";
import { tiktok } from "../integrations/scrapeCreators/platforms/tiktok";
import { THRESHOLDS } from "../config/thresholds";
import { clip } from "../lib/clip";

const D = 86_400_000;
const STEP_GAP_MS = 5_000;

// ------------------------------------------------------------------ pure helpers

/** Pure: shift every epoch-ms number (a plausible timestamp) inside a value by `delta`. Ids are strings; durations are small. */
export function shiftTimes<T>(value: T, delta: number, now: number): T {
  const lo = Date.UTC(2015, 0, 1), hi = now + 400 * D;
  const walk = (x: unknown): unknown => {
    if (typeof x === "number") return Number.isFinite(x) && x >= lo && x <= hi ? x + delta : x;
    // Day keys ("2026-09-24", "morning:2026-09-24"): the daily budget row and dedupe keys move with the day.
    if (typeof x === "string" && delta % D === 0 && x.length <= 200 && !x.includes("http")) return x.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => { const t = Date.parse(`${m}T00:00:00Z`); return Number.isFinite(t) ? new Date(t + delta).toISOString().slice(0, 10) : m; });
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      if (x instanceof ArrayBuffer) return x;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) out[k] = k.startsWith("_") ? val : walk(val);
      return out;
    }
    return x;
  };
  return walk(value) as T;
}

/** Pure: a small deterministic PRNG so a run is repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface LifeEvent { day: number; text: string; kind: "life" | "rule" | "slump" | "brand" | "shift" | "probe" }

/** Pure: the hidden life script, spread over the run's length. Probes land at the end. */
export function lifeScript(days: number): LifeEvent[] {
  const at = (f: number) => Math.max(1, Math.round(days * f));
  return [
    { day: at(0.07), kind: "life", text: "doing the gold coast half marathon in a few weeks, kinda nervous ngl" },
    { day: at(0.18), kind: "rule", text: "pls don't suggest dance trends, i hate filming those" },
    { day: at(0.3), kind: "slump", text: "views have been so dead lately. maybe running content is done?" },
    { day: at(0.42), kind: "life", text: "my sister's visiting next week, she films way better than me" },
    { day: at(0.5), kind: "life", text: "I RAN IT. 1:52. legs are gone" },
    { day: at(0.6), kind: "brand", text: "a hydration brand dmed me offering free product for a post. worth it?" },
    { day: at(0.72), kind: "shift", text: "honestly i've been liking making the travel stuff more than the running stuff lately" },
    { day: days - 2, kind: "probe", text: "ok real question, what do you actually know about me at this point?" },
    { day: days - 1, kind: "probe", text: "do you remember the race i told you about? how'd it go?" },
    { day: days, kind: "probe", text: "what's changed in what you suggest to me compared to when we started?" },
  ];
}

// ------------------------------------------------------------------ guards + state

async function simCreator(ctx: MutationCtx, creatorId: Id<"creators">): Promise<Doc<"creators">> {
  const c = (await ctx.db.get(creatorId)) as Doc<"creators"> | null;
  if (!c || !c.clerkUserId.startsWith("eval-run:sim-")) throw new Error("only a living-sim clone");
  return c;
}

type Future = { offsetMs: number; doc: Record<string, unknown> };
type LanePost = { postId: string; url: string; createTime: number; views: number; clipId: string | null; paid: boolean };
type LaneAccount = { handle: string; trackedAccountId: Id<"trackedAccounts">; posts: LanePost[] };
type State = { runId: string; creatorId: Id<"creators">; persona: string; days: number; startedAt: number; seed: number; future: Future[]; releasedDraftPostIds: string[]; t0?: number; lane?: LaneAccount[] };
const stateKey = (runId: string) => `sim:${runId}:state`;
const dayKey = (runId: string, d: number) => `sim:${runId}:day:${String(d).padStart(3, "0")}`;

export const readState = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<State | null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", stateKey(a.runId))).unique();
    return row ? (JSON.parse(row.value) as State) : null;
  },
});

async function writeKey(ctx: MutationCtx, key: string, value: unknown): Promise<void> {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const json = JSON.stringify(value);
  if (row) await ctx.db.patch(row._id, { value: json, updatedAt: Date.now() });
  else await ctx.db.insert("syncState", { key, value: json, updatedAt: Date.now() });
}

export const writeState = internalMutation({
  args: { runId: v.string(), state: v.any() },
  handler: async (ctx, a): Promise<null> => { await writeKey(ctx, stateKey(a.runId), a.state); return null; },
});

// ------------------------------------------------------------------ setup

export const prepare = internalMutation({
  args: { creatorId: v.id("creators"), days: v.number(), runId: v.string(), persona: v.string(), seed: v.number() },
  handler: async (ctx, a): Promise<{ held: number; kept: number; days: number }> => {
    const c = await simCreator(ctx, a.creatorId);
    const now = Date.now();
    const all = ((await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ownPosts">[]).map((p) => p.createTime).sort((x, y) => x - y);
    // Start where her real posting begins: at least 10 posts of history before day 1, so Maya has something to know.
    const t0 = Math.max(now - a.days * D, all.length > 10 ? all[9] + 1 : now - a.days * D);
    const days = Math.max(3, Math.ceil((now - t0) / D));
    // Paired (so her rails allow texting) but with no chat or phone: an eval-run creator is never delivered to.
    await ctx.db.patch(a.creatorId, { plan: { ...c.plan, status: "comped", tier: "partner" }, channel: { ...c.channel, paired: true }, firstWeek: undefined });
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ownPosts">[];
    const future: Future[] = [];
    for (const p of posts) {
      if (p.createTime > t0) {
        const { _id, _creationTime, embedding, embeddedText, ...doc } = p;
        void _creationTime; void embedding; void embeddedText; // large, and re-derived by her own jobs
        future.push({ offsetMs: p.createTime - t0, doc: doc as Record<string, unknown> });
        await ctx.db.delete(_id);
      }
    }
    future.sort((x, y) => x.offsetMs - y.offsetMs);
    await writeKey(ctx, stateKey(a.runId), { runId: a.runId, creatorId: a.creatorId, persona: a.persona, days, startedAt: now, seed: a.seed, future, releasedDraftPostIds: [], t0 } satisfies State);
    return { held: future.length, kept: posts.length - future.length, days };
  },
});

/**
 * Each per-creator table's index that starts with `creatorId`. Ageing reads through these: a
 * `.filter` on creatorId scans the whole table (costEvents, messages) and hits Convex's read limit
 * on a busy deployment, the same failure the load test's cleanup had (2026-09-24). Tables with no
 * creator index (oauth states, the eval ledgers) are not aged: nothing in a day's jobs reads them.
 */
export const CREATOR_INDEX: Record<(typeof TABLES_BY_CREATOR)[number], string | null> = {
  partnershipProfiles: "by_creator", partnershipOpportunities: "by_creator", partnershipDrafts: "by_creator", partnershipEvents: "by_creator", partnershipResearch: "by_creator", partnershipMailboxes: "by_creator",
  trackedAccounts: "by_creator", ownPosts: "by_creator", ownPostReads: "by_creator", signals: "by_creator", ideas: "by_creator", predictions: "by_creator",
  calendarBlocks: "by_creator", calendarEvents: "by_creator_start", tasteEvents: "by_creator", oauthStates: null, connections: "by_creator", directives: "by_creator",
  messages: "by_creator", jobs: "by_creator", budgets: "by_creator_day", costEvents: "by_creator_at", memories: "by_creator_ref", personalRecords: "by_creator",
  finishes: "by_creator", laneReads: "by_token", followerSnapshots: "by_creator_day", accountInsights: "by_creator_kind", evalRuns: null, evalLabels: null,
  userActions: "by_creator_at", schedule: "by_creator",
};

/**
 * Shift one table's rows for a sim creator by `delta` (the creator row itself with table "creators").
 * The caller has already checked the creator is a simulation's. A running job keeps its lease: moving
 * its deadline a day into the past would hand it to the reaper and run it twice.
 */
export async function ageCreatorTable(ctx: MutationCtx, c: Doc<"creators">, tableName: string, delta: number): Promise<number> {
  const now = Date.now();
  if (tableName === "creators") {
    const { _id, _creationTime, ...rest } = c;
    void _creationTime;
    await ctx.db.replace(_id, shiftTimes(rest, delta, now) as never);
    return 1;
  }
  const table = tableName as (typeof TABLES_BY_CREATOR)[number];
  const index = CREATOR_INDEX[table];
  if (!index) return 0;
  const q = ctx.db.query(table) as unknown as { withIndex: (i: string, f: (q: { eq: (k: string, v: unknown) => unknown }) => unknown) => { take: (n: number) => Promise<Array<Record<string, unknown>>> } };
  const rows = await q.withIndex(index, (x) => x.eq("creatorId", c._id)).take(4000);
  let n = 0;
  for (const r of rows) {
    if (table === "jobs" && r.status === "running") continue;
    const { _id, _creationTime, ...rest } = r as Record<string, unknown> & { _id: string; _creationTime: number };
    void _creationTime;
    await ctx.db.replace(_id as never, shiftTimes(rest, delta, now) as never);
    n++;
  }
  return n;
}

/** Shift one table's rows for the clone by `delta` (and the creator row with table "creators"). */
export const ageTable = internalMutation({
  args: { creatorId: v.id("creators"), table: v.string(), delta: v.number() },
  handler: async (ctx, a): Promise<number> => await ageCreatorTable(ctx, await simCreator(ctx, a.creatorId), a.table, a.delta),
});

async function ageWorld(ctx: ActionCtx, creatorId: Id<"creators">, delta: number): Promise<void> {
  await ctx.runMutation(internal.eval.livingSim.ageTable, { creatorId, table: "creators", delta });
  for (const table of TABLES_BY_CREATOR) await ctx.runMutation(internal.eval.livingSim.ageTable, { creatorId, table, delta });
}

export const releasePost = internalMutation({
  args: { creatorId: v.id("creators"), doc: v.any(), createTime: v.number() },
  handler: async (ctx, a): Promise<Id<"ownPosts">> => {
    await simCreator(ctx, a.creatorId);
    const orig = a.doc as Record<string, unknown> & { createTime: number };
    // Everything dated on the post (its view history, when its numbers were read) moves with it.
    const doc = { ...shiftTimes(orig, a.createTime - orig.createTime, Date.now()), creatorId: a.creatorId, createTime: a.createTime, metricsAsOf: Date.now() };
    return await ctx.db.insert("ownPosts", doc as never);
  },
});

export const actOnIdea = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), act: v.union(v.literal("save"), v.literal("pass")) },
  handler: async (ctx, a): Promise<boolean> => {
    await simCreator(ctx, a.creatorId);
    return (await applyIdeaAct(ctx, a.creatorId, a.ideaId, a.act, { origin: "app" })).ok;
  },
});

// ------------------------------------------------------------------ the run

export const start = internalAction({
  args: { persona: v.string(), days: v.number(), seed: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ runId: string; held: number; kept: number; days: number }> => {
    if (a.days < 3 || a.days > 180) throw new Error("days must be 3–180");
    const runId = `sim-${Date.now()}`;
    const source = await ctx.runQuery(internal.eval.expertBench.personaSource, { clerkUserId: a.persona });
    if (!source) throw new Error(`persona ${a.persona} is missing`);
    const creatorId = await ctx.runMutation(internal.eval.scenarios.cloneForRun, { sourceId: source, runId });
    // Enough real history to replay: page back through her TikTok until it covers the run.
    const handle = await ctx.runQuery(internal.account.setup.handlesFor, { creatorId });
    if (handle?.tiktok) await ctx.runAction(internal.eval.livingSim.deepen, { creatorId, handle: handle.tiktok, days: a.days });
    const r = await ctx.runMutation(internal.eval.livingSim.prepare, { creatorId, days: a.days, runId, persona: a.persona, seed: a.seed ?? 7 });
    // The accounts she watches, replayed too: their real posts, released day by day (a live lane is silent
    // when a simulated day is five real minutes).
    const lane = await ctx.runAction(internal.eval.livingSim.fetchLane, { creatorId, since: Date.now() - (r.days + 45) * D });
    const s0 = await ctx.runQuery(internal.eval.livingSim.readState, { runId });
    await ctx.runMutation(internal.eval.livingSim.writeState, { runId, state: { ...s0, lane } });
    // Day 0: the world moves forward so the start date is "now"; each day then ages it one day back.
    await ageWorld(ctx, creatorId, r.days * D);
    await ctx.scheduler.runAfter(0, internal.eval.livingSim.dayWorld, { runId, d: 1 });
    return { runId, ...r };
  },
});

/** Phase A: a day passes; her real posts from that day go out (some first as a draft for captions). */
export const dayWorld = internalAction({
  args: { runId: v.string(), d: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const s = await ctx.runQuery(internal.eval.livingSim.readState, { runId: a.runId });
    if (!s) return null;
    await ageWorld(ctx, s.creatorId, -D);
    const now = Date.now();
    const due = s.future.filter((f) => f.offsetMs <= a.d * D);
    const rand = rng(s.seed * 1000 + a.d);
    const notes: string[] = [];
    for (const f of due) {
      const doc = f.doc as { url?: string; caption?: string; postId?: string };
      let drafted = false;
      // Some real posts arrive first as a camera-roll draft: Maya finishes it, then the real caption goes out.
      if (doc.url && rand() < 0.35) {
        try {
          const { messageId } = await ctx.runAction(internal.eval.expertBench.sendDraft, { creatorId: s.creatorId, url: doc.url, body: rand() < 0.5 ? "caption + sound for this one? posting later" : "" });
          const r = await ctx.runAction(internal.agent.finish.run, { creatorId: s.creatorId, messageId });
          notes.push(`draft ${doc.postId}: ${r.reason ?? (r.ok ? "finished" : "failed")}`);
          drafted = true;
        } catch (e) {
          notes.push(`draft ${doc.postId} skipped: ${e instanceof Error ? clip(e.message, 80) : "error"}`);
        }
      }
      // A drafted post goes out after the draft (as it would in life); the rest at their real time of day.
      await ctx.runMutation(internal.eval.livingSim.releasePost, { creatorId: s.creatorId, doc: f.doc, createTime: drafted ? Date.now() : now - (a.d * D - f.offsetMs) });
    }
    // The lane's posts from this day: a post well above its account's normal becomes a breakout for her.
    let laneReleased = 0, breakouts = 0;
    const t0 = s.t0 ?? s.startedAt - s.days * D;
    for (const acct of s.lane ?? []) {
      const today = acct.posts.filter((p) => p.createTime > t0 + (a.d - 1) * D && p.createTime <= t0 + a.d * D);
      laneReleased += today.length;
      const candidates = today.flatMap((p) => {
        const prior = acct.posts.filter((x) => x.createTime < p.createTime).sort((x, y) => y.createTime - x.createTime).slice(0, 20).map((x) => x.views).sort((x, y) => x - y);
        if (prior.length < 8 || p.paid) return [];
        const normal = prior[Math.floor(prior.length / 2)];
        const ratio = normal > 0 ? Math.round((p.views / normal) * 100) / 100 : 0;
        return ratio >= BREAKOUT_RATIO ? [{ postId: p.postId, url: p.url, ratio, views: p.views, ageHours: 20, clipId: p.clipId }] : [];
      });
      if (candidates.length) breakouts += (await ctx.runMutation(internal.scout.sampler.writeBreakouts, { trackedAccountId: acct.trackedAccountId, creatorId: s.creatorId, candidates, now: Date.now() })).written;
    }
    notes.push(`lane: ${laneReleased} posts, ${breakouts} breakouts`);
    await ctx.runMutation(internal.eval.livingSim.writeState, { runId: a.runId, state: { ...s, future: s.future.filter((f) => f.offsetMs > a.d * D) } });
    await ctx.runMutation(internal.eval.livingSim.note, { runId: a.runId, d: a.d, patch: { released: due.length, world: notes } });
    await ctx.scheduler.runAfter(STEP_GAP_MS, internal.eval.livingSim.dayMaya, { runId: a.runId, d: a.d, dayStart: now });
    return null;
  },
});

/** Phase B: Maya's own daily jobs for this creator, exactly the functions the crons fan out to. */
export const dayMaya = internalAction({
  args: { runId: v.string(), d: v.number(), dayStart: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const s = await ctx.runQuery(internal.eval.livingSim.readState, { runId: a.runId });
    if (!s) return null;
    const id = s.creatorId;
    const now = Date.now();
    const jobs: Record<string, string> = {};
    const step = async (name: string, f: () => Promise<{ sent?: boolean; reason?: string } | unknown>) => {
      try {
        const r = (await f()) as { sent?: boolean; reason?: string } | null;
        jobs[name] = r && typeof r === "object" && "reason" in r ? clip(`${r.sent ? "sent" : "held"}: ${String(r.reason ?? "")}`, 120) : "ran";
      } catch (e) {
        jobs[name] = `failed: ${e instanceof Error ? clip(e.message, 100) : "error"}`;
      }
    };
    // Her lane's keyword tops (the fleet sweep skips eval creators; cached by keyword and week).
    await step("sweep", async () => { const r = await ctx.runAction(internal.scout.sweep.run, { creatorId: id }); return { sent: r.signals > 0, reason: `${r.keywords} keywords, ${r.signals} shapes, ${r.failed} failed` }; });
    await step("morning", () => ctx.runAction(internal.agent.cadence.morning, { creatorId: id, now }));
    await step("scout", () => ctx.runAction(internal.scout.scout.run, { creatorId: id }));
    if (a.d % 7 === 6) await step("weekPlan", () => ctx.runAction(internal.calendar.weekPlan.draft, { creatorId: id, now, horizon: "next_week" }));
    if (a.d % 7 === 0) await step("weeklyReview", () => ctx.runAction(internal.review.weekly.run, { creatorId: id }));
    if (a.d % 7 === 3) await step("dealsOffer", () => ctx.runAction(internal.partnerships.kit.offerOne, { creatorId: id }));
    await step("howDidItGo", () => ctx.runAction(internal.agent.cadence.howDidItGo, { creatorId: id, now }));
    await step("quiet", () => ctx.runAction(internal.agent.cadence.quiet, { creatorId: id, now }));
    const unlearned = await ctx.runQuery(internal.eval.livingSim.unlearnedFor, { creatorId: id });
    for (const f of unlearned) await step(`lesson:${String(f).slice(-4)}`, () => ctx.runAction(internal.agent.finish.learnOne, { finishId: f }));
    await ctx.runMutation(internal.eval.livingSim.note, { runId: a.runId, d: a.d, patch: { jobs } });
    await ctx.scheduler.runAfter(STEP_GAP_MS, internal.eval.livingSim.dayCreator, { runId: a.runId, d: a.d, dayStart: a.dayStart });
    return null;
  },
});

export const unlearnedFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Id<"finishes">[]> => {
    const rows = (await ctx.db.query("finishes").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(100)) as Doc<"finishes">[];
    return rows.filter((r) => !r.outcome).map((r) => r._id);
  },
});

/** The creator actor's instructions, for a creator on the platform(s) named ("TikTok", "Instagram", "TikTok and Instagram"). */
export function actorPromptFor(platforms: string): string {
  return `You are role-playing a real ${platforms} creator texting her social media expert, Maya. Stay in character: write exactly like the creator's own captions below (their case, emoji, slang, length). You are a busy person: you often ignore messages, reply briefly, sometimes enthusiastically. You never know you are in a simulation.
Given Maya's messages today and the ideas she sent, return ONLY JSON:
{"replies": [{"to": "the message id you're answering, or ''", "text": "your text, in your voice"}], "ideas": [{"ideaId": "", "act": "save|pass"}]}
Reply to at most 2 messages. It's fine and realistic to reply to none. Save an idea only if it genuinely fits what you'd film; pass on ones that don't.`;
}
export const ACTOR_PROMPT = actorPromptFor("TikTok");

/** Phase C: the creator lives her day (replies, taps, her life script), then the day is measured. */
export const dayCreator = internalAction({
  args: { runId: v.string(), d: v.number(), dayStart: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const s = await ctx.runQuery(internal.eval.livingSim.readState, { runId: a.runId });
    if (!s) return null;
    const id = s.creatorId;
    const rand = rng(s.seed * 7919 + a.d);
    const said: string[] = [];
    const today = await ctx.runQuery(internal.eval.livingSim.todayFromMaya, { creatorId: id, since: a.dayStart - 60_000 });
    const events = lifeScript(s.days).filter((e) => e.day === a.d);
    const probes: Array<{ q: string; a: string }> = [];
    // Her life first: things she'd text unprompted.
    for (const e of events) {
      const reply = await sayAndHear(ctx, id, e.text);
      said.push(e.text);
      if (e.kind === "probe") probes.push({ q: e.text, a: reply });
    }
    // Then her replies to Maya, in her voice, often none.
    if (today.messages.length && rand() < 0.7) {
      const voice = await ctx.runQuery(internal.eval.livingSim.voiceOf, { creatorId: id });
      const r = await callModel(ctx, { creatorId: id, purpose: "sim_actor", model: REGISTRY.writer.primary, messages: [{ role: "system", content: `${ACTOR_PROMPT}\n\nYour own captions:\n${voice}` }, { role: "user", content: JSON.stringify({ day: a.d, mayaToday: today.messages, ideasToday: today.ideas }) }], temperature: 0.8, maxTokens: 700, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      const out = r.ok ? parseJson<{ replies?: Array<{ text?: string }>; ideas?: Array<{ ideaId?: string; act?: string }> }>(r.content) : null;
      for (const rep of (out?.replies ?? []).slice(0, 2)) if (rep.text?.trim()) { await sayAndHear(ctx, id, clip(rep.text.trim(), 400)); said.push(rep.text.trim()); }
      for (const t of (out?.ideas ?? []).slice(0, 3)) {
        const idea = today.ideas.find((x) => x.id === t.ideaId);
        if (idea && (t.act === "save" || t.act === "pass")) await ctx.runMutation(internal.eval.livingSim.actOnIdea, { creatorId: id, ideaId: idea.id, act: t.act });
      }
    }
    const snap = await ctx.runQuery(internal.eval.livingSim.snapshot, { creatorId: id, since: a.dayStart - 60_000 });
    await ctx.runMutation(internal.eval.livingSim.note, { runId: a.runId, d: a.d, patch: { said, probes, snap } });
    if (a.d < s.days) await ctx.scheduler.runAfter(STEP_GAP_MS, internal.eval.livingSim.dayWorld, { runId: a.runId, d: a.d + 1 });
    else await ctx.scheduler.runAfter(STEP_GAP_MS, internal.eval.livingSim.judgeProbes, { runId: a.runId });
    return null;
  },
});

/** Her text through the same path a phone takes; returns Maya's reply text. */
async function sayAndHear(ctx: Parameters<typeof callModel>[0], creatorId: Id<"creators">, text: string): Promise<string> {
  const c = ctx as unknown as { runMutation: (f: unknown, a: unknown) => Promise<{ messageId: Id<"messages"> }>; runAction: (f: unknown, a: unknown) => Promise<unknown>; runQuery: (f: unknown, a: unknown) => Promise<Array<{ text: string }>> };
  const since = Date.now();
  const { messageId } = await c.runMutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: text });
  try {
    await c.runAction(internal.agent.converse.run, { creatorId, messageId });
  } catch {
    return "(no reply: the turn failed)";
  }
  const replies = await c.runQuery(internal.eval.converse.repliesTo, { creatorId, inboundId: messageId, since });
  return replies.map((r) => r.text).join("\n---\n");
}

export const todayFromMaya = internalQuery({
  args: { creatorId: v.id("creators"), since: v.number() },
  handler: async (ctx, a): Promise<{ messages: Array<{ id: string; kind: string; text: string }>; ideas: Array<{ id: Id<"ideas">; hook: string }> }> => {
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.since)).take(40)) as Doc<"messages">[];
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(10)) as Doc<"ideas">[];
    return {
      messages: msgs.filter((m) => m.direction === "out" && m.proactive).map((m) => ({ id: m._id, kind: m.kind ?? "", text: clip(m.body, 600) })),
      ideas: ideas.filter((i) => i.createdAt >= a.since).map((i) => ({ id: i._id, hook: clip((i.version as { hook?: string } | undefined)?.hook ?? i.messageText, 140) })),
    };
  },
});

export const voiceOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<string> => {
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(15)) as Doc<"ownPosts">[];
    return posts.map((p) => `- ${clip(p.caption.split("\n")[0], 160)}`).join("\n");
  },
});

/** One day, measured from rows. */
export const snapshot = internalQuery({
  args: { creatorId: v.id("creators"), since: v.number() },
  handler: async (ctx, a): Promise<Record<string, unknown>> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return {};
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.since)).take(200)) as Doc<"messages">[];
    const out = msgs.filter((m) => m.direction === "out");
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(500)) as Doc<"ideas">[];
    const records = (await ctx.db.query("personalRecords").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(500)) as Doc<"personalRecords">[];
    const directives = (await ctx.db.query("directives").withIndex("by_creator_and_active", (q) => q.eq("creatorId", a.creatorId).eq("active", true)).take(100)) as Doc<"directives">[];
    // Through the creator index (a filter scan over costEvents reads the whole ledger and hits the read limit).
    const costs = (await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", a.creatorId).gte("at", Date.now() - 30 * 60_000)).take(500)) as Array<{ costUsd?: number }>;
    const finishes = (await ctx.db.query("finishes").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(200)) as Doc<"finishes">[];
    const d = c.dossier as { lane?: string; persona?: { summary?: string } } | undefined;
    return {
      out: out.length,
      outProactive: out.filter((m) => m.proactive).length,
      outKinds: out.map((m) => m.kind ?? "?"),
      in: msgs.filter((m) => m.direction === "in").length,
      ideasTotal: ideas.length,
      ideasSent: ideas.filter((i) => i.createdAt >= a.since).map((i) => clip((i.version as { hook?: string } | undefined)?.hook ?? "", 90)),
      ideasSaved: ideas.filter((i) => i.savedAt).length,
      ideasPassed: ideas.filter((i) => i.status === "passed").length,
      ideasPosted: ideas.filter((i) => i.status === "posted").length,
      memory: { records: records.filter((r) => r.active).length, byKind: records.filter((r) => r.active).reduce<Record<string, number>>((acc, r) => ((acc[r.kind] = (acc[r.kind] ?? 0) + 1), acc), {}), notes: (c.notes ?? []).filter((n) => !n.tombstonedAt).length, rules: directives.map((r) => clip(r.verbatim, 80)) },
      lane: clip(d?.lane ?? c.niche ?? "", 160),
      taste: clip(c.taste?.text ?? "", 220),
      finishes: finishes.length,
      captionLessons: finishes.filter((f) => f.outcome?.lesson).map((f) => clip(f.outcome!.lesson, 120)),
      costUsdLast30m: Math.round(costs.reduce((s, x) => s + (x.costUsd ?? 0), 0) * 1000) / 1000,
    };
  },
});

export const note = internalMutation({
  args: { runId: v.string(), d: v.number(), patch: v.any() },
  handler: async (ctx, a): Promise<null> => {
    const key = dayKey(a.runId, a.d);
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
    const prev = row ? (JSON.parse(row.value) as Record<string, unknown>) : { d: a.d };
    await writeKey(ctx, key, { ...prev, ...(a.patch as Record<string, unknown>) });
    return null;
  },
});

export const PROBE_JUDGE = `You judge whether an assistant named Maya, after weeks of texting one creator, answers from a real memory of THIS person. You get the creator's hidden life script (what really happened, with days), her records (what she learned from their profile, posts and messages), the question, and Maya's answer. A fact in her records is not invented. Return ONLY JSON: {"remembers": 0|1|2, "invented": ["anything stated that the script and her records don't support"], "note": "≤160"}. 2 = specific and right, 1 = partly, 0 = generic or wrong.`;

export const judgeProbes = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const s = await ctx.runQuery(internal.eval.livingSim.readState, { runId: a.runId });
    if (!s) return null;
    const days = await ctx.runQuery(internal.eval.livingSim.days, { runId: a.runId });
    const script = lifeScript(s.days);
    // Her real records too: a true fact from their profile or posts is not an invention (sim 1's judge flagged one).
    const known = await ctx.runQuery(internal.eval.expertBench.postsByPlatform, { creatorId: s.creatorId });
    const records = { whatSheKnowsAboutThem: (known as { whatSheKnowsAboutThem?: unknown }).whatSheKnowsAboutThem, whatTheyToldHer: (known as { whatTheyToldHer?: unknown }).whatTheyToldHer };
    for (const day of days) {
      const probes = (day.probes as Array<{ q: string; a: string }> | undefined) ?? [];
      const judged = [];
      for (const p of probes) {
        const r = await callModel(ctx, { creatorId: s.creatorId, purpose: "sim_probe_judge", model: REGISTRY.writer.primary, messages: [{ role: "system", content: PROBE_JUDGE }, { role: "user", content: JSON.stringify({ script, herRecords: records, question: p.q, answer: p.a }) }], temperature: 0, maxTokens: 400, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
        judged.push({ ...p, verdict: r.ok ? parseJson(r.content) : null });
      }
      if (judged.length) await ctx.runMutation(internal.eval.livingSim.note, { runId: a.runId, d: day.d as number, patch: { probes: judged } });
    }
    await ctx.runMutation(internal.eval.livingSim.note, { runId: a.runId, d: 0, patch: { finishedAt: Date.now() } });
    return null;
  },
});

export const days = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<Array<Record<string, unknown> & { d: number }>> => {
    const rows = await ctx.db.query("syncState").withIndex("by_key", (q) => q.gte("key", `sim:${a.runId}:day:`).lt("key", `sim:${a.runId}:day:~`)).collect();
    return rows.map((r) => JSON.parse(r.value) as Record<string, unknown> & { d: number }).sort((x, y) => x.d - y.d);
  },
});

/** The timeline: one row per simulated day, plus the probes. */
export const report = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ state: Omit<State, "future"> & { heldBack: number } | null; days: Array<Record<string, unknown>> }> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", stateKey(a.runId))).unique();
    const s = row ? (JSON.parse(row.value) as State) : null;
    const rows = await ctx.db.query("syncState").withIndex("by_key", (q) => q.gte("key", `sim:${a.runId}:day:`).lt("key", `sim:${a.runId}:day:~`)).collect();
    const { future, ...rest } = s ?? ({ future: [] } as unknown as State);
    return { state: s ? { ...rest, heldBack: future.length } : null, days: rows.map((r) => JSON.parse(r.value) as Record<string, unknown>).sort((x, y) => Number(x.d) - Number(y.d)) };
  },
});

/** How much real history a persona has to replay: post count and how far back it goes, per platform. */
export const span = internalQuery({
  args: { persona: v.string() },
  handler: async (ctx, a): Promise<Record<string, { posts: number; oldestDaysAgo: number; newestDaysAgo: number }>> => {
    const c = await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", a.persona)).first();
    if (!c) return {};
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"ownPosts">[];
    const out: Record<string, { posts: number; oldestDaysAgo: number; newestDaysAgo: number }> = {};
    for (const p of posts) {
      const ago = Math.round((Date.now() - p.createTime) / D);
      const e = out[p.platform] ?? { posts: 0, oldestDaysAgo: 0, newestDaysAgo: 9999 };
      out[p.platform] = { posts: e.posts + 1, oldestDaysAgo: Math.max(e.oldestDaysAgo, ago), newestDaysAgo: Math.min(e.newestDaysAgo, ago) };
    }
    return out;
  },
});

/** Pure: a normalized TikTok post as an ownPosts row for the clone (null when it has no id or url). */
export function historyRow(p: { postId?: string; url?: string | null; caption?: string | null; postedAt?: number | null; metrics?: { viewCount?: number | null; likeCount?: number | null; commentCount?: number | null; shareCount?: number | null; saveCount?: number | null }; mediaType?: string; videoDurationSec?: number | null; clipId?: string | null }, creatorId: Id<"creators">, now: number): Record<string, unknown> | null {
  if (!p.postId || !p.url || !p.postedAt) return null;
  const caption = p.caption ?? "";
  const m = p.metrics ?? {};
  return {
    creatorId, platform: "tiktok", postId: p.postId, url: p.url.split("?")[0],
    createTime: p.postedAt < 1e12 ? p.postedAt * 1000 : p.postedAt,
    contentType: p.mediaType === "carousel" ? "carousel" : p.mediaType === "image" ? "photo" : "video",
    ...(p.videoDurationSec ? { durationSec: p.videoDurationSec } : {}),
    caption, hashtags: (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.slice(1).toLowerCase()),
    ...(p.clipId ? { soundClipId: p.clipId } : {}),
    metrics: { views: m.viewCount ?? 0, likes: m.likeCount ?? 0, comments: m.commentCount ?? 0, shares: m.shareCount ?? 0, ...(m.saveCount != null ? { saves: m.saveCount } : {}) },
    metricsAsOf: now, source: "scrape",
  };
}

/** Pure: each post's multiple against the median of the 15 posts before it (chronological), as her own reads do. */
export function withMultiples<T extends { createTime: number; metrics: { views: number } }>(rows: T[]): Array<T & { multiple?: number }> {
  const sorted = [...rows].sort((a, b) => a.createTime - b.createTime);
  return sorted.map((r, i) => {
    const prior = sorted.slice(Math.max(0, i - 15), i).map((x) => x.metrics.views).sort((a, b) => a - b);
    if (prior.length < 5) return r;
    const med = prior[Math.floor(prior.length / 2)];
    return med > 0 ? { ...r, multiple: Math.round((r.metrics.views / med) * 100) / 100 } : r;
  });
}

export const insertHistory = internalMutation({
  args: { creatorId: v.id("creators"), rows: v.array(v.any()) },
  handler: async (ctx, a): Promise<{ added: number }> => {
    await simCreator(ctx, a.creatorId);
    const have = new Set(((await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ownPosts">[]).map((p) => p.postId));
    let added = 0;
    for (const r of a.rows as Array<{ postId: string }>) if (!have.has(r.postId)) { await ctx.db.insert("ownPosts", r as never); added++; }
    return { added };
  },
});

/** Page back through her real TikTok history (1 credit a page) so a months-long run has months of real posts. */
export const deepen = internalAction({
  args: { creatorId: v.id("creators"), handle: v.string(), days: v.number(), maxPages: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ pages: number; fetched: number; added: number; oldestDaysAgo: number }> => {
    const now = Date.now();
    const all: Record<string, unknown>[] = [];
    let cursor: string | null = null, pages = 0;
    do {
      const page = await tiktok.postsPage(a.handle, cursor);
      pages++;
      await ctx.runMutation(internal.core.costs.record, { creatorId: a.creatorId, vendor: "scrapecreators", resource: "/v3/tiktok/profile/videos", purpose: "sim_history", costUsd: 0.002, costSource: "tier_table" });
      for (const p of page.posts) { const row = historyRow(p as never, a.creatorId, now); if (row) all.push(row); }
      cursor = page.hasMore ? page.nextCursor : null;
      const oldest = Math.min(...all.map((r) => r.createTime as number));
      if (oldest < now - (a.days + 21) * D) break;
    } while (cursor && pages < (a.maxPages ?? 10));
    const rows = withMultiples(all as Array<Record<string, unknown> & { createTime: number; metrics: { views: number } }>);
    const { added } = await ctx.runMutation(internal.eval.livingSim.insertHistory, { creatorId: a.creatorId, rows });
    const oldest = all.length ? Math.min(...all.map((r) => r.createTime as number)) : now;
    return { pages, fetched: all.length, added, oldestDaysAgo: Math.round((now - oldest) / D) };
  },
});


const BREAKOUT_RATIO = THRESHOLDS.breakoutFloorRatio; // the sampler's own floor into the candidate list; the scout judges

/** Her watched TikTok accounts' real posts since `since` (1 credit a page, ≤3 pages each). */
export const fetchLane = internalAction({
  args: { creatorId: v.id("creators"), since: v.number() },
  handler: async (ctx, a): Promise<LaneAccount[]> => {
    const tracked = await ctx.runQuery(internal.eval.livingSim.trackedOf, { creatorId: a.creatorId });
    const out: LaneAccount[] = [];
    for (const t of tracked) {
      const posts: LanePost[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page++) {
        try {
          const r = await tiktok.postsPage(t.handle, cursor);
          await ctx.runMutation(internal.core.costs.record, { creatorId: a.creatorId, vendor: "scrapecreators", resource: "/v3/tiktok/profile/videos", purpose: "sim_lane", costUsd: 0.002, costSource: "tier_table" });
          for (const p of r.posts) {
            const row = historyRow(p as never, a.creatorId, Date.now());
            if (row) posts.push({ postId: String(row.postId), url: String(row.url), createTime: row.createTime as number, views: (row.metrics as { views: number }).views, clipId: (row.soundClipId as string | undefined) ?? null, paid: Boolean((p as { raw?: { is_ad?: boolean } }).raw?.is_ad) });
          }
          cursor = r.hasMore ? r.nextCursor : null;
          if (!cursor || Math.min(...posts.map((x) => x.createTime)) < a.since) break;
        } catch {
          break; // a handle the platform no longer has: that account is simply quiet in the replay
        }
      }
      out.push({ handle: t.handle, trackedAccountId: t.id, posts: posts.filter((p) => p.createTime >= a.since).sort((x, y) => x.createTime - y.createTime) });
    }
    return out;
  },
});

export const trackedOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ id: Id<"trackedAccounts">; handle: string }>> => {
    const rows = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(20)) as Doc<"trackedAccounts">[];
    return rows.filter((r) => r.status === "active" && r.platform === "tiktok").map((r) => ({ id: r._id, handle: r.handle }));
  },
});
