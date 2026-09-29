/**
 * The silence simulation (re-engagement, 2026-09-28): what Maya does over three weeks when people stop
 * answering, on the REAL send path (`messages.send`, the daily cap, quiet hours, Linq's phone rail and
 * opt-out), the real writer, the real critic and the model judge, with time compressed by ageing every
 * row a day at a time (livingSim's technique). No vendor is read, so it spends no ScrapeCreators credits;
 * it costs a few cents of model calls. Eight scripted people, each proving one promise:
 *
 *   0 phone_silent    on iMessage, never answers        → nudge d3, nudge d9, easy-out d15, then nothing
 *   1 tg_silent       the same on Telegram              → the same (the policy is channel-agnostic)
 *   2 phone_scout3    three scout texts go unanswered   → Linq's rail holds the d3 nudge; only the easy-out (d15)
 *   3 replies_d4      answers after the first nudge     → a new spell: nudges at d7 (+ a post doing 4x), d13, easy-out d19
 *   4 stops_d5        opts out on day 5                 → one nudge (d3), then nothing, not even the easy-out
 *   5 no_reasons      nothing true to say, ever         → only the easy-out, d15
 *   6 paused_d2       pauses on day 2                   → nothing at all
 *   7 returns_d12     comes back on day 13: "hey! i'm back"     → a real reply that catches them up; then the ladder restarts
 *   8 returns_busy    comes back on day 13: "sorry, work is a lot" → answers THEM first, no pitch, no guilt; same restart
 *
 * Isolation: every creator is `eval-run:sl-<run>:<i>` (no delivery: `messages.send` suppresses it), and
 * every mutation here refuses anything else. Read the result with `report`; remove everything with `clear`.
 *   npx convex run eval/silenceSim:start '{}'
 *   npx convex run eval/silenceSim:report '{}'
 *   npx convex run eval/silenceSim:clear '{}'
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { TABLES_BY_CREATOR } from "../account/deletion";
import { ageCreatorTable, CREATOR_INDEX } from "./livingSim";
import { judge, judgePass } from "./judge";
import { timezonesFor } from "./firstWeek";
import { clip } from "../lib/clip";

const D = 86_400_000;
export const SL_PREFIX = "eval-run:sl-";
const KEY = (runId: string) => `sl:${runId}`;
const isSimSubject = (id: string | undefined) => (id ?? "").startsWith(SL_PREFIX);

export type Role = "phone_silent" | "tg_silent" | "phone_scout3" | "replies_d4" | "stops_d5" | "no_reasons" | "paused_d2" | "returns_d12" | "returns_busy";
export const ROLES: Role[] = ["phone_silent", "tg_silent", "phone_scout3", "replies_d4", "stops_d5", "no_reasons", "paused_d2", "returns_d12", "returns_busy"];

/** Pure: the re-engagement texts each role should get, as [simulated day, rung]. The whole promise, in one table. */
export const EXPECTED: Record<Role, Array<[number, string]>> = {
  phone_silent: [[3, "nudge"], [9, "nudge2"], [15, "easy_out"]],
  tg_silent: [[3, "nudge"], [9, "nudge2"], [15, "easy_out"]],
  phone_scout3: [[15, "easy_out"]],
  replies_d4: [[3, "nudge"], [7, "nudge"], [13, "nudge2"], [19, "easy_out"]],
  stops_d5: [[3, "nudge"]],
  no_reasons: [[15, "easy_out"]],
  paused_d2: [],
  returns_d12: [[3, "nudge"], [9, "nudge2"], [16, "nudge"], [22, "nudge2"]],
  returns_busy: [[3, "nudge"], [9, "nudge2"], [16, "nudge"], [22, "nudge2"]],
};

