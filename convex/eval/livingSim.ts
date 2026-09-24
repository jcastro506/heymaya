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

const D = 86_400_000;
const STEP_GAP_MS = 5_000;

// ------------------------------------------------------------------ pure helpers

/** Pure: shift every epoch-ms number (a plausible timestamp) inside a value by `delta`. Ids are strings; durations are small. */
export function shiftTimes<T>(value: T, delta: number, now: number): T {
  const lo = Date.UTC(2015, 0, 1), hi = now + 400 * D;
  const walk = (x: unknown): unknown => {
    if (typeof x === "number") return Number.isFinite(x) && x >= lo && x <= hi ? x + delta : x;
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
type State = { runId: string; creatorId: Id<"creators">; persona: string; days: number; startedAt: number; seed: number; future: Future[]; releasedDraftPostIds: string[] };
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
  handler: async (ctx, a): Promise<{ held: number; kept: number }> => {
    const c = await simCreator(ctx, a.creatorId);
    const now = Date.now();
    const t0 = now - a.days * D;
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
    await writeKey(ctx, stateKey(a.runId), { runId: a.runId, creatorId: a.creatorId, persona: a.persona, days: a.days, startedAt: now, seed: a.seed, future, releasedDraftPostIds: [] } satisfies State);
    return { held: future.length, kept: posts.length - future.length };
  },
});

/** Shift one table's rows for the clone by `delta` (and the creator row with table "creators"). */
export const ageTable = internalMutation({
  args: { creatorId: v.id("creators"), table: v.string(), delta: v.number() },
  handler: async (ctx, a): Promise<number> => {
    const c = await simCreator(ctx, a.creatorId);
    const now = Date.now();
    if (a.table === "creators") {
      const { _id, _creationTime, ...rest } = c;
      void _id; void _creationTime;
      await ctx.db.replace(a.creatorId, shiftTimes(rest, a.delta, now) as never);
      return 1;
    }
    const table = a.table as (typeof TABLES_BY_CREATOR)[number];
    const rows = await ctx.db.query(table).filter((q) => q.eq(q.field("creatorId"), a.creatorId)).take(4000);
    for (const r of rows) {
      const { _id, _creationTime, ...rest } = r as unknown as Record<string, unknown> & { _id: Id<"creators">; _creationTime: number };
      void _creationTime;
      await ctx.db.replace(_id as never, shiftTimes(rest, a.delta, now) as never);
    }
    return rows.length;
  },
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
  handler: async (ctx, a): Promise<{ runId: string; held: number; kept: number }> => {
    if (a.days < 3 || a.days > 180) throw new Error("days must be 3–180");
    const runId = `sim-${Date.now()}`;
    const source = await ctx.runQuery(internal.eval.expertBench.personaSource, { clerkUserId: a.persona });
    if (!source) throw new Error(`persona ${a.persona} is missing`);
    const creatorId = await ctx.runMutation(internal.eval.scenarios.cloneForRun, { sourceId: source, runId });
    // Enough real history to replay: page back through her TikTok until it covers the run.
    const handle = await ctx.runQuery(internal.account.setup.handlesFor, { creatorId });
    if (handle?.tiktok) await ctx.runAction(internal.eval.livingSim.deepen, { creatorId, handle: handle.tiktok, days: a.days });
    const r = await ctx.runMutation(internal.eval.livingSim.prepare, { creatorId, days: a.days, runId, persona: a.persona, seed: a.seed ?? 7 });
    // Day 0: the world moves forward so the start date is "now"; each day then ages it one day back.
    await ageWorld(ctx, creatorId, a.days * D);
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
          notes.push(`draft ${doc.postId} skipped: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`);
        }
      }
      // A drafted post goes out after the draft (as it would in life); the rest at their real time of day.
      await ctx.runMutation(internal.eval.livingSim.releasePost, { creatorId: s.creatorId, doc: f.doc, createTime: drafted ? Date.now() : now - (a.d * D - f.offsetMs) });
    }
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
        jobs[name] = r && typeof r === "object" && "reason" in r ? `${r.sent ? "sent" : "held"}: ${String(r.reason ?? "")}`.slice(0, 120) : "ran";
      } catch (e) {
        jobs[name] = `failed: ${e instanceof Error ? e.message.slice(0, 100) : "error"}`;
      }
    };
    // The accounts she watches are read for her roster (the fleet sampler does this every 6 h; cached reads).
    await step("sample", async () => { const r = await ctx.runAction(internal.scout.sampler.run, { creatorId: id }); return { sent: r.signals > 0, reason: `${r.accounts} accounts, ${r.signals} breakouts, ${r.failed} failed` }; });
    await step("morning", () => ctx.runAction(internal.agent.cadence.morning, { creatorId: id, now }));
    await step("scout", () => ctx.runAction(internal.scout.scout.runOne, { creatorId: id }));
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

