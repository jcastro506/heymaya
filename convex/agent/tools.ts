/**
 * The tool belt (plan §13.11 (1)). Every read kind that is useful mid-judgment,
 * exposed to the model as a typed tool with a one-line purpose and its price, and
 * executed ONLY through `read()` so the cache, the in-flight claim and the credit
 * ledger apply. Results are summarised by code before they go back to the model:
 * counts, ids, the first few hundred characters, never the raw payload. Two tools
 * are ours, not the vendor's: the creator's own rhyming posts and their taste.
 */

import type { OpenRouterTool } from "../integrations/openrouter/client";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { parseLink } from "./inbound";

export const SUMMARY_CAP = 1800; // characters of tool result the model sees, per call

export interface ToolBudget { calls: number; credits: number; deadlineAt: number }
export const DEFAULT_BUDGET = (): ToolBudget => ({ calls: 6, credits: 40, deadlineAt: Date.now() + 60_000 });

/** Approximate credit prices per call (the ledger records the vendor's real number). */
export const TOOL_CREDITS: Record<string, number> = { post_info: 1, post_transcript: 1, post_comments: 1, sound_info: 1, sound_videos: 1, profile: 1, account_posts: 1, search_keyword: 1, search_hashtag: 1, search_top: 1, own_rhymes: 0, taste: 0, calendar_upcoming: 0 };

const str = { type: "string" } as const;

export const TOOLS: OpenRouterTool[] = [
  { type: "function", function: { name: "post_info", description: "Stats, caption, sound id, author and length for one post. 1 credit. Use to check the numbers behind a candidate or a link.", parameters: { type: "object", properties: { url: str, why: str }, required: ["url", "why"] } } },
  { type: "function", function: { name: "post_transcript", description: "What is said in the post, as text. 1 credit. You have NOT watched it; this is the words.", parameters: { type: "object", properties: { url: str, why: str }, required: ["url", "why"] } } },
  { type: "function", function: { name: "post_comments", description: "The top comments: what people are reacting to. 1 credit (15 on Instagram, so only when it decides something).", parameters: { type: "object", properties: { url: str, why: str }, required: ["url", "why"] } } },
  { type: "function", function: { name: "sound_info", description: "A TikTok sound: title, author, how many videos use it. 1 credit. Use when the sound might be the reason, not the account.", parameters: { type: "object", properties: { clipId: str, why: str }, required: ["clipId", "why"] } } },
  { type: "function", function: { name: "sound_videos", description: "Recent videos on a TikTok sound: is it rising, who else used it. 1 credit.", parameters: { type: "object", properties: { clipId: str, why: str }, required: ["clipId", "why"] } } },
  { type: "function", function: { name: "profile", description: "An account's size and bio. 1 credit. Use to tell a breakout from a big account being big.", parameters: { type: "object", properties: { platform: { type: "string", enum: ["tiktok", "instagram"] }, handle: str, why: str }, required: ["platform", "handle", "why"] } } },
  { type: "function", function: { name: "account_posts", description: "An account's recent posts with numbers, to compute its normal and see whether this one is above it. 1 credit.", parameters: { type: "object", properties: { platform: { type: "string", enum: ["tiktok", "instagram"] }, handle: str, why: str }, required: ["platform", "handle", "why"] } } },
  { type: "function", function: { name: "search_keyword", description: "TikTok posts for a keyword this week, most liked first: is this shape a wave right now, or one account? 1 credit.", parameters: { type: "object", properties: { keyword: str, why: str }, required: ["keyword", "why"] } } },
  { type: "function", function: { name: "search_hashtag", description: "TikTok posts under a hashtag. 1 credit.", parameters: { type: "object", properties: { hashtag: str, why: str }, required: ["hashtag", "why"] } } },
  { type: "function", function: { name: "own_rhymes", description: "The creator's OWN posts that rhyme with a topic or format, with their multiples. Free. Use before saying 'this is yours to take'.", parameters: { type: "object", properties: { query: str, why: str }, required: ["query", "why"] } } },
  { type: "function", function: { name: "calendar_upcoming", description: "What is on the creator's calendar in the next two weeks (titles and times only). Free.", parameters: { type: "object", properties: { why: str }, required: ["why"] } } },
];

