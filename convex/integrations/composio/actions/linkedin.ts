/**
 * LinkedIn action wrappers (Composio v3) — for Riley, the growth agent.
 *
 * Per the 2026-04-28 Composio LinkedIn capability research
 * (`docs/RILEY_GROWTH_PLAN.md` § "Why hybrid"), Composio's LinkedIn surface
 * uses LinkedIn's official OAuth API and is best for:
 *   - createPost           — publish to Josh's personal feed
 *   - createComment        — operator-approved comment on someone else's post
 *   - getMyInfo            — Josh's profile metadata
 *   - getShareStats        — impressions/clicks/likes/comments counts
 *   - listReactions        — who liked a post
 *   - initImageUpload      — image-attachment flow (3-step: init → register → reference)
 *
 * What's NOT here (Composio doesn't cover; goes through Unipile instead):
 *   - DM send / inbox read
 *   - profile search / outreach list build
 *   - read commenter text on Josh's posts
 *   - profile-feed watch (target persona post-watch)
 *   - connection-request send
 *
 * Each wrapper validates its response with Zod. Schemas are intentionally
 * narrow — only the fields Riley consumes. If Composio adds upstream fields
 * the `passthrough()` extension keeps the call working; if it RENAMES one,
 * the parser fails loud and the post-publish path surfaces an error rather
 * than silently failing.
 *
 * Auth: OAuth2 via LinkedIn's "Sign In with LinkedIn" + Marketing API.
 * Default scopes: `openid profile email w_member_social`. Production
 * deploys should use Josh's own LinkedIn Developer app (env vars
 * `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET`) to escape Composio's
 * shared-OAuth rate limits.
 */

import { z } from "zod";
import { runAction } from "../universalRunner";
import type { ComposioClient } from "../client";

/* -------------------------------------------------------------------------- */
/* Shared invocation context                                                   */
/* -------------------------------------------------------------------------- */

export interface LinkedInActionContext {
  /** Composio's connected-account id for Josh's LinkedIn account. */
  connectedAccountId: string;
  /** Test seam — inject a stub client to bypass HTTP. */
  client?: ComposioClient;
}

/* -------------------------------------------------------------------------- */
/* createPost — publish to the connected user's feed                           */
/* -------------------------------------------------------------------------- */

export const CreatePostParamsSchema = z.object({
  /** The post body. Plain text or LinkedIn-formatted. Max ~3000 chars. */
  text: z.string().min(1).max(3000),
  /**
   * Visibility. Personal-feed posting works with `PUBLIC` (default) or
   * `CONNECTIONS`. Public is the right default for hype-building.
   */
  visibility: z
    .union([z.literal("PUBLIC"), z.literal("CONNECTIONS")])
    .default("PUBLIC"),
  /**
   * Optional image asset URN(s) from `initImageUpload` → `registerImageUpload`.
   * Each must be in the form `urn:li:image:{id}`.
   */
  imageUrns: z.array(z.string().startsWith("urn:li:image:")).optional(),
});
export type CreatePostParams = z.infer<typeof CreatePostParamsSchema>;

export const CreatePostResponseSchema = z
  .object({
    /** Post URN — `urn:li:share:{id}` or `urn:li:ugcPost:{id}`. */
    id: z.string(),
  })
  .passthrough();
export type CreatePostResponse = z.infer<typeof CreatePostResponseSchema>;

