/**
 * OpenClaw attachment bridge for Creator Maya.
 *
 * Native iMessage attachments are transient from Maya's point of view. The
 * gateway must call this endpoint immediately with either an attachment URL or
 * base64 bytes. Convex stores durable bytes, dedupes by content hash, and
 * returns a creator-owned media asset id that skills can reference later.
 */

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const RUNTIME_SECRET_ENV = "MAYA_RUNTIME_SECRET";

type MediaKind = "image" | "video" | "audio" | "other";
type Source =
  | "imessage"
  | "web_upload"
  | "openclaw_attachment"
  | "rendered_variant"
  | "seedance_reference";

interface Payload {
  creatorId: string;
  attachmentUrl?: string;
  attachmentBase64?: string;
  mimeType?: string;
  mediaKind?: MediaKind;
  source?: Source;
  sourceMessageId?: string;
  sourceChannel?: string;
  sourcePhoneNumber?: string;
  filename?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  consentText?: string;
  nowMs?: number;
}

export const openClawMediaIngestHttp = httpAction(async (ctx, request) => {
  const authError = authenticate(request);
  if (authError) return json(authError, 401);

  let payload: Payload;
  try {
    payload = parsePayload(await request.json());
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }

  try {
    await ctx.runQuery(
      internal.creatorMayaV0.mediaAssets.validateRuntimeMediaIngestInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        sourcePhoneNumber: payload.sourcePhoneNumber,
      }
    );

    const attachment = await readAttachment(payload);
    const storageId = await ctx.storage.store(
      new Blob([attachment.bytes], { type: attachment.mimeType })
    );
    const contentHash = await sha256Hex(attachment.bytes);

    const result = await ctx.runMutation(
      internal.creatorMayaV0.mediaAssets.ingestCreatorMediaAssetInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        storageId,
        storageBytes: attachment.bytes.byteLength,
        mimeType: attachment.mimeType,
        mediaKind: payload.mediaKind ?? mediaKindFromMime(attachment.mimeType),
        source: payload.source ?? "openclaw_attachment",
        sourceMessageId: payload.sourceMessageId,
        sourceChannel: payload.sourceChannel,
        sourcePhoneNumber: payload.sourcePhoneNumber,
        filename: payload.filename,
        width: payload.width,
        height: payload.height,
        durationMs: payload.durationMs,
        contentHash,
        consentText: payload.consentText,
        nowMs: payload.nowMs,
      }
    );

    return json(
      {
        ok: true,
        ...result,
        contentHash,
        storageBytes: attachment.bytes.byteLength,
        mimeType: attachment.mimeType,
      },
      200
    );
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function authenticate(request: Request): { error: string } | null {
  const expected = process.env[RUNTIME_SECRET_ENV];
  if (!expected) {
    return { error: `${RUNTIME_SECRET_ENV} not configured` };
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return { error: "Invalid Maya runtime secret" };
  }
  return null;
}

function parsePayload(value: unknown): Payload {
  if (!value || typeof value !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  const payload = value as Payload;
  if (!payload.creatorId || typeof payload.creatorId !== "string") {
    throw new Error("creatorId is required.");
  }
  if (!payload.attachmentUrl && !payload.attachmentBase64) {
    throw new Error("attachmentUrl or attachmentBase64 is required.");
  }
  if (payload.attachmentUrl && payload.attachmentBase64) {
    throw new Error("Pass only one of attachmentUrl or attachmentBase64.");
  }
  if (payload.mediaKind && !isMediaKind(payload.mediaKind)) {
    throw new Error("mediaKind is invalid.");
  }
  if (payload.source && !isSource(payload.source)) {
    throw new Error("source is invalid.");
  }
  return payload;
}

async function readAttachment(payload: Payload): Promise<{
  bytes: ArrayBuffer;
  mimeType: string;
}> {
  if (payload.attachmentBase64) {
    const bytes = base64ToArrayBuffer(payload.attachmentBase64);
    assertSize(bytes.byteLength);
    return {
      bytes,
      mimeType: payload.mimeType ?? "application/octet-stream",
    };
  }

  const url = payload.attachmentUrl;
  if (!url) throw new Error("attachmentUrl is required.");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Attachment fetch failed: ${res.status}`);
  }
  const bytes = await res.arrayBuffer();
  assertSize(bytes.byteLength);
  return {
    bytes,
    mimeType:
      payload.mimeType ??
      res.headers.get("content-type")?.split(";")[0] ??
      "application/octet-stream",
  };
}

function assertSize(bytes: number): void {
  if (bytes <= 0) {
    throw new Error("Attachment is empty.");
  }
  if (bytes > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds Creator Maya media size limit.");
  }
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const clean = value.includes(",") ? value.split(",").pop() ?? "" : value;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
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
