/**
 * What they can do with her, taught one thing at a time in their first week (2026-11-04). The opening proves
 * she's good; it can't also be a manual (nobody reads one in Messages), and a capabilities list reads like a
 * bot. But someone who never learns they can send her a draft waits to be texted, and she becomes a feed they
 * ignore (a tester's first week). So each thing is taught once, at the moment it fits, never on its own text,
 * and never when they've already found it themselves.
 *
 *   drafts  in a reply, until they've sent a video        "anytime you film something, send it here…"
 *   shares  in a reply, until they've sent a TikTok        "see a tiktok you wish you'd made? send it…"
 *   app     when they first save an idea, until they've opened one in the app
 *   pace    with her first idea she found on her own: how often, and that "less" works
 *
 * At most one a day, only in the first week (pace and app: the first two). In a reply, code adds it and a
 * cheap screener call judges whether the moment fits (live on dev: told it was optional, the writer left it
 * out of every reply, the perfect moment included). The opening itself carries the rhythm in its
 * save-the-number line (conversation.saveContactLine).
 */
import { v } from "convex/values";
import { internalQuery, type ActionCtx, type QueryCtx } from "../_generated/server";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import type { Doc, Id } from "../_generated/dataModel";

export type LessonId = "drafts" | "shares" | "app" | "pace";

const H = 3_600_000, D = 24 * H;

export const LESSONS = {
  /** Reply lessons only in their first week from pairing. */
  windowMs: 7 * D,
  /** The moment lessons (app, pace) in their first two. */
  momentWindowMs: 14 * D,
  /** One lesson a day at most. */
  gapMs: 20 * H,
} as const;

export const LESSON_TEXT: Record<LessonId, string> = {
  drafts: "anytime you film something, send it here before you post and i'll tell you what i'd change",
  shares: "see a tiktok you wish you'd made? send it to me and i'll pull out what's worth stealing",
  app: "it's in your Maya app under Ideas, and the shot list goes there too when i write it",
  pace: "i'll text you like this when i find something worth making, usually about once a day. say \"less\" anytime",
};

/** What they've already found on their own: a lesson about it is never taught. */
export interface LessonUsage { sentVideo: boolean; sentTiktok: boolean; openedInApp: boolean }

export function lessonKey(id: LessonId, day: string): string {
  return `lesson:${id}:${day}`;
}

/** Pure: `lesson:<id>:<yyyy-mm-dd>` entries in milestonesSaid → what was taught, and when (noon UTC of that day). */
export function lessonsSaid(said: string[]): Array<{ id: LessonId; at: number }> {
  return said.flatMap((s) => {
    const m = /^lesson:(drafts|shares|app|pace):(\d{4}-\d{2}-\d{2})$/.exec(s);
    return m ? [{ id: m[1] as LessonId, at: Date.parse(`${m[2]}T12:00:00Z`) }] : [];
  });
}

function open(said: string[], now: number): boolean {
  return !lessonsSaid(said).some((l) => now - l.at < LESSONS.gapMs);
}

/** Pure: the one lesson her reply may carry right now, or null. */
export function replyLesson(input: { usage: LessonUsage; said: string[]; now: number; pairedAt?: number }): { id: LessonId; text: string } | null {
  const { usage, said, now, pairedAt } = input;
  if (!pairedAt || now - pairedAt > LESSONS.windowMs || now < pairedAt) return null;
  if (!open(said, now)) return null;
  const taught = new Set(lessonsSaid(said).map((l) => l.id));
  if (!usage.sentVideo && !taught.has("drafts")) return { id: "drafts", text: LESSON_TEXT.drafts };
  if (!usage.sentTiktok && !taught.has("shares")) return { id: "shares", text: LESSON_TEXT.shares };
  return null;
}

/** Pure: a moment lesson (the first save; her first find), or null. Pace ignores the daily gap: it's about her text, not theirs. */
export function momentLesson(id: "app" | "pace", input: { usage?: LessonUsage; said: string[]; now: number; pairedAt?: number }): string | null {
  const { usage, said, now, pairedAt } = input;
  if (!pairedAt || now - pairedAt > LESSONS.momentWindowMs || now < pairedAt) return null;
  if (lessonsSaid(said).some((l) => l.id === id)) return null;
  if (id === "app" && (usage?.openedInApp || !open(said, now))) return null;
  return LESSON_TEXT[id];
}

/** Pure: did her text carry the lesson? Its words in order, ignoring case, punctuation and quotes. */
export function carriesLesson(text: string, lesson: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return norm(text).includes(norm(lesson).split(" ").slice(0, 8).join(" "));
}

/** Pure: where a lesson goes in a message: its own last text, or before her question so the question stays last. */
export function withLesson(body: string, lesson: string): string {
  const parts = body.split(/\n[ \t]*---[ \t]*\n/);
  const last = parts[parts.length - 1]?.trim() ?? "";
  if (parts.length > 1 && /\?\s*$/.test(last)) return [...parts.slice(0, -1), lesson, last].join("\n---\n");
  return `${body}\n---\n${lesson}`;
}

/** Rows → what they've found on their own. Bounded reads. */
export async function lessonUsage(ctx: QueryCtx, creatorId: Id<"creators">): Promise<LessonUsage> {
  const finished = (await ctx.db.query("finishes").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).take(1)).length > 0;
  const inbound = ((await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creatorId)).order("desc").take(300)) as Doc<"messages">[]).filter((m) => m.direction === "in");
  const sentVideo = finished || inbound.some((m) => m.kind === "file" && /^video\//.test(m.fileMime ?? ""));
  const sentTiktok = inbound.some((m) => m.kind === "share" || /tiktok\.com\//i.test(m.body ?? ""));
  const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).order("desc").take(100)) as Doc<"ideas">[];
  return { sentVideo, sentTiktok, openedInApp: ideas.some((i) => Boolean(i.seenAt)) };
}

export const usageFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<LessonUsage> => await lessonUsage(ctx, a.creatorId),
});

export const LESSON_FIT_PROMPT = `A content creator texted their assistant, and the assistant wrote a reply. Should the reply end with a short friendly tip about something else they can do with the assistant? Answer "no" if the creator sounds upset, stressed, discouraged or is venting, asked to wait or stop, or is in the middle of something urgent. Otherwise answer "yes". Answer only yes or no.`;

/** Does this moment have room for the tip? The screener judges; anything but a clear yes leaves it out. */
export async function lessonFits(ctx: ActionCtx, creatorId: Id<"creators">, theirText: string, reply: string): Promise<boolean> {
  try {
    const r = await callModel(ctx, { creatorId, purpose: "lesson_fit", model: REGISTRY.screener.primary, messages: [{ role: "system", content: LESSON_FIT_PROMPT }, { role: "user", content: `Creator: ${theirText.slice(0, 400)}\nReply: ${reply.slice(0, 600)}` }], temperature: 0, maxTokens: 3, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    return r.ok && r.content.trim().toLowerCase().startsWith("yes");
  } catch {
    return false;
  }
}

/** Her context section: she knows the tip may follow her reply, so she doesn't say the same thing herself. */
export function lessonSection(lesson: { text: string } | null): string {
  if (!lesson) return "";
  return `# A tip that may follow your reply (their first week)
Code may add this after your reply as its own short text: "${lesson.text}". Don't say it yourself and don't refer to it; just answer them.`;
}
