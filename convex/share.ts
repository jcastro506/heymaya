/**
 * M5: the two native doors into the conversation (app spec §7.4, §10.1).
 *
 * - **Send to Maya** (the share extension): a TikTok or Instagram post shared from those apps
 *   reaches her exactly as if they'd texted her the link, and her read comes back in Messages.
 *   The extension holds a creator-scoped token, never the Clerk session and never a creator id.
 * - **Ask Maya** (every object screen): logged as a Reacted action with a 10-minute window, then
 *   the app opens Messages to her with a draft. Her next turn knows what they tapped.
 *
 * Nothing here sends a proactive text. A share is them talking to her; quiet hours hold her
 * answer until morning rather than waking them.
 */

import { v } from "convex/values";
import { httpAction, internalQuery } from "./_generated/server";
import { internalMutation, mutation } from "./lib/functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { creatorForIdentity } from "./core/identity";
import { recordAction } from "./core/act";
import { writeInbound } from "./core/messages";
import { parseLink } from "./agent/inbound";
import { inQuietHours } from "./scout/gate";
import { THRESHOLDS } from "./config/thresholds";
import { unseenIdeas } from "./core/unseen";
import { coverForUrl, coverKey, mediaUrl } from "./media";
import { settled } from "./core/normal";
import { clip } from "./lib/clip";

export const SHARES_PER_DAY = 25; // a person sharing, not a script
export const SHARE_DEDUPE_MS = 10 * 60_000;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pure: the first moment at or after `now` that isn't in their quiet hours (15-minute steps, 14 h max). */
export function nextAwake(now: number, timezone: string, quiet: { start: string; end: string }): number {
  let t = now;
  for (let i = 0; i < 56 && inQuietHours(t, timezone, quiet); i++) t += 15 * 60_000;
  return t;
}

/** Pure: only a TikTok or Instagram post link; everything else is refused with a reason. */
export function shareTarget(url: string): { ok: true; url: string; platform: "tiktok" | "instagram" } | { ok: false; reason: string } {
  const link = parseLink(clip(url.trim(), 500));
  if (!link) return { ok: false, reason: "only TikTok and Instagram posts can be sent to Maya" };
  return { ok: true, url: link.url, platform: link.platform };
}

// ------------------------------------------------------------------ the extension's token

/** The app mints it after sign-in and puts it in the App Group; a new one replaces the old. */
export const mintShareToken = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; token?: string }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return { ok: false };
    const token = randomToken();
    await ctx.db.patch(c._id, { shareToken: { hash: await sha256(token), issuedAt: Date.now() } });
    return { ok: true, token };
  },
});

export const creatorForShareToken = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, a): Promise<Id<"creators"> | null> => {
    const c = (await ctx.db.query("creators").withIndex("by_share_token", (q) => q.eq("shareToken.hash", a.hash)).first()) as Doc<"creators"> | null;
    return c && c.plan.status !== "deleting" && c.plan.status !== "canceled" ? c._id : null;
  },
});

// ------------------------------------------------------------------ Send to Maya

