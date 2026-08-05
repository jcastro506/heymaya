/**
 * The inbound file path — she asks for a screen recording, and the founder can
 * actually send it.
 *
 * ## The bug this closes
 *
 * Sprint 4.75 gave her the ask (`request_assets`) and the library
 * (`mediaAssets`), and live she asked for exactly the right thing:
 *
 * > *"I need a single 30–60 second screen recording of you using Widgetly so
 * > the video shows the real product, not a made-up interface."*
 *
 * The founder sends it. **Nothing happens.** The switchboard forked on
 * `update.message.text`, and on a media message `text` is always undefined —
 * the words are in `caption`. So the update fell off the end of the handler and
 * they got silence, from an employee who had just asked them for the file.
 *
 * Silence after a request is worse than never asking.
 *
 * ## Deterministic, and off the machine
 *
 * Ingest is code, not judgment (§2.3), and it deliberately does **not** wake
 * the Fly machine. A founder dropping four screenshots shouldn't spend a
 * 10–30s boot and a turn's tokens to be told "got them" — the files are rows,
 * and rows are the truth. She sees the library next time she's awake.
 *
 * The one exception is a **caption**: someone who types words with their upload
 * is saying something, and that deserves an answer rather than a receipt.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { deliverNow } from "./scheduler";
import type { Doc } from "../_generated/dataModel";
import type { TelegramInboundMessage } from "../integrations/telegram/client";

/**
 * How long to wait before acknowledging an album.
 *
 * Telegram delivers an album as N separate updates within about a second, so
 * acking the first arrival can only say "got it". Waiting lets the ack say
 * *"got all four screenshots"* — which is the difference between a receipt and
 * a colleague. Nothing depends on the delay being exact; a straggler just lands
 * in the library uncounted.
 */
export const ALBUM_SETTLE_MS = 4_000;

export interface ExtractedFile {
  fileId: string;
  /** Stable per file — survives a re-send, so it dedupes Telegram retries. */
  fileUniqueId: string;
  sizeBytes?: number;
  /**
   * What this IS, decided at extraction rather than from the mime type,
   * because two of these cases are indistinguishable by mime.
   */
  kindHint: Doc<"mediaAssets">["kind"] | undefined;
  label: string;
}

/**
 * ⭐ Pull the file out of an inbound message — and file it as the right thing.
 *
 * Order is load-bearing twice over:
 *
 * **`animation` before `document`.** A GIF arrives with BOTH fields set.
 * Matching `document` first files every GIF as a generic document and loses the
 * fact that it's motion we can pull frames from.
 *
 * **`video_note` is not a screen recording.** It's the round selfie bubble.
 * `kindFor` maps every video mime to `screen_recording`, which would make a
 * three-second wave at the camera satisfy `libraryHealth.hasRecording` — and
 * that flag suppresses the ask *permanently*. The founder would never be asked
 * again, on the strength of a selfie. It's filed as `video`.
 */
export function extractFile(message: TelegramInboundMessage): ExtractedFile | null {
  // A GIF: matched before `document` because it sets both.
  if (message.animation) {
    return {
      fileId: message.animation.file_id,
      fileUniqueId: message.animation.file_unique_id,
      sizeBytes: message.animation.file_size,
      kindHint: "screen_recording",
      label: "clip",
    };
  }

  if (message.video) {
    return {
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      sizeBytes: message.video.file_size,
      kindHint: "screen_recording",
      label: "recording",
    };
  }

  // ⚠️ Deliberately NOT a screen recording — see the doc comment.
  if (message.video_note) {
    return {
      fileId: message.video_note.file_id,
      fileUniqueId: message.video_note.file_unique_id,
      sizeBytes: message.video_note.file_size,
      kindHint: "video",
      label: "video note",
    };
  }

  if (message.document) {
    // A screenshot sent "as a file" keeps its pixels, which is the better way
    // to send one — so this path matters more than it looks.
    return {
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      sizeBytes: message.document.file_size,
      kindHint: undefined, // let the mime decide
      label: "file",
    };
  }

  if (message.photo?.length) {
    // Ascending by size: the last one is the largest Telegram kept.
    const largest = message.photo[message.photo.length - 1];
    return {
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
      sizeBytes: largest.file_size,
      kindHint: undefined,
      label: "image",
    };
  }

  return null;
}

/** Telegram's cap on what a bot may download. Checked before the fetch. */
export const TELEGRAM_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Plain-language refusal for a file we can't take.
 *
 * A 60-second screen recording — *the exact thing she asks for* — routinely
 * exceeds 20MB, so this is a common path, not an edge case. It has to say what
 * to do next, and it must never read like a bug in her.
 */
