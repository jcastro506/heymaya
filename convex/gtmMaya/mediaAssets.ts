/**
 * Slideshow cluster — Maya's per-agent media library + grounded slide gen.
 *
 * The moat is GROUNDING: every TikTok/IG slide is framed around the user's
 * REAL screenshot, never a stock image. Five agent-facing tools:
 *
 *   - save_media         the user texted Maya a screenshot/recording → she
 *                        resolved its Telegram file URL (getFile, same path as
 *                        review_media) → we download into Convex storage and
 *                        catalog an entry. This is the ground truth.
 *   - search_my_media    what's already in the library (check BEFORE asking).
 *   - request_media      text the user for a specific missing asset, ONCE —
 *                        guarded against asking for something she already has.
 *   - generate_slide_image  nano banana (gemini-2.5-flash-image) frames a real
 *                        screenshot into a slide; output stored back as a
 *                        `slide` entry. A carousel = an ordered set of slides.
 *   - send_media_to_user deliver finished slides to the user (auto-post to
 *                        TikTok/IG is API-gated → fast-follow).
 *
 * STORAGE SHAPE — the library is NOT a Convex table. It lives as a JSON string
 * on `gtmAgents.mediaLibraryJson`. The schema sits exactly at TypeScript's
 * DataModel instantiation ceiling; a 139th table (proven empirically) regresses
 * `db.get()` narrowing project-wide, while a plain string adds zero type
 * complexity. Per-agent the library is small (always loaded with the agent
 * row), and search/dedupe run in JS over the parsed array. Each entry's
 * identity is its Convex storageId.
 *
 * Outbound (request/deliver) goes Convex→Telegram, the reliable direction
 * (Fly→api.telegram.org is flaky — see feedback memory). Ingest + gen run in
 * actions because they fetch/store bytes and call Gemini.
 */

import { v } from "convex/values";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { authenticate } from "./openclaw/inboundCallback";

// Image ingest ceiling — screenshots/recordings are small; reject anything
// that smells like a mis-handed huge file (protects storage + Gemini cost).
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_REFERENCE_ASSETS = 4;
const MAX_DELIVER_ASSETS = 12;
// Nano Banana 2 = Gemini 3.1 Flash Image (launched 2026-02-26): ~50% cheaper
// than 2.5 Flash Image and the current Flash-tier image model. Routed through
// OpenRouter (modalities:["image","text"]) so slide-gen shares Maya's single
// OPENROUTER_API_KEY + telemetry profile, instead of a separate GEMINI key.
const SLIDE_MODEL =
  process.env.MAYA_GTM_SLIDE_MODEL ?? "google/gemini-3.1-flash-image-preview";

const MEDIA_KINDS = [
  "screenshot",
  "screen_recording",
  "image",
  "slide",
  "video",
] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

const MEDIA_SOURCES = [
  "telegram",
  "onboarding",
  "generated",
  "auto_grab",
  "creatify",
] as const;
type MediaSource = (typeof MEDIA_SOURCES)[number];

/** One row in the per-agent media library (stored as JSON, keyed by storageId). */
interface GtmMediaEntry {
  storageId: string;
  kind: MediaKind;
  source: MediaSource;
  mimeType: string;
  storageBytes: number;
  label?: string;
  sha256?: string;
  /** For `slide` entries: the screenshot storageIds this slide was grounded in. */
  referenceStorageIds?: string[];
  /** Free-form provenance (gen prompt, platform, slideText) — small object. */
  meta?: Record<string, unknown>;
  archivedAt?: number;
  createdAt: number;
}

// Explicit handler return types. These break the circular type inference
// between this module's exported Convex functions and the `internal.*` API
// graph (which references them back) — without the annotations TS deeply
// re-instantiates the whole DataModel and blows its program-wide budget,
// regressing db.get() narrowing across unrelated files.
type IngestResult =
  | { ok: false; reason: string }
  | { ok: true; deduped: boolean; assetId: string; label: string | null };
type GenerateResult =
  | { ok: false; reason: string }
  | { ok: true; assetId: string; grounded: boolean; reason: string };
interface DeliveryItem {
  id: string;
  url: string;
  isVideo: boolean;
}

