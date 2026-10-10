/**
 * Routines (2026-10-09, docs/CREATOR_REACH_OUT.md): things they asked her to do on a schedule ("3 ideas
 * every morning at 9", "comment picks at noon"). Asked for, so never held by her budget; still held by
 * quiet hours and their pause, both inside `messages.send`. Set and stopped in chat through her tools,
 * one shared function each (`add`, `stop`), run by one hourly pass that reads only schedule rows.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { localHourMinute } from "../scout/gate";
import { dayKeyInZone } from "./cadence";
import { pairedRows } from "./schedule";
import { pausedByThem } from "./paused";
import { buildPrefix } from "../agent/context";
import { investigate } from "../agent/investigate";
import { critique, tooLong } from "../agent/critic";
import { clip } from "../lib/clip";

export type Routine = NonNullable<Doc<"creators">["routines"]>[number];
export type Days = Routine["days"];

export const ROUTINES = { max: 5, whatChars: 200 } as const;

/** Pure: does this routine run in this hour, on their clock, and not yet today? */
export function isDue(r: Routine, now: number, timezone: string): boolean {
  const { hour } = localHourMinute(now, timezone);
  if (r.hour !== hour) return false;
  const today = dayKeyInZone(now, timezone);
  if (r.lastRunDay === today) return false;
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (r.days === "weekdays") return weekday >= 1 && weekday <= 5;
  if (r.days === "weekly") return weekday === (r.weekday ?? 1);
  return true;
}

/** Pure: is this hour, on their clock, inside their quiet window ("22:00"–"07:00" wraps midnight)? */
export function hourInQuiet(hour: number, quiet: { start: string; end: string }): boolean {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const at = hour * 60, s = m(quiet.start), e = m(quiet.end);
  return s <= e ? at >= s && at < e : at >= s || at < e;
}

/** Pure: one line per routine, the way she'd say it back. */
export function describe(r: Routine): string {
  const h = r.hour === 0 ? "12am" : r.hour < 12 ? `${r.hour}am` : r.hour === 12 ? "12pm" : `${r.hour - 12}pm`;
  const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][r.weekday ?? 1];
  const when = r.days === "daily" ? "every day" : r.days === "weekdays" ? "weekdays" : `every ${day}`;
  return `${when} at ${h}: ${r.what}`;
}

/** Shared by her tool (and any app control later): add one. Refuses inside quiet hours rather than silently never sending. */
export const add = internalMutation({
  args: { creatorId: v.id("creators"), what: v.string(), hour: v.number(), days: v.union(v.literal("daily"), v.literal("weekdays"), v.literal("weekly")), weekday: v.optional(v.number()), commentPicks: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string; id?: string }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { ok: false, body: "no account" };
    const what = clip(a.what.trim(), ROUTINES.whatChars);
    const hour = Math.round(a.hour);
    if (!what) return { ok: false, body: "say what they want" };
    if (!(hour >= 0 && hour <= 23)) return { ok: false, body: "hour must be 0-23 on their clock" };
    if (a.days === "weekly" && !(a.weekday !== undefined && a.weekday >= 0 && a.weekday <= 6)) return { ok: false, body: "a weekly routine needs a weekday 0-6 (0 is sunday)" };
    if (hourInQuiet(hour, c.quietHours)) return { ok: false, body: `${hour}:00 is inside their quiet hours (${c.quietHours.start}–${c.quietHours.end}); ask for another time or change quiet hours first` };
    const list = c.routines ?? [];
    if (list.length >= ROUTINES.max) return { ok: false, body: `they already have ${list.length}; stop one first` };
    const id = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const r: Routine = { id, what, hour, days: a.days, ...(a.days === "weekly" ? { weekday: a.weekday } : {}), ...(a.commentPicks ? { builtin: "comment_picks" as const } : {}), createdAt: Date.now() };
    await ctx.db.patch(c._id, { routines: [...list, r], updatedAt: Date.now() });
    return { ok: true, id, body: `saved: ${describe(r)}` };
  },
});

export const stop = internalMutation({
  args: { creatorId: v.id("creators"), id: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { ok: false, body: "no account" };
    const list = c.routines ?? [];
    const hit = list.find((r) => r.id === a.id);
    if (!hit) return { ok: false, body: `no routine ${a.id}; theirs: ${list.map((r) => `${r.id} (${describe(r)})`).join("; ") || "none"}` };
    await ctx.db.patch(c._id, { routines: list.filter((r) => r.id !== a.id), updatedAt: Date.now() });
    return { ok: true, body: `stopped: ${describe(hit)}` };
  },
});

