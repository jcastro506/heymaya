/**
 * The format watch (plan §13.12). Once a day, fleet-wide: the platform's trending
 * feeds through the cache (one read each, shared), the screener over the day's posts
 * to keep the ones whose FORMAT travels (the structure, the hook shape, the angle, the
 * humor), and one `worth_seeing` signal per kept format for every paired creator,
 * with the fingerprint the gate requires. Topic is irrelevant here on purpose.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { THRESHOLDS } from "../config/thresholds";

export const KEEP_PER_DAY = 3;

interface Post { postId?: string; url?: string | null; caption?: string | null; authorHandle?: string | null; metrics?: { viewCount?: number | null; likeCount?: number | null; commentCount?: number | null; shareCount?: number | null } }

export interface FormatLabel { postId: string; transferable: boolean; format: string; angle: string; humor: string; why: string; onAnotherSubject: string }

export const FORMAT_PROMPT = `You look at today's trending short videos (captions and numbers only; you have not watched them) and decide which have a FORMAT worth stealing for creators in completely different niches. A format is the structure, the hook shape, the angle, the humor, the pacing: "a list where every point cuts to an object", "an interruption bit where a stranger derails the take", "a POV that opens on the hands, not the face". A trend that only works with its own subject, a dance, a meme sound with no structure, a celebrity moment: not transferable.
For each post: transferable true/false; if true, name the format (≤ 80), the angle (≤ 80), the humor if any (≤ 60), why it is working (≤ 120), and what it would look like on a different subject (≤ 120, one concrete example). Keep at most ${KEEP_PER_DAY}. Output ONLY JSON: [{"postId": "", "transferable": true, "format": "", "angle": "", "humor": "", "why": "", "onAnotherSubject": ""}]`;

/** Parse the screener's answer; only rows with a real format survive. Pure. */
export function parseLabels(content: string, known: Set<string>): FormatLabel[] {
  try {
    const m = content.match(/\[[\s\S]*\]/);
    const rows = JSON.parse(m ? m[0] : "[]") as Array<Partial<FormatLabel>>;
    return rows
      .filter((r) => r && r.transferable === true && typeof r.postId === "string" && known.has(r.postId) && typeof r.format === "string" && r.format.trim().length > 3)
      .slice(0, KEEP_PER_DAY)
      .map((r) => ({ postId: r.postId!, transferable: true, format: r.format!.trim().slice(0, 80), angle: String(r.angle ?? "").slice(0, 80), humor: String(r.humor ?? "").slice(0, 60), why: String(r.why ?? "").slice(0, 120), onAnotherSubject: String(r.onAnotherSubject ?? "").slice(0, 120) }));
  } catch {
    return [];
  }
}

/** A stable fingerprint of a format so taste and cooldown can see the same shape twice. */
export function fingerprint(format: string): string {
  return format.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 2).slice(0, 6).join("-");
}

export const pairedCreatorIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators">[]> => {
    const rows = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    return rows.filter((c) => c.channel.paired && c.dossier && c.plan.status !== "paused" && c.plan.status !== "canceled" && c.plan.status !== "deleting").map((c) => c._id);
  },
});

export const writeWorthSeeing = internalMutation({
  args: { creatorIds: v.array(v.id("creators")), labels: v.array(v.object({ postId: v.string(), url: v.string(), authorHandle: v.union(v.string(), v.null()), views: v.number(), format: v.string(), angle: v.string(), humor: v.string(), why: v.string(), onAnotherSubject: v.string() })), now: v.number() },
  handler: async (ctx, a): Promise<{ written: number }> => {
    let written = 0;
    for (const creatorId of a.creatorIds) {
      const existing = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createdAt", a.now - 7 * 86_400_000)).collect()) as Doc<"signals">[];
      const seen = new Set(existing.filter((s) => s.kind === "worth_seeing").flatMap((s) => s.sourcePostIds));
      const seenFingerprints = new Set(existing.filter((s) => s.kind === "worth_seeing" && s.formatFingerprint).map((s) => s.formatFingerprint));
      for (const l of a.labels) {
        const fp = fingerprint(l.format);
        if (seen.has(l.postId) || seenFingerprints.has(fp)) continue; // the same shape twice in a week is not news
        await ctx.db.insert("signals", {
          creatorId,
          kind: "worth_seeing",
          sourcePostIds: [l.postId],
          score: 1.5, // above the breakout floor; taste and the scout rank from here
          corroboration: { accounts: 0, soundRising: false },
          formatFingerprint: fp,
          verdict: "pending",
          url: l.url,
          why: `format worth stealing, not their topic: ${l.format}; angle: ${l.angle}${l.humor ? `; humor: ${l.humor}` : ""}; why it works: ${l.why}; on another subject: ${l.onAnotherSubject}; from @${l.authorHandle ?? "?"} (${l.views.toLocaleString()} views); ${l.url}`,
          thresholdsVersion: THRESHOLDS.version,
          createdAt: a.now,
        });
        written++;
      }
    }
    return { written };
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ posts: number; kept: number; written: number }> => {
    const now = Date.now();
    const posts: Post[] = [];
    for (const [kind, params] of [["trending.tiktok", { region: "US" }], ["trending.reels", { batch: 1 }]] as const) {
      try {
        const r = await ctx.runAction(internal.reads.read.read, { kind, params });
        const rows = (Array.isArray(r.value) ? r.value : ((r.value as { posts?: unknown[] } | null)?.posts ?? [])) as Post[];
        posts.push(...rows);
      } catch (e) {
        console.error(`[formats] ${kind}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const usable = posts.filter((p) => p.postId && p.url && (p.caption ?? "").trim()).slice(0, 40);
    if (usable.length === 0) return { posts: posts.length, kept: 0, written: 0 };
    const creatorIds = await ctx.runQuery(internal.scout.formats.pairedCreatorIds, {});
    if (creatorIds.length === 0) return { posts: posts.length, kept: 0, written: 0 };
    const r = await callModel(ctx, {
      creatorId: creatorIds[0], // the fleet's read; billed once, to the first creator, and cached for all
      purpose: "format_watch",
      model: REGISTRY.screener.primary,
      messages: [
        { role: "system", content: FORMAT_PROMPT },
        { role: "user", content: JSON.stringify(usable.map((p) => ({ postId: p.postId, author: p.authorHandle ?? null, views: p.metrics?.viewCount ?? null, likes: p.metrics?.likeCount ?? null, comments: p.metrics?.commentCount ?? null, caption: (p.caption ?? "").slice(0, 200) }))) },
      ],
      temperature: 0.2,
      maxTokens: 900,
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    if (!r.ok) return { posts: posts.length, kept: 0, written: 0 };
    const known = new Map(usable.map((p) => [p.postId!, p]));
    const labels = parseLabels(r.content, new Set(known.keys()));
    const { written } = await ctx.runMutation(internal.scout.formats.writeWorthSeeing, {
      creatorIds,
      labels: labels.map((l) => ({ postId: l.postId, url: known.get(l.postId)!.url!, authorHandle: known.get(l.postId)!.authorHandle ?? null, views: known.get(l.postId)!.metrics?.viewCount ?? 0, format: l.format, angle: l.angle, humor: l.humor, why: l.why, onAnotherSubject: l.onAnotherSubject })),
      now,
    });
    return { posts: posts.length, kept: labels.length, written };
  },
});
