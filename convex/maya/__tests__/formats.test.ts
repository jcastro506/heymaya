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
  mineHashtags,
  mergeWatch,
  handleFrom,
  MAX_TAGS_PER_CHANNEL,
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

describe("mineHashtags", () => {
  const post = (text: string, views: number) => ({ text, views });

  /**
   * ⭐ §7.5.9: "Hashtags are a research output, not a generation output."
   *
   * Ranked by the median views of the posts using each tag, NOT by frequency.
   * Frequency finds the tags everyone uses; median performance finds the ones
   * that were on the posts that worked — a different set, and the one worth
   * borrowing.
   */
  it("ranks by how the posts using a tag performed, not by how common it is", () => {
    const mined = mineHashtags([
      post("a #common", 10),
      post("b #common", 10),
      post("c #common", 10),
      post("d #rare", 900_000),
      post("e #rare", 900_000),
    ]);
    expect(mined[0].tag).toBe("rare");
    // The common tag appears more often and still loses. That's the point.
    expect(mined.find((t) => t.tag === "common")?.uses).toBe(3);
  });

  it("drops a tag seen only once — that's a lucky post, not a pattern", () => {
    const mined = mineHashtags([post("x #once", 5_000_000)]);
    expect(mined).toEqual([]);
  });

  /**
   * ⚠️ `#fyp` and family are the most common output of "ask a model for ten
   * hashtags" and do nothing. They also dominate any frequency ranking, so
   * mining without excluding them returns them every time.
   */
  it("excludes platform-noise tags however well they appear to perform", () => {
    const mined = mineHashtags([
      post("a #fyp #foryou #viral #realtag", 1_000_000),
      post("b #fyp #foryou #viral #realtag", 1_000_000),
    ]);
    expect(mined.map((t) => t.tag)).toEqual(["realtag"]);
  });

  it("counts one post once, however many times it repeats a tag", () => {
    const mined = mineHashtags([
      post("#dup #dup #dup", 100),
      post("#dup", 100),
    ]);
    expect(mined[0].uses).toBe(2);
  });

  it("reads tags with non-ASCII letters and digits", () => {
    const mined = mineHashtags([post("#café2 x", 100), post("#café2 y", 100)]);
    expect(mined[0].tag).toBe("café2");
  });

  it("returns an empty set rather than inventing one", () => {
    // The caller must then post with NO hashtags. An empty set is a real
    // answer; generating tags here would undo the whole point.
    expect(mineHashtags([])).toEqual([]);
    expect(mineHashtags([post("no tags here", 100)])).toEqual([]);
  });

  it("caps the set so it stays a set rather than a dictionary", () => {
    const posts = Array.from({ length: 60 }, (_, i) => [
      post(`#tag${i}`, 100),
      post(`#tag${i}`, 100),
    ]).flat();
    expect(mineHashtags(posts).length).toBeLessThanOrEqual(MAX_TAGS_PER_CHANNEL);
  });
});

describe("mergeWatch", () => {
  const read = card({ depth: "read" });
  const seen = JSON.stringify({
    visualDevice: "tight vertical frame, man talking straight to camera",
    onScreenText: "Does the earth get heavier?",
    beats: [
      { atSec: 0, whatHappens: "asks the question" },
      { atSec: 6, whatHappens: "elaborates with gestures" },
    ],
    textOverlay: { style: "bold white", placement: "upper third", timing: "0-3s" },
    pacing: { cutsPerSecond: 0.25, totalLength: 65 },
  });

  it("promotes to watch and fills the visual fields", () => {
    const out = mergeWatch(read, seen);
    expect(out?.depth).toBe("watch");
    expect(out?.hook.visualDevice).toContain("tight vertical frame");
    expect(out?.beats).toHaveLength(2);
    expect(out?.pacing?.totalLength).toBe(65);
  });

  it("keeps everything the read tier established", () => {
    // The watch tier ADDS. Losing `reusableAs` would throw away the field the
    // whole library exists for.
    const out = mergeWatch(read, seen);
    expect(out?.reusableAs).toBe(read.reusableAs);
    expect(out?.hook.spokenLine).toBe(read.hook.spokenLine);
    expect(out?.cardId).toBe(read.cardId);
  });

  /**
   * ⭐ A card stamped "watched" with nothing seen is worse than a read card:
   * it claims a stronger observation than was made, and downstream it is
   * indistinguishable from a real one (§2.7).
   */
  it("refuses to promote when nothing was actually seen", () => {
    expect(mergeWatch(read, JSON.stringify({ visualDevice: "" }))).toBeNull();
    expect(mergeWatch(read, JSON.stringify({ beats: [] }))).toBeNull();
    expect(mergeWatch(read, "the video wouldn't load")).toBeNull();
  });

  it("drops malformed beats rather than keeping half a shape", () => {
    const out = mergeWatch(
      read,
      JSON.stringify({
        visualDevice: "something",
        beats: [{ atSec: "nope", whatHappens: "x" }, { atSec: 3, whatHappens: "ok" }],
      })
    );
    expect(out?.beats).toEqual([{ atSec: 3, whatHappens: "ok" }]);
  });

  it("caps beats so a card stays a shape rather than a transcript", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ atSec: i, whatHappens: "x" }));
    const out = mergeWatch(read, JSON.stringify({ visualDevice: "v", beats: many }));
    expect(out?.beats?.length).toBeLessThanOrEqual(6);
  });
});

describe("handleFrom", () => {
  it("reads the @handle out of a share URL", () => {
    expect(handleFrom("https://www.tiktok.com/@some.user/video/123?_r=1")).toBe(
      "some.user"
    );
  });

  it("returns undefined when there's no handle to find", () => {
    // A card with no handle can't be watched — `post()` needs both parts.
    expect(handleFrom("https://example.com/video/1")).toBeUndefined();
  });
});