export function oversizeMessage(sizeBytes: number): string {
  const mb = Math.round(sizeBytes / (1024 * 1024));
  return `That one's ${mb}MB and Telegram won't let me download anything over 20MB. A shorter clip — 30 seconds or so — comes in under it, and honestly works better anyway.`;
}

/* -------------------------------------------------------------------------- */

/**
 * Take one inbound file. Scheduled from the webhook, one per update, so an
 * album fans out into N of these running concurrently.
 */
export const ingestInboundFile = internalAction({
  args: {
    customerId: v.id("customers"),
    chatId: v.string(),
    fileId: v.string(),
    fileUniqueId: v.string(),
    kindHint: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    caption: v.optional(v.string()),
    ackKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    /**
     * Size is refused BEFORE the download. Telegram hands us `file_size` on the
     * message itself, so a 40MB recording costs one comparison instead of a
     * 40MB transfer that then fails.
     */
    if (args.sizeBytes && args.sizeBytes > TELEGRAM_MAX_BYTES) {
      await ctx.runMutation(internal.maya.messages.send, {
        customerId: args.customerId,
        surface: "telegram",
        body: oversizeMessage(args.sizeBytes),
        // Keyed to the FILE, not the moment: re-sending the same too-big file
        // is the same conversation, and saying it twice is nagging.
        dedupeKey: `oversize:${args.fileUniqueId}`,
        proactive: true,
      });
      await deliverNow(ctx);
      return { ok: false, reason: "over Telegram's 20MB download cap" };
    }

    const result = await ctx.runAction(internal.maya.media.ingestFromTelegram, {
      customerId: args.customerId,
      fileId: args.fileId,
      caption: args.caption,
      kindHint: args.kindHint,
    });

    if (!result.ok) {
      /**
       * ⭐ A failure the founder caused something to happen for MUST reach
       * them (§2.5). They sent a file because she asked; a silent drop looks
       * exactly like the bug this module exists to fix.
       */
      await ctx.runMutation(internal.maya.messages.send, {
        customerId: args.customerId,
        surface: "telegram",
        body: `That file didn't come through — ${result.error}. Worth another try?`,
        dedupeKey: `ingest-failed:${args.fileUniqueId}`,
        proactive: true,
      });
      await deliverNow(ctx);
      return { ok: false, reason: result.error };
    }

    return { ok: true };
  },
});

/**
 * ⭐ Say what landed — once per album, and specifically.
 *
 * Scheduled once per act (the dedupe key is the album id, or the file's unique
 * id when it's a single file), `ALBUM_SETTLE_MS` after the first arrival so it
 * can count what actually made it in.
 *
 * No model call. This is a receipt, and paying for tokens to say "got it" is
 * the kind of cost that looks small until it runs on every upload forever.
 */
export const acknowledgeUpload = internalAction({
  args: {
    customerId: v.id("customers"),
    ackKey: v.string(),
    since: v.number(),
  },
  handler: async (ctx, args): Promise<{ acked: boolean }> => {
    const health = await ctx.runQuery(internal.maya.media.libraryHealth, {
      customerId: args.customerId,
    });
    const assets = await ctx.runQuery(internal.maya.media.forCustomer, {
      customerId: args.customerId,
    });
    const landed = assets.filter((a) => a.createdAt >= args.since);

    // Everything failed — each failure already spoke for itself, and a second
    // message saying nothing arrived would just be noise on top of it.
    if (landed.length === 0) return { acked: false };

    const recordings = landed.filter((a) => a.kind === "screen_recording").length;
    const images = landed.length - recordings;

    /**
     * Grounded, per §2.7: it names what it actually has and what that unlocks,
     * and it never promises a post. Whether one gets made depends on the idea
     * bank and the budget, neither of which this path can see.
     */
    let body: string;
    if (recordings > 0) {
      body =
        recordings === 1
          ? "Got the recording — that's what I needed. I can pull frames and b-roll out of it, so the videos will show the real thing."
          : `Got ${recordings} recordings — plenty to pull frames and b-roll from.`;
    } else if (images === 1) {
      body = "Got it, saved to your library.";
    } else {
      body = `Got all ${images} — saved to your library.`;
    }

    if (health.shouldAsk) {
      // Still nothing real to work from. Better to say so now than to let them
      // discover it in a post made of stock illustration.
      body += " Still short of a real look at the product, though — a quick screen recording would cover it.";
    }

    const { sent } = await ctx.runMutation(internal.maya.messages.send, {
      customerId: args.customerId,
      surface: "telegram",
      body,
      dedupeKey: `asset-ack:${args.ackKey}`,
      proactive: true,
    });
    // They just handed her a file. A receipt minutes later reads as broken.
    await deliverNow(ctx);
    return { acked: sent };
  },
});