export const setPace = internalMutation({
  args: { creatorId: v.id("creators"), pace: v.union(v.literal("less"), v.literal("normal"), v.literal("more")) },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { ok: false, body: "no account" };
    await ctx.db.patch(c._id, { textFirstPace: a.pace, updatedAt: Date.now() });
    const said = { less: "her own finds at most every few days", normal: "her own finds at most once a day", more: "her own finds up to twice a day" }[a.pace];
    return { ok: true, body: `set: ${said}. routines they asked for and their own shoots are unchanged` };
  },
});

/** Who has a routine in this hour on their own clock, from schedule rows only. */
export const dueCreators = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Id<"creators">[]> =>
    (await pairedRows(ctx, { activeOnly: true })).filter((r) => r.routineHours?.includes(localHourMinute(a.now, r.timezone).hour)).map((r) => r.creatorId),
});

/** Claim today's run before doing it, so two passes can never send it twice. */
export const claim = internalMutation({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<Routine[]> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !c.channel.paired || pausedByThem(c)) return [];
    const due = (c.routines ?? []).filter((r) => isDue(r, a.now, c.timezone));
    if (!due.length) return [];
    const today = dayKeyInZone(a.now, c.timezone);
    await ctx.db.patch(c._id, { routines: (c.routines ?? []).map((r) => (due.some((d) => d.id === r.id) ? { ...r, lastRunDay: today } : r)) });
    return due.map((r) => ({ ...r, lastRunDay: today }));
  },
});

export const ROUTINE_SKILL = `routine
When: they asked you to do this on a schedule, and it's time.
Do exactly what they asked, now, the way you'd text it: short bubbles with a line of only --- between them, plain words, no stats-speak. Ideas are concrete and from their world (what they'd film, said simply). Use a lookup only if it makes this better. Don't mention that it's a routine or a schedule, and don't ask whether they still want it. If what they asked for has nothing real today (e.g. "tell me if anything blows up" and nothing did), output exactly SKIP.
Output only the text.`;

/** One routine, now. Returns what happened; a model failure says so rather than sending something empty. */
export const runOne = internalAction({
  args: { creatorId: v.id("creators"), routine: v.any(), now: v.number(), preview: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string; text?: string }> => {
    const r = a.routine as Routine;
    // Their day, set by the claim (never a UTC date: core/cadence owns day keys).
    const day = r.lastRunDay ?? "unclaimed";
    if (r.builtin === "comment_picks") {
      const out = await ctx.runAction(internal.engage.round.sendText, { creatorId: a.creatorId, now: a.now, asked: true });
      return { sent: out.sent, reason: out.reason };
    }
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!g) return { sent: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: g.creator, directives: g.directives, skill: ROUTINE_SKILL, personal: g.personal, voice: g.voice, history: g.history });
    const convo = `# Recent conversation\n${g.recent.slice(-8).map((m) => `${m.direction === "in" ? "them" : "you"}: ${clip(m.body, 300)}`).join("\n")}\n\nThey asked you: "${r.what}". Do it now.`;
    const inv = await investigate(ctx, { creatorId: a.creatorId, purpose: "routine", prefix, user: convo, budget: { calls: 3, credits: 6, deadlineAt: Date.now() + 60_000 }, temperature: 0.6, maxTokens: 900 });
    const text = inv.content.trim();
    if (!text) return { sent: false, reason: `nothing written (${inv.ended})` };
    if (/^SKIP\b/.test(text)) return { sent: false, reason: "nothing real today" };
    const verdict = tooLong(text) ? { pass: false, problems: ["too_long"], note: "over the length cap" } : await critique(ctx, { creatorId: a.creatorId, kind: "reply", text, evidence: { asked: r.what, toolTrace: inv.trace.map((t) => ({ tool: t.tool, ok: t.ok, result: clip(t.result ?? "", 600) })) }, voice: {}, directives: g.directives.map((x) => x.verbatim) });
    // Operator preview: the text she'd send, written and checked, never sent.
    if (a.preview) return { sent: false, reason: verdict.pass ? "preview" : `preview (critic: ${verdict.problems.join(", ")})`, text };
    if (!verdict.pass) console.warn(`[routines] ${r.id} for ${a.creatorId} critic: ${verdict.problems.join(", ")} (sent anyway: asked for, log-only)`);
    const res = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: text, dedupeKey: `routine:${r.id}:${day}`, proactive: true, kind: "routine", ts: a.now });
    return { sent: res.sent, reason: res.sent ? "sent" : res.held ?? "already sent today" };
  },
});

export const runAll = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ ran: number }> => {
    const now = a.now ?? Date.now();
    let ran = 0;
    for (const creatorId of await ctx.runQuery(internal.core.routines.dueCreators, { now })) {
      for (const routine of await ctx.runMutation(internal.core.routines.claim, { creatorId, now })) {
        await ctx.scheduler.runAfter(0, internal.core.routines.runOne, { creatorId, routine, now });
        ran++;
      }
    }
    return { ran };
  },
});
