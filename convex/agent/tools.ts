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
export const TOOL_CREDITS: Record<string, number> = { post_info: 10, post_transcript: 1, post_comments: 1, sound_info: 1, sound_videos: 1, sound_reels: 1, profile: 1, account_posts: 1, search_keyword: 1, search_hashtag: 1, search_top: 1, search_reels: 1, search_ig_hashtag: 1, ig_popular: 1, trending_tiktok: 1, trending_reels: 1, suggestions: 1, discover_creators: 1, discover_profiles: 1, own_rhymes: 0, taste: 0, calendar_upcoming: 0, recall: 0, lane_benchmark: 0 };

const str = { type: "string" } as const;

export const TOOLS: OpenRouterTool[] = [
  { type: "function", function: { name: "post_info", description: "Full detail for one post: sound id, media, caption, author, length, stats. 10 credits when the vendor finds the media, so use account_posts (1 credit, the whole feed with stats) when numbers are all you need; post_info is for the sound id or a link they sent.", parameters: { type: "object", properties: { url: str, why: str }, required: ["url", "why"] } } },
  { type: "function", function: { name: "post_transcript", description: "What is said in the post, as text. 1 credit. You have NOT watched it; this is the words.", parameters: { type: "object", properties: { url: str, why: str }, required: ["url", "why"] } } },
  { type: "function", function: { name: "post_comments", description: "The top comments: what people are reacting to. 1 credit on TikTok, 15 on Instagram (replies are fetched too), so on Instagram only when it decides something.", parameters: { type: "object", properties: { url: str, why: str }, required: ["url", "why"] } } },
  { type: "function", function: { name: "sound_info", description: "A TikTok sound: title, author, how many videos use it. 1 credit. Use when the sound might be the reason, not the account.", parameters: { type: "object", properties: { clipId: str, why: str }, required: ["clipId", "why"] } } },
  { type: "function", function: { name: "sound_videos", description: "Recent videos on a TikTok sound: is it rising, who else used it. 1 credit.", parameters: { type: "object", properties: { clipId: str, why: str }, required: ["clipId", "why"] } } },
  { type: "function", function: { name: "profile", description: "An account's size and bio. Free when the vendor's cache is fresh, 1 credit live. Use to tell a breakout from a big account being big.", parameters: { type: "object", properties: { platform: { type: "string", enum: ["tiktok", "instagram"] }, handle: str, why: str }, required: ["platform", "handle", "why"] } } },
  { type: "function", function: { name: "account_posts", description: "An account's recent posts with numbers, to compute its normal and see whether this one is above it. 1 credit.", parameters: { type: "object", properties: { platform: { type: "string", enum: ["tiktok", "instagram"] }, handle: str, why: str }, required: ["platform", "handle", "why"] } } },
  { type: "function", function: { name: "search_keyword", description: "TikTok posts for a keyword this week, most liked first: is this shape a wave right now, or one account? 1 credit.", parameters: { type: "object", properties: { keyword: str, why: str }, required: ["keyword", "why"] } } },
  { type: "function", function: { name: "search_hashtag", description: "TikTok posts under a hashtag. 1 credit.", parameters: { type: "object", properties: { hashtag: str, why: str }, required: ["hashtag", "why"] } } },
  { type: "function", function: { name: "search_reels", description: "Instagram reels for a keyword, last week or month. 1 credit.", parameters: { type: "object", properties: { keyword: str, why: str }, required: ["keyword", "why"] } } },
  { type: "function", function: { name: "search_ig_hashtag", description: "Instagram posts under a hashtag. 1 credit.", parameters: { type: "object", properties: { hashtag: str, why: str }, required: ["hashtag", "why"] } } },
  { type: "function", function: { name: "ig_popular", description: "What Instagram surfaces as popular for a topic right now. 1 credit.", parameters: { type: "object", properties: { topic: str, why: str }, required: ["topic", "why"] } } },
  { type: "function", function: { name: "sound_reels", description: "Instagram reels on one audio id: is the audio rising, who used it. 1 credit.", parameters: { type: "object", properties: { audioId: str, why: str }, required: ["audioId", "why"] } } },
  { type: "function", function: { name: "trending_tiktok", description: "TikTok's trending feed for a region (US default): what the platform is pushing today. 1 credit. Rarely decides anything; use to check whether a shape is platform-wide.", parameters: { type: "object", properties: { region: str, why: str }, required: ["why"] } } },
  { type: "function", function: { name: "trending_reels", description: "Instagram's trending reels right now. 1 credit.", parameters: { type: "object", properties: { why: str }, required: ["why"] } } },
  { type: "function", function: { name: "suggestions", description: "TikTok search autocomplete for a keyword: what people are typing next to it, a demand signal. 1 credit.", parameters: { type: "object", properties: { keyword: str, why: str }, required: ["keyword", "why"] } } },
  { type: "function", function: { name: "discover_creators", description: "Popular TikTok creators in a follower band (10K-100K, 100K-1M, 1M-10M, 10M+) for a country. 1 credit. For 'who else is in this lane', not for judging a post.", parameters: { type: "object", properties: { band: { type: "string", enum: ["10K-100K", "100K-1M", "1M-10M", "10M+"] }, country: str, why: str }, required: ["band", "why"] } } },
  { type: "function", function: { name: "discover_profiles", description: "Instagram profiles for a keyword. 1 credit.", parameters: { type: "object", properties: { keyword: str, why: str }, required: ["keyword", "why"] } } },
  { type: "function", function: { name: "own_rhymes", description: "The creator's OWN posts that rhyme with a topic or format, with their multiples. Free. Use before saying 'this is yours to take'.", parameters: { type: "object", properties: { query: str, why: str }, required: ["query", "why"] } } },
  { type: "function", function: { name: "lane_benchmark", description: "This week's median and top-quarter views across the creator's lane (their keywords and the accounts they watch), or why it is unusable. Free. Use to say whether a number is good, not just big.", parameters: { type: "object", properties: { why: str }, required: ["why"] } } },
  { type: "function", function: { name: "recall", description: "Search the creator's own memory: ideas she sent, ideas they saved, things they told her. Free. Use when they refer to something from before.", parameters: { type: "object", properties: { query: str, why: str }, required: ["query", "why"] } } },
  { type: "function", function: { name: "calendar_upcoming", description: "What is on the creator's calendar in the next two weeks (titles and times only). Free.", parameters: { type: "object", properties: { why: str }, required: ["why"] } } },
];

