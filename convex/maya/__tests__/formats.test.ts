/**
 * `watch-formats` — the constraints that hold without a vendor or a model.
 *
 * The sharing key and the card filter are where this either saves money or
 * silently doesn't, and neither failure is visible in production: a forked
 * fingerprint just shows up as a bill, and a generic card just makes the
 * library look fuller than it is.
 */

import { describe, expect, it } from "vitest";
import {
  cardIdFor,
  extractYoutubeTranscript,
  nicheFingerprint,
  parseCard,
  parseMetrics,
  pickCard,
  videoIdFrom,
  type FormatCard,
} from "../formats";

const card = (over: Partial<FormatCard>): FormatCard => ({
  cardId: "fc_1",
  sourceUrl: "https://tiktok.com/@a/video/1",
  channel: "tiktok",
  depth: "read",
  metrics: { views: 100, likes: 1, comments: 1 },
  hook: { spokenLine: "hi" },
  hypothesis: "because",
  reusableAs: "a shape",
  observedAt: 0,
  ...over,
});

describe("nicheFingerprint", () => {
  /**
   * ⭐ The whole affordability argument (§17.35.3) rests on this collapsing.
   *
   * Twenty founders in one niche must land on ONE key. If order or casing
   * forked it, each would get a private cache, every sweep would be paid for
   * twenty times, and nothing would look broken — the only symptom is the bill.
   */
  it("is stable across keyword order and casing", () => {
    expect(nicheFingerprint(["Solo Founder", "saas", "indie hacker"])).toBe(
      nicheFingerprint(["indie hacker", "SOLO FOUNDER", "  saas  "])
    );
  });

  it("collapses duplicates rather than forking on them", () => {
    expect(nicheFingerprint(["saas", "saas", "b2b"])).toBe(
      nicheFingerprint(["b2b", "saas"])
    );
  });

  it("separates genuinely different niches", () => {
    expect(nicheFingerprint(["saas"])).not.toBe(nicheFingerprint(["plumbing"]));
  });

  it("carries no customer identity", () => {
    // nicheCache is read across tenants — an id leaking into the key would
    // both break sharing and cross the isolation boundary.
    expect(nicheFingerprint(["saas"])).toMatch(/^niche_[a-z0-9]+$/);
  });
});

describe("cardIdFor", () => {
  it("is stable for a source, so a re-sweep replaces rather than stacks", () => {
    const url = "https://www.tiktok.com/@a/video/123";
    expect(cardIdFor(url)).toBe(cardIdFor(url));
    expect(cardIdFor(url)).not.toBe(cardIdFor("https://www.tiktok.com/@a/video/124"));
  });
});

describe("videoIdFrom", () => {
  /**
   * ⚠️ The measured bug: the same TikTok arrived three times as three
   * `sourceUrl`s differing only in share-tracking parameters, and we paid for
   * the transcript three times. The id is the only stable identity.
   */
  it("gives one id for the same video however the link was shared", () => {
    const a = videoIdFrom("https://www.tiktok.com/@x/video/7669789212694170902", "tiktok");
    const b = videoIdFrom(
      "https://www.tiktok.com/@x/video/7669789212694170902?_r=1&u_code=abc&share_item_id=7669789212694170902",
      "tiktok"
    );
    expect(a).toBe("7669789212694170902");
    expect(a).toBe(b);
  });

  it("reads both YouTube shapes", () => {
    expect(videoIdFrom("https://www.youtube.com/watch?v=abc123", "youtube")).toBe("abc123");
    expect(videoIdFrom("https://www.youtube.com/shorts/xyz789", "youtube")).toBe("xyz789");
  });
});

describe("parseMetrics", () => {
  it("reads the alternate key each vendor happens to use", () => {
    expect(parseMetrics(JSON.stringify({ playCount: 500 })).views).toBe(500);
    expect(parseMetrics(JSON.stringify({ viewCount: 500 })).views).toBe(500);
    expect(parseMetrics(JSON.stringify({ diggCount: 7 })).likes).toBe(7);
  });

  it("returns zeros rather than throwing on junk", () => {
    // A malformed row must skip a candidate, never kill the sweep.
    expect(parseMetrics("not json")).toEqual({ views: 0, likes: 0, comments: 0 });
    expect(parseMetrics(undefined)).toEqual({ views: 0, likes: 0, comments: 0 });
  });
});