export const receive = internalMutation({
  args: { creatorId: v.id("creators"), url: v.string(), note: v.optional(v.string()), app: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; answersAt?: number; duplicate?: boolean }> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return { ok: false, reason: "not found" };
    const now = Date.now();
    const recent = (await ctx.db.query("userActions").withIndex("by_creator_at", (q) => q.eq("creatorId", a.creatorId).gte("at", now - 86_400_000)).collect()) as Doc<"userActions">[];
    const shares = recent.filter((r) => r.kind === "share");
    if (shares.length >= SHARES_PER_DAY) return { ok: false, reason: `that's ${SHARES_PER_DAY} today; send more tomorrow` };
    if (shares.some((r) => r.objectId === a.url && now - r.at < SHARE_DEDUPE_MS)) return { ok: true, duplicate: true };

    // Exactly as if they'd texted her the link: their note is their own words, in the same message.
    const note = clip((a.note ?? "").trim(), 280);
    const surface = creator.channel.kind === "imessage" ? "imessage" : "telegram";
    const { messageId } = await writeInbound(ctx, { creatorId: a.creatorId, surface, body: note ? `${a.url}\n${note}` : a.url, ts: now });
    await recordAction(ctx, { creatorId: a.creatorId, kind: "share", source: "share_ext", objectId: a.url, summary: `sent you a post from ${a.app ?? "their phone"}${note ? ` with a note` : ""}` });
    const answersAt = nextAwake(now, creator.timezone, creator.quietHours ?? THRESHOLDS.quietHoursDefault);
    await ctx.runMutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: `converse:${messageId}`, creatorId: a.creatorId, payloadJson: JSON.stringify({ messageId, kind: "share" }), runAfter: answersAt });
    return { ok: true, answersAt };
  },
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** POST /share  Authorization: Bearer <share token>  {"url": "...", "note": "...", "app": "TikTok"} */
export const shareHttp = httpAction(async (ctx, req) => {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^[0-9a-f]{64}$/.test(token)) return json(401, { ok: false, reason: "open Maya once to connect sharing" });
  const creatorId = await ctx.runQuery(internal.share.creatorForShareToken, { hash: await sha256(token) });
  if (!creatorId) return json(401, { ok: false, reason: "open Maya once to connect sharing" });
  let body: { url?: unknown; note?: unknown; app?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { ok: false, reason: "nothing to send" });
  }
  const target = shareTarget(String(body.url ?? ""));
  if (!target.ok) return json(400, target);
  const r = await ctx.runMutation(internal.share.receive, { creatorId, url: target.url, note: typeof body.note === "string" ? body.note : undefined, app: typeof body.app === "string" ? clip(body.app, 20) : undefined });
  if (!r.ok) return json(429, r);
  return json(200, { ok: true, duplicate: Boolean(r.duplicate), later: r.answersAt !== undefined && r.answersAt > Date.now() + 60_000 });
});

// ------------------------------------------------------------------ Ask Maya

/** Pure: the link that opens their conversation with her, with a draft where the app allows one. */
export function conversationLink(channel: "telegram" | "imessage", draft: string, env: { lineNumber?: string; botUsername?: string }): string | null {
  if (channel === "imessage") return env.lineNumber ? `sms:${env.lineNumber}&body=${encodeURIComponent(draft)}` : null;
  return env.botUsername ? `https://t.me/${env.botUsername}` : null; // Telegram can't prefill a message to a bot
}

export const askMaya = mutation({
  args: { kind: v.union(v.literal("idea"), v.literal("post")), id: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; url?: string | null; draft?: string }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return { ok: false };
    let label = "";
    if (a.kind === "idea") {
      const id = ctx.db.normalizeId("ideas", a.id);
      const i = id ? ((await ctx.db.get(id)) as Doc<"ideas"> | null) : null;
      if (!i || i.creatorId !== c._id) return { ok: false };
      label = `the "${clip((i.version as { hook?: string } | undefined)?.hook ?? i.messageText, 60)}" idea`;
    } else {
      const id = ctx.db.normalizeId("ownPosts", a.id);
      const p = id ? ((await ctx.db.get(id)) as Doc<"ownPosts"> | null) : null;
      if (!p || p.creatorId !== c._id) return { ok: false };
      label = `your ${p.platform === "instagram" ? "reel" : "tiktok"} "${p.caption.split("\n")[0].slice(0, 50)}"`;
    }
    await recordAction(ctx, { creatorId: c._id, kind: "ask", objectId: `${a.kind}:${a.id}`, summary: `tapped Ask Maya on ${label}; if their next message says "this" or "it", they mean that` });
    const draft = `about ${label.replace(/^your /, "my ")}: `;
    const url = conversationLink(c.channel.kind === "imessage" ? "imessage" : "telegram", draft, { lineNumber: process.env.CLAW_LINE_NUMBER, botUsername: process.env.TELEGRAM_BOT_USERNAME });
    return { ok: true, url, draft };
  },
});

/** Dev and eval only (internal: not callable from a client): a token for a scenario persona, to exercise /share live. */
export const devMintShareToken = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<string> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !(c.clerkUserId ?? "").startsWith("eval")) throw new Error("dev tokens are for eval personas only");
    const token = randomToken();
    await ctx.db.patch(a.creatorId, { shareToken: { hash: await sha256(token), issuedAt: Date.now() } });
    return token;
  },
});

// ------------------------------------------------------------------ the widget (M6)

export interface WidgetBlock { kind: string; start: number; end: number; title: string; hook: string | null; ideaId: string | null; booked: boolean }
export interface WidgetPost { id: string; platform: string; createTime: number; views: number; multiple: number | null; settled: boolean; cover: string | null }

