/**
 * X (Twitter) action wrappers (Composio v3) — for Riley, the growth agent.
 *
 * Per the 2026-04-28 Composio Twitter capability research
 * (`docs/RILEY_GROWTH_PLAN.md` § "X / Twitter surface"), Composio's Twitter
 * toolkit covers ~60 actions via X's official API. The post-Feb 2026
 * pay-per-use pricing (writes ~$0.010/req, owned-reads $0.001/req as of
 * April 20 2026) makes this viable for indie use — Riley's expected
 * 5 posts/day + engagement reads + occasional reply lands at ~$2-5/mo.
 *
 * Skipped intentionally:
 *   - DMs                   — gated, abuse-flagged, not in v0 scope
 *   - Full-archive search   — Enterprise-only historically, burns PPU credits
 *   - Spaces / Bookmarks    — irrelevant to a founder hype-building loop
 *   - Connection / follow   — defer, account-flag risk for batch automation
 *
 * Auth: OAuth2 via Composio's managed OAuth app (operator connects through
 * Composio dashboard — NO custom X developer app needed for auth itself,
 * but operator's X dev account is what pays the per-call PPU bill).
 *
 * Each wrapper validates its response with Zod. Schemas are intentionally
 * narrow — only the fields Riley consumes. `passthrough()` keeps unknown
 * upstream fields intact; if a known field is RENAMED upstream, the
 * parser fails loud rather than silently swallowing.
 */

import { z } from "zod";
import { runAction } from "../universalRunner";
import type { ComposioClient } from "../client";

/* -------------------------------------------------------------------------- */
/* Shared invocation context                                                   */
/* -------------------------------------------------------------------------- */

export interface TwitterActionContext {
  /** Composio's connected-account id for Josh's X account. */
  connectedAccountId: string;
  /** Test seam — inject a stub client to bypass HTTP. */
  client?: ComposioClient;
}

/* -------------------------------------------------------------------------- */
/* createPost — tweet (with optional media + reply target)                     */
/* -------------------------------------------------------------------------- */

export const CreatePostParamsSchema = z.object({
  /** Tweet body. 280 chars unless verified, then up to 4000. */
  text: z.string().min(1).max(4000),
  /** Optional media id(s) from Composio's media-upload flow. Max 4. */
  mediaIds: z.array(z.string()).max(4).optional(),
  /** Reply to an existing tweet by id (turns this into a reply). */
  inReplyToTweetId: z.string().optional(),
  /** Quote-tweet a target tweet by id (turns this into a quote-tweet). */
  quoteTweetId: z.string().optional(),
});
export type CreatePostParams = z.infer<typeof CreatePostParamsSchema>;

export const CreatePostResponseSchema = z
  .object({
    id: z.string(),
    text: z.string().optional(),
  })
  .passthrough();
export type CreatePostResponse = z.infer<typeof CreatePostResponseSchema>;