// =====================================================================
// Helpers
// =====================================================================

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function kindFromMime(mime: string): MediaKind {
  if (mime.startsWith("video/")) return "screen_recording";
  return "image";
}

function parseLibrary(json: string | undefined): GtmMediaEntry[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as GtmMediaEntry[]) : [];
  } catch {
    return [];
  }
}

// =====================================================================
// DB layer — the library lives on gtmAgents.mediaLibraryJson.
// =====================================================================

export const getLibrary = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<GtmMediaEntry[]> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return [];
    return parseLibrary(agent.mediaLibraryJson).filter((e) => !e.archivedAt);
  },
});

/**
 * Append an entry to the agent's library, deduped by sha256. Atomic: the read,
 * dedupe check, and write all happen in one mutation. If a same-sha entry
 * already exists, the just-stored blob is an orphan — we delete it and return
 * the existing entry's storageId.
 */
export const appendEntry = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    storageId: v.id("_storage"),
    kind: v.string(),
    source: v.string(),
    mimeType: v.string(),
    storageBytes: v.number(),
    label: v.optional(v.string()),
    sha256: v.optional(v.string()),
    referenceStorageIds: v.optional(v.array(v.string())),
    meta: v.optional(v.any()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ assetId: string; deduped: boolean }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("agent not found");
    const library = parseLibrary(agent.mediaLibraryJson);

    if (args.sha256) {
      const dupe = library.find(
        (e) => !e.archivedAt && e.sha256 === args.sha256
      );
      if (dupe) {
        // Orphan the blob we were handed; the existing entry wins.
        await ctx.storage.delete(args.storageId);
        return { assetId: dupe.storageId, deduped: true };
      }
    }

    const entry: GtmMediaEntry = {
      storageId: args.storageId,
      kind: (MEDIA_KINDS as readonly string[]).includes(args.kind)
        ? (args.kind as MediaKind)
        : kindFromMime(args.mimeType),
      source: (MEDIA_SOURCES as readonly string[]).includes(args.source)
        ? (args.source as MediaSource)
        : "telegram",
      mimeType: args.mimeType,
      storageBytes: args.storageBytes,
      label: args.label,
      sha256: args.sha256,
      referenceStorageIds:
        args.referenceStorageIds && args.referenceStorageIds.length > 0
          ? args.referenceStorageIds
          : undefined,
      meta: args.meta,
      createdAt: Date.now(),
    };
    library.push(entry);
    await ctx.db.patch(args.agentId, {
      mediaLibraryJson: JSON.stringify(library),
      updatedAt: Date.now(),
    });
    return { assetId: args.storageId, deduped: false };
  },
});

// =====================================================================
// Actions (download / generate)
// =====================================================================

/** Download a Telegram (or any directly-fetchable) media URL → store → entry. */
export const ingestFromUrl = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    mediaUrl: v.string(),
    label: v.optional(v.string()),
    kindHint: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<IngestResult> => {
    const res = await fetch(args.mediaUrl);
    if (!res.ok) {
      return { ok: false as const, reason: `fetch_failed_${res.status}` };
    }
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength <= 0) {
      return { ok: false as const, reason: "empty_media" };
    }
    if (bytes.byteLength > MAX_MEDIA_BYTES) {
      return { ok: false as const, reason: "too_large" };
    }
    const mimeType =
      res.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";
    const sha256 = await sha256Hex(bytes);

    // Pre-check dedupe so we skip the storage write on a known re-send.
    const library = await ctx.runQuery(
      internal.gtmMaya.mediaAssets.getLibrary,
      { agentId: args.agentId }
    );
    const existing = library.find((e) => e.sha256 === sha256);
    if (existing) {
      return {
        ok: true as const,
        deduped: true,
        assetId: existing.storageId,
        label: existing.label ?? args.label ?? null,
      };
    }

    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: mimeType })
    );
    const result = await ctx.runMutation(
      internal.gtmMaya.mediaAssets.appendEntry,
      {
        agentId: args.agentId,
        storageId,
        kind: args.kindHint ?? kindFromMime(mimeType),
        source: args.source ?? "telegram",
        mimeType,
        storageBytes: bytes.byteLength,
        label: args.label,
        sha256,
      }
    );
    return {
      ok: true as const,
      deduped: result.deduped,
      assetId: result.assetId,
      label: args.label ?? null,
    };
  },
});