/** The vendor's price, platform-aware where it matters (docs/scrapecreators-credits.json). */
export function priceFor(name: string, args: Record<string, unknown>): number | undefined {
  const base = TOOL_CREDITS[name];
  if (base === undefined) return undefined;
  const url = typeof args.url === "string" ? args.url : "";
  const ig = args.platform === "instagram" || /instagram\.com/.test(url);
  if (name === "post_comments") return ig ? 15 : 1;
  return base;
}

export interface ToolCallRecord { tool: string; params: Record<string, unknown>; why: string; credits?: number; ms: number; ok: boolean; detail?: string }

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
    case "suggestions": {
      const rows = (Array.isArray(value) ? value : ((value as { suggestions?: unknown[] } | null)?.suggestions ?? [])) as unknown[];
      return rows.length ? cap(rows.slice(0, 20).map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" · ")) : "no suggestions";
    }
    case "discover_creators":
    case "discover_profiles": {
      const rows = (Array.isArray(value) ? value : ((value as { profiles?: unknown[]; creators?: unknown[]; users?: unknown[] } | null)?.profiles ?? (value as { creators?: unknown[] } | null)?.creators ?? (value as { users?: unknown[] } | null)?.users ?? [])) as Array<{ handle?: string; username?: string; followerCount?: number; followers?: number; bio?: string; displayName?: string }>;
      return rows.length ? cap(rows.slice(0, 15).map((r) => `@${r.handle ?? r.username ?? "?"} · ${r.followerCount ?? r.followers ?? "?"} followers · ${(r.displayName ?? "")} · "${(r.bio ?? "").slice(0, 80)}"`).join("\n")) : "no profiles returned";
    }
    case "account_posts":
    case "search_keyword":
    case "search_hashtag":
    case "search_reels":
    case "search_ig_hashtag":
    case "ig_popular":
    case "sound_videos":
    case "sound_reels":
    case "trending_tiktok":
    case "trending_reels": {
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
  const record = (ok: boolean, credits?: number, detail?: string) => trace.push({ tool: call.name, params: Object.fromEntries(Object.entries(call.args).filter(([k]) => k !== "why")), why, credits, ms: Date.now() - started, ok, ...(detail ? { detail } : {}) });
  if (trace.length >= budget.calls) {
    record(false, 0, "call budget spent");
    return `refused: the call budget (${budget.calls}) is spent. Answer with what you have.`;
  }
  if (Date.now() > budget.deadlineAt) {
    record(false, 0, "out of time");
    return "refused: out of time. Answer with what you have.";
  }
  const price = priceFor(call.name, call.args);
  if (price === undefined) {
    record(false, 0, "unknown tool");
    return `refused: no tool named ${call.name}`;
  }
  const spent = trace.reduce((s, t) => s + (t.credits ?? 0), 0);
  if (spent + price > budget.credits) {
    record(false, 0, "credit budget");
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
    if (call.name === "lane_benchmark") {
      const b = await ctx.runQuery(internal.scout.benchmarks.laneFor, { creatorId, now: Date.now() });
      record(true, 0);
      return b.usable ? `lane this week: median ${b.medianViews?.toLocaleString()} views, top quarter from ${b.p75Views?.toLocaleString()}, median engagement per view ${((b.medianEngagementPerView ?? 0) * 100).toFixed(1)}% (${b.why})` : `no usable lane median: ${b.why}`;
    }
    if (call.name === "recall") {
      const hits = await ctx.runAction(internal.agent.memory.recall, { creatorId, query: String(call.args.query ?? ""), k: 4 });
      record(true, 0);
      return hits.length ? cap(hits.map((h) => `[${h.kind}, ${new Date(h.at).toISOString().slice(0, 10)}] ${h.text.slice(0, 300)}`).join("\n")) : "nothing close enough in their memory";
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
      case "search_reels":
        kind = "search.reels";
        params = { keyword: String(call.args.keyword ?? ""), window: "last-week" };
        break;
      case "search_ig_hashtag":
        kind = "search.hashtagPosts";
        params = { hashtag: String(call.args.hashtag ?? "").replace(/^#/, ""), window: "last-week" };
        break;
      case "ig_popular":
        kind = "ig.popular";
        params = { topic: String(call.args.topic ?? "") };
        break;
      case "sound_reels":
        kind = "sound.reels";
        params = { audioId: String(call.args.audioId ?? "") };
        break;
      case "trending_tiktok":
        kind = "trending.tiktok";
        params = { region: String(call.args.region ?? "US") };
        break;
      case "trending_reels":
        kind = "trending.reels";
        params = { batch: 1 };
        break;
      case "suggestions":
        kind = "suggestions.tiktok";
        params = { keyword: String(call.args.keyword ?? "") };
        break;
      case "discover_creators":
        kind = "discover.creators";
        params = { band: String(call.args.band ?? "100K-1M"), country: String(call.args.country ?? "US") };
        break;
      case "discover_profiles":
        kind = "discover.profiles";
        params = { keyword: String(call.args.keyword ?? "") };
        break;
      default:
        record(false, 0);
        return `refused: no tool named ${call.name}`;
    }
    const r = await ctx.runAction(internal.reads.read.read, { kind, params, creatorId });
    record(true, r.cached ? 0 : price);
    return summarize(call.name, r.value);
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 160) : "error";
    record(false, 0, detail);
    return `failed: ${detail.slice(0, 120)}`;
  }
}