export interface ToolCallRecord { tool: string; params: Record<string, unknown>; why: string; credits?: number; ms: number; ok: boolean }

function cap(s: string): string {
  return s.length > SUMMARY_CAP ? `${s.slice(0, SUMMARY_CAP)}… (cut)` : s;
}

type Post = { postId?: string; url?: string | null; caption?: string | null; postedAt?: number | null; createTime?: number; durationSec?: number | null; authorHandle?: string | null; clipId?: string | null; metrics?: { viewCount?: number | null; likeCount?: number | null; commentCount?: number | null; shareCount?: number | null; saveCount?: number | null } };

function postLine(p: Post): string {
  const m = p.metrics ?? {};
  const when = p.postedAt ?? p.createTime;
  return `${p.url ?? p.postId ?? "?"} · ${p.authorHandle ? "@" + p.authorHandle + " · " : ""}${when ? new Date(when).toISOString().slice(0, 10) : "?"} · ${m.viewCount ?? "?"} views, ${m.likeCount ?? "?"} likes, ${m.commentCount ?? "?"} comments, ${m.shareCount ?? "?"} shares${p.durationSec ? ` · ${p.durationSec}s` : ""}${p.clipId ? ` · sound ${p.clipId}` : ""} · "${(p.caption ?? "").slice(0, 100)}"`;
}

/** Reads come back as an array, or as a research envelope `{ posts: [...] }`. */
function postsOf(value: unknown): Post[] {
  if (Array.isArray(value)) return value as Post[];
  const posts = (value as { posts?: unknown } | null)?.posts;
  return Array.isArray(posts) ? (posts as Post[]) : [];
}

function summarize(tool: string, value: unknown): string {
  if (value === null || value === undefined) return "nothing came back";
  switch (tool) {
    case "post_info":
      return cap(postLine(value as Post));
    case "post_transcript": {
      const t = (value as { transcript?: string | null }).transcript;
      return t ? cap(t) : "no transcript available for this post";
    }
    case "post_comments": {
      const rows = (Array.isArray(value) ? value : []) as Array<{ text?: string; likeCount?: number | null; authorHandle?: string | null }>;
      if (!rows.length) return "no comments returned";
      return cap(rows.slice(0, 15).map((c) => `(${c.likeCount ?? 0}) ${(c.text ?? "").slice(0, 120)}`).join("\n"));
    }
    case "account_posts":
    case "search_keyword":
    case "search_hashtag": {
      const rows = postsOf(value);
      if (!rows.length) return "no posts returned";
      const views = rows.map((p) => p.metrics?.viewCount ?? 0).filter((x) => x > 0).sort((a, b) => a - b);
      const median = views.length ? views[Math.floor(views.length / 2)] : null;
      return cap(`${rows.length} posts${median !== null ? `, median ${median} views` : ""}\n${rows.slice(0, 12).map(postLine).join("\n")}`);
    }
    case "profile": {
      const p = value as { handle?: string; followerCount?: number | null; postCount?: number | null; bio?: string | null; displayName?: string | null; verified?: boolean };
      return cap(`@${p.handle ?? "?"} · ${p.followerCount ?? "?"} followers · ${p.postCount ?? "?"} posts${p.verified ? " · verified" : ""} · ${p.displayName ?? ""} · "${(p.bio ?? "").slice(0, 160)}"`);
    }
    default:
      return cap(JSON.stringify(value));
  }
}

/**
 * Run one tool. Refuses over budget, refuses unknown tools, and never reads outside `read()`.
 * The creator's own posts and calendar come from rows scoped by creatorId.
 */
