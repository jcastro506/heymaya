/**
 * Which posts from her engagement text they opened (2026-09-30). Each post goes out as a short link
 * of ours (`/go/<code>`, outside the paths the app claims) that forwards to the post; the first real
 * open becomes a noticed action, so she knows without asking. Link previews, crawlers, HEAD requests
 * and anything in the first seconds after the send (the phone fetching a preview) never count, and
 * an open is never a comment: the round's ticks and streak stay theirs to mark.
 */
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { mutation } from "../lib/functions";
import { recordAction } from "../core/act";
import { looksLikeBot } from "../partnerships/kitSettings";

export const LINKS = { codeLength: 10, previewGraceMs: 10_000 } as const;
const CODE = /^[a-z0-9]{10}$/;

/** A fresh unguessable code (lowercase letters and digits). */
export function newCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(LINKS.codeLength));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function goUrl(code: string, appUrl = process.env.APP_URL): string {
  return `${(appUrl ?? "https://hey-maya.ai").replace(/\/$/, "")}/go/${code}`;
}

/** Pure: we only ever forward to a TikTok or Instagram post, so the link can't be used to send people elsewhere. */
export function safeTarget(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const ok = u.protocol === "https:" && ["tiktok.com", "instagram.com"].some((d) => host === d || host.endsWith(`.${d}`));
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Store the links of a text that went out. Called only after the send succeeded, so no orphan codes. */
export async function saveLinks(ctx: MutationCtx, creatorId: Id<"creators">, links: Array<{ code: string; key: string; handle: string; url: string; fromLane?: boolean }>, sentAt: number): Promise<void> {
  for (const l of links) await ctx.db.insert("engageLinks", { creatorId, code: l.code, key: l.key, handle: l.handle, url: l.url, fromLane: l.fromLane, sentAt, opens: 0 });
}

/**
 * The /go page reports a tap and gets the post to forward to (null: unknown code, send them home).
 * Public by necessity (the tap comes from a phone's browser); the code is the only key, and all it
 * can do is mark that one link opened.
 */
export const open = mutation({
  args: { code: v.string(), userAgent: v.optional(v.string()), count: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ url: string | null; counted: boolean }> => {
    if (!CODE.test(a.code)) return { url: null, counted: false };
    const r = await ctx.db.query("engageLinks").withIndex("by_code", (q) => q.eq("code", a.code)).first();
    if (!r) return { url: null, counted: false };
    const url = safeTarget(r.url);
    const now = Date.now();
    if (!url || a.count === false || looksLikeBot(a.userAgent) || now < r.sentAt + LINKS.previewGraceMs) return { url, counted: false };
    await ctx.db.patch(r._id, { opens: r.opens + 1, openedAt: r.openedAt ?? now });
    if (!r.openedAt) await recordAction(ctx, { creatorId: r.creatorId, kind: "engage.opened", source: "chat", objectId: r.key, summary: `opened @${r.handle}'s post from her comment-round text${r.fromLane ? " (one new to them)" : ""}` });
    return { url, counted: true };
  },
});
