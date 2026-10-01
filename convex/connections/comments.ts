import { clip } from "../lib/clip";
/**
 * A2: comments on THEIR OWN posts, read from a connected account. READ ONLY: nothing here replies,
 * hides, likes or deletes, and nothing ever will without a separate product decision (the Zernio
 * client carries no such call). Three ways in, one write:
 *
 *   daily     the account-insights pass (insightsSync) reads the posts with new comments, bounded
 *   webhook   `comment.received` (connections/zernio.zernioWebhook), one comment, idempotent
 *   tool      `post_comments` on their own post reads it live (free) instead of the 15-credit scrape
 *
 * What she gets from it is code's facts, her judgment: which comments are questions (an idea seed:
 * a question asked twice is a video) and which questions no reply from them has answered yet.
 * Comment text is untrusted (other people wrote it): clipped, control characters stripped, and
 * labelled as data wherever it reaches her. Commenters are kept as a one-way key, never a name.
 *
 * Built against the live recording (fixtures.live-2026-10-01.json): every endpoint answered 200 and
 * every post had zero comments, so the comment SHAPE is the spec's (1.196.0) and the tests say so.
 */

import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { commentedPosts, postComments, zernioClient, type ZernioClient } from "../integrations/zernio/index";
import { postIdFromUrl } from "./analytics";
import { readableAccounts } from "./insightsSync";

export const COMMENTS = {
  windowDays: 14,          // the daily pass looks at posts commented on in the last two weeks
  postsPerAccount: 5,      // and reads at most five of them a pass
  perPost: 50,             // top-level comments per read
  keepDays: 120,           // older comments are pruned as new ones land
  textMax: 500,
} as const;

const DAY = 86_400_000;
const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
const int = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
const time = (x: unknown): number | null => { const t = typeof x === "string" ? Date.parse(x) : NaN; return Number.isFinite(t) ? t : null; };

export interface ParsedComment {
  commentId: string;
  parentId: string | null;
  text: string;
  authorId: string | null;
  isOwner: boolean;
  likeCount: number | null;
  replyCount: number | null;
  createdAt: number | null;
}

/** Pure: someone else's words, made safe to store and show: no control characters, one line, clipped. */
export function cleanText(s: string): string {
  return clip(s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim(), COMMENTS.textMax);
}

/** Pure: a stable one-way key for a commenter, salted per creator so two creators' keys never link. Two FNV-1a 32-bit passes. */
export function authorKey(salt: string, authorId: string | null): string {
  if (!authorId) return "unknown";
  const fnv = (s: string, seed: number) => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
  const s = `${salt}:${authorId}`;
  return fnv(s, 0x811c9dc5) + fnv(s.split("").reverse().join(""), 0x050c5d1f);
}

function one(c: Record<string, unknown>, parentId: string | null): ParsedComment | null {
  const commentId = str(c.id);
  const text = str(c.message) ?? str(c.text);
  if (!commentId || !text) return null;
  const from = isObj(c.from) ? c.from : isObj(c.author) ? c.author : {};
  return {
    commentId,
    parentId,
    text: cleanText(text),
    authorId: str(from.id) ?? str(from.username),
    isOwner: from.isOwner === true || from.isOwnAccount === true,
    likeCount: int(c.likeCount),
    replyCount: int(c.replyCount),
    createdAt: time(c.createdTime ?? c.createdAt),
  };
}

/** Pure: GET /v1/inbox/comments/{postId} → comments and their replies, flattened. Null when the shape is wrong. */
export function normalizeComments(raw: unknown): { platformPostId: string | null; comments: ParsedComment[] } | null {
  if (!isObj(raw) || !Array.isArray(raw.comments)) return null;
  const out: ParsedComment[] = [];
  for (const c of raw.comments.slice(0, 100)) {
    if (!isObj(c)) continue;
    const top = one(c, null);
    if (!top) continue;
    out.push(top);
    for (const r of (Array.isArray(c.replies) ? c.replies : []).slice(0, 20)) if (isObj(r)) { const x = one(r, top.commentId); if (x) out.push(x); }
  }
  const meta = isObj(raw.meta) ? raw.meta : {};
  return { platformPostId: str(meta.postId), comments: out };
}