describe("parseCard", () => {
  const candidate = {
    sourceUrl: "https://tiktok.com/@a/video/1",
    channel: "tiktok",
    metrics: { views: 10, likes: 2, comments: 1 },
  };

  /**
   * ⭐ `reusableAs` IS the card.
   *
   * §5.3 calls the library "a stock of proven shapes". A card that can't state
   * the shape is a row that makes the library look fuller than it is, and the
   * prompt is told to return "" precisely so this can throw it away.
   */
  it("drops a card that can't state the shape", () => {
    expect(
      parseCard(JSON.stringify({ hypothesis: "no idea", reusableAs: "" }), candidate, 0)
    ).toBeNull();
    expect(
      parseCard(JSON.stringify({ hypothesis: "no idea", reusableAs: "   " }), candidate, 0)
    ).toBeNull();
  });

  it("keeps a card that states one, and stamps it read-tier", () => {
    const out = parseCard(
      JSON.stringify({
        hypothesis: "the objection opener did the work",
        reusableAs: "open on the objection, answer it with a number",
        spokenHook: "people don't have time for this",
      }),
      candidate,
      1234
    );
    expect(out?.reusableAs).toContain("open on the objection");
    // ⚠️ Nothing here looked at a frame. A card claiming otherwise would be a
    // fabricated observation (§2.7).
    expect(out?.depth).toBe("read");
    expect(out?.beats).toBeUndefined();
    expect(out?.hook.visualDevice).toBeUndefined();
    expect(out?.observedAt).toBe(1234);
  });

  it("returns null for output that isn't JSON", () => {
    expect(parseCard("I couldn't watch that video.", candidate, 0)).toBeNull();
  });
});

describe("pickCard", () => {
  it("returns null on an empty library rather than inventing a default", () => {
    // A fallback would mean every post carries a formatCardId and none of them
    // means anything — worse than the honest gap.
    expect(pickCard([])).toBeNull();
    expect(pickCard([card({ reusableAs: "" })])).toBeNull();
  });

  it("prefers the same channel over a bigger cross-channel number", () => {
    // A shape proven on TikTok is evidence for TikTok. Reach doesn't transfer.
    const picked = pickCard(
      [
        card({ cardId: "yt", channel: "youtube", metrics: { views: 9_000_000, likes: 0, comments: 0 } }),
        card({ cardId: "tt", channel: "tiktok", metrics: { views: 1_000, likes: 0, comments: 0 } }),
      ],
      { channel: "tiktok" }
    );
    expect(picked?.cardId).toBe("tt");
  });

  it("falls back across channels when that channel has nothing", () => {
    const picked = pickCard([card({ cardId: "yt", channel: "youtube" })], {
      channel: "tiktok",
    });
    expect(picked?.cardId).toBe("yt");
  });

  it("ranks by reach within a channel, and honours exclusions", () => {
    const cards = [
      card({ cardId: "small", metrics: { views: 10, likes: 0, comments: 0 } }),
      card({ cardId: "big", metrics: { views: 5000, likes: 0, comments: 0 } }),
    ];
    expect(pickCard(cards)?.cardId).toBe("big");
    // Exclusion is what stops every post borrowing the same shape forever.
    expect(pickCard(cards, { exclude: ["big"] })?.cardId).toBe("small");
  });
});

describe("extractYoutubeTranscript", () => {
  // The wrapper returns the raw result for YouTube, so the shape is walked
  // rather than assumed — and the vendor uses more than one.
  it("reads each shape the endpoint returns", () => {
    expect(extractYoutubeTranscript({ transcript_only_text: "flat text" })).toBe("flat text");
    expect(extractYoutubeTranscript({ transcript: "also flat" })).toBe("also flat");
    expect(
      extractYoutubeTranscript({ transcript: [{ text: "one" }, { text: "two" }] })
    ).toBe("one two");
    expect(extractYoutubeTranscript({ segments: [{ text: "a" }, { text: "b" }] })).toBe("a b");
  });

  it("returns null when there's nothing, rather than an empty-looking string", () => {
    expect(extractYoutubeTranscript(null)).toBeNull();
    expect(extractYoutubeTranscript({ nope: true })).toBeNull();
  });
});