export const ACTOR_PROMPT = `You are role-playing a real TikTok creator texting her social media expert, Maya. Stay in character: write exactly like the creator's own captions below (their case, emoji, slang, length). You are a busy person: you often ignore messages, reply briefly, sometimes enthusiastically. You never know you are in a simulation.
Given Maya's messages today and the ideas she sent, return ONLY JSON:
{"replies": [{"to": "the message id you're answering, or ''", "text": "your text, in your voice"}], "ideas": [{"ideaId": "", "act": "save|pass"}]}
Reply to at most 2 messages. It's fine and realistic to reply to none. Save an idea only if it genuinely fits what you'd film; pass on ones that don't.`;

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
      for (const rep of (out?.replies ?? []).slice(0, 2)) if (rep.text?.trim()) { await sayAndHear(ctx, id, rep.text.trim().slice(0, 400)); said.push(rep.text.trim()); }
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
      messages: msgs.filter((m) => m.direction === "out" && m.proactive).map((m) => ({ id: m._id, kind: m.kind ?? "", text: m.body.slice(0, 600) })),
      ideas: ideas.filter((i) => i.createdAt >= a.since).map((i) => ({ id: i._id, hook: ((i.version as { hook?: string } | undefined)?.hook ?? i.messageText).slice(0, 140) })),
    };
  },
});

export const voiceOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<string> => {
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(15)) as Doc<"ownPosts">[];
    return posts.map((p) => `- ${p.caption.split("\n")[0].slice(0, 160)}`).join("\n");
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
    const costs = (await ctx.db.query("costEvents").filter((q) => q.and(q.eq(q.field("creatorId"), a.creatorId), q.gte(q.field("_creationTime"), Date.now() - 30 * 60_000))).take(500)) as Array<{ costUsd?: number }>;
    const finishes = (await ctx.db.query("finishes").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(200)) as Doc<"finishes">[];
    const d = c.dossier as { lane?: string; persona?: { summary?: string } } | undefined;
    return {
      out: out.length,
      outProactive: out.filter((m) => m.proactive).length,
      outKinds: out.map((m) => m.kind ?? "?"),
      in: msgs.filter((m) => m.direction === "in").length,
      ideasTotal: ideas.length,
      ideasSent: ideas.filter((i) => i.createdAt >= a.since).map((i) => ((i.version as { hook?: string } | undefined)?.hook ?? "").slice(0, 90)),
      ideasSaved: ideas.filter((i) => i.savedAt).length,
      ideasPassed: ideas.filter((i) => i.status === "passed").length,
      ideasPosted: ideas.filter((i) => i.status === "posted").length,
      memory: { records: records.filter((r) => r.active).length, byKind: records.filter((r) => r.active).reduce<Record<string, number>>((acc, r) => ((acc[r.kind] = (acc[r.kind] ?? 0) + 1), acc), {}), notes: (c.notes ?? []).filter((n) => !n.tombstonedAt).length, rules: directives.map((r) => r.verbatim.slice(0, 80)) },
      lane: (d?.lane ?? c.niche ?? "").slice(0, 160),
      taste: (c.taste?.text ?? "").slice(0, 220),
      finishes: finishes.length,
      captionLessons: finishes.filter((f) => f.outcome?.lesson).map((f) => f.outcome!.lesson.slice(0, 120)),
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

export const PROBE_JUDGE = `You judge whether an assistant named Maya, after weeks of texting one creator, answers from a real memory of THIS person. You get the creator's hidden life script (what really happened, with days), the question, and Maya's answer. Return ONLY JSON: {"remembers": 0|1|2, "invented": ["anything stated that the script and her records don't support"], "note": "≤160"}. 2 = specific and right, 1 = partly, 0 = generic or wrong.`;

export const judgeProbes = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const s = await ctx.runQuery(internal.eval.livingSim.readState, { runId: a.runId });
    if (!s) return null;
    const days = await ctx.runQuery(internal.eval.livingSim.days, { runId: a.runId });
    const script = lifeScript(s.days);
    for (const day of days) {
      const probes = (day.probes as Array<{ q: string; a: string }> | undefined) ?? [];
      const judged = [];
      for (const p of probes) {
        const r = await callModel(ctx, { creatorId: s.creatorId, purpose: "sim_probe_judge", model: REGISTRY.writer.primary, messages: [{ role: "system", content: PROBE_JUDGE }, { role: "user", content: JSON.stringify({ script, question: p.q, answer: p.a }) }], temperature: 0, maxTokens: 400, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
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