/** Pure: GET /v1/inbox/comments → their posts with comments (the platform's post id, link, count). */
export function normalizeCommentedPosts(raw: unknown): Array<{ platformPostId: string; permalink: string | null; commentCount: number; platform: string }> | null {
  if (!isObj(raw) || !Array.isArray(raw.data)) return null;
  return raw.data.filter(isObj).flatMap((p) => {
    const id = str(p.id);
    return id && !p.isAd ? [{ platformPostId: id, permalink: str(p.permalink), commentCount: int(p.commentCount) ?? 0, platform: String(p.platform ?? "").toLowerCase() }] : [];
  });
}

/** Pure: the `comment.received` webhook → one comment with its post and account, or null. */
export function normalizeCommentWebhook(body: unknown): { accountId: string; platform: "tiktok" | "instagram"; platformPostId: string; permalink: string | null; comment: ParsedComment } | null {
  if (!isObj(body) || (body.event ?? body.type) !== "comment.received" || !isObj(body.comment)) return null;
  const c = body.comment;
  const account = isObj(body.account) ? body.account : {};
  const post = isObj(body.post) ? body.post : {};
  const platform = String(c.platform ?? account.platform ?? "").toLowerCase();
  const accountId = str(account.accountId) ?? str(account.id);
  const platformPostId = str(c.platformPostId) ?? str(post.platformPostId);
  if ((platform !== "tiktok" && platform !== "instagram") || !accountId || !platformPostId) return null;
  const parsed = one({ ...c, author: c.author }, c.isReply === true ? str(c.parentCommentId) : null);
  if (!parsed) return null;
  return { accountId, platform, platformPostId, permalink: str(post.permalink) ?? str(post.platformPostUrl) ?? null, comment: parsed };
}

const Q_START = /^(how|what|whats|what's|where|wheres|where's|which|who|why|when|can|could|do|does|did|is|are|will|would|should|any|pls|please|part\s?2|tutorial|recipe|link|size|price)\b/i;

/** Pure: is this comment a question, i.e. something an audience wants to know (an idea seed)? */
export function isQuestion(text: string): boolean {
  const t = text.replace(/https?:\/\/\S+/g, "").replace(/@[\w.]+/g, "").trim();
  if (t.replace(/[^\p{L}\p{N}]/gu, "").length < 5) return false;
  if (/\?/.test(t)) return true;
  return Q_START.test(t) && t.split(/\s+/).length >= 3;
}

const STOP = new Set("a an the i you u your ur my me to of in on for and or is are do does did it this that how what where which who why when can could would should will be with from at so just pls please?".split(" "));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));

/** Pure: questions grouped by what they ask (word overlap), most asked first, then most liked. */
export function groupQuestions<T extends { text: string; likeCount?: number | null; authorKey: string }>(rows: T[]): Array<{ example: T; askers: number; likes: number }> {
  const groups: Array<{ example: T; words: Set<string>; askers: Set<string>; likes: number }> = [];
  for (const r of rows) {
    const w = words(r.text);
    const g = groups.find((x) => { const inter = [...w].filter((y) => x.words.has(y)).length; const union = new Set([...w, ...x.words]).size; return union > 0 && inter / union >= 0.5; });
    if (g) { g.askers.add(r.authorKey); g.likes += r.likeCount ?? 0; if ((r.likeCount ?? 0) > (g.example.likeCount ?? 0)) g.example = r; }
    else groups.push({ example: r, words: w, askers: new Set([r.authorKey]), likes: r.likeCount ?? 0 });
  }
  return groups.map((g) => ({ example: g.example, askers: g.askers.size, likes: g.likes })).sort((a, b) => b.askers - a.askers || b.likes - a.likes);
}

/** Pure: questions from other people that no reply from them has answered yet, most liked first. */
export function worthAnswering<T extends { commentId: string; parentId?: string | null; isOwner: boolean; question: boolean; likeCount?: number | null; createdAt: number }>(rows: T[]): T[] {
  const answered = new Set(rows.filter((r) => r.isOwner && r.parentId).map((r) => r.parentId!));
  return rows.filter((r) => !r.isOwner && !r.parentId && r.question && !answered.has(r.commentId)).sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0) || b.createdAt - a.createdAt);
}

// ------------------------------------------------------------------ the rows

const commentArg = v.object({ commentId: v.string(), parentId: v.union(v.string(), v.null()), text: v.string(), authorKey: v.string(), isOwner: v.boolean(), likeCount: v.union(v.number(), v.null()), replyCount: v.union(v.number(), v.null()), createdAt: v.union(v.number(), v.null()) });

