/**
 * Context assembly (plan §15.1). Stable prefix first, byte-identical for a creator
 * within a week; variable suffix after. A test asserts the prefix is identical
 * across two consecutive turns.
 */

import { internalQuery, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { SOUL, SOUL_VERSION, REGISTER_ADDENDA } from "./soul";
import { summarize, type Affinity } from "../taste/affinities";
import { voiceFor, voiceSection } from "./voice";

export const RECENT_MESSAGES = 20;
export const CONTEXT_VERSION = "ctx-2026-09-02.1";

export interface AssembledContext {
  prefix: string;
  suffix: string;
  produced: { skillVersion: string; model: string; thresholdsVersion: string };
  creator: Doc<"creators">;
  lastInbound: Doc<"messages"> | null;
}

export const gather = internalQuery({
  args: { creatorId: v.id("creators"), messageId: v.optional(v.id("messages")) },
  handler: async (ctx, args): Promise<{ creator: Doc<"creators">; directives: Doc<"directives">[]; recent: Doc<"messages">[]; target: Doc<"messages"> | null; personal: string; voice: string } | null> => {
    const creator = (await ctx.db.get(args.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const directives = (await ctx.db
      .query("directives")
      .withIndex("by_creator_and_active", (q) => q.eq("creatorId", args.creatorId).eq("active", true))
      .collect()) as Doc<"directives">[];
    const recent = (await ctx.db
      .query("messages")
      .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", args.creatorId))
      .order("desc")
      .take(RECENT_MESSAGES)) as Doc<"messages">[];
    const target = args.messageId ? ((await ctx.db.get(args.messageId)) as Doc<"messages"> | null) : null;
    const personal = await personalFor(ctx, creator);
    // Their own sentences, on every turn. Describing a voice does not reproduce it.
    const voice = voiceSection(await voiceFor(ctx, creator._id));
    return { creator, directives, recent: recent.reverse(), target, personal, voice };
  },
});

/**
 * Hyper-personal by construction: every skill sees their last week of posts with the
 * numbers and their next few days, compactly, on every turn. What she says about a
 * trend, a draft or an idea is said against their own work and their own life.
 */
export async function personalFor(ctx: QueryCtx, creator: Doc<"creators">): Promise<string> {
  const now = Date.now();
  const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).order("desc").take(6)) as Doc<"ownPosts">[];
  const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", creator._id).gte("start", now).lte("start", now + 7 * 86_400_000)).take(8)) as Doc<"calendarEvents">[];
  const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", creator._id).gte("start", now).lte("start", now + 7 * 86_400_000)).take(4)) as Doc<"calendarBlocks">[];
  const day = (t: number) => new Intl.DateTimeFormat("en-US", { timeZone: creator.timezone, weekday: "short", month: "short", day: "numeric" }).format(t);
  const week = posts.map((p) => `- ${day(p.createTime)} · ${p.metrics.views.toLocaleString()} views${p.multiple !== undefined ? ` (${p.multiple}× their normal)` : ""} · "${p.caption.slice(0, 70)}"${p.url ? ` · ${p.url}` : ""}`);
  const life = [
    ...events.filter((e) => e.status === "active" && e.class !== "private" && e.title).map((e) => `- ${day(e.start)} · ${e.title}${e.class === "filmable" ? " (could film around this)" : ""}`),
    ...blocks.filter((b) => b.status !== "deleted").map((b) => `- ${day(b.start)} · your block: ${b.title} (${b.status})`),
  ];
  return `# Their recent posts (newest first; the numbers you may cite about them)\n${week.join("\n") || "- none read yet"}\n\n# Their next few days (titles only; never private events)\n${life.join("\n") || "- nothing on the calendar, or no calendar connected"}`;
}

/** Build the stable prefix: soul → register → skill → dossier → directives → live notes. */
export function buildPrefix(input: { creator: Doc<"creators">; directives: Doc<"directives">[]; skill: string; personal?: string; voice?: string }): string {
  const c = input.creator;
  const notes = (c.notes ?? []).filter((n) => !n.tombstonedAt && (!n.expiresHint || n.expiresHint > Date.now()));
  const dossier = c.dossier ? JSON.stringify(c.dossier) : `{"mode":"newCreator","note":"no dossier yet — the catalogue read has not finished"}`;
  return [
    SOUL,
    REGISTER_ADDENDA[c.tone ?? "friend"],
    `# Skill\n${input.skill}`,
    `# The creator (their dossier, evidence-backed; say "unknown" for anything not in it)\nHandles: ${JSON.stringify(c.handles)}\nTheir words about what they make: ${JSON.stringify(c.niche)}\nTimezone: ${c.timezone}\n${dossier}`,
    tasteSection(c),
    ...(input.voice ? [input.voice] : []),
    ...(input.personal ? [input.personal] : []),
    `# House rules, verbatim (${input.directives.length})\n${input.directives.map((d) => `- ${d.verbatim}`).join("\n") || "- none yet"}`,
    `# Things they told you (${notes.length})\n${notes.map((n) => `- ${n.text}`).join("\n") || "- nothing yet"}`,
  ].join("\n\n");
}

/** §13.10 (4): what they take, in prose, plus the strongest computed likes and dislikes. */
function tasteSection(c: Doc<"creators">): string {
  const { likes, dislikes } = summarize((c.affinities ?? []) as Affinity[], Date.now());
  const note = c.taste?.text ?? "no note yet — you have not seen enough of their reactions";
  return `# Their taste (what they actually take from you; weigh it, name what is different when you go against it)\n${note}\nComputed, decayed, (score, count): took ${likes.join(", ") || "nothing yet"} · passed on ${dislikes.join(", ") || "nothing yet"}`;
}

/** The variable suffix: the recent conversation, oldest first, then the message being answered. */
export function buildSuffix(input: { recent: Doc<"messages">[]; target: Doc<"messages"> | null }): string {
  const lines = input.recent.map((m) => `${m.direction === "in" ? "them" : "you"}: ${m.body}`);
  const t = input.target;
  const targetLine = t ? `\n\nAnswer this one:\nthem${t.kind && t.kind !== "inbound" ? ` (${t.kind})` : ""}: ${t.body}` : "";
  return `# Recent conversation (oldest first)\n${lines.join("\n") || "(none)"}${targetLine}`;
}

export function producedStamp(model: string): { skillVersion: string; model: string; thresholdsVersion: string } {
  return { skillVersion: `${SOUL_VERSION}+${CONTEXT_VERSION}`, model, thresholdsVersion: "thresholds-0" };
}

export type CreatorId = Id<"creators">;
