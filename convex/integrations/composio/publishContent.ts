/**
 * Sprint 2.5 — Composio "Maya posts it" lane.
 *
 * After the operator approves a drafted reply/tweet/post via Telegram,
 * Maya can auto-publish to X / LinkedIn via Composio's unified action
 * surface. Reddit deliberately stays tap-and-post (Reddit's ToS treats
 * automated posting hostile + voice authenticity matters per PLAYBOOK
 * § 3.5 — Reddit comments must come from the operator's account in
 * their voice).
 *
 * Composio v3 action slugs (verified from Composio docs):
 *   TWITTER_CREATION_OF_A_POST   — X / Twitter tweet
 *   LINKEDIN_CREATE_LINKED_IN_POST — LinkedIn personal post
 *
 * Auth: `COMPOSIO_API_KEY` Convex env var (already in collectDeploySecrets
 * since Sprint 0). Per-user Composio account auth comes from each
 * creator's connected account id (separate Composio onboarding flow,
 * not in scope for this wrapper).
 *
 * Returns `{ providerPostId, providerUrl }` on success so the caller
 * can persist them in gtmDraftedContent.providerPostId + .publishedAt.
 * Soft-fails on network error / missing key / Composio API failure so
 * the approval workflow can decide retry vs surface-to-operator.
 */

const COMPOSIO_BASE = "https://backend.composio.dev/api/v2";
const REQUEST_TIMEOUT_MS = 30_000;

export type PublishPlatform = "x" | "linkedin";

export interface PublishContentInput {
  /** Composio's identifier for the user's connected account. */
  composioAccountId: string;
  /** The post body. For X, ≤280 chars. For LinkedIn, no hard cap. */
  text: string;
  /** Thread mode for X — array of segments to publish as a thread. */
  segments?: string[];
}

export interface PublishContentResult {
  ok: boolean;
  providerPostId?: string;
  providerUrl?: string;
  statusDetail: string;
}

interface ComposioExecuteResponse {
  successful?: boolean;
  data?: {
    id?: string;
    tweet_id?: string;
    response_data?: { id?: string };
    permalink?: string;
    url?: string;
  };
  error?: string;
}

function compactExcerpt(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

async function executeComposioAction(
  actionSlug: string,
  args: {
    apiKey: string;
    connectedAccountId: string;
    body: Record<string, unknown>;
  }
): Promise<ComposioExecuteResponse | { httpStatus: number; bodyText: string }> {
  const url = `${COMPOSIO_BASE}/actions/${actionSlug}/execute`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": args.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        connectedAccountId: args.connectedAccountId,
        input: args.body,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return { httpStatus: res.status, bodyText };
    }
    return (await res.json()) as ComposioExecuteResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Publish to X. Single tweet by default; if `segments` provided, posts
 * each segment as a separate tweet replying to the previous (thread).
 */
async function publishToX(input: PublishContentInput): Promise<PublishContentResult> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return { ok: false, statusDetail: "composio_key_missing" };

  const segments = input.segments && input.segments.length > 0
    ? input.segments
    : [input.text];

  let previousTweetId: string | undefined;
  let firstTweetId: string | undefined;
  let firstTweetUrl: string | undefined;

  for (const segment of segments) {
    const body: Record<string, unknown> = {
      tweet_body: segment,
    };
    if (previousTweetId) {
      body.in_reply_to_tweet_id = previousTweetId;
    }
    let response: ComposioExecuteResponse | { httpStatus: number; bodyText: string };
    try {
      response = await executeComposioAction("TWITTER_CREATION_OF_A_POST", {
        apiKey,
        connectedAccountId: input.composioAccountId,
        body,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { ok: false, statusDetail: "composio_timeout" };
      }
      return {
        ok: false,
        statusDetail: `composio_error:${(err as Error).message.slice(0, 200)}`,
      };
    }
    if ("httpStatus" in response) {
      return {
        ok: false,
        statusDetail: `composio_http_${response.httpStatus}:${response.bodyText.slice(0, 200)}`,
      };
    }
    if (!response.successful) {
      return {
        ok: false,
        statusDetail: `composio_unsuccessful:${(response.error ?? compactExcerpt(JSON.stringify(response.data ?? {}))).slice(0, 200)}`,
      };
    }
    const tweetId =
      response.data?.tweet_id ??
      response.data?.id ??
      response.data?.response_data?.id;
    if (!tweetId) {
      return {
        ok: false,
        statusDetail: `composio_no_tweet_id:${compactExcerpt(JSON.stringify(response.data ?? {}))}`,
      };
    }
    previousTweetId = tweetId;
    if (!firstTweetId) {
      firstTweetId = tweetId;
      firstTweetUrl = response.data?.permalink ?? response.data?.url ?? `https://x.com/i/web/status/${tweetId}`;
    }
  }

  return {
    ok: true,
    providerPostId: firstTweetId!,
    providerUrl: firstTweetUrl!,
    statusDetail: "ok",
  };
}

/**
 * Publish to LinkedIn — personal post on the connected account.
 */
async function publishToLinkedIn(
  input: PublishContentInput
): Promise<PublishContentResult> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return { ok: false, statusDetail: "composio_key_missing" };

  let response: ComposioExecuteResponse | { httpStatus: number; bodyText: string };
  try {
    response = await executeComposioAction(
      "LINKEDIN_CREATE_LINKED_IN_POST",
      {
        apiKey,
        connectedAccountId: input.composioAccountId,
        body: { commentary: input.text, visibility: "PUBLIC" },
      }
    );
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { ok: false, statusDetail: "composio_timeout" };
    }
    return {
      ok: false,
      statusDetail: `composio_error:${(err as Error).message.slice(0, 200)}`,
    };
  }
  if ("httpStatus" in response) {
    return {
      ok: false,
      statusDetail: `composio_http_${response.httpStatus}:${response.bodyText.slice(0, 200)}`,
    };
  }
  if (!response.successful) {
    return {
      ok: false,
      statusDetail: `composio_unsuccessful:${(response.error ?? compactExcerpt(JSON.stringify(response.data ?? {}))).slice(0, 200)}`,
    };
  }
  const postId = response.data?.id ?? response.data?.response_data?.id;
  if (!postId) {
    return {
      ok: false,
      statusDetail: `composio_no_post_id:${compactExcerpt(JSON.stringify(response.data ?? {}))}`,
    };
  }
  return {
    ok: true,
    providerPostId: postId,
    providerUrl: response.data?.permalink ?? response.data?.url ?? undefined,
    statusDetail: "ok",
  };
}

/**
 * Public publish dispatcher. Routes to the right platform handler.
 * Reddit and others not supported — they stay tap-and-post per PLAYBOOK
 * § 3.5 (Reddit hostility to bots) + Sprint 2.5 scope.
 */
export async function publishContent(
  platform: PublishPlatform,
  input: PublishContentInput
): Promise<PublishContentResult> {
  switch (platform) {
    case "x":
      return publishToX(input);
    case "linkedin":
      return publishToLinkedIn(input);
  }
}
