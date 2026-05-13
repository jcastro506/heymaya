/**
 * Outbound media bridge for Creator Maya — Sprint A.1.
 *
 * The mirror of `openClawMediaIngestHttp` (the INBOUND bridge). After Maya
 * runs `maya-clip-editor` and FFmpeg drops a rendered file on her Fly
 * machine's local volume (`/data/workspace/<file>.mp4`), she CANNOT pass that
 * local path to `claw-messenger.sendMedia` — the relay can't reach Maya's
 * volume. She has to upload the bytes here first, then send the returned
 * `publicUrl` through `claw-messenger.sendMedia`.
 *
 * Contract:
 *   - Maya POSTs `multipart/form-data` (not JSON — `curl -F` is what her
 *     `exec` tool naturally produces, and form-data keeps the file off the
 *     base64-padding tax).
 *   - Form fields:
 *       secret           — gated by assertWebhookSecret (constant-time)
 *       creatorId        — validated against creators table
 *       file             — the binary (mp4 / png / jpg / gif / wav)
 *       kind             — optional "image" | "video" | "audio"
 *                          (inferred from mime if omitted)
 *       source           — optional, default "rendered_variant"
 *                          (alt: "web_upload")
 *       originalFilename — optional, preserved on the row
 *   - Returns `{ ok, publicUrl, mediaAssetId, mimeType, bytes }`.
 *   - `publicUrl` comes from `ctx.storage.getUrl(storageId)`. Convex signed
 *     URLs are valid for ~1 hour — Apple's CDN caches in seconds, so the TTL
 *     is fine for iMessage delivery.
 *
 * Auth note: this endpoint uses `assertWebhookSecret` (form field), NOT the
 * `MAYA_RUNTIME_SECRET` Bearer header that `openClawMediaIngestHttp` uses.
 * Reason: Maya posts from the Fly machine via curl with `-F secret=$X` (her
 * `exec` tool composes form-data ergonomically; bearer headers via curl are
 * doable but the per-creator Fly env already ships `WEBHOOK_INTERNAL_SECRET`
 * which is the shared HTTP-bridge gate.
 *
 * Sibling: `convex/creatorMayaV0/openClawMediaIngestHttp.ts` (inbound). Do
 * NOT consolidate — inbound parses base64 / URL fetch, outbound parses
 * multipart. Different shapes, same downstream mutation
 * (`ingestCreatorMediaAssetInternal`).
 */

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assertWebhookSecret } from "../lib/webhookSecret";

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

type MediaKind = "image" | "video" | "audio" | "other";
type Source =
  | "imessage"
  | "web_upload"
  | "openclaw_attachment"
  | "rendered_variant"
  | "seedance_reference";

interface ParsedForm {
  creatorId: string;
  file: File;
  kind?: MediaKind;
  source: Source;
  originalFilename?: string;
}