/**
 * Generate a slide with nano banana, GROUNDED in real screenshots.
 *
 * The reference screenshots are passed to Gemini as inline image parts; the
 * prompt hard-rules that the screenshot must be placed UNCHANGED (Gemini only
 * frames/captions around it). If no reference is given the call still runs but
 * the grounding rule is relaxed to "decorative/hook/CTA slide only" — the
 * skill steers Maya to always attach a screenshot for product slides.
 */
export const generateSlide = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    referenceStorageIds: v.optional(v.array(v.string())),
    prompt: v.string(),
    slideText: v.optional(v.string()),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<GenerateResult> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { ok: false as const, reason: "openrouter_key_missing" };
    }

    const refIds = (args.referenceStorageIds ?? []).slice(
      0,
      MAX_REFERENCE_ASSETS
    );
    // Only reference assets that actually belong to THIS agent's library.
    const library = await ctx.runQuery(
      internal.gtmMaya.mediaAssets.getLibrary,
      { agentId: args.agentId }
    );
    const ownedRefs = refIds.filter((id) =>
      library.some((e) => e.storageId === id)
    );

    // OpenRouter image-input content parts: { type:"image_url", image_url:{ url:
    // "data:<mime>;base64,<...>" } }. The user's REAL screenshots, base64'd.
    const imageParts: Array<{
      type: "image_url";
      image_url: { url: string };
    }> = [];
    for (const id of ownedRefs) {
      const entry = library.find((e) => e.storageId === id);
      if (!entry || !entry.mimeType.startsWith("image/")) continue;
      const url = await ctx.storage.getUrl(id as Id<"_storage">);
      if (!url) continue;
      const imgRes = await fetch(url);
      if (!imgRes.ok) continue;
      const imgBytes = await imgRes.arrayBuffer();
      imageParts.push({
        type: "image_url",
        image_url: {
          url: `data:${entry.mimeType};base64,${arrayBufferToBase64(imgBytes)}`,
        },
      });
    }

    const grounded = imageParts.length > 0;
    const platform = args.platform ?? "tiktok";
    const groundingRule = grounded
      ? `GROUNDING (non-negotiable): the attached screenshot(s) are the user's REAL product. Place the screenshot UNCHANGED inside the slide — do NOT redraw, restyle, fabricate, or alter any UI, text, numbers, or data shown in it. You only build the frame, background, and caption AROUND the real screenshot. If you cannot preserve the screenshot exactly, return no image.`
      : `No reference screenshot was attached, so produce a DECORATIVE/hook/CTA slide only (background + caption). Do NOT fabricate a fake product UI or invent screenshots of the app.`;
    const captionRule = args.slideText
      ? `Overlay this caption text, legibly, high-contrast: "${args.slideText}"`
      : `No caption text — keep it clean for the user to add their own.`;

    const fullPrompt = `You are designing one ${platform} ${
      grounded ? "photo-mode/carousel" : ""
    } slide for an indie app founder's organic growth post.

${groundingRule}

${captionRule}

Slide intent from the founder's manager: ${args.prompt}

Output a single image sized for ${platform} (vertical 9:16 / 1080x1920 feel). Modern, clean, native-to-the-platform — not corporate, not stock-photo, not AI-slop. Return the image.`;

    // OpenRouter image generation: /chat/completions with modalities including
    // "image"; the generated image returns in message.images[].image_url.url as
    // a base64 data URL.
    let res: Response;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: SLIDE_MODEL,
          modalities: ["image", "text"],
          messages: [
            { role: "user", content: [...imageParts, { type: "text", text: fullPrompt }] },
          ],
        }),
      });
    } catch (err) {
      return {
        ok: false as const,
        reason: `slide_fetch_error: ${(err as Error).message}`,
      };
    }
    if (!res.ok) {
      return { ok: false as const, reason: `slide_http_${res.status}` };
    }
    const payload = (await res.json()) as {
      choices?: Array<{
        message?: {
          images?: Array<{ image_url?: { url?: string } }>;
        };
      }>;
    };
    // Parse the first returned image's base64 out of its data URL.
    let outMime = "image/png";
    let outData: string | undefined;
    const images = payload.choices?.[0]?.message?.images ?? [];
    for (const img of images) {
      const dataUrl = img.image_url?.url;
      if (!dataUrl) continue;
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        outMime = m[1] ?? outMime;
        outData = m[2];
        break;
      }
    }
    if (!outData) {
      return { ok: false as const, reason: "slide_no_image_returned" };
    }

    const binary = atob(outData);
    const outBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1)
      outBytes[i] = binary.charCodeAt(i);
    const storageId = await ctx.storage.store(
      new Blob([outBytes], { type: outMime })
    );

    const result = await ctx.runMutation(
      internal.gtmMaya.mediaAssets.appendEntry,
      {
        agentId: args.agentId,
        storageId,
        kind: "slide",
        source: "generated",
        mimeType: outMime,
        storageBytes: outBytes.byteLength,
        label: args.slideText ?? args.prompt.slice(0, 80),
        referenceStorageIds: ownedRefs.length > 0 ? ownedRefs : undefined,
        meta: {
          prompt: args.prompt,
          slideText: args.slideText ?? null,
          platform,
          grounded,
          model: SLIDE_MODEL,
        },
      }
    );
    return {
      ok: true as const,
      assetId: result.assetId,
      grounded,
      reason: grounded ? "grounded" : "decorative_no_reference",
    };
  },
});

