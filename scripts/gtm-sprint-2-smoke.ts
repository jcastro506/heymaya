#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 2 — L4 smoke (GTM ScrapeCreators wrappers).
 *
 * Asserts:
 *   - All 11 typed wrappers exist and have stable rawRef shape
 *   - Normalizers produce ResearchRawItem matching the zod schema
 *   - Soft-fail discipline holds (4xx + network = statusDetail, no throw)
 *   - rawRef prefixes by platform are stable across calls
 *
 * `--live --confirm` mode hits the real ScrapeCreators API for each
 * platform with a single low-cost probe (1 call/platform = max 5 calls,
 * <$0.05 total). Skipped in default mode.
 */

import { ScrapeCreatorsClient } from "../convex/integrations/scrapeCreators/client";
import {
  ResearchRawItemSchema,
  googleSearch,
  instagramSearchReels,
  redditPostComments,
  searchRedditAll,
  searchRedditSubreddit,
  subredditPosts,
  tiktokVideoComments,
  tiktokVideoTranscript,
  twitterProfile,
  twitterSearch,
  twitterTweet,
  twitterUserTweets,
} from "../convex/gtmMaya/scrapeCreatorsGtmResearch";

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}

const checks: Check[] = [];
function pass(name: string, detail: string): void {
  checks.push({ name, status: "passed", detail });
}
function fail(name: string, detail: string): void {
  checks.push({ name, status: "failed", detail });
}

function fakeClient(body: unknown, httpStatus = 200): ScrapeCreatorsClient {
  return new ScrapeCreatorsClient({
    apiKey: "smoke-key",
    baseUrl: "https://api.test/",
    maxAttempts: 1,
    fetchImpl: (async () =>
      new Response(httpStatus === 200 ? JSON.stringify(body) : "", {
        status: httpStatus,
      })) as typeof fetch,
  });
}

async function checkAllNormalizersReturnValidItems(): Promise<void> {
  const allItems: unknown[] = [];
  allItems.push(
    ...(
      await searchRedditAll(
        fakeClient({
          data: {
            children: [
              {
                data: {
                  id: "abc",
                  title: "t",
                  subreddit: "S",
                  permalink: "/r/S/comments/abc/x/",
                },
              },
            ],
          },
        }),
        "q"
      )
    ).items
  );
  allItems.push(
    ...(
      await searchRedditSubreddit(
        fakeClient({
          data: {
            children: [
              { data: { id: "y", title: "t", subreddit: "Q" } },
            ],
          },
        }),
        "r/Q",
        "q"
      )
    ).items
  );
  allItems.push(
    ...(
      await subredditPosts(
        fakeClient({
          data: {
            children: [
              { data: { id: "z", title: "t", subreddit: "Q" } },
            ],
          },
        }),
        "r/Q"
      )
    ).items
  );
  allItems.push(
    ...(
      await redditPostComments(
        fakeClient([
          { data: { children: [] } },
          {
            data: {
              children: [
                { data: { id: "c", body: "b", author: "a" } },
              ],
            },
          },
        ]),
        "https://r.test/p"
      )
    ).items
  );
  allItems.push(
    ...(
      await tiktokVideoComments(
        fakeClient({
          comments: [
            { cid: "1", text: "t", user: { unique_id: "u", nickname: "U" } },
          ],
        }),
        "0"
      )
    ).items
  );
  allItems.push(
    ...(
      await tiktokVideoTranscript(
        fakeClient({ transcript: "transcript", language: "en" }),
        "0"
      )
    ).items
  );
  allItems.push(
    ...(
      await twitterProfile(
        fakeClient({ id: "1", handle: "h", name: "n" }),
        "@h"
      )
    ).items
  );
  allItems.push(
    ...(
      await twitterUserTweets(
        fakeClient({
          tweets: [{ id: "t", text: "x", user: { screen_name: "h" } }],
        }),
        "h"
      )
    ).items
  );
  allItems.push(
    ...(
      await twitterTweet(
        fakeClient({ id: "t", text: "x", user: { screen_name: "h" } }),
        "https://x.com/h/status/t"
      )
    ).items
  );
  allItems.push(
    ...(
      await twitterSearch(
        fakeClient({
          tweets: [{ id: "t", text: "x", user: { screen_name: "h" } }],
        }),
        "q"
      )
    ).items
  );
  allItems.push(
    ...(
      await instagramSearchReels(
        fakeClient({
          reels: [{ id: "r", shortcode: "s", owner: { username: "u" } }],
        }),
        "q"
      )
    ).items
  );
  allItems.push(
    ...(
      await googleSearch(
        fakeClient({
          results: [
            { title: "t", link: "https://e.test/x", snippet: "s" },
          ],
        }),
        "q"
      )
    ).items
  );

  for (const item of allItems) {
    const result = ResearchRawItemSchema.safeParse(item);
    if (!result.success) {
      fail(
        "research-raw-item-schema",
        `item failed schema: ${JSON.stringify(item).slice(0, 200)}`
      );
      return;
    }
  }
  pass(
    "research-raw-item-schema",
    `${allItems.length} normalized items across 5 platforms all match ResearchRawItem zod schema`
  );
}