/** Pure: what happens to each role on each day, before the daily run. */
export function eventsFor(role: Role, d: number): Array<{ kind: "inbound" | "idea" | "hot" | "scout" | "optout" | "pause" | "return"; arg?: string }> {
  const e: Array<{ kind: "inbound" | "idea" | "hot" | "scout" | "optout" | "pause" | "return"; arg?: string }> = [];
  if (d === 0) e.push({ kind: "inbound", arg: "hey maya" });
  if (role !== "no_reasons" && d === 0) e.push({ kind: "idea", arg: "the shoe rack list, said straight to camera" });
  const returner = role === "returns_d12" || role === "returns_busy";
  if ((role === "phone_silent" || role === "tg_silent" || returner) && d === 8) e.push({ kind: "idea", arg: "km versus miles, one continuous take" });
  if (role === "phone_scout3" && (d === 0 || d === 1 || d === 4)) e.push({ kind: "scout", arg: `scout ${d}` });
  if (role === "replies_d4") {
    if (d === 4) { e.push({ kind: "inbound", arg: "ok!" }); e.push({ kind: "hot" }); }
    if (d === 6) e.push({ kind: "idea", arg: "the mile-one face, five seconds" });
    if (d === 12) e.push({ kind: "idea", arg: "what i eat on a sixteen-miler" });
  }
  if (role === "stops_d5" && d === 5) e.push({ kind: "optout" });
  if (role === "paused_d2" && d === 2) e.push({ kind: "pause" });
  if (returner) {
    if (d === 13) e.push({ kind: "return", arg: role === "returns_d12" ? "hey! ok i'm back. what's new?" : "hey, sorry, work has been a lot" });
    if (d === 14) e.push({ kind: "idea", arg: "the taper-week freakout, in one shot" });
    if (d === 21) e.push({ kind: "idea", arg: "how i actually pace the first mile" });
  }
  return e;
}

const GUILT = /(just checking in|it'?s been a while|haven'?t heard from you|where('?d| did| have) you (go|been)|been (so )?quiet|miss(ed)? you|ghost)/i;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const content = (s: string) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []));

/* ------------------------------------------------------------------ state (one syncState row) */

interface LogEntry { d: number; event?: string; result?: string; sent?: boolean; rung?: string; body?: string; reasons?: string[]; judge?: { pass: boolean; note: string } | null }
interface Slot { i: number; role: Role; creatorId?: Id<"creators">; log: LogEntry[] }
interface State { runId: string; startedAt: number; days: number; slots: Slot[]; finished?: boolean; error?: string }

async function read(ctx: QueryCtx | MutationCtx, runId: string): Promise<State | null> {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY(runId))).unique();
  return row ? (JSON.parse(row.value) as State) : null;
}
async function write(ctx: MutationCtx, s: State): Promise<void> {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY(s.runId))).unique();
  const value = JSON.stringify(s);
  if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
  else await ctx.db.insert("syncState", { key: KEY(s.runId), value, updatedAt: Date.now() });
}

export const readState = internalQuery({ args: { runId: v.string() }, handler: async (ctx, a): Promise<State | null> => await read(ctx, a.runId) });
export const latestRunId = internalQuery({ args: {}, handler: async (ctx): Promise<string | null> => {
  const rows = await ctx.db.query("syncState").collect();
  const ids = rows.map((r) => /^sl:(sl-[a-z0-9]+)$/.exec(r.key)?.[1]).filter((x): x is string => Boolean(x)).sort();
  return ids.at(-1) ?? null;
} });
export const saveState = internalMutation({ args: { state: v.any() }, handler: async (ctx, a): Promise<null> => { await write(ctx, a.state as State); return null; } });

async function simCreator(ctx: MutationCtx, id: Id<"creators">): Promise<Doc<"creators">> {
  const c = (await ctx.db.get(id)) as Doc<"creators"> | null;
  if (!c || !isSimSubject(c.clerkUserId)) throw new Error("only a silence-simulation creator");
  return c;
}

/* ------------------------------------------------------------------ mutations (all refuse anything else) */

