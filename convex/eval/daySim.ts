/**
 * The day sim (2026-10-01): scripted conversations through the real phone path (core/imessage
 * handleText, the real turn, the real tools, the real calendar code), on dev, with a real model.
 * Three scripts:
 *   - opening: a fresh signup texting her while she reads, then the month plan and booking;
 *   - google:  calendar CRUD from easy to hard on a fake Google Calendar (eval/fakeGoogle) with their
 *              life planted on it (a race, a dinner, a standup, the dentist);
 *   - iphone:  the same CRUD on the iPhone path (calendar/device), the app's sync played by the sim.
 * After every step it snapshots her reply, the blocks, the calendar and what the phone should hold,
 * and checks them: deterministic consistency (every booked block on the calendar exactly once, times
 * equal; nothing of hers left behind), and a judge for "did the change match what they asked, and
 * did she say it truthfully" plus a rubric for each event's notes. Test creators are eval-run:day-*;
 * nothing reaches a person. Operator-run; costs a few dollars of model calls (no scraping for the
 * calendar scripts: they clone a persona whose posts are already read).
 *
 *   npx convex run eval/daySim:start '{"scripts":["google","iphone","opening"]}'
 *   npx convex run eval/daySim:report '{"runId":"day-..."}'
 *   npx convex run eval/daySim:clear '{"runId":"day-..."}'
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { clip } from "../lib/clip";
import { encrypt } from "../lib/encryption";
import { TABLES_BY_CREATOR, PURGE_INDEX } from "../account/deletion";
import { liveBlocks } from "../calendar/liveness";
import { DEVICE_CALENDAR_ID, devicePlanFor } from "../calendar/device";

const H = 3_600_000;
const D = 24 * H;
const RUNNER = "eval:vanessaalopezz";

type Step =
  | { say: string; expect: string }
  | { wait: "read" }
  | { plan: true }
  | { syncPhone: true }
  | { syncGoogle: true }
  | { scout: true };

/** Their life, planted on the calendar relative to "now" (hours from now, local-agnostic). */
const LIFE = [
  { summary: "Half marathon", inH: 9 * 24 + 8, h: 4 },
  { summary: "Dinner with Sam", inH: 2 * 24 + 18, h: 2 },
  { summary: "team standup", inH: 1 * 24 + 9, h: 0.5, recurring: true },
  { summary: "dentist", inH: 3 * 24 + 14, h: 1 },
];

const CRUD: Step[] = [
  { say: "can you plan my week?", expect: "she proposes this week's sessions around their real calendar (not over the dinner, the standup or the dentist)" },
  { say: "book it", expect: "every proposed session is booked and on their calendar; she says so" },
  { say: "move the first film session to the next day, same time", expect: "that film session moves one day later, same time; its own edit and post sessions may follow it (editing can't come before filming) but nothing unrelated changes; she says the new times" },
  { say: "drop the edit block", expect: "the edit session is removed (if there is more than one, she asks which or removes the one they clearly meant); nothing else changes" },
  { say: "add a film session sunday at 11am", expect: "a new film session on Sunday 11:00 their time, booked; she confirms" },
  { say: "can we do one at 11pm tonight?", expect: "she doesn't book inside their quiet hours without saying so; offers a sensible time or asks" },
  { say: "move the sunday one to the same time as my dinner with sam", expect: "she notices the clash with the dinner and doesn't silently double-book; asks or offers another time" },
  { say: "actually push the sunday one an hour later and drop the one before it", expect: "both changes happen: sunday moves to 12:00 and the session before it is removed; she says both" },
  { say: "what's on my calendar this week?", expect: "she lists their booked sessions accurately (and may mention their own events), matching the rows" },
  { say: "cancel everything this week", expect: "all of this week's sessions are removed from the plan and the calendar; she confirms plainly" },
];