/** Idempotent by the platform's comment id, per creator: a re-read refreshes counts and text, never duplicates. */
export const write = internalMutation({
  args: { creatorId: v.id("creators"), platform: v.union(v.literal("tiktok"), v.literal("instagram")), accountId: v.string(), platformPostId: v.string(), permalink: v.union(v.string(), v.null()), comments: v.array(commentArg), source: v.union(v.literal("sync"), v.literal("webhook"), v.literal("tool")), now: v.number() },
  handler: async (ctx, a): Promise<{ inserted: number; updated: number }> => {
    const shortId = postIdFromUrl(a.permalink) ?? (a.platform === "tiktok" ? a.platformPostId : null);
    const own = shortId ? ((await ctx.db.query("ownPosts").withIndex("by_creator_post", (q) => q.eq("creatorId", a.creatorId).eq("platform", a.platform).eq("postId", shortId)).first()) as Doc<"ownPosts"> | null) : null;
    let inserted = 0, updated = 0;
    for (const c of a.comments.slice(0, 120)) {
      const text = cleanText(c.text);
      if (!text) continue;
      const existing = (await ctx.db.query("postComments").withIndex("by_creator_comment", (q) => q.eq("creatorId", a.creatorId).eq("commentId", c.commentId)).first()) as Doc<"postComments"> | null;
      const counts = { ...(c.likeCount !== null ? { likeCount: c.likeCount } : {}), ...(c.replyCount !== null ? { replyCount: c.replyCount } : {}) };
      if (existing) {
        await ctx.db.patch(existing._id, { text, question: !existing.isOwner && isQuestion(text), fetchedAt: a.now, ...counts, ...(own && !existing.ownPostId ? { ownPostId: own._id } : {}) });
        updated++;
        continue;
      }
      await ctx.db.insert("postComments", {
        creatorId: a.creatorId, platform: a.platform, accountId: a.accountId, platformPostId: a.platformPostId,
        ...(own ? { ownPostId: own._id, postUrl: own.url } : a.permalink ? { postUrl: a.permalink.replace(/\?.*$/, "") } : {}),
        commentId: c.commentId, ...(c.parentId ? { parentId: c.parentId } : {}), text, authorKey: c.authorKey, isOwner: c.isOwner, question: !c.isOwner && isQuestion(text),
        ...counts, createdAt: c.createdAt ?? a.now, fetchedAt: a.now, source: a.source,
      });
      inserted++;
    }
    // Bounded retention: the oldest beyond the window go as new ones land.
    const old = (await ctx.db.query("postComments").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).lt("createdAt", a.now - COMMENTS.keepDays * DAY)).take(50)) as Doc<"postComments">[];
    for (const r of old) await ctx.db.delete(r._id);
    return { inserted, updated };
  },
});

/** How many comments we already hold per post, so the daily pass only reads posts with new ones. */
export const heldCounts = internalQuery({
  args: { creatorId: v.id("creators"), platformPostIds: v.array(v.string()) },
  handler: async (ctx, a): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const id of a.platformPostIds.slice(0, 50)) out[id] = ((await ctx.db.query("postComments").withIndex("by_creator_post", (q) => q.eq("creatorId", a.creatorId).eq("platformPostId", id)).take(200)) as Doc<"postComments">[]).filter((r) => !r.parentId).length;
    return out;
  },
});

const key = (creatorId: string) => (c: ParsedComment) => ({ commentId: c.commentId, parentId: c.parentId, text: c.text, authorKey: authorKey(creatorId, c.authorId), isOwner: c.isOwner, likeCount: c.likeCount, replyCount: c.replyCount, createdAt: c.createdAt });

// ------------------------------------------------------------------ the reads

export type CommentsStatus = "ok" | "not_available" | "failed";

/**
 * The daily read for one account (called from insightsSync's pass): the posts commented on in the
 * window, then only those with more comments than we hold, at most five. Returns a status and counts.
 */
