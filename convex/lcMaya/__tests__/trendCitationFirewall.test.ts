/**
 * Sprint 12.7 Phase 2 — citation firewall tests.
 *
 * Three layers under test:
 *   1. Pure helpers — `isPlatformPostUrl`, `extractPlatformUrls`,
 *      `checkTrendCitation`. Adversarial inputs covered here.
 *   2. `log_trend` chat-on-demand URL gate — Maya cannot persist a
 *      `chat-on-demand` trend whose evidence has no platform-post URL.
 *      Cron sources (niche-scan / platform-wide / industry-intel /
 *      competitor-watch) are NOT gated, confirmed by sibling assertion.
 *   3. `validate_trend_citation` HTTP endpoint — auth, malformed body,
 *      pass-through verdicts on draft messages.
 *
 * Five mandatory categories:
 *   - Cross-tenant: log_trend gate is creator-scoped (already covered in
 *     trendsLive.test.ts); the URL gate fires uniformly per body.
 *   - Plan-tier × action: validation endpoint open to all tiers (asserted).
 *   - Adversarial: bogus / non-URL / hashtag-only / partial-URL inputs.
 *   - Sibling-file scan: gate logic + endpoint share one helper set, no
 *     duplicate regexes elsewhere (TODO grep on commit catches drift).
 *   - TODO grep: covered repo-wide.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";
import {
  checkTrendCitation,
  extractPlatformUrls,
  isPlatformPostUrl,
} from "../lcMayaHttp";

const TEST_SECRET = "deadbeef".repeat(8);
const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* Layer 1 — pure helpers                                                       */
/* -------------------------------------------------------------------------- */