const SCRIPTS: Record<string, { fresh: boolean; google: boolean; phone: boolean; steps: Step[]; handle?: string; watchCap?: number }> = {
  // A creator who is already big (operator, 2026-10-01): how she reads someone at 450K, what she makes of
  // their comments, the plan she builds, and her ideas. A fresh signup on his real public posts.
  small: {
    fresh: true, google: false, phone: false, handle: "adinawilliamsss", watchCap: 10,
    steps: [] as Step[],
  },
  big: {
    fresh: true, google: false, phone: false, handle: "kevin_0connor_", watchCap: 12,
    steps: [
      { say: "hey", expect: "a short friendly reply; no judgement of their posts yet" },
      { say: "honestly i want to turn this into real income, mostly brand deals, without burning out", expect: "she takes the goal on board; may ask what gets in the way" },
      { wait: "read" },
      { say: "what are people asking in my comments lately?", expect: "she reads real comments on their recent posts and reports what people actually ask, quoting or paraphrasing real ones; nothing invented" },
      { plan: true },
      { say: "give me 3 ideas for this week", expect: "three specific ideas built on what they're good at (not a one-off's setting), right for an account this size, each with why" },
      { say: "which of my recent posts underperformed and why?", expect: "names real posts below their normal with grounded reasons, no invented numbers or causes stated as fact" },
      { scout: true },
    ],
  },
  google: { fresh: false, google: true, phone: false, steps: [{ syncGoogle: true }, ...CRUD.flatMap((s) => [s, { syncGoogle: true } as Step])] },
  iphone: { fresh: false, google: false, phone: true, steps: [{ syncPhone: true }, ...CRUD.flatMap((s) => [s, { syncPhone: true } as Step])] },
  opening: {
    fresh: true, google: false, phone: false,
    steps: [
      { say: "hey!", expect: "a short friendly reply; no judgement of their posts yet" },
      { say: "so what do you think of my stuff so far?", expect: "she says she's still going through their posts and will come back with it; no early verdict" },
      { say: "honestly mostly i want to be consistent, i always fall off after a week", expect: "she takes the goal on board warmly and briefly; may ask what gets in the way" },
      { wait: "read" },
      { say: "being on camera is the hard part tbh", expect: "she takes it seriously and offers ways to post without talking to camera" },
      { plan: true },
      { say: "2 a week is more realistic for me", expect: "she adjusts the month plan to 2 a week and says what that changes" },
      { say: "book it", expect: "this week's sessions are booked; she says so and offers the calendar" },
    ],
  },
};

// The small creator runs the same conversation as the big one: one set of rules, any size.
SCRIPTS.small.steps = SCRIPTS.big.steps;

const subject = (runId: string, script: string) => `eval-run:${runId}:${script}`;