export const makeWorld = internalMutation({
  args: { runId: v.string(), i: v.number(), role: v.string(), timezone: v.string() },
  handler: async (ctx, a): Promise<Id<"creators">> => {
    if (!/^sl-[a-z0-9]+$/.test(a.runId)) throw new Error("not a silence run id");
    const now = Date.now();
    const phone = a.role.startsWith("phone") || a.role === "stops_d5";
    const id = await ctx.db.insert("creators", {
      clerkUserId: `${SL_PREFIX}${a.runId.slice(3)}:${a.i}`, email: `${a.runId}-${a.i}@eval.invalid`, handles: { tiktok: `eval_sl_${a.i}` }, ownership: "unverified", niche: "running and marathon training",
      timezone: a.timezone, quietHours: { start: "22:00", end: "07:00" }, tone: "friend", mode: "full", dossierVersion: 0, notes: [], affinities: [], experiments: [],
      channel: phone ? { paired: true, pairedAt: now, kind: "imessage" } : { paired: true, pairedAt: now }, plan: { status: "active", founding: true }, createdAt: now - 20 * D, updatedAt: now,
    } as never);
    // Eight ordinary posts (~1,000 views: their normal) well before the world starts.
    for (let n = 0; n < 8; n++) {
      await ctx.db.insert("ownPosts", { creatorId: id, platform: "tiktok", postId: `sl${a.i}p${n}`, url: `https://www.tiktok.com/@eval_sl_${a.i}/video/${a.i}${n}`, createTime: now - (12 + 4 * n) * D, contentType: "video", caption: ["long run recap, mile 16 hurt", "honest training week", "shoe rack list", "the pace i pretend i hold", "sunday long run vlog", "fueling on a 14 miler", "rest day is a lie", "race week nerves"][n], hashtags: [], metrics: { views: 900 + 40 * n, likes: 40, comments: 4, shares: 2 }, metricsAsOf: now, source: "scrape" } as never);
    }
    return id;
  },
});

export const apply = internalMutation({
  args: { creatorId: v.id("creators"), kind: v.string(), arg: v.optional(v.string()), n: v.number() },
  handler: async (ctx, a): Promise<string> => {
    const c = await simCreator(ctx, a.creatorId);
    const now = Date.now();
    if (a.kind === "idea") {
      await ctx.db.insert("ideas", { creatorId: a.creatorId, evidenceLinks: [], fit: "yes", fitWhy: "your own format", version: { hook: a.arg ?? "an idea" }, messageText: a.arg ?? "an idea", produced: { skillVersion: "sl/1", model: "sim", thresholdsVersion: "n/a" }, status: "sent", createdAt: now } as never);
      return "an idea they haven't seen";
    }
    if (a.kind === "hot") {
      await ctx.db.insert("ownPosts", { creatorId: a.creatorId, platform: "tiktok", postId: `sl-hot-${a.n}`, url: `https://www.tiktok.com/@eval_sl/video/hot${a.n}`, createTime: now, contentType: "video", caption: "the pacing rule i broke on purpose", hashtags: [], metrics: { views: 4200, likes: 300, comments: 40, shares: 20 }, metricsAsOf: now, source: "scrape" } as never);
      return "a post at about 4x their normal";
    }
    if (a.kind === "inbound" || a.kind === "optout") {
      const surface = c.channel.kind === "imessage" ? "imessage" : "telegram";
      await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "in", surface, kind: a.kind === "optout" ? "optout" : "inbound", body: a.kind === "optout" ? "STOP" : a.arg ?? "hey", channelMessageId: `sl:${a.creatorId}:${a.n}`, ts: now } as never);
      if (a.kind === "optout") await ctx.db.patch(a.creatorId, { channel: { ...c.channel, optedOutAt: now } });
      return a.kind === "optout" ? "texted STOP" : `they wrote: ${a.arg}`;
    }
    if (a.kind === "pause") { await ctx.db.patch(a.creatorId, { plan: { ...c.plan, status: "paused" } }); return "paused"; }
    throw new Error(`unknown event ${a.kind}`);
  },
});

export const ageOne = internalMutation({
  args: { creatorId: v.id("creators"), table: v.string() },
  handler: async (ctx, a): Promise<number> => await ageCreatorTable(ctx, await simCreator(ctx, a.creatorId), a.table, -D),
});

