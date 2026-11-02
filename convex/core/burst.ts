/**
 * One burst, one reply (2026-11-02). People text in bursts: two videos, "oh wrong ones", two more,
 * "this is for halloween", "which sound?". Adina's Halloween burst got ten replies in six minutes,
 * a review of the videos she'd said were wrong, and three more after "stop texting for a minute".
 *
 * The rules, all code:
 * - A turn waits a few seconds after their last text (SETTLE), so a burst lands before she answers.
 * - A turn whose message has a newer one behind it is skipped: the newest turn answers the whole
 *   burst (everything they sent since her last reply). Never past MAX_HOLD, so a long burst still
 *   gets answered as it goes.
 * - A reply about to go out is held the same way if they wrote again while it was being written
 *   (inside `messages.send`, so no path forgets it).
 * - "hold on" / "stop texting for a minute" (hush): anything of hers not yet delivered is withdrawn
 *   at once, she says one short line, and she starts nothing until they write again.
 *
 * Grouping never means a longer text: the reply to a burst is held to the same bubble caps
 * (core/envelope) and is told to stay short.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "./llm";
import { REGISTRY } from "../agent/registry";
import { classifyInbound } from "../agent/inbound";

/** Inbound kinds that make up a burst. Taps, reactions and pairing are signals, never part of one. */
export const BURST_KINDS: ReadonlySet<string> = new Set(["inbound", "file", "share"]);

/** How long after their last text a turn waits, so the rest of the burst can land. */
export const SETTLE_MS = { text: 7_000, file: 10_000 } as const;

/** Tests set this to 0 so a turn runs as soon as it's claimed. */
const settleScale = (): number => Number(process.env.BURST_SETTLE_SCALE ?? "1");

/** A burst older than this gets answered even if they keep typing: grouping must never become silence. */
export const MAX_HOLD_MS = 3 * 60_000;

/** After "hold on", she starts nothing for this long unless they write again. */
export const HUSH_MS = 6 * 3_600_000;

/** The one line she says to a hush. */
export const HUSH_REPLY = "Got it, I'll wait for you.";

type Row = Pick<Doc<"messages">, "_id" | "direction" | "kind" | "ts"> & { withdrawnAt?: number };

const inBurst = (m: Row) => m.direction === "in" && BURST_KINDS.has(m.kind ?? "inbound");

/** Pure: their messages since her last outbound, up to and including the target (oldest first). */
export function burstOf<T extends Row>(rowsAsc: T[], targetId: Id<"messages">): T[] {
  const end = rowsAsc.findIndex((m) => m._id === targetId);
  if (end < 0) return [];
  let start = end;
  while (start > 0) {
    const prev = rowsAsc[start - 1];
    if (prev.direction === "out" && !prev.withdrawnAt) break;
    start--;
  }
  return rowsAsc.slice(start, end + 1).filter(inBurst);
}

export type TurnDecision = { act: "run" } | { act: "wait"; ms: number } | { act: "skip"; reason: string };

/**
 * Pure: should this turn run now, wait for the rest of the burst, or leave it to the newer turn?
 * A command ("stop", "delete my account") always runs on its own.
 */
export function turnDecision(i: { target: Row; newer: Row[]; burstStartTs: number; now: number; command: boolean }): TurnDecision {
  if (!inBurst(i.target)) return { act: "run" };
  const fresh = i.now - i.burstStartTs < MAX_HOLD_MS;
  if (!i.command && fresh && i.newer.some(inBurst)) return { act: "skip", reason: "a newer message answers the burst" };
  const settle = (i.target.kind === "file" ? SETTLE_MS.file : SETTLE_MS.text) * settleScale();
  const age = i.now - i.target.ts;
  // A vendor's timestamp can run ahead of ours: never wait longer than one settle.
  if (!i.command && settle > 0 && age < settle) return { act: "wait", ms: Math.min(settle, settle - age) };
  return { act: "run" };
}

/** Pure: a reply to `answering` is stale if they've written again since, inside a fresh burst. */
export function superseded(i: { answering: Row; newer: Row[]; burstStartTs: number; now: number }): boolean {
  return i.now - i.burstStartTs < MAX_HOLD_MS && i.newer.some(inBurst);
}

async function around(ctx: QueryCtx | MutationCtx, messageId: Id<"messages">): Promise<{ target: Doc<"messages">; burst: Doc<"messages">[]; newer: Doc<"messages">[] } | null> {
  const target = (await ctx.db.get(messageId)) as Doc<"messages"> | null;
  if (!target) return null;
  const before = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", target.creatorId).lte("ts", target.ts)).order("desc").take(30)) as Doc<"messages">[];
  const newer = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", target.creatorId).gt("ts", target.ts)).take(30)) as Doc<"messages">[];
  return { target, burst: burstOf(before.reverse(), target._id), newer };
}

/** For the turn's dispatcher: run, wait, or skip. */
export const decide = internalQuery({
  args: { messageId: v.id("messages"), now: v.number() },
  handler: async (ctx, a): Promise<TurnDecision> => {
    const r = await around(ctx, a.messageId);
    if (!r) return { act: "run" };
    const command = r.target.kind === "inbound" && classifyInbound({ text: r.target.body, kind: "inbound", handles: {} }).route === "command";
    return turnDecision({ target: r.target, newer: r.newer, burstStartTs: r.burst[0]?.ts ?? r.target.ts, now: a.now, command });
  },
});

/** The held check inside `messages.send`. */
export async function replySuperseded(ctx: MutationCtx, answering: Id<"messages">, now: number): Promise<boolean> {
  const r = await around(ctx, answering);
  if (!r || r.target.direction !== "in") return false;
  return superseded({ answering: r.target, newer: r.newer, burstStartTs: r.burst[0]?.ts ?? r.target.ts, now });
}