export async function createPost(
  ctx: TwitterActionContext,
  params: CreatePostParams
): Promise<CreatePostResponse> {
  const validated = CreatePostParamsSchema.parse(params);
  const result = await runAction({
    provider: "twitter",
    action: "TWITTER_CREATE_A_POST",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: CreatePostResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* searchRecent — last-7d search for tweets matching a query                   */
/* -------------------------------------------------------------------------- */

export const SearchRecentParamsSchema = z.object({
  /** Twitter search query syntax — keywords, operators, filters. */
  query: z.string().min(1).max(1024),
  /** Max results, 10-100. */
  maxResults: z.number().int().min(10).max(100).default(25),
  /** ISO-8601 start time (within last 7d). */
  startTime: z.string().optional(),
  /** ISO-8601 end time. */
  endTime: z.string().optional(),
  /** Pagination token. */
  nextToken: z.string().optional(),
});
export type SearchRecentParams = z.infer<typeof SearchRecentParamsSchema>;

export const SearchRecentResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string(),
            text: z.string(),
            authorId: z.string().optional(),
            createdAt: z.string().optional(),
            publicMetrics: z
              .object({
                likeCount: z.number().int().nonnegative().optional(),
                retweetCount: z.number().int().nonnegative().optional(),
                replyCount: z.number().int().nonnegative().optional(),
                impressionCount: z.number().int().nonnegative().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
      )
      .default([]),
    meta: z
      .object({
        resultCount: z.number().int().nonnegative().optional(),
        nextToken: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type SearchRecentResponse = z.infer<typeof SearchRecentResponseSchema>;

export async function searchRecent(
  ctx: TwitterActionContext,
  params: SearchRecentParams
): Promise<SearchRecentResponse> {
  const validated = SearchRecentParamsSchema.parse(params);
  const result = await runAction({
    provider: "twitter",
    action: "TWITTER_SEARCH_RECENT_TWEETS",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: SearchRecentResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* lookupTweet — fetch a tweet's metrics by id                                 */
/* -------------------------------------------------------------------------- */

export const LookupTweetParamsSchema = z.object({
  tweetId: z.string().min(1),
});
export type LookupTweetParams = z.infer<typeof LookupTweetParamsSchema>;

export const LookupTweetResponseSchema = z
  .object({
    id: z.string(),
    text: z.string().optional(),
    authorId: z.string().optional(),
    createdAt: z.string().optional(),
    publicMetrics: z
      .object({
        likeCount: z.number().int().nonnegative().optional(),
        retweetCount: z.number().int().nonnegative().optional(),
        replyCount: z.number().int().nonnegative().optional(),
        impressionCount: z.number().int().nonnegative().optional(),
        bookmarkCount: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type LookupTweetResponse = z.infer<typeof LookupTweetResponseSchema>;

export async function lookupTweet(
  ctx: TwitterActionContext,
  params: LookupTweetParams
): Promise<LookupTweetResponse> {
  const validated = LookupTweetParamsSchema.parse(params);
  const result = await runAction({
    provider: "twitter",
    action: "TWITTER_LOOK_UP_POST_BY_ID",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: LookupTweetResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* listLikers — who liked a tweet                                              */
/* -------------------------------------------------------------------------- */

export const ListLikersParamsSchema = z.object({
  tweetId: z.string().min(1),
  maxResults: z.number().int().min(10).max(100).default(50),
  paginationToken: z.string().optional(),
});
export type ListLikersParams = z.infer<typeof ListLikersParamsSchema>;

export const ListLikersResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string(),
            username: z.string().optional(),
            name: z.string().optional(),
          })
          .passthrough()
      )
      .default([]),
    meta: z
      .object({
        resultCount: z.number().int().nonnegative().optional(),
        nextToken: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ListLikersResponse = z.infer<typeof ListLikersResponseSchema>;

export async function listLikers(
  ctx: TwitterActionContext,
  params: ListLikersParams
): Promise<ListLikersResponse> {
  const validated = ListLikersParamsSchema.parse(params);
  const result = await runAction({
    provider: "twitter",
    action: "TWITTER_LIST_POST_LIKERS",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: ListLikersResponseSchema,
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
    username: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    profileImageUrl: z.string().url().optional(),
    publicMetrics: z
      .object({
        followersCount: z.number().int().nonnegative().optional(),
        followingCount: z.number().int().nonnegative().optional(),
        tweetCount: z.number().int().nonnegative().optional(),
        listedCount: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type GetMyInfoResponse = z.infer<typeof GetMyInfoResponseSchema>;

export async function getMyInfo(
  ctx: TwitterActionContext
): Promise<GetMyInfoResponse> {
  const result = await runAction({
    provider: "twitter",
    action: "TWITTER_GET_AUTHENTICATED_USER",
    params: {},
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: GetMyInfoResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* lookupUser — fetch a user's profile by username                             */
/* -------------------------------------------------------------------------- */

export const LookupUserParamsSchema = z.object({
  username: z.string().min(1).max(15),
});
export type LookupUserParams = z.infer<typeof LookupUserParamsSchema>;

export const LookupUserResponseSchema = GetMyInfoResponseSchema;
export type LookupUserResponse = z.infer<typeof LookupUserResponseSchema>;

export async function lookupUser(
  ctx: TwitterActionContext,
  params: LookupUserParams
): Promise<LookupUserResponse> {
  const validated = LookupUserParamsSchema.parse(params);
  const result = await runAction({
    provider: "twitter",
    action: "TWITTER_LOOK_UP_USER_BY_USERNAME",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: LookupUserResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* like + retweet — operator-approved engagement writes                        */
/* -------------------------------------------------------------------------- */

export const LikeTweetParamsSchema = z.object({
  tweetId: z.string().min(1),
});
export type LikeTweetParams = z.infer<typeof LikeTweetParamsSchema>;

export const LikeTweetResponseSchema = z
  .object({ liked: z.boolean().optional() })
  .passthrough();
export type LikeTweetResponse = z.infer<typeof LikeTweetResponseSchema>;

export async function likeTweet(
  ctx: TwitterActionContext,
  params: LikeTweetParams
): Promise<LikeTweetResponse> {
  const validated = LikeTweetParamsSchema.parse(params);
  const result = await runAction({
    provider: "twitter",
    action: "TWITTER_LIKE_A_TWEET",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: LikeTweetResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

export const RetweetParamsSchema = z.object({
  tweetId: z.string().min(1),
});
export type RetweetParams = z.infer<typeof RetweetParamsSchema>;

export const RetweetResponseSchema = z
  .object({ retweeted: z.boolean().optional() })
  .passthrough();
export type RetweetResponse = z.infer<typeof RetweetResponseSchema>;

export async function retweet(
  ctx: TwitterActionContext,
  params: RetweetParams
): Promise<RetweetResponse> {
  const validated = RetweetParamsSchema.parse(params);
  const result = await runAction({
    provider: "twitter",
    action: "TWITTER_RETWEET_POST",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: RetweetResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* getReverseChronoTimeline — operator's home feed                             */
/* -------------------------------------------------------------------------- */

export const GetReverseChronoTimelineParamsSchema = z.object({
  maxResults: z.number().int().min(5).max(100).default(25),
  paginationToken: z.string().optional(),
});
export type GetReverseChronoTimelineParams = z.infer<
  typeof GetReverseChronoTimelineParamsSchema
>;

export const GetReverseChronoTimelineResponseSchema = SearchRecentResponseSchema;
export type GetReverseChronoTimelineResponse = z.infer<
  typeof GetReverseChronoTimelineResponseSchema
>;

export async function getReverseChronoTimeline(
  ctx: TwitterActionContext,
  params: GetReverseChronoTimelineParams = { maxResults: 25 }
): Promise<GetReverseChronoTimelineResponse> {
  const validated = GetReverseChronoTimelineParamsSchema.parse(params);
  const result = await runAction({
    provider: "twitter",
    action: "TWITTER_GET_USER'S_REVERSE_CHRONOLOGICAL_TIMELINE",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: GetReverseChronoTimelineResponseSchema,
    client: ctx.client,
  });
  return result.data;
}