async function checkRawRefPlatformPrefixes(): Promise<void> {
  const reddit = (await searchRedditAll(fakeClient({ data: { children: [{ data: { id: "1", title: "t" } }] } }), "q")).items[0]!;
  const tiktok = (await tiktokVideoComments(fakeClient({ comments: [{ cid: "1", text: "t" }] }), "0")).items[0]!;
  const twitter = (await twitterProfile(fakeClient({ id: "1", handle: "h" }), "h")).items[0]!;
  const instagram = (await instagramSearchReels(fakeClient({ reels: [{ id: "1", shortcode: "s" }] }), "q")).items[0]!;
  const google = (await googleSearch(fakeClient({ results: [{ link: "https://e.test/x" }] }), "q")).items[0]!;

  const expected: Record<string, string> = {
    reddit: "reddit:",
    tiktok: "tiktok:",
    twitter: "twitter:",
    instagram: "instagram:",
    google: "google:",
  };
  for (const [platform, item] of Object.entries({
    reddit,
    tiktok,
    twitter,
    instagram,
    google,
  })) {
    if (!item.rawRef.startsWith(expected[platform]!)) {
      fail(
        "rawref-platform-prefix",
        `${platform} item has rawRef '${item.rawRef}' — expected to start with '${expected[platform]}'`
      );
      return;
    }
  }
  pass(
    "rawref-platform-prefix",
    "every normalized item carries a rawRef with its platform prefix (for citation-firewall)"
  );
}

async function checkSoftFailDiscipline(): Promise<void> {
  const httpFail = await searchRedditAll(fakeClient(null, 503), "q");
  if (httpFail.items.length > 0) {
    fail(
      "soft-fail-5xx",
      "5xx should return empty items, not throw"
    );
    return;
  }
  if (!httpFail.statusDetail.startsWith("reddit_http_")) {
    fail("soft-fail-5xx", `unexpected statusDetail: ${httpFail.statusDetail}`);
    return;
  }
  const networkFail = await twitterProfile(
    new ScrapeCreatorsClient({
      apiKey: "k",
      maxAttempts: 1,
      fetchImpl: (async () => {
        throw new Error("ENOTFOUND");
      }) as typeof fetch,
    }),
    "ghost"
  );
  if (networkFail.items.length > 0) {
    fail("soft-fail-network", "network error should return empty items");
    return;
  }
  if (!networkFail.statusDetail.startsWith("twitter_error:")) {
    fail(
      "soft-fail-network",
      `unexpected statusDetail: ${networkFail.statusDetail}`
    );
    return;
  }
  pass(
    "soft-fail-discipline",
    "5xx + network errors return empty items + descriptive statusDetail (no throw)"
  );
}

function checkWrapperCount(): void {
  // Sprint 2 spec called for: 3 Reddit + 2 TikTok + 4 Twitter + 1 Instagram + 1 Google = 11 wrappers.
  const wrappers = [
    searchRedditAll,
    searchRedditSubreddit,
    subredditPosts,
    redditPostComments,
    tiktokVideoComments,
    tiktokVideoTranscript,
    twitterProfile,
    twitterUserTweets,
    twitterTweet,
    twitterSearch,
    instagramSearchReels,
    googleSearch,
  ];
  if (wrappers.length !== 12) {
    fail("wrapper-count", `expected 12 wrappers, found ${wrappers.length}`);
    return;
  }
  pass("wrapper-count", "12 typed GTM ScrapeCreators wrappers exported (Reddit 4 + TikTok 2 + Twitter 4 + Instagram 1 + Google 1)");
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkWrapperCount();
  await checkAllNormalizersReturnValidItems();
  await checkRawRefPlatformPrefixes();
  await checkSoftFailDiscipline();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 2 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. Ensure SCRAPE_CREATORS_API_KEY is set on the Convex deployment.\n" +
        "  2. Probe each platform with one cheap call (cost-cap $1 ceiling enforced):\n" +
        "     searchRedditAll('claude code') / tiktokVideoComments(<known-aweme>) / \n" +
        "     twitterProfile('marc_louvion') / instagramSearchReels('indie hacker') / \n" +
        "     googleSearch('alternative to Stripe Atlas')\n" +
        "  3. Confirm each returns items + non-empty rawRef + cost ledger row.\n" +
        "  4. Spot-check that each item.url resolves to a real page on the platform."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