/** The whole burst a turn answers: oldest first, with what each one was. */
export const burstFor = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, a): Promise<Array<{ id: Id<"messages">; kind: string; body: string; fileMime: string | null; hasFile: boolean; ts: number }>> => {
    const r = await around(ctx, a.messageId);
    if (!r) return [];
    return r.burst.map((m) => ({ id: m._id, kind: m.kind ?? "inbound", body: m.body, fileMime: m.fileMime ?? null, hasFile: Boolean(m.fileId), ts: m.ts }));
  },
});

/** Pure: is this a video they sent (a draft), as opposed to a photo, a voice note or a text? */
export function isVideo(m: { kind: string; fileMime: string | null; hasFile: boolean }): boolean {
  return m.kind === "file" && m.hasFile && (m.fileMime ?? "").toLowerCase().startsWith("video/");
}

/** Pure: the burst as she reads it, videos numbered in the order they came. */
export function burstTranscript(burst: Array<{ kind: string; body: string; fileMime: string | null; hasFile: boolean }>): string {
  let n = 0;
  return burst.map((m) => {
    if (isVideo(m)) { n++; return `[video ${n}]${m.body.trim() ? ` ${m.body.trim()}` : ""}`; }
    if (m.kind === "file") return `[a file]${m.body.trim() ? ` ${m.body.trim()}` : ""}`;
    return m.body.trim();
  }).filter(Boolean).join("\n");
}

// ------------------------------------------------------------------ hush

/** Pure: worth asking the model? Only a short text, while she's mid-reply or just replied. */
export function mightBeHush(text: string, busy: boolean): boolean {
  const t = text.trim();
  return busy && t.length > 0 && t.length <= 80 && !/https?:\/\//i.test(t);
}

export const HUSH_PROMPT = `Someone is texting with their assistant, who is replying right now. Is their new message asking the assistant to stop or pause texting for the moment (e.g. "stop texting for a minute", "hold on", "one sec", "wait", "shh", "brb", "give me a sec", with typos)? A question, an answer, or anything else is no. Answer ONE word: yes or no.`;

/** Is she writing or sending to them right now (a turn in flight, or a reply in the last few minutes)? */
export const busyWith = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<boolean> => {
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator_and_createdAt", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"jobs">[];
    if (jobs.some((j) => (j.kind === "converse" || j.kind === "deliver_message") && (j.status === "queued" || j.status === "running"))) return true;
    const last = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.now - 3 * 60_000)).take(30)) as Doc<"messages">[];
    return last.some((m) => m.direction === "out");
  },
});

/** Withdraw everything of hers not yet delivered, and hold her first texts until they write. */
export const hush = internalMutation({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), now: v.number() },
  handler: async (ctx, a): Promise<{ withdrawn: number }> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.now - 30 * 60_000)).collect()) as Doc<"messages">[];
    let withdrawn = 0;
    for (const m of rows) {
      if (m.direction !== "out" || m.deliveredAt || m.withdrawnAt) continue;
      await ctx.db.patch(m._id, { withdrawnAt: a.now, deliveryError: "withdrawn: they asked her to wait" });
      withdrawn++;
    }
    await ctx.db.patch(a.creatorId, { hushedAt: a.now, hushMessageId: a.messageId });
    return { withdrawn };
  },
});

/** Has this row been withdrawn (checked between the texts of one row, too)? */
export const isWithdrawn = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, a): Promise<boolean> => Boolean(((await ctx.db.get(a.messageId)) as Doc<"messages"> | null)?.withdrawnAt),
});

/** Pure: is she holding her own texts because they said "hold on"? Anything they write after lifts it. */
export function hushed(c: Pick<Doc<"creators">, "hushedAt">, lastInboundTs: number | null, now: number): boolean {
  if (!c.hushedAt || now - c.hushedAt >= HUSH_MS) return false;
  return lastInboundTs === null || lastInboundTs <= c.hushedAt;
}

/**
 * Every inbound text door calls this right after recording the message. Cheap: one tiny model call,
 * and only for a short text while she's busy with them. Never throws into the door.
 */
export const checkHush = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), text: v.string() },
  handler: async (ctx, a): Promise<{ hush: boolean }> => {
    try {
      const busy = await ctx.runQuery(internal.core.burst.busyWith, { creatorId: a.creatorId, now: Date.now() });
      if (!mightBeHush(a.text, busy)) return { hush: false };
      const r = await callModel(ctx, { creatorId: a.creatorId, purpose: "hush_check", model: REGISTRY.screener.primary, messages: [{ role: "system", content: HUSH_PROMPT }, { role: "user", content: a.text.slice(0, 200) }], temperature: 0, maxTokens: 3, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (!r.ok || !r.content.trim().toLowerCase().startsWith("yes")) return { hush: false };
      const w = await ctx.runMutation(internal.core.burst.hush, { creatorId: a.creatorId, messageId: a.messageId, now: Date.now() });
      console.log(`[burst] hush for ${a.creatorId}: withdrew ${w.withdrawn}`);
      return { hush: true };
    } catch (e) {
      console.error(`[burst] hush check failed for ${a.creatorId}: ${String(e)}`);
      return { hush: false };
    }
  },
});

/** For the turn: was this message the hush? */
export const isHushMessage = internalQuery({
  args: { creatorId: v.id("creators"), messageId: v.id("messages") },
  handler: async (ctx, a): Promise<boolean> => ((await ctx.db.get(a.creatorId)) as Doc<"creators"> | null)?.hushMessageId === a.messageId,
});