export const clearPage = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ deleted: number; done: boolean }> => {
    const s = await read(ctx, a.runId);
    if (!s) return { deleted: 0, done: true };
    let deleted = 0;
    for (const slot of s.slots) {
      if (!slot.creatorId) continue;
      const c = (await ctx.db.get(slot.creatorId)) as Doc<"creators"> | null;
      if (!c) continue;
      if (!isSimSubject(c.clerkUserId)) throw new Error("refusing to delete a creator outside the simulation");
      for (const table of TABLES_BY_CREATOR) {
        const index = CREATOR_INDEX[table];
        if (!index || table === "schedule") continue;
        const q = ctx.db.query(table) as unknown as { withIndex: (i: string, f: (q: { eq: (k: string, v: unknown) => unknown }) => unknown) => { take: (n: number) => Promise<Array<{ _id: never }>> } };
        for (const r of await q.withIndex(index, (x) => x.eq("creatorId", c._id)).take(400 - deleted)) { await ctx.db.delete(r._id); deleted++; }
        if (deleted >= 400) return { deleted, done: false };
      }
      await ctx.db.delete(c._id);
      deleted++;
      if (deleted >= 400) return { deleted, done: false };
    }
    return { deleted, done: true };
  },
});

export const clear = internalAction({
  args: { runId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ deleted: number }> => {
    const runId = a.runId ?? (await ctx.runQuery(internal.eval.silenceSim.latestRunId, {}));
    if (!runId) return { deleted: 0 };
    let deleted = 0;
    for (let n = 0; n < 200; n++) { const r = await ctx.runMutation(internal.eval.silenceSim.clearPage, { runId }); deleted += r.deleted; if (r.done) break; }
    return { deleted };
  },
});

/* ------------------------------------------------------------------ the run */

export const start = internalAction({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ runId: string; days: number; creators: number }> => {
    if (!process.env.ENVIRONMENT_NAME || process.env.ENVIRONMENT_NAME === "production") throw new Error("the silence simulation runs only on a non-production deployment");
    const days = Math.max(20, Math.min(40, a.days ?? 22));
    const runId = `sl-${Date.now().toString(36)}`;
    const zones = timezonesFor(ROLES.length, Date.now());
    const slots: Slot[] = [];
    for (const [i, role] of ROLES.entries()) slots.push({ i, role, creatorId: await ctx.runMutation(internal.eval.silenceSim.makeWorld, { runId, i, role, timezone: zones[i] }), log: [] });
    await ctx.runMutation(internal.eval.silenceSim.saveState, { state: { runId, startedAt: Date.now(), days, slots } satisfies State });
    await ctx.scheduler.runAfter(0, internal.eval.silenceSim.day, { runId, d: 0 });
    return { runId, days, creators: slots.length };
  },
});

async function judged(ctx: ActionCtx, creatorId: Id<"creators">, text: string, kind: string, evidence: unknown): Promise<{ pass: boolean; note: string } | null> {
  try { const j = await judge(ctx, { creatorId, text, kind, evidence }); return j ? { pass: judgePass(j), note: clip(j.note, 160) } : null; } catch { return null; }
}

