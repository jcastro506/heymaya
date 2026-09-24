"use node";
/**
 * Big phone videos, off the small-memory runtime. A draft texted to Maya is often 30–150 MB (iMessage
 * sends full quality); the default runtime can't hold that in memory, so the download to storage and
 * the upload to the video watcher happen here, in Node, and the rest of the flow passes a reference.
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { uploadFile } from "../integrations/gemini/client";

export const BIG_MEDIA_MAX_BYTES = 150 * 1024 * 1024;

/** Fetch a vendor attachment URL into Convex storage, with a size cap. */
export const fetchToStorage = internalAction({
  args: { url: v.string(), mimeType: v.string() },
  handler: async (ctx, a): Promise<{ ok: true; storageId: string; mime: string; bytes: number } | { ok: false; reason: string }> => {
    try {
      const res = await fetch(a.url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > BIG_MEDIA_MAX_BYTES) return { ok: false, reason: "too big" };
      // One copy in memory (a Blob), not an ArrayBuffer plus a Blob made from it.
      const blob = await res.blob();
      if (blob.size > BIG_MEDIA_MAX_BYTES) return { ok: false, reason: "too big" };
      const mime = res.headers.get("content-type")?.split(";")[0] || a.mimeType;
      const storageId = await ctx.storage.store(blob.type === mime ? blob : new Blob([blob], { type: mime }));
      return { ok: true, storageId, mime, bytes: blob.size };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "fetch failed" };
    }
  },
});

/** Upload a stored file to the video watcher; returns the file reference to watch by. */
export const uploadStoredForWatch = internalAction({
  args: { storageId: v.id("_storage"), mimeType: v.string() },
  handler: async (ctx, a): Promise<{ ok: true; uri: string } | { ok: false; reason: string }> => {
    const blob = await ctx.storage.get(a.storageId);
    if (!blob) return { ok: false, reason: "the file is gone" };
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
    // The Blob goes straight into the request: copying 150 MB to an ArrayBuffer ran Node out of memory.
    return await uploadFile({ apiKey, bytes: blob, mimeType: a.mimeType });
  },
});

/** Eval/ops probe: force the big-file path on a stored video and watch it by reference. */
export const probeWatchByReference = internalAction({
  args: { storageId: v.id("_storage"), mimeType: v.string() },
  handler: async (ctx, a): Promise<{ upload: string; watch: string }> => {
    const up = await uploadFileFromStorage(ctx, a.storageId, a.mimeType);
    if (!up.ok) return { upload: `failed: ${up.reason}`, watch: "skipped" };
    const { watchMedia } = await import("../integrations/gemini/client");
    const r = await watchMedia({ model: process.env.MODEL_WATCH ?? "gemini-3.1-flash-lite", apiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "", prompt: 'Return JSON {"about": "≤80 chars: what happens in this video"}', media: { fileUri: up.uri, mimeType: a.mimeType }, resolution: "low", maxOutputTokens: 200 });
    return { upload: "ok", watch: r.ok ? r.text.slice(0, 200) : `failed: ${r.reason}` };
  },
});

async function uploadFileFromStorage(ctx: { storage: { get: (id: never) => Promise<Blob | null> } }, storageId: unknown, mimeType: string) {
  const blob = await ctx.storage.get(storageId as never);
  if (!blob) return { ok: false as const, reason: "the file is gone" };
  return await uploadFile({ apiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "", bytes: blob, mimeType });
}

