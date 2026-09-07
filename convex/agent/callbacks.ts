/**
 * Callbacks (2026-09-07): the three things from their world and their past worth bringing
 * up this week, chosen by code from rows, offered to her in the prefix. This is what "she
 * remembers your dog" looks like as a mechanism: the friend's memory is pre-selected, the
 * friend's timing and phrasing are hers. Never a list in a message; the soul says so.
 */

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const CALLBACKS = { max: 3, recentPostDays: 60, staleIdeaDays: 7 } as const;

export interface Callback { line: string; why: string; kind: "world" | "win" | "unfilmed" | "note" }

export function pickCallbacks(input: {
  now: number;
  world: string | null;
  posts: Array<{ caption: string; createTime: number; multiple: number | null; signature: string | null }>;
  ideas: Array<{ hook: string; savedAt: number | null; sentAt: number | null; status: string }>;
  notes: Array<{ text: string; kind?: string; expiresHint?: number }>;
}): Callback[] {
  const out: Callback[] = [];
  const day = 86_400_000;
  // 1. A saved idea they never filmed, more than a week old: the friend who remembers what you said you'd do.
  const stale = input.ideas.filter((i) => i.savedAt && i.status !== "posted" && input.now - i.savedAt > CALLBACKS.staleIdeaDays * day).sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0))[0];
  if (stale) out.push({ kind: "unfilmed", line: `they saved "${stale.hook.slice(0, 70)}" ${Math.round((input.now - (stale.savedAt ?? input.now)) / day)} days ago and have not filmed it`, why: "a saved idea, not filmed" });
  // 2. Their best recent post, by what it did, with what she saw in it.
  const win = input.posts.filter((p) => input.now - p.createTime < CALLBACKS.recentPostDays * day && (p.multiple ?? 0) >= 1.5).sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))[0];
  if (win) out.push({ kind: "win", line: `their ${win.signature ? win.signature.toLowerCase() : `"${win.caption.slice(0, 60)}"`} did ${win.multiple}× their normal ${Math.round((input.now - win.createTime) / day)} days ago`, why: "a recent win worth calling back" });
  // 3. A live note about their life, soonest-expiring first: the trip, the race, the sister.
  const note = input.notes.filter((n) => n.kind !== "rule" && (!n.expiresHint || n.expiresHint > input.now)).sort((a, b) => (a.expiresHint ?? Infinity) - (b.expiresHint ?? Infinity))[0];
  if (note) out.push({ kind: "note", line: `they told her: "${note.text.slice(0, 90)}"`, why: "something they said, still current" });
  // 4. Their world, when there is room: the recurring things a regular viewer would recognise.
  if (out.length < CALLBACKS.max && input.world) out.push({ kind: "world", line: `their world on camera: ${input.world.slice(0, 120)}`, why: "the recurring things a viewer knows" });
  return out.slice(0, CALLBACKS.max);
}

export function callbacksSection(cb: Callback[]): string | null {
  if (cb.length === 0) return null;
  return `# Worth calling back this week (bring one up when it fits, by name, in passing; never as a list, never all three)\n${cb.map((c) => `- ${c.line} (${c.why})`).join("\n")}`;
}

export async function callbacksFor(ctx: QueryCtx, creator: Doc<"creators">, now = Date.now()): Promise<Callback[]> {
  const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).order("desc").take(60)) as Doc<"ownPosts">[];
  const reads = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).order("desc").take(120)) as Doc<"ownPostReads">[];
  const sig = new Map<string, string>();
  for (const r of reads) { const s = (r.card as { signature?: string } | undefined)?.signature; if (s && !sig.has(String(r.ownPostId))) sig.set(String(r.ownPostId), s); }
  const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).order("desc").take(80)) as Doc<"ideas">[];
  const persona = (creator.dossier as { persona?: { world?: string } } | undefined)?.persona;
  return pickCallbacks({
    now,
    world: persona?.world ?? null,
    posts: posts.map((p) => ({ caption: p.caption, createTime: p.createTime, multiple: p.reachMultiple ?? p.multiple ?? null, signature: sig.get(String(p._id)) ?? null })),
    ideas: ideas.map((i) => ({ hook: (i.version as { hook?: string } | undefined)?.hook ?? i.messageText.slice(0, 80), savedAt: i.savedAt ?? null, sentAt: i.sentAt ?? null, status: i.status })),
    notes: (creator.notes ?? []).filter((n) => !n.tombstonedAt).map((n) => ({ text: n.text, kind: (n as { kind?: string }).kind, expiresHint: n.expiresHint })),
  });
}