export const day = internalAction({
  args: { runId: v.string(), d: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const s = (await ctx.runQuery(internal.eval.silenceSim.readState, { runId: a.runId })) as State | null;
    if (!s || s.finished) return null;
    try {
      for (const slot of s.slots) {
        const id = slot.creatorId!;
        if (a.d > 0) for (const table of ["creators", "messages", "ideas", "ownPosts"]) await ctx.runMutation(internal.eval.silenceSim.ageOne, { creatorId: id, table });
        let n = 0;
        for (const e of eventsFor(slot.role, a.d)) {
          n += 1;
          if (e.kind === "scout") {
            const r = await ctx.runMutation(internal.core.messages.send, { creatorId: id, surface: "telegram", body: `idea: ${e.arg}`, dedupeKey: `sl:scout:${a.d}`, proactive: true, capped: true, kind: "scout", ts: Date.now() });
            slot.log.push({ d: a.d, event: "scout text", result: r.sent ? "sent" : `held: ${r.held}` });
          } else if (e.kind === "return") {
            const result = await ctx.runMutation(internal.eval.silenceSim.apply, { creatorId: id, kind: "inbound", arg: e.arg, n: a.d * 10 + n });
            const since = Date.now() - 1000;
            const inbound = (await ctx.runQuery(internal.eval.silenceSim.lastInbound, { creatorId: id }))!;
            let reply = "(no reply)";
            try {
              await ctx.runAction(internal.agent.converse.run, { creatorId: id, messageId: inbound });
              const replies = await ctx.runQuery(internal.eval.converse.repliesTo, { creatorId: id, inboundId: inbound, since });
              reply = replies.map((x: { text: string }) => x.text).join("\n---\n") || reply;
            } catch (err) { reply = `(the turn failed: ${err instanceof Error ? clip(err.message, 80) : "error"})`; }
            slot.log.push({ d: a.d, event: `${result}`, result: "welcome-back turn", body: reply, judge: await judged(ctx, id, reply, "reply", { theirMessage: e.arg, cameBackAfterDays: 13 }) });
          } else {
            slot.log.push({ d: a.d, event: await ctx.runMutation(internal.eval.silenceSim.apply, { creatorId: id, kind: e.kind, arg: e.arg, n: a.d * 10 + n }) });
          }
        }
        const inputs = await ctx.runQuery(internal.agent.reengage.inputs, { creatorId: id, now: Date.now() });
        const r = await ctx.runAction(internal.agent.cadence.quiet, { creatorId: id });
        const entry: LogEntry = { d: a.d, result: `${r.sent ? "sent" : "held"}: ${r.reason}`, sent: r.sent, rung: r.sent ? r.reason : undefined, reasons: inputs?.input.reasons.map((x) => x.text) };
        if (r.sent) {
          const row = await ctx.runQuery(internal.eval.silenceSim.newestOut, { creatorId: id });
          entry.body = row?.body;
          if (row) entry.judge = await judged(ctx, id, row.body, row.kind === "quiet" ? "easy_out" : "nudge", { reasons: entry.reasons ?? [], rung: r.reason });
        }
        slot.log.push(entry);
      }
    } catch (err) {
      s.error = err instanceof Error ? clip(err.message, 300) : String(err);
    }
    if (a.d >= s.days || s.error) s.finished = true;
    await ctx.runMutation(internal.eval.silenceSim.saveState, { state: s });
    if (!s.finished) await ctx.scheduler.runAfter(0, internal.eval.silenceSim.day, { runId: a.runId, d: a.d + 1 });
    return null;
  },
});

export const lastInbound = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Id<"messages"> | null> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"messages">[];
    return rows.find((m) => m.direction === "in")?._id ?? null;
  },
});
export const newestOut = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ body: string; kind: string } | null> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(10)) as Doc<"messages">[];
    const m = rows.find((x) => x.direction === "out" && x.proactive);
    return m ? { body: m.body, kind: m.kind ?? "" } : null;
  },
});

/* ------------------------------------------------------------------ the verdict */

