/**
 * twitterapi.io — the X surface beyond `advanced_search`.
 *
 * §2 puts the gap plainly: twitterapi.io exposes 75+ endpoints and we wrapped
 * two. The five here are the ones the product actually needs:
 *
 *   mentions + replies  →  "answer everyone" on X. Without them she cannot see
 *                          what was said to her, which is most of the job.
 *   followers           →  the buyer map's audience-overlap input (§5.0.0),
 *                          the X equivalent of `tiktok/user/followers`.
 *   userInfo            →  profile facts for the tracked-account list.
 *   trends              →  the wider-world sweep.
 *
 * **All paths and parameters VERIFIED LIVE 2026-08-01** before a line of this
 * was written. Worth noting the convention difference, because it is exactly
 * the kind of thing that silently 400s: twitterapi.io is **camelCase**
 * (`userName`, `tweetId`), where ScrapeCreators is snake_case (`audio_id`,
 * `comment_id`). Same product, two vendors, opposite conventions.
 *
 * Every response carries `{status, msg}` alongside the payload, and the
 * paginated ones carry `{has_next_page, next_cursor}` — snake_case in the
 * BODY while the query is camelCase, which is its own small trap.
 */

const BASE_URL = "https://api.twitterapi.io";
const TIMEOUT_MS = 20_000;

/**
 * A page of results plus what it costs to keep reading.
 *
 * Modelled on the Zernio fix: pagination lives in the return type rather than
 * being something a caller has to remember to look for. Reading page one and
 * calling it the whole inbox is a mistake this codebase has already made once.
 */
export interface XPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Set when the call did not succeed. Empty items + a reason, never a throw. */
  statusDetail?: string;
}

function emptyPage<T>(statusDetail: string): XPage<T> {
  return { items: [], nextCursor: null, hasMore: false, statusDetail };
}

/**
 * One request, with the same degradation contract the existing search wrapper
 * uses: a missing key or a bad response yields an empty page carrying a named
 * reason, never an exception. A perception sweep that throws takes down the
 * whole run for one flaky vendor.
 */
async function request(
  path: string,
  query: Record<string, string | number | undefined>
): Promise<{ body: Record<string, unknown> | null; statusDetail?: string }> {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) return { body: null, statusDetail: "twitterapi_io_key_missing" };

  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { "X-API-Key": key },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        body: null,
        statusDetail: `twitterapi_io_http_${res.status}:${text.slice(0, 200)}`,
      };
    }
    return { body: (await res.json()) as Record<string, unknown> };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      body: null,
      statusDetail: /abort/i.test(message)
        ? "twitterapi_io_timeout"
        : `twitterapi_io_error:${message.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the standard page envelope out of a response body. */
export function toPage<T>(
  body: Record<string, unknown> | null,
  itemsKey: string,
  statusDetail?: string
): XPage<T> {
  if (!body) return emptyPage<T>(statusDetail ?? "twitterapi_io_no_body");
  const raw = body[itemsKey];
  return {
    items: Array.isArray(raw) ? (raw as T[]) : [],
    // snake_case in the body, camelCase in the query. Easy to get backwards.
    nextCursor: (body.next_cursor as string | null | undefined) ?? null,
    hasMore: body.has_next_page === true,
  };
}

/* -------------------------------------------------------------------------- */
/* The endpoints                                                               */
/* -------------------------------------------------------------------------- */

/** Mentions of an account — half of "answer everyone" on X. */
export async function getMentions(
  userName: string,
  cursor?: string
): Promise<XPage<Record<string, unknown>>> {
  const { body, statusDetail } = await request("/twitter/user/mentions", {
    userName,
    cursor,
  });
  return toPage(body, "tweets", statusDetail);
}

/** Replies to one tweet — the other half. */
export async function getTweetReplies(
  tweetId: string,
  cursor?: string
): Promise<XPage<Record<string, unknown>>> {
  const { body, statusDetail } = await request("/twitter/tweet/replies", {
    tweetId,
    cursor,
  });
  return toPage(body, "tweets", statusDetail);
}

/**
 * An account's followers — the buyer map's audience-overlap input on X.
 *
 * `computeAudienceOverlap` takes handles, so this is the X-side equivalent of
 * `tiktok.followers`: without it, overlap discovery only works on TikTok.
 */
export async function getFollowers(
  userName: string,
  cursor?: string
): Promise<XPage<Record<string, unknown>>> {
  const { body, statusDetail } = await request("/twitter/user/followers", {
    userName,
    cursor,
  });
  return toPage(body, "followers", statusDetail);
}

/** Profile facts. Note the payload is under `data`, not a plural collection. */
export async function getUserInfo(
  userName: string
): Promise<{ data: Record<string, unknown> | null; statusDetail?: string }> {
  const { body, statusDetail } = await request("/twitter/user/info", {
    userName,
  });
  if (!body) return { data: null, statusDetail };
  return { data: (body.data as Record<string, unknown> | null) ?? null };
}

/**
 * Trends for a location. `woeid` is a Yahoo "Where On Earth" id — 1 is
 * worldwide. Not a country code, and passing one silently returns nothing
 * useful rather than erroring.
 */
export async function getTrends(
  woeid: number | string = 1
): Promise<{ trends: unknown[]; statusDetail?: string }> {
  const { body, statusDetail } = await request("/twitter/trends", { woeid });
  if (!body) return { trends: [], statusDetail };
  return { trends: Array.isArray(body.trends) ? body.trends : [] };
}