export const uploadRenderedMediaHttp = httpAction(async (ctx, request) => {
  // 1) Parse the multipart body. A malformed body throws here; we surface as
  //    400 (unreadable form) rather than 500 so Maya knows to redraft the
  //    curl, not retry the same payload.
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return json(
      { error: `Unreadable multipart body: ${(err as Error).message}` },
      400
    );
  }

  // 2) Auth gate. The provided secret may be missing / wrong — both produce
  //    the same 401 (assertWebhookSecret intentionally vague to avoid timing
  //    oracles + to avoid leaking whether the env is unset).
  const providedSecret = readString(form, "secret");
  try {
    assertWebhookSecret(providedSecret);
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }

  // 3) Validate required fields.
  let parsed: ParsedForm;
  try {
    parsed = parseForm(form);
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }

  // 4) Confirm the creator exists. Mirrors the INBOUND validator. Short-
  //    circuits before any storage write — important for cross-tenant /
  //    plan-tier × action coverage (Maya never lands bytes for a bogus id).
  try {
    await ctx.runQuery(
      internal.creatorMayaV0.mediaAssets.validateRuntimeMediaIngestInternal,
      {
        creatorId: parsed.creatorId as Id<"creators">,
      }
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Creator not found")) {
      return json({ error: "Creator not found." }, 404);
    }
    return json({ error: msg }, 400);
  }

  // 5) Read the bytes and enforce caps.
  const bytes = await parsed.file.arrayBuffer();
  if (bytes.byteLength <= 0) {
    return json({ error: "File is empty." }, 400);
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return json(
      {
        error: `File exceeds ${MAX_ATTACHMENT_BYTES} byte limit (got ${bytes.byteLength}).`,
      },
      413
    );
  }

  // 6) Resolve mime + kind. The browser/curl `Content-Type` on the file part
  //    is authoritative if present; we fall back to octet-stream and let the
  //    `kind` form field (or the mime-prefix inference) decide the row's
  //    `mediaKind`.
  const mimeType =
    parsed.file.type && parsed.file.type.length > 0
      ? parsed.file.type
      : "application/octet-stream";
  const mediaKind: MediaKind = parsed.kind ?? mediaKindFromMime(mimeType);

  // 7) Store the bytes + hash + write the row. Any failure here surfaces as
  //    500 (storage outage / mutation-validator mismatch); Maya retries once
  //    per her skill.md `maya-clip-editor` contract, then surfaces honestly.
  try {
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: mimeType })
    );
    const contentHash = await sha256Hex(bytes);

    const result = await ctx.runMutation(
      internal.creatorMayaV0.mediaAssets.ingestCreatorMediaAssetInternal,
      {
        creatorId: parsed.creatorId as Id<"creators">,
        storageId,
        storageBytes: bytes.byteLength,
        mimeType,
        mediaKind,
        source: parsed.source,
        filename: parsed.originalFilename,
        contentHash,
        consentText: "Outbound render — Maya-uploaded rendered creator media",
      }
    );

    const publicUrl = await ctx.storage.getUrl(storageId);
    if (!publicUrl) {
      // Storage wrote but the signed-URL helper returned null — treat as
      // 500 because Maya cannot deliver without a URL. The row stays (the
      // creator can re-request, dedupe will short-circuit).
      return json({ error: "Storage returned no public URL." }, 500);
    }

    return json(
      {
        ok: true,
        publicUrl,
        mediaAssetId: result.mediaAssetId,
        deduped: result.deduped,
        mimeType,
        bytes: bytes.byteLength,
      },
      200
    );
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function parseForm(form: FormData): ParsedForm {
  const creatorId = readString(form, "creatorId");
  if (!creatorId) {
    throw new Error("creatorId is required.");
  }

  const fileEntry = form.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    throw new Error("file is required.");
  }
  // `fileEntry` here is a Blob/File. Convex's runtime gives us a `File`
  // instance with `.arrayBuffer()`, `.type`, `.name`. Narrow.
  const file = fileEntry as File;

  const kindRaw = readString(form, "kind");
  if (kindRaw && !isMediaKind(kindRaw)) {
    throw new Error("kind is invalid.");
  }
  const kind = (kindRaw ?? undefined) as MediaKind | undefined;

  const sourceRaw = readString(form, "source") ?? "rendered_variant";
  if (!isSource(sourceRaw)) {
    throw new Error("source is invalid.");
  }
  const source = sourceRaw as Source;

  const originalFilename = readString(form, "originalFilename") ?? file.name;

  return {
    creatorId,
    file,
    kind,
    source,
    originalFilename: originalFilename || undefined,
  };
}

function readString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (value === null) return undefined;
  if (typeof value !== "string") return undefined;
  return value;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function mediaKindFromMime(mimeType: string): MediaKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "other";
}

function isMediaKind(value: string): value is MediaKind {
  return ["image", "video", "audio", "other"].includes(value);
}

function isSource(value: string): value is Source {
  return [
    "imessage",
    "web_upload",
    "openclaw_attachment",
    "rendered_variant",
    "seedance_reference",
  ].includes(value);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