/** Pure: every check for one role, from its log. */
export function judgeRole(role: Role, log: LogEntry[]): Array<{ check: string; ok: boolean; detail: string }> {
  const out: Array<{ check: string; ok: boolean; detail: string }> = [];
  const sends = log.filter((e) => e.sent).map((e) => [e.d, e.rung!] as [number, string]);
  const want = EXPECTED[role];
  out.push({ check: "the right texts on the right days", ok: JSON.stringify(sends) === JSON.stringify(want), detail: `sent ${JSON.stringify(sends)}; expected ${JSON.stringify(want)}` });
  const gaps = sends.slice(1).map(([d], i) => d - sends[i][0]);
  out.push({ check: "about a text a week: at least six days between rungs of one spell (ignoring a reply between)", ok: role === "replies_d4" || role === "returns_d12" || role === "returns_busy" ? true : gaps.every((g) => g >= 6), detail: `gaps ${JSON.stringify(gaps)}` });
  const bodies = log.filter((e) => e.sent && e.body);
  const bad = bodies.filter((e) => GUILT.test(e.body!));
  out.push({ check: "no guilt, no \"just checking in\"", ok: bad.length === 0, detail: bad.map((e) => `d${e.d}: ${clip(e.body!, 90)}`).join(" | ") || "clean" });
  const long = bodies.filter((e) => words(e.body!) > (e.rung === "easy_out" ? 38 : 45));
  out.push({ check: "short enough to be a text", ok: long.length === 0, detail: long.map((e) => `d${e.d}: ${words(e.body!)} words`).join(", ") || "all short" });
  const easy = bodies.filter((e) => e.rung === "easy_out");
  out.push({ check: "the easy-out says how to pause", ok: easy.every((e) => /pause/i.test(e.body!)), detail: easy.map((e) => clip(e.body!, 100)).join(" | ") || "no easy-out for this role" });
  const nudges = bodies.filter((e) => e.rung === "nudge" || e.rung === "nudge2");
  const ungrounded = nudges.filter((e) => { const have = content(e.body!); return !(e.reasons ?? []).some((r) => [...content(r)].filter((w) => have.has(w)).length >= 2); });
  out.push({ check: "a nudge names the true thing it was given", ok: ungrounded.length === 0, detail: ungrounded.map((e) => `d${e.d}: ${clip(e.body!, 90)}`).join(" | ") || "grounded" });
  const rail = log.filter((e) => e.result?.includes("phone rail"));
  if (role === "phone_scout3") out.push({ check: "Linq's rail actually held the nudge behind two unanswered texts", ok: rail.length > 0, detail: rail.map((e) => `d${e.d}: ${e.result}`).join(" | ") || "the rail never fired" });
  if (role === "stops_d5") out.push({ check: "nothing after they said STOP", ok: sends.every(([d]) => d < 5), detail: `sent on ${JSON.stringify(sends.map(([d]) => d))}` });
  if (role === "paused_d2") out.push({ check: "nothing after they paused", ok: sends.length === 0, detail: `${sends.length} sent; held with ${[...new Set(log.filter((e) => !e.sent && e.d >= 3).map((e) => e.result))].slice(0, 2).join(" / ")}` });
  if (role === "returns_d12" || role === "returns_busy") {
    const back = log.find((e) => e.result === "welcome-back turn");
    out.push({ check: "a real reply to the person who came back, without guilt", ok: Boolean(back?.body && !back.body.startsWith("(") && !GUILT.test(back.body)), detail: clip(back?.body ?? "no reply", 200) });
  }
  if (role === "returns_d12") {
    // "what's new?" is an invitation: the catch-up (the idea waiting in their app) belongs in the answer.
    const back = log.find((e) => e.result === "welcome-back turn");
    out.push({ check: "asked what's new, she catches them up on what's actually waiting", ok: Boolean(back?.body && /idea|km|miles|shot list|waiting|in your app/i.test(back.body)), detail: clip(back?.body ?? "no reply", 200) });
  }
  const j = log.filter((e) => e.judge);
  out.push({ check: "the model judge would send what she wrote (advisory)", ok: j.every((e) => e.judge!.pass), detail: `${j.filter((e) => e.judge!.pass).length}/${j.length} pass${j.filter((e) => !e.judge!.pass).map((e) => ` · d${e.d}: ${e.judge!.note}`).join("")}` });
  return out;
}

export const report = internalQuery({
  args: { runId: v.optional(v.string()), full: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const runId = a.runId ?? ((await ctx.db.query("syncState").collect()).map((r) => /^sl:(sl-[a-z0-9]+)$/.exec(r.key)?.[1]).filter((x): x is string => Boolean(x)).sort().at(-1) ?? "");
    const s = await read(ctx, runId);
    if (!s) return { error: "no such run" };
    const roles = s.slots.map((slot) => {
      const checks = judgeRole(slot.role, slot.log);
      return { role: slot.role, failed: checks.filter((c) => !c.ok).length, checks: a.full ? checks : checks.filter((c) => !c.ok), texts: slot.log.filter((e) => e.sent).map((e) => `d${e.d} ${e.rung}: ${e.body}`) };
    });
    return { runId, finished: Boolean(s.finished), error: s.error ?? null, dayReached: Math.max(0, ...s.slots.flatMap((x) => x.log.map((e) => e.d))), days: s.days, passed: roles.filter((r) => r.failed === 0).length, of: roles.length, roles };
  },
});