/** Resolve storage URLs for delivery (action context). */
export const resolveDeliveryUrls = internalAction({
  args: { agentId: v.id("gtmAgents"), ids: v.array(v.string()) },
  handler: async (ctx, args): Promise<DeliveryItem[]> => {
    const library = await ctx.runQuery(
      internal.gtmMaya.mediaAssets.getLibrary,
      { agentId: args.agentId }
    );
    const out: DeliveryItem[] = [];
    for (const id of args.ids) {
      const entry = library.find((e) => e.storageId === id);
      if (!entry) continue; // tenant isolation: only this agent's own assets
      const url = await ctx.storage.getUrl(id as Id<"_storage">);
      if (!url) continue;
      out.push({
        id,
        url,
        isVideo:
          entry.mimeType.startsWith("video/") ||
          entry.kind === "video" ||
          entry.kind === "screen_recording",
      });
    }
    return out;
  },
});

// =====================================================================
// HTTP endpoints (agent-facing typed tools)
// =====================================================================

export const saveMediaHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: { mediaUrl?: string; label?: string; kind?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.mediaUrl || typeof body.mediaUrl !== "string") {
    return new Response("missing required field (mediaUrl)", { status: 400 });
  }

  const result = await ctx.runAction(
    internal.gtmMaya.mediaAssets.ingestFromUrl,
    {
      agentId: auth.agentId,
      mediaUrl: body.mediaUrl,
      label: body.label,
      kindHint: body.kind,
      source: "telegram",
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const searchMyMediaHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(
    limitParam && Number.isFinite(parseInt(limitParam, 10))
      ? parseInt(limitParam, 10)
      : 50,
    100
  );

  const library = await ctx.runQuery(internal.gtmMaya.mediaAssets.getLibrary, {
    agentId: auth.agentId,
  });
  const assets = library
    .filter((e) => (kind ? e.kind === kind : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((e) => ({
      id: e.storageId,
      kind: e.kind,
      source: e.source,
      label: e.label ?? null,
      mimeType: e.mimeType,
      createdAt: e.createdAt,
      referenceStorageIds: e.referenceStorageIds ?? [],
    }));
  return new Response(
    JSON.stringify({ ok: true, count: assets.length, assets }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});

export const requestMediaHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: { label?: string; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.label || typeof body.label !== "string") {
    return new Response("missing required field (label)", { status: 400 });
  }

  // NEVER double-ask: if she already has a non-slide asset matching this
  // label, tell her instead of texting the user for something on hand.
  const library = await ctx.runQuery(internal.gtmMaya.mediaAssets.getLibrary, {
    agentId: auth.agentId,
  });
  const needle = body.label.trim().toLowerCase();
  const existing = library.find(
    (e) =>
      e.kind !== "slide" &&
      (e.label ?? "").trim().toLowerCase().includes(needle)
  );
  if (existing) {
    return new Response(
      JSON.stringify({
        ok: true,
        sent: false,
        alreadyHave: true,
        assetId: existing.storageId,
        message: `You already have an asset labeled "${existing.label ?? body.label}" — use search_my_media, don't ask again.`,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  // Resolve chat + bot, then text the ask (Convex→Telegram, reliable dir).
  const agent = await ctx.runQuery(
    internal.gtmMaya.openclaw.inboundCallback.getAgentForSendUpdate,
    { agentId: auth.agentId }
  );
  if (!agent || !agent.telegramChatId) {
    return new Response(
      JSON.stringify({ ok: false, sent: false, reason: "no_telegram_chat_id" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  const { resolveBotForAgent } = await import("./telegramBotPerTenant");
  const bot = await resolveBotForAgent(
    ctx as { runQuery: <T>(ref: unknown, args: unknown) => Promise<T> },
    auth.agentId,
    {
      sharedToken: process.env.TELEGRAM_BOT_TOKEN,
      sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
    }
  );
  if (!bot.token) {
    return new Response(
      JSON.stringify({ ok: false, sent: false, reason: "no_telegram_bot" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  const ask = body.reason
    ? `${body.reason}\n\nCould you text me: ${body.label}?`
    : `Could you text me ${body.label}? I'll use it to build your next post.`;
  const { sendDirectTelegramMessage } = await import(
    "../integrations/telegram/sendDirectMessage"
  );
  const sendResult = await sendDirectTelegramMessage({
    botToken: bot.token,
    chatId: agent.telegramChatId,
    text: ask,
  });
  return new Response(
    JSON.stringify({
      ok: sendResult.ok,
      sent: sendResult.ok,
      reason: sendResult.reason,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});

export const generateSlideImageHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: {
    referenceAssetIds?: string[];
    prompt?: string;
    slideText?: string;
    platform?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.prompt || typeof body.prompt !== "string") {
    return new Response("missing required field (prompt)", { status: 400 });
  }

  const result = await ctx.runAction(
    internal.gtmMaya.mediaAssets.generateSlide,
    {
      agentId: auth.agentId,
      referenceStorageIds: (body.referenceAssetIds ?? []).slice(
        0,
        MAX_REFERENCE_ASSETS
      ),
      prompt: body.prompt,
      slideText: body.slideText,
      platform: body.platform,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const sendMediaToUserHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: { assetIds?: string[]; caption?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const assetIds = (body.assetIds ?? []).slice(0, MAX_DELIVER_ASSETS);
  if (assetIds.length === 0) {
    return new Response("missing required field (assetIds)", { status: 400 });
  }

  const agent = await ctx.runQuery(
    internal.gtmMaya.openclaw.inboundCallback.getAgentForSendUpdate,
    { agentId: auth.agentId }
  );
  if (!agent || !agent.telegramChatId) {
    return new Response(
      JSON.stringify({ ok: false, reason: "no_telegram_chat_id" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  const { resolveBotForAgent } = await import("./telegramBotPerTenant");
  const bot = await resolveBotForAgent(
    ctx as { runQuery: <T>(ref: unknown, args: unknown) => Promise<T> },
    auth.agentId,
    {
      sharedToken: process.env.TELEGRAM_BOT_TOKEN,
      sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
    }
  );
  if (!bot.token) {
    return new Response(
      JSON.stringify({ ok: false, reason: "no_telegram_bot" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  const items = await ctx.runAction(
    internal.gtmMaya.mediaAssets.resolveDeliveryUrls,
    { agentId: auth.agentId, ids: assetIds }
  );
  if (items.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, reason: "no_resolvable_assets" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  const { sendDirectTelegramMedia } = await import(
    "../integrations/telegram/sendDirectMessage"
  );
  let delivered = 0;
  const failures: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const r = await sendDirectTelegramMedia({
      botToken: bot.token,
      chatId: agent.telegramChatId,
      mediaUrl: item.url,
      isVideo: item.isVideo,
      // Caption only on the first item so a carousel reads as one message.
      caption: i === 0 ? body.caption : undefined,
    });
    if (r.ok) delivered += 1;
    else failures.push(`${item.id}:${r.reason}`);
  }
  return new Response(
    JSON.stringify({
      ok: delivered > 0,
      delivered,
      requested: assetIds.length,
      failures,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});
