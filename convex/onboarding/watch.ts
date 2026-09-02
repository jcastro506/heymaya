/**
 * Pass three of the catalogue read (plan §13.1, §14.2): watch the sampled own posts,
 * one per call, and write an `ownPostReads` card with the creator-own extension.
 * Observations only; the "why" is asked once, in the synthesis, with the numbers.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { watchMedia, fetchMedia } from "../integrations/gemini/client";
import { WATCH_MODEL, WATCH_MODEL_TOP } from "../agent/registry";

export const WATCH_CAP = 40;

export const WATCH_PROMPT = `You are watching one short video to describe HOW it is made. Observations only, never why it worked. Return STRICT JSON, no prose:
{
 "firstSecond": "what is on screen and said in second one (≤160 chars)",
 "firstThree": "and by second three; when any text lands (≤200)",
 "hook": {"spokenLine": "≤200 or ''", "onScreenText": "≤120 or 'none'", "visualDevice": "≤120", "secondsToHook": 0.0},
 "beats": [{"atSec": 0, "what": "≤120"}],
 "textOverlay": {"present": true, "style": "≤80 or 'unknown'", "timing": "first-second|later|none|unknown"},
 "sound": {"type": "trending|original-voice|music-bed|silent|unknown"},
 "pacing": {"cutsPerTenSeconds": 0, "lengthSec": 0},
 "person": {"onCamera": "face|voice|hands|text|mixed", "framing": "≤60", "setting": "≤80", "lighting": "good|flat|dark|mixed|unknown", "energy": "≤60", "relationshipToCamera": "≤100"},
 "craft": {"transitions": ["≤4"], "zooms": false, "bRoll": false, "captionStyle": "≤80", "voice": "over|on-camera|none|unknown", "cta": "≤80 or 'none'"},
 "payoff": {"present": false, "atSec": null},
 "signature": "what would identify this creator with the name hidden (≤160)",
 "generic": "what is standard for the genre here (≤120)",
 "toneObservations": {"delivery": "flat|animated|mixed|unknown", "absurdity": "none|some|high|unknown", "laughCues": false, "captionRegister": "straight|playful|unknown"},
 "confidence": {"hook": 0.0, "person": 0.0, "craft": 0.0}
}
Describe only what you can actually see and hear. Empty string or 'unknown' beats a guess.`;

export const sampledPosts = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Doc<"ownPosts">[]> => {
    const rows = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ownPosts">[];
    const already = new Set(
      ((await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ownPostReads">[]).map((r) => r.ownPostId),
    );
    return rows.filter((r) => r.sample?.length && r.contentType === "video" && !already.has(r._id)).slice(0, WATCH_CAP);
  },
});

export const storeRead = internalMutation({
  args: { creatorId: v.id("creators"), ownPostId: v.id("ownPosts"), card: v.any(), depth: v.union(v.literal("read"), v.literal("watch")), model: v.string() },
  handler: async (ctx, a): Promise<Id<"ownPostReads">> =>
    await ctx.db.insert("ownPostReads", {
      creatorId: a.creatorId,
      ownPostId: a.ownPostId,
      card: a.card,
      depth: a.depth,
      produced: { skillVersion: "watch-1", model: a.model, thresholdsVersion: "thresholds-0" },
      createdAt: Date.now(),
    }),
});

export const readsFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Doc<"ownPostReads">[]> =>
    (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ownPostReads">[],
});

/** Watch the sample. Returns counts; failures degrade to a `read`-depth card with the reason. */
export const run = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args): Promise<{ watched: number; degraded: number; costUsd: number }> => {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
    if (!apiKey) return { watched: 0, degraded: 0, costUsd: 0 };
    const posts = await ctx.runQuery(internal.onboarding.watch.sampledPosts, { creatorId: args.creatorId });
    let watched = 0, degraded = 0, costUsd = 0;

    for (const post of posts) {
      const isTop = post.sample?.includes("top") || post.sample?.includes("recent");
      const model = isTop ? WATCH_MODEL_TOP : WATCH_MODEL;
      let reason = "";
      try {
        // The playable URL comes from the post read; it is signed and expiring, so fetch at once.
        const info = await ctx.runAction(internal.reads.read.read, { kind: "post.info", params: { platform: post.platform, url: post.url }, creatorId: args.creatorId });
        const videoUrl = (info.value as { videoUrl?: string | null } | null)?.videoUrl ?? null;
        if (!videoUrl) reason = "no playable url";
        else {
          const media = await fetchMedia(videoUrl);
          if (!media.ok) reason = media.reason;
          else {
            const r = await watchMedia({ model, apiKey, prompt: WATCH_PROMPT, media: { bytes: media.bytes, mimeType: media.mimeType }, resolution: isTop ? "default" : "low" });
            if (r.usage) {
              costUsd += r.usage.costUsd;
              await ctx.runMutation(internal.core.costs.record, { creatorId: args.creatorId, vendor: "gemini", resource: model, purpose: "watch_own", costUsd: r.usage.costUsd, promptTokens: r.usage.promptTokens, completionTokens: r.usage.outputTokens, costSource: "endpoint_table" });
            }
            if (!r.ok) reason = r.reason;
            else {
              const m = r.text.match(/\{[\s\S]*\}/);
              let card: unknown = null;
              try { card = m ? JSON.parse(m[0]) : null; } catch { card = null; }
              if (!card) reason = "watch returned no JSON";
              else {
                await ctx.runMutation(internal.onboarding.watch.storeRead, { creatorId: args.creatorId, ownPostId: post._id, card: { ...(card as object), depth: "watch", postId: post.postId, platform: post.platform }, depth: "watch", model });
                watched += 1;
                continue;
              }
            }
          }
        }
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
      // Degraded: a read-depth card that cannot claim visuals (§14.2), with the reason kept.
      await ctx.runMutation(internal.onboarding.watch.storeRead, {
        creatorId: args.creatorId,
        ownPostId: post._id,
        card: { depth: "read", postId: post.postId, platform: post.platform, hook: { visualDevice: "unknown" }, textOverlay: { style: "unknown", timing: "unknown" }, pacing: { cutsPerTenSeconds: "unknown" }, degradedBecause: reason },
        depth: "read",
        model,
      });
      degraded += 1;
    }
    return { watched, degraded, costUsd };
  },
});