export const start = internalAction({
  args: { scripts: v.array(v.string()), freshHandle: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ runId: string; creators: Record<string, Id<"creators">> }> => {
    if (process.env.ENVIRONMENT_NAME === "production") throw new Error("never on production");
    const runId = `day-${Date.now().toString(36)}`;
    const creators: Record<string, Id<"creators">> = {};
    for (const name of a.scripts) {
      const s = SCRIPTS[name];
      if (!s) throw new Error(`no script ${name}`);
      let creatorId: Id<"creators">;
      if (s.fresh) {
        const r = await ctx.runMutation(internal.eval.onboardingRead.start, { subjects: [{ tiktok: s.handle ?? a.freshHandle ?? "adinawilliamsss" }], watchCap: s.watchCap ?? 8, transcriptCap: 4 });
        creatorId = (await ctx.runQuery(internal.eval.daySim.byPrefix, { prefix: `eval-run:${r.runId}:` }))!;
      } else {
        const source = await ctx.runQuery(internal.eval.expertBench.personaSource, { clerkUserId: RUNNER });
        if (!source) throw new Error("persona missing");
        creatorId = await ctx.runMutation(internal.eval.scenarios.cloneForRun, { sourceId: source, runId: `${runId}:${name}` });
      }
      // Unique per run and script (2026-10-01: two runs both used +15550190000, and one script's texts
      // reached the other's creator). Fictional 555-01xx range, never a real phone.
      const seed = [...`${runId}:${name}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
      const phone = `+1555010${String(seed % 10_000).padStart(4, "0")}`;
      await ctx.runMutation(internal.eval.daySim.prepare, { creatorId, phone, google: s.google, phoneCal: s.phone, fresh: s.fresh });
      if (s.google) await ctx.runMutation(internal.eval.fakeGoogle.plant, { calendarId: `primary:${creatorId}`, events: LIFE.map((l) => ({ summary: l.summary, start: Date.now() + l.inH * H, end: Date.now() + (l.inH + l.h) * H, recurring: l.recurring })) });
      if (s.google) await ctx.runAction(internal.eval.daySim.seedGoogle, { creatorId });
      if (s.fresh) {
        const t = await ctx.runMutation(internal.eval.onboardingRead.pairingCode, { creatorId, timezone: "America/New_York" });
        await ctx.runAction(internal.core.imessage.handleText, { from: phone, text: `START ${t.token}`, channelMessageId: `${runId}:${name}:start` });
      }
      creators[name] = creatorId;
      await ctx.scheduler.runAfter(5_000, internal.eval.daySim.step, { runId, script: name, creatorId, phone, i: 0 });
    }
    return { runId, creators };
  },
});

export const byPrefix = internalQuery({
  args: { prefix: v.string() },
  handler: async (ctx, a): Promise<Id<"creators"> | null> =>
    ((await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.gte("clerkUserId", a.prefix).lt("clerkUserId", `${a.prefix}~`)).first()) as Doc<"creators"> | null)?._id ?? null,
});

/** A test creator, made texting-ready: a fake number, paired, a live plan, their clock. */
export const prepare = internalMutation({
  args: { creatorId: v.id("creators"), phone: v.string(), google: v.boolean(), phoneCal: v.boolean(), fresh: v.boolean() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !c.clerkUserId.startsWith("eval-run:")) throw new Error("only a test creator");
    await ctx.db.patch(a.creatorId, {
      phone: a.phone,
      timezone: "America/New_York",
      quietHours: { start: "22:00", end: "07:00" },
      plan: { ...c.plan, status: "active" },
      ...(a.fresh ? {} : { channel: { paired: true, pairedAt: Date.now() - 5 * D, kind: "imessage" as const }, conversationalOnboardingAt: Date.now() - 5 * D }),
      ...(a.phoneCal ? { deviceCalendar: { status: "granted" as const, at: Date.now() } } : {}),
    });
    return null;
  },
});

/** A Google connection pointing at the fake: a token that won't need refreshing during the run. */
export const seedGoogle = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<null> => {
    const tokenRef = await encrypt(JSON.stringify({ access: "fake-access", refresh: "fake-refresh", expiresAt: Date.now() + 2 * D, scope: "calendar" }));
    await ctx.runMutation(internal.eval.daySim.insertConnection, { creatorId: a.creatorId, tokenRef, calendarId: `primary:${a.creatorId}` });
    return null;
  },
});
export const insertConnection = internalMutation({
  args: { creatorId: v.id("creators"), tokenRef: v.string(), calendarId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.insert("connections", { creatorId: a.creatorId, provider: "google_calendar", status: "connected", calendarIds: [a.calendarId], calendars: [{ id: a.calendarId, name: "Primary", selected: true }], tokenRef: a.tokenRef, updatedAt: Date.now() });
    return null;
  },
});

/** Everything a check needs, as rows. */
export const snapshot = internalQuery({
  args: { creatorId: v.id("creators"), since: v.number() },
  handler: async (ctx, a) => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators">;
    const now = Date.now();
    const tz = c.timezone;
    const fmt = (t: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(t);
    const all = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("start", now - D)).take(100)) as Doc<"calendarBlocks">[];
    const live = new Set((await liveBlocks(ctx, a.creatorId, all)).map((b) => String(b._id)));
    const blocks = all.map((b) => ({ id: String(b._id), kind: b.kind, title: b.title, start: b.start, end: b.end, when: `${fmt(b.start)}–${fmt(b.end)}`, status: b.status, booked: Boolean(b.consentAt), live: live.has(String(b._id)) && b.status !== "deleted", googleId: b.externalEventId ?? null, deviceId: b.deviceEventId ?? null }));
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.since)).take(30)) as Doc<"messages">[];
    return {
      timezone: tz,
      nowLocal: fmt(now),
      quietHours: c.quietHours,
      replies: msgs.filter((m) => m.direction === "out").map((m) => ({ kind: m.kind ?? null, body: m.body })),
      blocks,
      plan: (c.growthPlan as { postsPerWeek?: number; status?: string; goal?: string } | undefined) ?? null,
      lifeEvents: ((await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId).gte("start", now - D)).take(60)) as Doc<"calendarEvents">[]).filter((e) => e.status === "active").map((e) => ({ title: e.title || "(private)", when: fmt(e.start), class: e.class, source: e.calendarId === DEVICE_CALENDAR_ID ? "iphone" : "google" })),
    };
  },
});

/** Pure: the calendar matches the plan. Every live booked block once, at its time; nothing of hers left over. */
export function consistency(blocks: Array<{ id: string; start: number; end: number; booked: boolean; live: boolean; googleId: string | null; deviceId: string | null }>, cal: { kind: "google"; events: Array<{ id: string; start: string; end: string; status: string; maya: boolean }> } | { kind: "iphone"; write: Array<{ id: string; start: number; end: number }>; remove: Array<{ id: string }> }): string[] {
  const problems: string[] = [];
  const booked = blocks.filter((b) => b.booked && b.live && b.end > Date.now());
  if (cal.kind === "google") {
    const mine = cal.events.filter((e) => e.maya && e.status !== "cancelled");
    for (const b of booked) {
      const ev = mine.filter((e) => e.id === b.googleId);
      if (ev.length !== 1) problems.push(`booked block ${b.id} is on Google ${ev.length} times`);
      else if (Date.parse(ev[0].start) !== b.start || Date.parse(ev[0].end) !== b.end) problems.push(`block ${b.id} and its Google event disagree on time`);
    }
    const bookedIds = new Set(booked.map((b) => b.googleId));
    for (const e of mine) if (!bookedIds.has(e.id) && Date.parse(e.end) > Date.now()) problems.push(`Google still has her event ${e.id} with no live booked block`);
  } else {
    const want = new Set(booked.map((b) => b.id));
    const got = new Set(cal.write.map((w) => w.id));
    for (const id of want) if (!got.has(id)) problems.push(`booked block ${id} is not on the phone's list`);
    for (const id of got) if (!want.has(id)) problems.push(`the phone would hold ${id}, which isn't a live booked block`);
    for (const w of cal.write) { const b = booked.find((x) => x.id === w.id); if (b && (b.start !== w.start || b.end !== w.end)) problems.push(`block ${w.id} times differ on the phone`); }
  }
  return problems;
}

const STEP_JUDGE = `You check one step of a scripted conversation between a content creator and their assistant Maya, who plans filming sessions on their calendar. You get what they texted, what should happen, the calendar BEFORE and AFTER (rows, the truth), what her tools returned (also truth), and Maya's reply. Judge: "matched" = the rows (sessions and the month plan) changed the way the expectation says (or, where the expectation allows asking, she asked instead of guessing); "honest" = her reply says only what the rows show (no session claimed booked/moved/removed that wasn't; times right). Output ONLY JSON: {"matched": true|false, "honest": true|false, "note": "≤200 chars"}`;
const NOTES_JUDGE = `You rate the notes on a calendar event a creator will read the day of a filming session. Good notes say the day's job (film, edit, or post) and exactly what to make (the hook, the shots), specific to this idea, short enough to read in 20 seconds, no filler or hype. Output ONLY JSON: {"saysTheJob": true|false, "specific": true|false, "concise": true|false, "score": 1-5, "note": "≤140 chars"}`;

async function judge(ctx: Parameters<typeof callModel>[0], creatorId: Id<"creators">, system: string, user: string): Promise<Record<string, unknown> | null> {
  const r = await callModel(ctx, { creatorId, purpose: "daysim_judge", model: REGISTRY.critic.primary, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0, maxTokens: 400, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
  if (!r.ok) return null;
  try { return JSON.parse(r.content.match(/\{[\s\S]*\}/)?.[0] ?? "") as Record<string, unknown>; } catch { return null; }
}

export const step = internalAction({
  args: { runId: v.string(), script: v.string(), creatorId: v.id("creators"), phone: v.string(), i: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const s = SCRIPTS[a.script];
    const st = s?.steps[a.i];
    if (!st) { await ctx.runMutation(internal.eval.daySim.log, { runId: a.runId, script: a.script, i: a.i, entry: { done: true } }); return null; }
    const next = (delayMs: number) => ctx.scheduler.runAfter(delayMs, internal.eval.daySim.step, { ...a, i: a.i + 1 });
    const t0 = Date.now();
    try {
      if ("syncGoogle" in st) {
        await ctx.runAction(internal.calendar.sync.syncOne, { creatorId: a.creatorId });
        const events = await ctx.runQuery(internal.eval.fakeGoogle.read, { calendarId: `primary:${a.creatorId}` });
        const snap = await ctx.runQuery(internal.eval.daySim.snapshot, { creatorId: a.creatorId, since: t0 });
        const problems = consistency(snap.blocks, { kind: "google", events });
        // The notes on each of her events, rated.
        const notes = [];
        for (const e of events.filter((x) => x.maya && x.status !== "cancelled").slice(0, 3)) notes.push({ title: e.summary, rating: await judge(ctx as never, a.creatorId, NOTES_JUDGE, `Title: ${e.summary}\nNotes:\n${e.description ?? "(none)"}`) });
        await ctx.runMutation(internal.eval.daySim.log, { runId: a.runId, script: a.script, i: a.i, entry: { sync: "google", problems, notes, lifeEvents: snap.lifeEvents } });
        await next(5_000);
        return null;
      }
      if ("syncPhone" in st) {
        // What the app does when it opens: read the plan, "write" the events, report their life.
        const plan = await ctx.runQuery(internal.eval.daySim.phonePlan, { creatorId: a.creatorId });
        await ctx.runMutation(internal.eval.daySim.phoneSynced, { creatorId: a.creatorId, written: plan.write.filter((w) => !w.eventId).map((w) => ({ id: w.id, eventId: `ev-${w.id}` })), removed: plan.remove.map((r) => r.id) });
        await ctx.runMutation(internal.eval.daySim.phoneEvents, { creatorId: a.creatorId, events: LIFE.map((l, k) => ({ id: `life${k}`, title: l.summary, s: t0 + l.inH * H, e: t0 + (l.inH + l.h) * H, allDay: false, recurring: Boolean(l.recurring) })) });
        const after = await ctx.runQuery(internal.eval.daySim.phonePlan, { creatorId: a.creatorId });
        const snap = await ctx.runQuery(internal.eval.daySim.snapshot, { creatorId: a.creatorId, since: t0 });
        const problems = consistency(snap.blocks, { kind: "iphone", write: after.write, remove: after.remove });
        const notes = [];
        for (const w of after.write.slice(0, 3)) notes.push({ title: w.title, rating: await judge(ctx as never, a.creatorId, NOTES_JUDGE, `Title: ${w.title}\nNotes:\n${w.notes || "(none)"}`) });
        await ctx.runMutation(internal.eval.daySim.log, { runId: a.runId, script: a.script, i: a.i, entry: { sync: "iphone", problems, notes } });
        await next(20_000); // the scheduled ingest of their events runs first
        return null;
      }
      if ("wait" in st) {
        const done = await ctx.runQuery(internal.eval.daySim.hasRead, { creatorId: a.creatorId });
        if (!done && Date.now() - (await ctx.runQuery(internal.eval.daySim.createdAt, { creatorId: a.creatorId })) < 30 * 60_000) { await ctx.scheduler.runAfter(20_000, internal.eval.daySim.step, a); return null; }
        await ctx.runMutation(internal.eval.daySim.log, { runId: a.runId, script: a.script, i: a.i, entry: { wait: "read", landed: done } });
        await next(5_000);
        return null;
      }
      if ("scout" in st) {
        // The idea she'd send unprompted: the real scout, past the day-one settle and the daily cap for the sim.
        // A dry run past the rails: the idea she'd write, never sent (the day-one settle would hold a real one).
        const r = await ctx.runAction(internal.scout.scout.run, { creatorId: a.creatorId, ignoreRails: true, dryRun: true }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
        const snap = await ctx.runQuery(internal.eval.daySim.snapshot, { creatorId: a.creatorId, since: t0 });
        await ctx.runMutation(internal.eval.daySim.log, { runId: a.runId, script: a.script, i: a.i, entry: { scout: r, replies: snap.replies } });
        await next(5_000);
        return null;
      }
      if ("plan" in st) {
        const r = await ctx.runAction(internal.agent.monthPlan.proposeThenWeek, { creatorId: a.creatorId });
        const snap = await ctx.runQuery(internal.eval.daySim.snapshot, { creatorId: a.creatorId, since: t0 });
        await ctx.runMutation(internal.eval.daySim.log, { runId: a.runId, script: a.script, i: a.i, entry: { plan: r, replies: snap.replies, monthPlan: snap.plan } });
        await next(5_000);
        return null;
      }
      const before = await ctx.runQuery(internal.eval.daySim.snapshot, { creatorId: a.creatorId, since: t0 });
      await ctx.runAction(internal.core.imessage.handleText, { from: a.phone, text: st.say, channelMessageId: `${a.runId}:${a.script}:${a.i}` });
      // Her reply: wait for an outbound after their text (the turn runs as a job).
      let after = before;
      for (let k = 0; k < 24; k++) {
        await new Promise((r) => setTimeout(r, 5_000));
        after = await ctx.runQuery(internal.eval.daySim.snapshot, { creatorId: a.creatorId, since: t0 });
        if (after.replies.length) { await new Promise((r) => setTimeout(r, 4_000)); after = await ctx.runQuery(internal.eval.daySim.snapshot, { creatorId: a.creatorId, since: t0 }); break; }
      }
      // What her tools returned this turn, so a grounded answer about posts or comments isn't judged invented.
      const tools = (await ctx.runQuery(internal.eval.expertBench.tracesSince, { creatorId: a.creatorId, since: t0 })) as Array<{ tool?: string; ok?: boolean; result?: string }>;
      const toolLines = tools.filter((x) => x.tool !== "critic").slice(0, 8).map((x) => `${x.tool}: ${clip(x.result ?? "", 500)}`).join("\n") || "(no tools used)";
      const verdict = await judge(ctx as never, a.creatorId, STEP_JUDGE, `Their timezone: ${after.timezone}; their quiet hours ${after.quietHours.start}-${after.quietHours.end}; now ${after.nowLocal}.\nThey texted: "${st.say}"\nShould happen: ${st.expect}\n\nBEFORE (sessions): ${JSON.stringify(before.blocks.filter((b) => b.live).map((b) => ({ kind: b.kind, when: b.when, booked: b.booked, title: clip(b.title, 60) })))}\nAFTER (sessions): ${JSON.stringify(after.blocks.filter((b) => b.live).map((b) => ({ kind: b.kind, when: b.when, booked: b.booked, title: clip(b.title, 60) })))}\nTheir own events: ${JSON.stringify(after.lifeEvents)}\nMonth plan BEFORE: ${JSON.stringify(before.plan)}\nMonth plan AFTER: ${JSON.stringify(after.plan)}\nWhat her tools returned this turn (also truth; she may cite these):\n${toolLines}\n\nMaya's reply:\n${after.replies.map((r) => r.body).join("\n---\n") || "(no reply)"}`);
      await ctx.runMutation(internal.eval.daySim.log, { runId: a.runId, script: a.script, i: a.i, entry: { said: st.say, expect: st.expect, replies: after.replies, ms: Date.now() - t0, verdict, sessions: after.blocks.filter((b) => b.live).map((b) => `${b.kind} ${b.when}${b.booked ? " (booked)" : " (proposed)"}`) } });
    } catch (e) {
      await ctx.runMutation(internal.eval.daySim.log, { runId: a.runId, script: a.script, i: a.i, entry: { error: e instanceof Error ? clip(e.message, 300) : "failed" } });
    }
    await next(5_000);
    return null;
  },
});

export const phonePlan = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a) => await devicePlanFor(ctx, (await ctx.db.get(a.creatorId)) as Doc<"creators">),
});
export const phoneSynced = internalMutation({
  args: { creatorId: v.id("creators"), written: v.array(v.object({ id: v.string(), eventId: v.string() })), removed: v.array(v.string()) },
  handler: async (ctx, a): Promise<null> => {
    for (const w of a.written) { const id = ctx.db.normalizeId("calendarBlocks", w.id); if (id) await ctx.db.patch(id, { deviceEventId: w.eventId }); }
    for (const r of a.removed) { const id = ctx.db.normalizeId("calendarBlocks", r); if (id) await ctx.db.patch(id, { deviceEventId: undefined }); }
    return null;
  },
});
export const phoneEvents = internalMutation({
  args: { creatorId: v.id("creators"), events: v.array(v.object({ id: v.string(), title: v.string(), s: v.number(), e: v.number(), allDay: v.boolean(), recurring: v.boolean() })) },
  handler: async (ctx, a): Promise<null> => {
    const rows = a.events.map((x) => ({ calendarId: DEVICE_CALENDAR_ID, externalId: `device:${x.id}`, title: x.title, start: x.s, end: x.e, allDay: x.allDay, recurring: x.recurring, cancelled: false }));
    await ctx.scheduler.runAfter(0, internal.calendar.device.ingest, { creatorId: a.creatorId, rows });
    return null;
  },
});

export const hasRead = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<boolean> => Boolean(await ctx.db.query("messages").withIndex("by_creator_and_dedupe", (q) => q.eq("creatorId", a.creatorId).eq("dedupeKey", `first_read:${a.creatorId}`)).first()),
});
export const createdAt = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<number> => ((await ctx.db.get(a.creatorId)) as Doc<"creators"> | null)?._creationTime ?? 0,
});

