/**
 * Management in plain words (plan §1 "chat is complete", §11.3). "no messages before
 * 9", "be blunter", "stop watching @x", "add @y", "i make running videos now" are the
 * same rows the Settings controls write, decided by the classifier, executed here by
 * code, confirmed in one line. Destructive ones (stop watching) confirm with a button
 * first; the rest apply immediately and say so, because undo is one more sentence.
 */

import { platformOn } from "../config/platforms";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { clip } from "../lib/clip";

export const MANAGE_ACTIONS = ["quiet_hours", "tone", "add_admired", "stop_watching", "niche"] as const;
export type ManageAction = (typeof MANAGE_ACTIONS)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Pure: minutes from midnight for "HH:MM". */
function mins(hhmm: string): number { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }

/** Pure: "9", "9am", "9:30pm", "21:00" → "HH:MM", or null. */
export function clockOf(raw: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = (m[3] ?? "").toLowerCase().replace(/\./g, "");
  if (h > 23 || min > 59) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Pure: the quiet hours their words mean, given what they are now. Code reads the plain one-edge forms itself
 * ("nothing before 9" moves only the end; "not after 10pm" only the start); a model's reading is used otherwise.
 * A window over 14 hours is almost certainly a misreading (2026-11-12: "not before 9am" became 09:00–07:00,
 * silence for 22 hours a day, and her 1 pm booking was refused as "quiet hours"), so it's refused, not applied.
 */
export function quietHoursFrom(text: string, proposed: { start: string; end: string }, current: { start: string; end: string }): { ok: true; start: string; end: string } | { ok: false } {
  const t = text.toLowerCase();
  const before = /\b(?:before|until|till|til)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/.exec(t);
  const after = /\b(?:after|past|later than)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/.exec(t);
  const range = /\b(?:from|between)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\s*(?:to|and|-|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/.exec(t);
  let start = proposed.start, end = proposed.end;
  if (range) {
    // "from 10 to 8": a night start (evening) and a morning end, unless they said am/pm.
    const s0 = range[1], e0 = range[2];
    start = clockOf(/am|pm/.test(s0) ? s0 : Number(s0.split(":")[0]) <= 12 ? `${s0}pm` : s0) ?? start;
    end = clockOf(/am|pm/.test(e0) ? e0 : `${e0}am`) ?? end;
  } else if (before || after) {
    start = current.start; end = current.end;
    // "before 9" with no am/pm means the morning edge; "after 10" with none means the night edge.
    if (before) { const raw = before[1]; end = clockOf(/am|pm/.test(raw) ? raw : `${raw}am`) ?? end; }
    if (after) { const raw = after[1]; const n = Number(raw.split(":")[0]); start = clockOf(/am|pm/.test(raw) ? raw : n <= 12 ? `${raw}pm` : raw) ?? start; }
  }
  const span = (mins(end) - mins(start) + 1440) % 1440;
  if (span === 0 || span > 14 * 60) return { ok: false };
  return { ok: true, start, end };
}

export const setQuietHours = internalMutation({
  // `said`: their words, so code can read the plain forms itself (quietHoursFrom).
  args: { creatorId: v.id("creators"), start: v.string(), end: v.string(), said: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    if (!HHMM.test(a.start) || !HHMM.test(a.end)) return { ok: false, body: "i didn't catch the hours. say it like 'nothing before 9am' or 'quiet from 10pm to 8am'." };
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { ok: false, body: "" };
    const q = quietHoursFrom(a.said ?? "", { start: a.start, end: a.end }, c.quietHours);
    if (!q.ok) return { ok: false, body: "i want to get this right: from what time at night to what time in the morning should i stay quiet? like '10pm to 9am'." };
    await ctx.db.patch(c._id, { quietHours: { start: q.start, end: q.end }, updatedAt: Date.now() });
    return { ok: true, body: `done: nothing from me between ${pretty(q.start)} and ${pretty(q.end)}. it's in settings if you want to change it.` };
  },
});

export const setTone = internalMutation({
  args: { creatorId: v.id("creators"), tone: v.union(v.literal("coach"), v.literal("friend"), v.literal("blunt")) },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { ok: false, body: "" };
    await ctx.db.patch(c._id, { tone: a.tone, updatedAt: Date.now() });
    return { ok: true, body: a.tone === "blunt" ? "blunt it is. same honesty, fewer cushions." : a.tone === "coach" ? "coach mode. i'll push a bit more and check in on the plan." : "back to friend mode." };
  },
});

/** An instruction to her is a rule, never what they make. The classifier is told; this is the rail (live 2026-09-09: the niche became "i hate talking-head videos, never suggest those"). Pure. */
export function readsAsInstruction(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(never|don'?t|do not|stop|always|no |please |i hate|i don'?t (like|want))/.test(t) || /\b(never|don'?t|do not) (suggest|send|text|message|recommend|pitch)\b/.test(t);
}

export const setNiche = internalMutation({
  args: { creatorId: v.id("creators"), text: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !a.text.trim()) return { ok: false, body: "" };
    // Refused with no body: the turn falls through to a normal reply, and the remember pass keeps the rule.
    if (readsAsInstruction(a.text)) return { ok: false, body: "" };
    await ctx.db.patch(c._id, { niche: a.text.trim().slice(0, 300), updatedAt: Date.now() });
    // 2026-10-21: quoting their words back ("noted, '…'. that's how i'll read your lane now.") read as a robot.
    // 2026-11-04: and "i'll work that into what i look for" promised nothing she then did. Now the plan is rebuilt
    // around it (onboarding/redirect) and she says so.
    return { ok: true, body: "got it. give me a minute to rethink your plan around that." };
  },
});

/** The same rules as the web control: lowercase handle, revive a removed one, ten at most. */
export async function addTracked(ctx: { db: { query: (t: "trackedAccounts") => unknown; patch: (id: Id<"trackedAccounts">, v: Partial<Doc<"trackedAccounts">>) => Promise<void>; insert: (t: "trackedAccounts", v: Omit<Doc<"trackedAccounts">, "_id" | "_creationTime">) => Promise<Id<"trackedAccounts">> } }, creatorId: Id<"creators">, platform: "tiktok" | "instagram", rawHandle: string, existing: Doc<"trackedAccounts">[], opts: { addedBy?: "creator" | "suggested" | "maya"; why?: string } = {}): Promise<{ ok: boolean; error?: string; id?: Id<"trackedAccounts"> }> {
  const handle = rawHandle.trim().replace(/^@/, "").toLowerCase();
  // The one watch-list rule (web, chat, roster, her tool): TikTok only while Instagram is off.
  if (!platformOn(platform)) return { ok: false, error: "I only watch TikTok accounts right now" };
  if (!/^[a-z0-9_.]{2,30}$/.test(handle)) return { ok: false, error: "that doesn't look like a handle" };
  const dup = existing.find((r) => r.platform === platform && r.handle === handle);
  if (dup) {
    if (dup.status === "removed") await ctx.db.patch(dup._id, { status: "active" });
    return { ok: true, id: dup._id };
  }
  if (existing.filter((r) => r.status !== "removed").length >= 10) return { ok: false, error: "ten is the most she can watch closely" };
  // §27: who added it, and why, so a suggestion's pick rate and its reason can be read back.
  const id = await ctx.db.insert("trackedAccounts", { creatorId, platform, handle, status: "active", addedBy: opts.addedBy ?? "creator", ...(opts.why ? { why: clip(opts.why, 300) } : {}), baselineN: 0, createdAt: Date.now() } as never);
  return { ok: true, id };
}

export const addAdmired = internalMutation({
  args: { creatorId: v.id("creators"), platform: v.union(v.literal("tiktok"), v.literal("instagram")), handle: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    const existing = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    const r = await addTracked(ctx as never, a.creatorId, a.platform, a.handle, existing);
    if (r.ok) await ctx.scheduler.runAfter(0, internal.media.refreshAvatars, { creatorId: a.creatorId });
    if (!r.ok) return { ok: false, body: r.error === "ten is the most she can watch closely" ? "you're at ten, which is the most i can watch closely. tell me who to drop and i'll swap." : `couldn't add that one: ${r.error}.` };
    return { ok: true, body: `watching @${a.handle.replace(/^@/, "").toLowerCase()} on ${a.platform} now. i'll know their normal in a day or two.` };
  },
});

/** The chat tool's drop, after they confirmed it in the conversation. Scoped to their own rows; history kept. */
export const stopWatchingNow = internalMutation({
  args: { creatorId: v.id("creators"), handle: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    const handle = a.handle.trim().replace(/^@/, "").toLowerCase();
    const rows = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    const t = rows.find((r) => r.handle === handle && r.status !== "removed");
    if (!t) return { ok: false, body: `@${handle} isn't on their list` };
    await ctx.db.patch(t._id, { status: "removed" });
    return { ok: true, body: `stopped watching @${handle}` };
  },
});

/** "Stop watching @x" is destructive, so it becomes the same buttons the three-passes question uses. */
export const stopWatchingButtons = internalMutation({
  args: { creatorId: v.id("creators"), handle: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string; buttons?: Array<{ id: string; label: string }> }> => {
    const handle = a.handle.trim().replace(/^@/, "").toLowerCase();
    const rows = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    const t = rows.find((r) => r.handle === handle && r.status !== "removed");
    if (!t) return { ok: false, body: `@${handle} isn't on your list. ${rows.filter((r) => r.status !== "removed").length ? `you're watching ${rows.filter((r) => r.status !== "removed").map((r) => "@" + r.handle).join(", ")}.` : "you're not watching anyone yet."}` };
    return { ok: true, body: `drop @${handle}? one tap and they're off; add them back any time.`, buttons: [{ id: `watch:${t._id}:stop`, label: "yes, stop watching" }, { id: `watch:${t._id}:keep`, label: "keep" }] };
  },
});

function pretty(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}
