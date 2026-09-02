/**
 * The pulse: how a creator is doing with her, read from what they do, never asked.
 * Replies, reactions, taps, ideas taken, posts made, and silence, over the last seven
 * and twenty-eight days, folded into one word by code: warm · steady · cooling ·
 * silent. The operator reads it per creator; the weekly review reads it so a
 * cooling creator gets one specific question about their content, not a survey.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type PulseWord = "warm" | "steady" | "cooling" | "silent" | "new";

export interface Pulse {
  word: PulseWord;
  why: string;
  week: { sent: number; replies: number; reactions: number; taken: number; passed: number; posts: number };
  month: { sent: number; replies: number; taken: number; posts: number };
  daysSinceLastReply: number | null;
  daysSincePaired: number | null;
}

/** Pure: the word from the counts. Rules, not a model; tune from the pilot journal. */
export function pulseWord(input: { week: Pulse["week"]; month: Pulse["month"]; daysSinceLastReply: number | null; daysSincePaired: number | null }): { word: PulseWord; why: string } {
  const { week, month, daysSinceLastReply, daysSincePaired } = input;
  if (daysSincePaired !== null && daysSincePaired < 3) return { word: "new", why: "paired under three days ago" };
  if (month.sent >= 3 && daysSinceLastReply !== null && daysSinceLastReply >= 14) return { word: "silent", why: `no reply in ${daysSinceLastReply} days across ${month.sent} messages` };
  if (month.sent >= 3 && month.replies === 0 && month.taken === 0) return { word: "silent", why: `${month.sent} messages this month, nothing back` };
  const engaged = week.replies + week.reactions + week.taken;
  if (week.taken >= 1 || week.posts >= 1 && engaged >= 2) return { word: "warm", why: `${week.taken} idea${week.taken === 1 ? "" : "s"} taken, ${week.posts} post${week.posts === 1 ? "" : "s"}, ${week.replies} repl${week.replies === 1 ? "y" : "ies"} this week` };
  if (engaged >= 1 && week.passed <= engaged) return { word: "steady", why: `${engaged} touch${engaged === 1 ? "" : "es"} this week` };
  if (week.sent >= 2 && engaged === 0) return { word: "cooling", why: `${week.sent} sent this week, nothing back` };
  if (week.passed > engaged) return { word: "cooling", why: `${week.passed} passed, ${engaged} taken this week` };
  return { word: "steady", why: "quiet week on both sides" };
}

export const pulseFor = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<Pulse | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const week = a.now - 7 * 86_400_000;
    const month = a.now - 28 * 86_400_000;
    const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", month)).collect()) as Doc<"messages">[];
    const events = (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("at", month)).collect()) as Doc<"tasteEvents">[];
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("createTime", month)).collect()) as Doc<"ownPosts">[];
    const sentIn = (since: number) => messages.filter((m) => m.direction === "out" && m.proactive && m.ts >= since).length;
    const repliesIn = (since: number) => messages.filter((m) => m.direction === "in" && (m.kind ?? "inbound") === "inbound" && m.ts >= since).length;
    const TAKEN = new Set(["posted", "blocked", "shotlist", "heart", "save", "reply_pos"]);
    const takenIn = (since: number) => events.filter((e) => TAKEN.has(e.kind) && e.at >= since).length;
    const lastReply = messages.filter((m) => m.direction === "in").sort((x, y) => y.ts - x.ts)[0];
    const pulse = {
      week: { sent: sentIn(week), replies: repliesIn(week), reactions: messages.filter((m) => m.direction === "in" && m.kind === "reaction" && m.ts >= week).length, taken: takenIn(week), passed: events.filter((e) => (e.kind === "notme" || e.kind === "thumbs_down" || e.kind === "reply_neg") && e.at >= week).length, posts: posts.filter((p) => p.createTime >= week).length },
      month: { sent: sentIn(month), replies: repliesIn(month), taken: takenIn(month), posts: posts.length },
      daysSinceLastReply: lastReply ? Math.floor((a.now - lastReply.ts) / 86_400_000) : null,
      daysSincePaired: c.channel.paired ? Math.floor((a.now - (c.updatedAt ?? c.createdAt)) / 86_400_000) : null,
    };
    return { ...pulseWord(pulse), ...pulse };
  },
});

export type PulseCreatorId = Id<"creators">;