export interface WidgetData {
  nextBlock: WidgetBlock | null;
  /** The next two filming blocks (confirmed or moved first, then proposed), soonest first. */
  blocks: WidgetBlock[];
  /** `fitWhy` is the idea row's own reason; `coverPlatform` is the platform of the evidence post the cover came from. */
  bestIdea: { id: string; hook: string; cover: string | null; coverPlatform: string | null; fitWhy: string | null; isNew: boolean } | null;
  /** Their last three posts, newest first. `multiple` is the stored views ÷ their normal (core/normal.ts), null until there is a normal; `settled` false means it is still a lower bound. */
  lastPosts: WidgetPost[];
  newIdeas: number;
  asOf: number;
}

const WIDGET_BLOCKS = 2;
const WIDGET_POSTS = 3;

/** What the home-screen widget shows. Read-only, the creator's own rows only; nothing here that isn't a stored fact. */
export const widgetData = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<WidgetData> => {
    const now = Date.now();
    const upcoming = ((await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("start", now)).take(20)) as Doc<"calendarBlocks">[])
      .filter((b) => b.status !== "deleted" && b.kind === "film");
    const firm = (b: Doc<"calendarBlocks">) => b.status === "confirmed" || b.status === "moved";
    const chosen = [...upcoming.filter(firm), ...upcoming.filter((b) => !firm(b))].slice(0, WIDGET_BLOCKS).sort((x, y) => x.start - y.start);
    const hookOf = (i: Doc<"ideas">) => clip((i.version as { hook?: string } | undefined)?.hook ?? i.messageText, 90);
    const blockView = async (b: Doc<"calendarBlocks">): Promise<WidgetBlock> => {
      const idea = b.ideaId ? ((await ctx.db.get(b.ideaId)) as Doc<"ideas"> | null) : null;
      const ours = idea && idea.creatorId === a.creatorId ? idea : null;
      return { kind: b.kind, start: b.start, end: b.end, title: b.title.replace(/^(film|edit|post)( \(experiment\))?: /, ""), hook: ours ? hookOf(ours) : null, ideaId: ours ? String(ours._id) : null, booked: Boolean(b.consentAt) };
    };
    const blocks = await Promise.all(chosen.map(blockView));
    // The headline block: the first firm one, else the soonest (unchanged from M6).
    const headline = upcoming.find(firm) ?? upcoming[0] ?? null;
    const nextBlock = headline ? await blockView(headline) : null;

    const unseen = await unseenIdeas(ctx, a.creatorId, now);
    const open = unseen[0] ?? ((await ctx.db.query("ideas").withIndex("by_creator_status", (q) => q.eq("creatorId", a.creatorId).eq("status", "sent")).order("desc").first()) as Doc<"ideas"> | null);
    const link = open?.evidenceLinks[0] ?? null;
    const coverPlatform = link ? (link.includes("instagram.com") ? "instagram" : link.includes("tiktok.com") ? "tiktok" : null) : null;
    const fitWhy = open?.fitWhy.trim() ? clip(open.fitWhy.trim(), 140) : null;

    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(WIDGET_POSTS)) as Doc<"ownPosts">[];
    const lastPosts = await Promise.all(posts.map(async (p): Promise<WidgetPost> => ({
      id: String(p._id), platform: p.platform, createTime: p.createTime, views: p.metrics.views,
      multiple: typeof p.multiple === "number" && Number.isFinite(p.multiple) ? p.multiple : null,
      settled: settled(p, now),
      cover: await mediaUrl(ctx, p.platform, "cover", coverKey(p.platform, p.url, p.postId)),
    })));

    return {
      nextBlock,
      blocks,
      bestIdea: open ? { id: String(open._id), hook: hookOf(open), cover: link ? await coverForUrl(ctx, link) : null, coverPlatform, fitWhy, isNew: unseen.some((u) => u._id === open._id) } : null,
      lastPosts,
      newIdeas: unseen.length,
      asOf: now,
    };
  },
});

/** GET /widget  Authorization: Bearer <share token>. The widget refreshes itself; no push needed. */
export const widgetHttp = httpAction(async (ctx, req) => {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^[0-9a-f]{64}$/.test(token)) return json(401, { ok: false, reason: "open Maya once" });
  const creatorId = await ctx.runQuery(internal.share.creatorForShareToken, { hash: await sha256(token) });
  if (!creatorId) return json(401, { ok: false, reason: "open Maya once" });
  return json(200, { ok: true, ...(await ctx.runQuery(internal.share.widgetData, { creatorId })) });
});