export async function createPost(
  ctx: LinkedInActionContext,
  params: CreatePostParams
): Promise<CreatePostResponse> {
  const validated = CreatePostParamsSchema.parse(params);
  const result = await runAction({
    provider: "linkedin",
    action: "LINKEDIN_CREATE_LINKED_IN_POST",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: CreatePostResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* createComment — comment on someone else's post                              */
/* -------------------------------------------------------------------------- */

export const CreateCommentParamsSchema = z.object({
  /** The post URN (`urn:li:share:...` or `urn:li:ugcPost:...`). */
  postUrn: z.string().startsWith("urn:li:"),
  text: z.string().min(1).max(1250),
});
export type CreateCommentParams = z.infer<typeof CreateCommentParamsSchema>;

export const CreateCommentResponseSchema = z
  .object({ id: z.string() })
  .passthrough();
export type CreateCommentResponse = z.infer<
  typeof CreateCommentResponseSchema
>;

export async function createComment(
  ctx: LinkedInActionContext,
  params: CreateCommentParams
): Promise<CreateCommentResponse> {
  const validated = CreateCommentParamsSchema.parse(params);
  const result = await runAction({
    provider: "linkedin",
    action: "LINKEDIN_CREATE_COMMENT_ON_POST",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: CreateCommentResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* getMyInfo — connected user's profile                                        */
/* -------------------------------------------------------------------------- */

export const GetMyInfoResponseSchema = z
  .object({
    id: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    profilePicture: z.string().url().optional(),
    headline: z.string().optional(),
    vanityName: z.string().optional(),
  })
  .passthrough();
export type GetMyInfoResponse = z.infer<typeof GetMyInfoResponseSchema>;

export async function getMyInfo(
  ctx: LinkedInActionContext
): Promise<GetMyInfoResponse> {
  const result = await runAction({
    provider: "linkedin",
    action: "LINKEDIN_GET_MY_INFO",
    params: {},
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: GetMyInfoResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* getShareStats — impressions/clicks/likes/comments counts                    */
/* -------------------------------------------------------------------------- */

export const GetShareStatsParamsSchema = z.object({
  postUrn: z.string().startsWith("urn:li:"),
});
export type GetShareStatsParams = z.infer<typeof GetShareStatsParamsSchema>;

export const GetShareStatsResponseSchema = z
  .object({
    impressionCount: z.number().int().nonnegative().optional(),
    uniqueImpressionsCount: z.number().int().nonnegative().optional(),
    clickCount: z.number().int().nonnegative().optional(),
    likeCount: z.number().int().nonnegative().optional(),
    commentCount: z.number().int().nonnegative().optional(),
    shareCount: z.number().int().nonnegative().optional(),
    engagement: z.number().nonnegative().optional(),
  })
  .passthrough();
export type GetShareStatsResponse = z.infer<
  typeof GetShareStatsResponseSchema
>;

export async function getShareStats(
  ctx: LinkedInActionContext,
  params: GetShareStatsParams
): Promise<GetShareStatsResponse> {
  const validated = GetShareStatsParamsSchema.parse(params);
  const result = await runAction({
    provider: "linkedin",
    action: "LINKEDIN_GET_SHARE_STATS",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: GetShareStatsResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* listReactions — who liked / reacted to a post                               */
/* -------------------------------------------------------------------------- */

export const ListReactionsParamsSchema = z.object({
  postUrn: z.string().startsWith("urn:li:"),
  count: z.number().int().positive().max(100).default(50),
  start: z.number().int().nonnegative().default(0),
});
export type ListReactionsParams = z.infer<typeof ListReactionsParamsSchema>;

export const ListReactionsResponseSchema = z
  .object({
    elements: z
      .array(
        z
          .object({
            actor: z.string().optional(),
            reactionType: z.string().optional(),
            createdAt: z.number().optional(),
          })
          .passthrough()
      )
      .default([]),
    paging: z
      .object({
        count: z.number().optional(),
        start: z.number().optional(),
        total: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ListReactionsResponse = z.infer<
  typeof ListReactionsResponseSchema
>;

export async function listReactions(
  ctx: LinkedInActionContext,
  params: ListReactionsParams
): Promise<ListReactionsResponse> {
  const validated = ListReactionsParamsSchema.parse(params);
  const result = await runAction({
    provider: "linkedin",
    action: "LINKEDIN_LIST_REACTIONS",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: ListReactionsResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* initImageUpload — start the 3-step image-attach flow                        */
/* -------------------------------------------------------------------------- */

/**
 * LinkedIn's image flow has three steps:
 *   1. `initImageUpload` — request a signed upload URL + asset URN
 *   2. (out-of-band PUT to the signed URL with the image bytes)
 *   3. `createPost` with the asset URN in `imageUrns`
 *
 * Step 2 is a plain HTTPS PUT; we do that directly from the agent rather
 * than through Composio. The `uploadUrl` returned here is the target.
 */
export const InitImageUploadParamsSchema = z.object({
  /** Optional MIME hint — `image/jpeg`, `image/png`. Default `image/jpeg`. */
  mimeType: z
    .union([z.literal("image/jpeg"), z.literal("image/png")])
    .default("image/jpeg"),
});
export type InitImageUploadParams = z.infer<
  typeof InitImageUploadParamsSchema
>;

export const InitImageUploadResponseSchema = z
  .object({
    uploadUrl: z.string().url(),
    /** Image asset URN — pass to createPost as one of `imageUrns`. */
    imageUrn: z.string().startsWith("urn:li:image:"),
  })
  .passthrough();
export type InitImageUploadResponse = z.infer<
  typeof InitImageUploadResponseSchema
>;

export async function initImageUpload(
  ctx: LinkedInActionContext,
  params: InitImageUploadParams = { mimeType: "image/jpeg" }
): Promise<InitImageUploadResponse> {
  const validated = InitImageUploadParamsSchema.parse(params);
  const result = await runAction({
    provider: "linkedin",
    action: "LINKEDIN_INITIALIZE_IMAGE_UPLOAD",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: InitImageUploadResponseSchema,
    client: ctx.client,
  });
  return result.data;
}
