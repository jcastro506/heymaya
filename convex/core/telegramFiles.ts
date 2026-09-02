/**
 * Inbound files (plan §12.6, §15.3). A creator sends a draft video, a screenshot
 * of their analytics, or a competitor's profile. On a media message `text` is
 * ALWAYS undefined and the words are in `caption`, which is why the legacy
 * switchboard dropped uploads in silence. Files are stored, recorded as a message
 * row, and handed to the dispatcher; the model never sees a Telegram file id.
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { TelegramInboundMessage } from "../integrations/telegram/client";

/** Telegram delivers an album as N updates within about a second; wait so the reply can count them. */
export const ALBUM_SETTLE_MS = 4_000;

export type FileKindHint = "video" | "image" | "video_note" | "animation" | "document";

export interface ExtractedFile {
  fileId: string;
  /** Stable per file across re-sends: the idempotency key for a Telegram retry. */
  fileUniqueId: string;
  sizeBytes?: number;
  kindHint: FileKindHint;
  mime?: string;
}

/**
 * Pull the file out of an inbound message. Order matters: a GIF sets both
 * `animation` and `document`, so `animation` is matched first; `video_note` is
 * the round selfie bubble and is never a draft.
 */
export function extractFile(message: TelegramInboundMessage): ExtractedFile | null {
  if (message.animation) {
    return { fileId: message.animation.file_id, fileUniqueId: message.animation.file_unique_id, sizeBytes: message.animation.file_size, kindHint: "animation", mime: message.animation.mime_type };
  }
  if (message.video) {
    return { fileId: message.video.file_id, fileUniqueId: message.video.file_unique_id, sizeBytes: message.video.file_size, kindHint: "video", mime: message.video.mime_type };
  }
  if (message.video_note) {
    return { fileId: message.video_note.file_id, fileUniqueId: message.video_note.file_unique_id, sizeBytes: message.video_note.file_size, kindHint: "video_note" };
  }
  if (message.document) {
    return { fileId: message.document.file_id, fileUniqueId: message.document.file_unique_id, sizeBytes: message.document.file_size, kindHint: "document", mime: message.document.mime_type };
  }
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1]; // ascending by size
    return { fileId: largest.file_id, fileUniqueId: largest.file_unique_id, sizeBytes: largest.file_size, kindHint: "image", mime: "image/jpeg" };
  }
  return null;
}

/** Telegram's cap on what a bot may download. Checked before the fetch. */
export const TELEGRAM_MAX_BYTES = 20 * 1024 * 1024;

/** Plain-language refusal for a file we can't take. It must say what to do next and never read like a bug in her. */
export function oversizeMessage(sizeBytes: number): string {
  const mb = Math.round(sizeBytes / (1024 * 1024));
  return `that one's ${mb}MB and Telegram won't let me download anything over 20MB. send me the link once it's posted, or a shorter cut, and I'll take a look.`;
}

export const recordInboundFile = internalMutation({
  args: {
    creatorId: v.id("creators"),
    storageId: v.id("_storage"),
    mime: v.string(),
    fileUniqueId: v.string(),
    caption: v.optional(v.string()),
    updateId: v.optional(v.number()),
    telegramMessageId: v.optional(v.string()),
    ts: v.number(),
  },
  handler: async (ctx, a): Promise<Id<"messages">> => {
    return await ctx.db.insert("messages", {
      creatorId: a.creatorId,
      direction: "in",
      surface: "telegram",
      kind: "file",
      body: a.caption ?? "",
      fileId: a.storageId,
      fileMime: a.mime,
      fileUniqueId: a.fileUniqueId,
      telegramUpdateId: a.updateId,
      telegramMessageId: a.telegramMessageId,
      ts: a.ts,
    });
  },
});

/**
 * Take one inbound file: refuse oversize before the fetch, store the bytes,
 * record the row, hand the dispatcher a `converse` job with the file attached.
 */
export const ingestInboundFile = internalAction({
  args: {
    creatorId: v.id("creators"),
    chatId: v.string(),
    fileId: v.string(),
    fileUniqueId: v.string(),
    kindHint: v.string(),
    mime: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    caption: v.optional(v.string()),
    updateId: v.optional(v.number()),
    telegramMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    if (args.sizeBytes && args.sizeBytes > TELEGRAM_MAX_BYTES) {
      await ctx.runMutation(internal.core.messages.send, {
        creatorId: args.creatorId,
        surface: "telegram",
        body: oversizeMessage(args.sizeBytes),
        dedupeKey: `oversize:${args.fileUniqueId}`, // the same too-big file twice is one conversation
        proactive: true,
      });
      return { ok: false, reason: "over Telegram's 20MB download cap" };
    }

    const { resolveTelegramBotIdentity, fetchTelegramFile } = await import("../integrations/telegram/client");
    const identity = resolveTelegramBotIdentity();
    if (!identity) return { ok: false, reason: "the Telegram bot isn't configured" };

    const fetched = await fetchTelegramFile(identity, args.fileId);
    if (!fetched.ok) {
      await ctx.runMutation(internal.core.messages.send, {
        creatorId: args.creatorId,
        surface: "telegram",
        body: `that file didn't come through (${fetched.reason}). worth another try?`,
        dedupeKey: `ingest-failed:${args.fileUniqueId}`,
        proactive: true,
      });
      return { ok: false, reason: fetched.reason };
    }

    const mime = args.mime ?? fetched.contentType;
    const storageId = await ctx.storage.store(new Blob([fetched.bytes.buffer as ArrayBuffer], { type: mime }));
    const messageId = await ctx.runMutation(internal.core.telegramFiles.recordInboundFile, {
      creatorId: args.creatorId,
      storageId,
      mime,
      fileUniqueId: args.fileUniqueId,
      caption: args.caption,
      updateId: args.updateId,
      telegramMessageId: args.telegramMessageId,
      ts: Date.now(),
    });
    await ctx.runMutation(internal.core.jobs.enqueue, {
      kind: "converse",
      idempotencyKey: `converse:${messageId}`,
      creatorId: args.creatorId,
      payloadJson: JSON.stringify({ messageId, chatId: args.chatId, kind: "file", kindHint: args.kindHint, mime }),
    });
    return { ok: true };
  },
});