export async function runTool(ctx: ActionCtx, creatorId: Id<"creators">, call: { name: string; args: Record<string, unknown> }, budget: ToolBudget, trace: ToolCallRecord[]): Promise<string> {
  const why = String(call.args.why ?? "").slice(0, 160);
  const started = Date.now();
  const record = (ok: boolean, credits?: number) => trace.push({ tool: call.name, params: Object.fromEntries(Object.entries(call.args).filter(([k]) => k !== "why")), why, credits, ms: Date.now() - started, ok });
  if (trace.length >= budget.calls) {
    record(false, 0);
    return `refused: the call budget (${budget.calls}) is spent. Answer with what you have.`;
  }
  if (Date.now() > budget.deadlineAt) {
    record(false, 0);
    return "refused: out of time. Answer with what you have.";
  }
  const price = TOOL_CREDITS[call.name];
  if (price === undefined) {
    record(false, 0);
    return `refused: no tool named ${call.name}`;
  }
  const spent = trace.reduce((s, t) => s + (t.credits ?? 0), 0);
  if (spent + price > budget.credits) {
    record(false, 0);
    return `refused: the credit budget (${budget.credits}) would be exceeded. Answer with what you have.`;
  }
  try {
    let value: unknown;
    if (call.name === "own_rhymes") {
      value = await ctx.runQuery(internal.agent.toolsData.ownRhymes, { creatorId, query: String(call.args.query ?? "") });
      record(true, 0);
      const rows = value as Array<{ url: string; multiple: number | null; caption: string; createTime: number }>;
      return rows.length ? cap(rows.map((r) => `${r.url} · ${new Date(r.createTime).toISOString().slice(0, 10)} · ${r.multiple ?? "?"}× · "${r.caption.slice(0, 100)}"`).join("\n")) : "nothing of theirs rhymes with that";
    }
    if (call.name === "calendar_upcoming") {
      value = await ctx.runQuery(internal.calendar.sync.upcoming, { creatorId, now: Date.now() });
      record(true, 0);
      const rows = value as Array<{ title: string; start: number; allDay: boolean; class: string }>;
      return rows.length ? cap(rows.map((e) => `${new Date(e.start).toISOString().slice(0, 10)} · ${e.title} (${e.class})`).join("\n")) : "nothing on their calendar in the next two weeks, or no calendar connected";
    }
    const link = typeof call.args.url === "string" ? parseLink(call.args.url) : null;
    const platform = (call.args.platform as "tiktok" | "instagram" | undefined) ?? link?.platform ?? "tiktok";
    let kind: string;
    let params: Record<string, unknown>;
    switch (call.name) {
      case "post_info":
        kind = "post.info";
        params = { platform, url: link?.url ?? call.args.url };
        break;
      case "post_transcript":
        kind = "post.transcript";
        params = { platform, url: link?.url ?? call.args.url };
        break;
      case "post_comments":
        kind = "post.comments";
        params = { platform, url: link?.url ?? call.args.url };
        break;
      case "sound_info":
        kind = "sound.tiktok";
        params = { clipId: String(call.args.clipId ?? "") };
        break;
      case "sound_videos":
        kind = "sound.tiktokVideos";
        params = { clipId: String(call.args.clipId ?? "") };
        break;
      case "profile":
        kind = "profile";
        params = { platform, handle: String(call.args.handle ?? "").replace(/^@/, "") };
        break;
      case "account_posts":
        kind = "account.posts";
        params = { platform, handle: String(call.args.handle ?? "").replace(/^@/, ""), sort: "latest", slot: "investigate" };
        break;
      case "search_keyword":
        kind = "search.keyword";
        params = { keyword: String(call.args.keyword ?? ""), window: "this-week", sort: "most-liked" };
        break;
      case "search_hashtag":
        kind = "search.hashtag";
        params = { hashtag: String(call.args.hashtag ?? "").replace(/^#/, "") };
        break;
      default:
        record(false, 0);
        return `refused: no tool named ${call.name}`;
    }
    const r = await ctx.runAction(internal.reads.read.read, { kind, params, creatorId });
    record(true, r.cached ? 0 : price);
    return summarize(call.name, r.value);
  } catch (e) {
    record(false, 0);
    return `failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`;
  }
}