export const log = internalMutation({
  args: { runId: v.string(), script: v.string(), i: v.number(), entry: v.any() },
  handler: async (ctx, a): Promise<null> => {
    const key = `eval:daysim:${a.runId}:${a.script}`;
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
    const list = row ? (JSON.parse(row.value) as unknown[]) : [];
    list.push({ i: a.i, at: Date.now(), ...a.entry });
    if (row) await ctx.db.patch(row._id, { value: JSON.stringify(list), updatedAt: Date.now() }); else await ctx.db.insert("syncState", { key, value: JSON.stringify(list), updatedAt: Date.now() });
    return null;
  },
});

export const report = internalQuery({
  args: { runId: v.string(), script: v.string() },
  handler: async (ctx, a): Promise<unknown[]> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", `eval:daysim:${a.runId}:${a.script}`)).unique();
    return row ? (JSON.parse(row.value) as unknown[]) : [];
  },
});

/** Remove a run's test creators (every row of theirs) and the fake calendars. */
export const clear = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ deleted: number; done: boolean }> => {
    let deleted = 0;
    const ids = Object.keys(SCRIPTS).map((s) => subject(a.runId, s));
    const cs = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.gte("clerkUserId", `eval-run:${a.runId}:`).lt("clerkUserId", `eval-run:${a.runId}:~`)).collect()) as Doc<"creators">[];
    void ids;
    for (const c of cs) {
      for (const table of TABLES_BY_CREATOR) {
        const q = ctx.db.query(table) as unknown as { withIndex: (i: string, f: (q: { eq: (f: string, v: unknown) => unknown }) => unknown) => { take: (n: number) => Promise<Array<{ _id: never }>> } };
        for (const r of await q.withIndex(PURGE_INDEX[table], (x) => x.eq("creatorId", c._id)).take(400)) { await ctx.db.delete(r._id); deleted++; }
        if (deleted > 3000) return { deleted, done: false };
      }
      const cal = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", `eval:fake_gcal:primary:${c._id}`)).unique();
      if (cal) await ctx.db.delete(cal._id);
      await ctx.db.delete(c._id);
    }
    return { deleted, done: true };
  },
});
