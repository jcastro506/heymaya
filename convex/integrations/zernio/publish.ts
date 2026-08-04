/**
 * Zernio `POST /v1/posts` — the write path (§18 Sprint 3).
 *
 * Vendor only. Whether a post *should* go out is decided by
 * `convex/maya/publishDecision.ts`; this knows how to send one and how to tell
 * whether it actually landed.
 *
 * ## Why the parsing here is strict, and stays strict
 *
 * The most expensive failure in this product's history: **Zernio publish calls
 * returned 200 for six days while nothing was published.** A lenient
 * `.passthrough()` schema parsed a changed response shape "successfully" into
 * nothing, so every dashboard was green and every post was missing.
 *
 * So a 200 is not the success signal. The success signal is a **platform entry
 * that says published, and a URL**. If the response doesn't contain a platform
 * result we recognise, that's an error the same day — not a silent empty.
 *
 * ## Idempotency, which v1 left on the table
 *
 * Zernio ships two layers and v1 uses neither (`x-request-id` appears nowhere
 * in `convex/gtmMaya/` or the client):
 *
 *   - `x-request-id` — a 5-minute retry window; the same id returns the SAME
 *     result rather than posting twice. This is what makes a job-queue retry
 *     safe, and a job queue that retries publishes without it is a
 *     double-post generator.
 *   - content-hash dedup — 24 hours, returns **409**. A 409 therefore means
 *     "this exact text already went out", which is a *success* for our purposes,
 *     not a failure to retry.
 */

import { z } from "zod";
import type { ZernioClient } from "./client";
import { ZernioApiError } from "./types";

/** Zernio's slug for X is `twitter`, NOT `x`. Confirmed live. */
export const ZERNIO_PLATFORM_SLUG: Record<string, string> = {
  x: "twitter",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube",
};

/**
 * What one platform came back as.
 *
 * `platformPostUrl` is nullable in the spec — present for `publishNow`, absent
 * for scheduled posts until publish time. Absent is a real state, so it is
 * modelled rather than defaulted.
 */
const PlatformResultSchema = z.object({
  platform: z.string(),
  status: z.string().optional(),
  platformPostUrl: z.string().url().nullish(),
  error: z.string().nullish(),
});

/**
 * The create response.
 *
 * Deliberately NOT `.passthrough()` at the level that matters: `post.platforms`
 * must exist and must be an array. Everything downstream — did it publish, what
 * is the URL — is read from there, so accepting a response without it would be
 * accepting exactly the shape that produced six silent days.
 */
const PostCreateResponseSchema = z.object({
  post: z.object({
    _id: z.string(),
    status: z.string().optional(),
    platforms: z.array(PlatformResultSchema),
  }),
});

export type PublishOutcome =
  | {
      ok: true;
      /** Zernio's post id. */
      postId: string;
      /** The live URL, when the platform gave one back. Never invented. */
      url: string | null;
      /** True when Zernio's content-hash dedup says this already went out. */
      deduped: boolean;
    }
  | { ok: false; reason: string; retryable: boolean };

export interface PublishTextInput {
  client: ZernioClient;
  /**
   * The per-platform connected account id — `platforms[].accountId` on the
   * wire, which is what Zernio scopes the OAuth grant under.
   *
   * NOT the umbrella profile id. `POST /v1/posts` wants the connection, not
   * the account that owns it, and carrying both here would invite passing the
   * wrong one.
   */
  accountId: string;
  /** Our channel key — `x`, not `twitter`. Mapped here. */
  channel: string;
  text: string;
  /**
   * ⭐ The idempotency key, sent as `x-request-id`.
   *
   * Every placement carries one (schema invariant 4). Sending it is what makes
   * the job queue's retry safe.
   */
  idempotencyKey: string;
}

/**
 * Publish one text post, now.
 *
 * Never throws — the caller is a job handler, where an uncaught throw becomes a
 * retry of work that may already have posted.
 */
export async function publishText(
  input: PublishTextInput
): Promise<PublishOutcome> {
  const platform = ZERNIO_PLATFORM_SLUG[input.channel];
  if (!platform) {
    return {
      ok: false,
      reason: `no Zernio slug for channel "${input.channel}"`,
      retryable: false,
    };
  }
  if (input.text.trim().length === 0) {
    return { ok: false, reason: "refusing to publish empty text", retryable: false };
  }

  let raw: unknown;
  try {
    raw = await input.client.request<unknown>("/api/v1/posts", {
      method: "POST",
      extraHeaders: { "x-request-id": input.idempotencyKey },
      body: {
        content: input.text,
        publishNow: true,
        platforms: [
          {
            platform,
            accountId: input.accountId,
          },
        ],
      },
    });
  } catch (error: unknown) {
    if (error instanceof ZernioApiError) {
      /**
       * 409 is Zernio's content-hash dedup: this exact text already went out
       * within 24h. That is the outcome we wanted, reached by another path —
       * retrying would never succeed, and reporting failure would make a
       * delivered post look lost.
       */
      if (error.status === 409) {
        return { ok: true, postId: "", url: null, deduped: true };
      }
      return {
        ok: false,
        reason: `zernio ${error.status}: ${error.body}`.slice(0, 300),
        // 4xx is our bug or the platform's refusal; retrying repeats it.
        retryable: error.status >= 500,
      };
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }

  const parsed = PostCreateResponseSchema.safeParse(raw);
  if (!parsed.success) {
    /**
     * The six-day failure, caught. A response we cannot read is NOT a success
     * with missing fields — it means the contract moved, and every publish
     * after this point is unverifiable until someone looks.
     */
    return {
      ok: false,
      reason: `zernio returned an unrecognised response shape: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
      retryable: false,
    };
  }

  const entry = parsed.data.post.platforms.find((p) => p.platform === platform);
  if (!entry) {
    return {
      ok: false,
      reason: `zernio accepted the post but reported no ${platform} result`,
      retryable: false,
    };
  }
  if (entry.error || entry.status === "failed") {
    return {
      ok: false,
      reason: entry.error ?? `${platform} rejected the post`,
      retryable: false,
    };
  }

  return {
    ok: true,
    postId: parsed.data.post._id,
    // Null when the platform hasn't given one back yet. Recorded as unknown
    // rather than guessed — invariant 1.
    url: entry.platformPostUrl ?? null,
    deduped: false,
  };
}