export async function syncAccountComments(ctx: ActionCtx, c: ZernioClient, creatorId: Id<"creators">, acc: { accountId: string; platform: "tiktok" | "instagram" }, now: number, classify: (e: unknown) => string): Promise<{ status: CommentsStatus; posts: number; read: number; detail?: string }> {
  let list: ReturnType<typeof normalizeCommentedPosts>;
  try {
    list = normalizeCommentedPosts(await commentedPosts(c, { accountId: acc.accountId, since: new Date(now - COMMENTS.windowDays * DAY).toISOString(), minComments: 1, limit: 20 }));
  } catch (e) {
    const s = classify(e);
    return { status: s === "not_available" ? "not_available" : "failed", posts: 0, read: 0, detail: e instanceof Error ? clip(e.message, 160) : "comments list failed" };
  }
  if (!list) return { status: "failed", posts: 0, read: 0, detail: "commented posts were not the expected shape" };
  const withComments = list.filter((p) => p.commentCount > 0);
  if (!withComments.length) return { status: "ok", posts: 0, read: 0 };
  const held = await ctx.runQuery(internal.connections.comments.heldCounts, { creatorId, platformPostIds: withComments.map((p) => p.platformPostId) });
  const due = withComments.filter((p) => p.commentCount > (held[p.platformPostId] ?? 0)).slice(0, COMMENTS.postsPerAccount);
  let read = 0;
  for (const p of due) {
    try {
      const parsed = normalizeComments(await postComments(c, { platformPostId: p.platformPostId, accountId: acc.accountId, limit: COMMENTS.perPost }));
      if (!parsed) continue;
      await ctx.runMutation(internal.connections.comments.write, { creatorId, platform: acc.platform, accountId: acc.accountId, platformPostId: p.platformPostId, permalink: p.permalink, comments: parsed.comments.map(key(creatorId)), source: "sync", now });
      read += parsed.comments.length;
    } catch (e) {
      return { status: "failed", posts: due.length, read, detail: e instanceof Error ? clip(e.message, 160) : "comments read failed" };
    }
  }
  return { status: "ok", posts: due.length, read };
}

/** The webhook's write: one comment onto whichever creator owns the account. Idempotent. */
export async function storeWebhookComment(ctx: Pick<ActionCtx, "runQuery" | "runMutation">, body: unknown, now: number): Promise<"stored" | "ignored" | "unknown account"> {
  const w = normalizeCommentWebhook(body);
  if (!w) return "ignored";
  const creatorId = await ctx.runQuery(internal.connections.sync.creatorForAccount, { accountId: w.accountId });
  if (!creatorId) return "unknown account";
  await ctx.runMutation(internal.connections.comments.write, { creatorId, platform: w.platform, accountId: w.accountId, platformPostId: w.platformPostId, permalink: w.permalink, comments: [key(creatorId)(w.comment)], source: "webhook", now });
  return "stored";
}

/** Which of their connected accounts can read one of their own posts' comments, and that post. Null = not theirs, or not connected. */
export const ownPostTarget = internalQuery({
  args: { creatorId: v.id("creators"), url: v.string() },
  handler: async (ctx, a): Promise<{ platform: "tiktok" | "instagram"; postId: string; url: string; createTime: number; accountId: string; platformPostId: string | null } | null> => {
    const id = postIdFromUrl(a.url);
    if (!id) return null;
    const platform = /instagram\.com/.test(a.url) ? "instagram" : "tiktok";
    const post = (await ctx.db.query("ownPosts").withIndex("by_creator_post", (q) => q.eq("creatorId", a.creatorId).eq("platform", platform).eq("postId", id)).first()) as Doc<"ownPosts"> | null;
    if (!post) return null;
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    if (!creator || !conn) return null;
    const acc = readableAccounts(conn, creator.plan).find((x) => x.platform === platform);
    if (!acc) return null;
    // TikTok's post id IS the platform id; Instagram's shortcode is not (the media id comes from a stored comment, or the list).
    const stored = (await ctx.db.query("postComments").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(300)) as Doc<"postComments">[];
    const platformPostId = platform === "tiktok" ? id : (stored.find((r) => r.ownPostId === post._id)?.platformPostId ?? null);
    return { platform, postId: id, url: post.url, createTime: post.createTime, accountId: acc.accountId, platformPostId };
  },
});

export interface ReadComment { text: string; likeCount: number | null; isOwner: boolean; question: boolean; reply: boolean }

/**
 * `post_comments` on their own post: read live from the connected account (free) and stored.
 * `{ ok: false }` means "use the public read instead" (not theirs, not connected, or Zernio failed).
 */
