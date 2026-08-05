/**
 * The media library (§6.4) — ingest, tag, and know what's missing.
 *
 * ## Why this is load-bearing rather than polish
 *
 * §6.4.6b measured it: **half of target-type sites publish no product
 * screenshot at all.** neon.tech returned 12 illustrations and zero
 * screenshots across every page; clerk.com 8 and zero. A headless browser
 * doesn't fix that — the images aren't hidden, they don't exist.
 *
 * So for roughly half of customers, what the founder sends is the *only* real
 * product imagery there will ever be. That makes the ask a primary path, not a
 * fallback.
 *
 * ## One recording, not five screenshots
 *
 * §6.4.2. A lighter ask *and* a richer input: one 30–60s screen recording
 * yields frames, b-roll, and showable moments that seed the idea bank. "Send
 * me five screenshots" is more work for them and less for us.
 *
 * ## Tagging is the whole value
 *
 * > *"Without tags `search_my_media` returns junk, and the difference between
 * > a grounded post and a random screenshot is entirely in whether she could
 * > find the right one."*
 *
 * A library nobody can search is a folder.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  assessLibrary,
  HEALTHY_SCREENSHOT_FLOOR,
  type AssetKind,
} from "./assetClassifier";
import type { Doc, Id } from "../_generated/dataModel";

/** Cheap vision, ~$0.0005 an image. §6.4.3 budgets exactly this. */
export const TAGGING_MODEL = "google/gemini-3.1-flash-lite";

/** Telegram's Bot API caps downloads here. A long recording will exceed it. */
export const TELEGRAM_MAX_BYTES = 20 * 1024 * 1024;

export const ASSET_KIND_BY_MIME: Record<string, "image" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
};

export function kindFor(contentType: string, caption?: string): Doc<"mediaAssets">["kind"] {
  const base = ASSET_KIND_BY_MIME[contentType.split(";")[0]] ?? "image";
  if (base === "video") {
    // A founder sending video almost always means "here's me using it" — that
    // is a screen recording, and it unlocks frames and b-roll rather than just
    // being a video we can post.
    return "screen_recording";
  }
  return /logo/i.test(caption ?? "") ? "logo" : "image";
}

/* -------------------------------------------------------------------------- */

export const record = internalMutation({
  args: {
    customerId: v.id("customers"),
    kind: v.union(
      v.literal("screenshot"),
      v.literal("screen_recording"),
      v.literal("image"),
      v.literal("slide"),
      v.literal("video"),
      v.literal("logo")
    ),
    source: v.union(
      v.literal("telegram"),
      v.literal("onboarding"),
      v.literal("scrape"),
      v.literal("generated")
    ),
    storageKey: v.string(),
    publicUrl: v.optional(v.string()),
    contentType: v.string(),
    bytes: v.optional(v.number()),
    caption: v.optional(v.string()),
    classifiedAs: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ assetId: Id<"mediaAssets"> }> => {
    const now = args.now ?? Date.now();
    // Same bytes twice is one asset. A founder re-sending a screenshot they
    // already sent should not double the library or the tagging bill.
    const existing = (await ctx.db
      .query("mediaAssets")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"mediaAssets">[];
    const dupe = existing.find((a) => a.storageKey === args.storageKey);
    if (dupe) return { assetId: dupe._id };

    const assetId = await ctx.db.insert("mediaAssets", {
      customerId: args.customerId,
      kind: args.kind,
      source: args.source,
      storageKey: args.storageKey,
      publicUrl: args.publicUrl,
      contentType: args.contentType,
      bytes: args.bytes,
      caption: args.caption,
      classifiedAs: args.classifiedAs,
      capturedAt: now,
      createdAt: now,
    });
    return { assetId };
  },
});

export const forCustomer = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<Doc<"mediaAssets">[]> =>
    (await ctx.db
      .query("mediaAssets")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"mediaAssets">[],
});

/**
 * ⭐ Does she have enough to make anything, and should she ask?
 *
 * The ask is expensive in a way credits aren't: it spends the founder's
 * attention and one of a handful of proactive messages. So it fires only when
 * the library genuinely can't carry a post — and never for the ~half of
 * customers whose site already publishes real screenshots.
 */
