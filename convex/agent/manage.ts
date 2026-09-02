/**
 * Management in plain words (plan §1 "chat is complete", §11.3). "no messages before
 * 9", "be blunter", "stop watching @x", "add @y", "i make running videos now" are the
 * same rows the Settings controls write, decided by the classifier, executed here by
 * code, confirmed in one line. Destructive ones (stop watching) confirm with a button
 * first; the rest apply immediately and say so, because undo is one more sentence.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const MANAGE_ACTIONS = ["quiet_hours", "tone", "add_admired", "stop_watching", "niche"] as const;
export type ManageAction = (typeof MANAGE_ACTIONS)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const setQuietHours = internalMutation({
  args: { creatorId: v.id("creators"), start: v.string(), end: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    if (!HHMM.test(a.start) || !HHMM.test(a.end)) return { ok: false, body: "i didn't catch the hours. say it like 'nothing before 9am' or 'quiet from 10pm to 8am'." };
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { ok: false, body: "" };
    await ctx.db.patch(c._id, { quietHours: { start: a.start, end: a.end }, updatedAt: Date.now() });
    return { ok: true, body: `done: nothing from me between ${pretty(a.start)} and ${pretty(a.end)}. it's in settings if you want to change it.` };
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

export const setNiche = internalMutation({
  args: { creatorId: v.id("creators"), text: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !a.text.trim()) return { ok: false, body: "" };
    await ctx.db.patch(c._id, { niche: a.text.trim().slice(0, 300), updatedAt: Date.now() });
    return { ok: true, body: `noted, in your words: "${a.text.trim().slice(0, 120)}". i'll read your lane that way from the next pass.` };
  },
});

/** The same rules as the web control: lowercase handle, revive a removed one, ten at most. */
export async function addTracked(ctx: { db: { query: (t: "trackedAccounts") => unknown; patch: (id: Id<"trackedAccounts">, v: Partial<Doc<"trackedAccounts">>) => Promise<void>; insert: (t: "trackedAccounts", v: Omit<Doc<"trackedAccounts">, "_id" | "_creationTime">) => Promise<Id<"trackedAccounts">> } }, creatorId: Id<"creators">, platform: "tiktok" | "instagram", rawHandle: string, existing: Doc<"trackedAccounts">[]): Promise<{ ok: boolean; error?: string; id?: Id<"trackedAccounts"> }> {
  const handle = rawHandle.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_.]{2,30}$/.test(handle)) return { ok: false, error: "that doesn't look like a handle" };
  const dup = existing.find((r) => r.platform === platform && r.handle === handle);
  if (dup) {
    if (dup.status === "removed") await ctx.db.patch(dup._id, { status: "active" });
    return { ok: true, id: dup._id };
  }
  if (existing.filter((r) => r.status !== "removed").length >= 10) return { ok: false, error: "ten is the most she can watch closely" };
  const id = await ctx.db.insert("trackedAccounts", { creatorId, platform, handle, status: "active", addedBy: "creator", baselineN: 0, createdAt: Date.now() } as never);
  return { ok: true, id };
}

export const addAdmired = internalMutation({
  args: { creatorId: v.id("creators"), platform: v.union(v.literal("tiktok"), v.literal("instagram")), handle: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; body: string }> => {
    const existing = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    const r = await addTracked(ctx as never, a.creatorId, a.platform, a.handle, existing);
    if (!r.ok) return { ok: false, body: r.error === "ten is the most she can watch closely" ? "you're at ten, which is the most i can watch closely. tell me who to drop and i'll swap." : `couldn't add that one: ${r.error}.` };
    return { ok: true, body: `watching @${a.handle.replace(/^@/, "").toLowerCase()} on ${a.platform} from the next pass. i'll know their normal in a day or two.` };
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