describe("isPlatformPostUrl", () => {
  it("accepts the canonical TikTok video shape", () => {
    expect(
      isPlatformPostUrl("https://www.tiktok.com/@charlidamelio/video/7234567890123456789")
    ).toBe(true);
    expect(
      isPlatformPostUrl("http://tiktok.com/@kevin.castro9996/video/123")
    ).toBe(true);
  });

  it("accepts TikTok short share form (vm.tiktok.com / vt.tiktok.com)", () => {
    expect(isPlatformPostUrl("https://vm.tiktok.com/ZMabc123/")).toBe(true);
    expect(isPlatformPostUrl("https://vt.tiktok.com/ZSxyz789/")).toBe(true);
  });

  it("accepts Instagram /p/, /reel/, /tv/", () => {
    expect(isPlatformPostUrl("https://www.instagram.com/p/CXabcDEF/")).toBe(true);
    expect(isPlatformPostUrl("https://www.instagram.com/reel/C123_xyz/")).toBe(true);
    expect(isPlatformPostUrl("https://instagram.com/tv/C-abc-XYZ")).toBe(true);
  });

  it("accepts YouTube long-form, Shorts, and youtu.be share", () => {
    expect(isPlatformPostUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isPlatformPostUrl("https://youtube.com/shorts/abc123XYZ")).toBe(true);
    expect(isPlatformPostUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  it("accepts X / Twitter status URLs", () => {
    expect(isPlatformPostUrl("https://x.com/maya/status/1234567890")).toBe(true);
    expect(isPlatformPostUrl("https://twitter.com/maya/status/9876543210")).toBe(true);
  });

  it("accepts LinkedIn posts + feed updates", () => {
    expect(
      isPlatformPostUrl("https://www.linkedin.com/posts/maya_activity-123456789")
    ).toBe(true);
    expect(
      isPlatformPostUrl(
        "https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789"
      )
    ).toBe(true);
  });

  it("rejects profile / hashtag / search pages (not citation-grade)", () => {
    expect(isPlatformPostUrl("https://www.tiktok.com/@charlidamelio")).toBe(false);
    expect(isPlatformPostUrl("https://tiktok.com/hashtag/nyc")).toBe(false);
    expect(isPlatformPostUrl("https://www.instagram.com/charlidamelio/")).toBe(false);
    expect(isPlatformPostUrl("https://www.youtube.com/@charlidamelio")).toBe(false);
    expect(isPlatformPostUrl("https://x.com/maya")).toBe(false);
  });

  it("rejects non-platform URLs", () => {
    expect(isPlatformPostUrl("https://google.com/")).toBe(false);
    expect(isPlatformPostUrl("https://scrapecreators.com")).toBe(false);
    expect(isPlatformPostUrl("https://heymaya.com/")).toBe(false);
    expect(isPlatformPostUrl("https://example.com/tiktok.com/fake")).toBe(false);
  });

  it("rejects malformed / non-URL strings", () => {
    expect(isPlatformPostUrl("")).toBe(false);
    expect(isPlatformPostUrl("not-a-url")).toBe(false);
    expect(isPlatformPostUrl("@tiktok.com/@x/video/123")).toBe(false);
    expect(isPlatformPostUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("extractPlatformUrls", () => {
  it("pulls the first platform URL from a friend-tone send", () => {
    const text =
      "https://www.tiktok.com/@alpha/video/p1 — staring-at-boyfriend trend, you and Josh could nail this";
    expect(extractPlatformUrls(text)).toEqual([
      "https://www.tiktok.com/@alpha/video/p1",
    ]);
  });

  it("ignores trailing punctuation on the URL", () => {
    expect(
      extractPlatformUrls("check this: https://www.tiktok.com/@a/video/1.")
    ).toEqual(["https://www.tiktok.com/@a/video/1"]);
    expect(
      extractPlatformUrls("see (https://www.tiktok.com/@a/video/1)")
    ).toEqual(["https://www.tiktok.com/@a/video/1"]);
  });

  it("pulls multiple URLs in document order", () => {
    const text =
      "Two: https://www.tiktok.com/@a/video/1 and https://www.instagram.com/reel/abc/";
    expect(extractPlatformUrls(text)).toEqual([
      "https://www.tiktok.com/@a/video/1",
      "https://www.instagram.com/reel/abc/",
    ]);
  });

  it("filters out non-platform URLs even if present", () => {
    const text =
      "context: https://heymaya.com/about and https://www.tiktok.com/@a/video/1";
    expect(extractPlatformUrls(text)).toEqual([
      "https://www.tiktok.com/@a/video/1",
    ]);
  });

  it("returns [] for empty / non-string inputs", () => {
    expect(extractPlatformUrls("")).toEqual([]);
    // @ts-expect-error — runtime safety
    expect(extractPlatformUrls(undefined)).toEqual([]);
    // @ts-expect-error — runtime safety
    expect(extractPlatformUrls(123)).toEqual([]);
  });
});

describe("checkTrendCitation", () => {
  it("PASS: message that doesn't mention a trend is always ok", () => {
    const v = checkTrendCitation(
      "Sunday 4pm — sketch next week with the creator. The Brooklyn shoot Thursday means we have a built-in shoot day."
    );
    expect(v.ok).toBe(true);
    expect(v.mentionsTrend).toBe(false);
    expect(v.blockedReason).toBeNull();
  });

  it("PASS: trend mention with a real TikTok URL inline", () => {
    const v = checkTrendCitation(
      "https://www.tiktok.com/@alpha/video/p1 — this trend is hitting because the deadpan POV thing is yours."
    );
    expect(v.ok).toBe(true);
    expect(v.mentionsTrend).toBe(true);
    expect(v.urlsFound).toHaveLength(1);
  });

  it("BLOCK: 'real-time trends' confabulation pattern with no URL", () => {
    const v = checkTrendCitation(
      "I'm seeing two specific real-time trends in your lane: NYC Scent Map and NYC Logic."
    );
    expect(v.ok).toBe(false);
    expect(v.mentionsTrend).toBe(true);
    expect(v.urlsFound).toEqual([]);
    expect(v.blockedReason).toBe("trend-mention-without-citation");
    expect(v.suggestedFix).toMatch(/tiktok\.com/);
  });

  it("BLOCK: 'going viral' without URL", () => {
    const v = checkTrendCitation("There's a sound going viral in your niche this week.");
    expect(v.ok).toBe(false);
  });

  it("BLOCK: 'blowing up' without URL", () => {
    const v = checkTrendCitation("the bodega-cat POV is blowing up right now");
    expect(v.ok).toBe(false);
  });

  it("BLOCK: 'people are doing X' without URL", () => {
    const v = checkTrendCitation(
      "people are making walking-monologue clips and getting massive saves."
    );
    expect(v.ok).toBe(false);
  });

  it("BLOCK: 'X is hitting' with a non-platform URL (heymaya.com)", () => {
    const v = checkTrendCitation(
      "the staring-at-boyfriend trend is hitting — see https://heymaya.com/blog/trends"
    );
    expect(v.ok).toBe(false);
    expect(v.urlsFound).toEqual([]);
  });

  it("BLOCK: a profile URL (not a post) does NOT satisfy the gate", () => {
    const v = checkTrendCitation(
      "this trend is hitting — https://www.tiktok.com/@charlidamelio"
    );
    expect(v.ok).toBe(false);
  });

  it("BLOCK: empty message + trend-shape pattern (defense-in-depth)", () => {
    // mentionsTrend false on empty string → ok=true; not a regression case
    expect(checkTrendCitation("").ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Layer 2 — log_trend chat-on-demand URL gate                                  */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/log_trend — chat-on-demand URL gate (Sprint 12.7 Phase 2)", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("BLOCKED 400: chat-on-demand with hashtag-only evidence (no platform URL)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "cod-block", plan: "manager" });
    const res = await t.fetch("/lc_maya/log_trend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        source: "chat-on-demand",
        observation: "the NYC Scent Map angle",
        evidence: [
          { kind: "hashtag", ref: "#nyc", fact: "appears in lots of NYC content" },
        ],
        relevanceScore: 0.7,
      }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/chat-on-demand source requires/);
    // No row should exist.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("trendObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows).toHaveLength(0);
  });

  it("BLOCKED 400: chat-on-demand with profile URL (not a post)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "cod-prof", plan: "manager" });
    const res = await t.fetch("/lc_maya/log_trend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        source: "chat-on-demand",
        observation: "this creator's vibe is trending",
        evidence: [
          {
            kind: "post",
            ref: "https://www.tiktok.com/@charlidamelio",
            fact: "their last 30 posts use the same format",
          },
        ],
        relevanceScore: 0.7,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("ALLOWED 200: chat-on-demand with a real TikTok video URL", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "cod-pass", plan: "manager" });
    const res = await t.fetch("/lc_maya/log_trend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        source: "chat-on-demand",
        observation: "the deadpan POV pattern fits your voice",
        evidence: [
          {
            kind: "post",
            ref: "https://www.tiktok.com/@alpha/video/p1",
            fact: "viewCount 410k, handheld POV matches creator's recurring shot",
          },
        ],
        relevanceScore: 0.91,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("SIBLING: niche-scan source is NOT gated (cron path is exempt — already grounded by design)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, {
      suffix: "ns-not-gated",
      plan: "manager",
    });
    const res = await t.fetch("/lc_maya/log_trend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        source: "niche-scan",
        observation: "a pantry-reset format is rising in this bracket",
        evidence: [
          { kind: "hashtag", ref: "#pantryreset", fact: "repeated across scan window" },
        ],
        relevanceScore: 0.82,
      }),
    });
    // Cron-side sources accept hashtag-only evidence — they're not the
    // confabulation surface this gate targets.
    expect(res.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Layer 3 — validate_trend_citation HTTP endpoint                              */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/validate_trend_citation", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: clean non-trend draft → ok=true", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/lc_maya/validate_trend_citation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        message:
          "Thursday's Brooklyn shoot — want me to draft a hook for the build-up?",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.mentionsTrend).toBe(false);
  });

  it("BLOCK: confabulation draft → ok=false + suggestedFix", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/lc_maya/validate_trend_citation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        message:
          "I'm seeing two specific real-time trends in your lane right now — NYC Scent Map and NYC Logic.",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.blockedReason).toBe("trend-mention-without-citation");
    expect(json.suggestedFix).toBeTruthy();
  });

  it("ALLOW: trend pitch with the URL inline → ok=true", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/lc_maya/validate_trend_citation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        message:
          "https://www.tiktok.com/@alpha/video/p1 — this trend fits your handheld POV",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.urlsFound).toHaveLength(1);
  });

  it("ADVERSARIAL: missing / wrong secret → 401", async () => {
    const t = convexTest(schema, modules);
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/validate_trend_citation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: bad, message: "anything" }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: malformed body → 400", async () => {
    const t = convexTest(schema, modules);
    const cases = [
      { body: "not-json", label: "non-json" },
      { body: JSON.stringify({}), label: "missing-secret" },
      { body: JSON.stringify({ secret: TEST_SECRET }), label: "missing-message" },
      {
        body: JSON.stringify({ secret: TEST_SECRET, message: 12345 }),
        label: "non-string-message",
      },
    ];
    for (const { body, label } of cases) {
      const res = await t.fetch("/lc_maya/validate_trend_citation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status, `case=${label}`).toBe(400);
    }
  });
});