export const readForPost = internalAction({
  args: { creatorId: v.id("creators"), url: v.string() },
  handler: async (ctx, a): Promise<{ ok: true; comments: ReadComment[] } | { ok: false; reason: string }> => {
    const t = await ctx.runQuery(internal.connections.comments.ownPostTarget, { creatorId: a.creatorId, url: a.url });
    if (!t) return { ok: false, reason: "not a connected post of theirs" };
    let c: ZernioClient;
    try { c = zernioClient(process.env.ZERNIO_API_KEY ?? ""); } catch { return { ok: false, reason: "no client" }; }
    const now = Date.now();
    try {
      let platformPostId = t.platformPostId;
      let permalink: string | null = t.url;
      if (!platformPostId) {
        const list = normalizeCommentedPosts(await commentedPosts(c, { accountId: t.accountId, since: new Date(t.createTime - DAY).toISOString(), limit: 50 })) ?? [];
        const hit = list.find((p) => postIdFromUrl(p.permalink) === t.postId);
        if (!hit) return { ok: false, reason: "post not found on the connected account" };
        platformPostId = hit.platformPostId;
        permalink = hit.permalink;
      }
      const parsed = normalizeComments(await postComments(c, { platformPostId, accountId: t.accountId, limit: COMMENTS.perPost }));
      if (!parsed) return { ok: false, reason: "comments were not the expected shape" };
      await ctx.runMutation(internal.connections.comments.write, { creatorId: a.creatorId, platform: t.platform, accountId: t.accountId, platformPostId, permalink, comments: parsed.comments.map(key(a.creatorId)), source: "tool", now });
      return { ok: true, comments: parsed.comments.map((x) => ({ text: x.text, likeCount: x.likeCount, isOwner: x.isOwner, question: !x.isOwner && isQuestion(x.text), reply: x.parentId !== null })) };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? clip(e.message, 120) : "read failed" };
    }
  },
});

// ------------------------------------------------------------------ for her

export interface CommentFacts { connected: boolean; readAt: number | null; total: number; posts: number; lines: string[]; worth: string[]; cannotKnow: string[] }

/** Pure given the rows: what people are asking under their posts, and what is still unanswered. */
export function commentFacts(rows: Doc<"postComments">[], connected: boolean, readAt: number | null, now: number): CommentFacts {
  const since = now - COMMENTS.windowDays * DAY;
  const recent = rows.filter((r) => r.createdAt >= since);
  const others = recent.filter((r) => !r.isOwner);
  const questions = others.filter((r) => r.question && !r.parentId);
  const where = (r: Doc<"postComments">) => (r.postUrl ? ` on ${r.postUrl}` : "");
  const lines = groupQuestions(questions).slice(0, 8).map((g) => `"${clip(g.example.text, 160)}"${g.askers > 1 ? ` (asked by ${g.askers} people)` : ""}${g.likes ? ` (${g.likes} likes)` : ""}${where(g.example)}`);
  const worth = worthAnswering(recent).slice(0, 5).map((r) => `"${clip(r.text, 160)}"${r.likeCount ? ` (${r.likeCount} likes)` : ""}${where(r)}`);
  const cannotKnow: string[] = [];
  if (!connected) cannotKnow.push("comments on their own posts: no account connected; post_comments reads one post's public comments instead");
  else if (readAt === null) cannotKnow.push("comments: not read yet (the first read runs within a day of connecting)");
  return { connected, readAt, total: others.length, posts: new Set(others.map((r) => r.platformPostId)).size, lines, worth, cannotKnow };
}

export async function commentFactsFor(ctx: Pick<QueryCtx, "db">, creatorId: Id<"creators">, now: number): Promise<CommentFacts> {
  const creator = (await ctx.db.get(creatorId)) as Doc<"creators"> | null;
  const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
  const connected = Boolean(creator && conn && readableAccounts(conn, creator.plan).length);
  const rows = (await ctx.db.query("postComments").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createdAt", now - COMMENTS.windowDays * DAY)).order("desc").take(400)) as Doc<"postComments">[];
  const reads = (await ctx.db.query("accountInsights").withIndex("by_creator_kind", (q) => q.eq("creatorId", creatorId).eq("kind", "comments")).take(20)) as Doc<"accountInsights">[];
  const readAt = reads.filter((r) => r.fetchedAt > 0).reduce<number | null>((m, r) => (m === null || r.fetchedAt > m ? r.fetchedAt : m), null);
  return commentFacts(rows, connected, readAt ?? (rows.length ? Math.max(...rows.map((r) => r.fetchedAt)) : null), now);
}

export const forCreator = internalQuery({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<CommentFacts> => await commentFactsFor(ctx, a.creatorId, a.now ?? Date.now()),
});