export const libraryHealth = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (
    ctx,
    args
  ): Promise<{
    total: number;
    productScreenshots: number;
    hasRecording: boolean;
    shouldAsk: boolean;
    detail: string;
  }> => {
    const assets = (await ctx.db
      .query("mediaAssets")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"mediaAssets">[];

    const hasRecording = assets.some((a) => a.kind === "screen_recording");
    const verdict = assessLibrary(
      assets.map((a) => (a.classifiedAs ?? "other") as AssetKind)
    );
    const productScreenshots = verdict.realScreenshots;

    /**
     * ⭐ `degraded`, not `thin`. The classifier already draws this line:
     * degraded means ZERO real product imagery, so anything we made would be
     * decoration around a claim. Thin means fewer than ideal, which is a worse
     * video and still a real post.
     *
     * Asking on `thin` would pester the founders who are already fine.
     *
     * And a screen recording answers the ask by itself — it yields frames — so
     * counting screenshots against someone who sent one asks them twice for
     * something they already did.
     */
    const shouldAsk = !hasRecording && verdict.degraded;

    return {
      total: assets.length,
      productScreenshots,
      hasRecording,
      shouldAsk,
      detail: hasRecording
        ? "a screen recording is on file — frames and b-roll come out of it"
        : productScreenshots >= HEALTHY_SCREENSHOT_FLOOR
          ? `${productScreenshots} real product screenshots — enough to work from`
          : productScreenshots === 0
            ? "no real product imagery at all — every post would be illustration or nothing"
            : `only ${productScreenshots} real product screenshots`,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Ingest                                                                      */
/* -------------------------------------------------------------------------- */

const TAG_SYSTEM = `You are labelling one image from a software product so it can be found later.

Return STRICT JSON, no prose:
{ "caption": string, "kind": string, "tags": string[] }

- "caption": what this SHOWS, in five or six words. "the export screen with an error", "empty dashboard before any data". Not "a screenshot of software".
- "kind": exactly one of product_screenshot, stock_photo, illustration, logo, person, other. product_screenshot means a real screenshot of the software's own interface — not a mockup, not a laptop on a desk.
- "tags": a few words someone would search for: the screen, the state, the feeling. "export", "error", "empty state", "before".

The caption is how she finds this again months from now. "Screenshot" helps nobody.`;

/**
 * Take a file the founder sent and make it usable.
 *
 * Deliberately ordered: **store the bytes first, tag second.** Telegram's
 * download URL dies within the hour and embeds the bot token, so anything that
 * delays the fetch risks losing the file entirely — and a stored-but-untagged
 * asset is recoverable, while a lost one is gone.
 */
export const ingestFromTelegram = internalAction({
  args: {
    customerId: v.id("customers"),
    fileId: v.string(),
    caption: v.optional(v.string()),
    /**
     * Set when the *message shape* knows better than the mime type does. A
     * `video_note` is `video/mp4` exactly like a screen recording is, and
     * filing that round selfie bubble as a recording would permanently
     * suppress the ask (§6.4.2). See `telegramFiles.extractFile`.
     */
    kindHint: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; error?: string; assetId?: Id<"mediaAssets">; classifiedAs?: string }> => {
    const { resolveTelegramBotIdentity, fetchTelegramFile } = await import(
      "../integrations/telegram/client"
    );
    const identity = resolveTelegramBotIdentity();
    if (!identity) return { ok: false, error: "the Telegram bot isn't configured" };

    const file = await fetchTelegramFile(identity, args.fileId);
    if (!file.ok) {
      // Same rule as the upload catch below: `reason` is Telegram's own words
      // ("download failed (403)", a raw fetch error), which tell the founder
      // nothing they can act on.
      console.error(`[media] telegram fetch failed for ${args.customerId}: ${file.reason}`);
      return { ok: false, error: "Telegram wouldn't hand it over" };
    }
    if (file.bytes.byteLength > TELEGRAM_MAX_BYTES) {
      return {
        ok: false,
        error:
          "that file is over Telegram's 20MB limit for bots — a shorter recording works better anyway",
      };
    }

    /**
     * `uploadAsset` sniffs the mime rather than trusting Telegram's, and is
     * idempotent by CONTENT HASH — the same bytes always land on the same key.
     * That is stronger dedupe than comparing filenames: a founder re-sending
     * the same screenshot under a new name is one asset, not two.
     */
    const { uploadAsset } = await import("../integrations/r2/endpoints");
    let key: string;
    try {
      const put = await uploadAsset({
        businessId: args.customerId,
        bytes: file.bytes,
        mimeType: file.contentType,
        sourceChannel: "telegram",
        receivedAt: Date.now(),
      });
      key = put.storageKey;
    } catch (error) {
      /**
       * ⚠️ The exception is LOGGED, never returned.
       *
       * This string ends up in a Telegram message, and an R2 SDK failure reads
       * like *"The specified bucket does not exist"* or a signature mismatch —
       * a founder cannot act on either, and both leak the stack. What reaches
       * them says what happened and what to do; what reaches the log says
       * what actually broke.
       */
      console.error(
        `[media] uploadAsset failed for ${args.customerId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return { ok: false, error: "I couldn't save it on my end" };
    }

    /**
     * ⚠️ NO `publicUrl` HERE, DELIBERATELY.
     *
     * `uploadAsset`'s `storageUrl` is private — the module says so: *"never
     * given to OpenClaw. Use getSignedUrl."* And Creatify's servers FETCH the
     * URLs we hand them (§6.4.4), so the render path needs a **signed URL with
     * a TTL comfortably longer than a render** (~5 min), minted at brief time
     * and not before.
     *
     * Storing a URL here would either leak a private path or bake in an expiry
     * that dies days before it's used.
     */
    const publicUrl: string | undefined = undefined;

    const kind = (args.kindHint as Doc<"mediaAssets">["kind"] | undefined)
      ?? kindFor(file.contentType, args.caption);
    const { assetId } = await ctx.runMutation(internal.maya.media.record, {
      customerId: args.customerId,
      kind,
      source: "telegram",
      storageKey: key,
      publicUrl,
      contentType: file.contentType,
      bytes: file.bytes.byteLength,
      caption: args.caption,
    });

    // Tagging is best-effort: an untagged asset is worse than a tagged one and
    // far better than a lost one, so a vision failure never discards the file.
    if (kind !== "screen_recording" && kind !== "video") {
      const tagged = await ctx.runAction(internal.maya.media.tagAsset, {
        assetId,
        bytesBase64: Buffer.from(file.bytes).toString("base64"),
        contentType: file.contentType,
      });
      return { ok: true, assetId, classifiedAs: tagged.classifiedAs };
    }

    return { ok: true, assetId };
  },
});

export const applyTags = internalMutation({
  args: {
    assetId: v.id("mediaAssets"),
    caption: v.string(),
    classifiedAs: v.string(),
    tagsJson: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.assetId, {
      caption: args.caption,
      classifiedAs: args.classifiedAs,
      tagsJson: args.tagsJson,
    });
    return null;
  },
});

export const tagAsset = internalAction({
  args: {
    assetId: v.id("mediaAssets"),
    bytesBase64: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args): Promise<{ classifiedAs?: string }> => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return {};

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType: args.contentType.split(";")[0],
                      data: args.bytesBase64,
                    },
                  },
                  { text: TAG_SYSTEM },
                ],
              },
            ],
          }),
        }
      );
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const parsed = parseTags(text);
      if (!parsed) return {};

      await ctx.runMutation(internal.maya.media.applyTags, {
        assetId: args.assetId,
        caption: parsed.caption,
        classifiedAs: parsed.kind,
        tagsJson: JSON.stringify(parsed.tags),
      });
      return { classifiedAs: parsed.kind };
    } catch {
      return {};
    }
  },
});

export function parseTags(
  content: string
): { caption: string; kind: string; tags: string[] } | null {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(text.slice(first, last + 1)) as {
      caption?: unknown;
      kind?: unknown;
      tags?: unknown;
    };
    if (typeof parsed.caption !== "string" || typeof parsed.kind !== "string") {
      return null;
    }
    return {
      caption: parsed.caption.slice(0, 200),
      kind: parsed.kind,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === "string").slice(0, 8)
        : [],
    };
  } catch {
    return null;
  }
}
