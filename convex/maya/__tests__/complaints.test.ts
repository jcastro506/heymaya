/**
 * The ranked complaint list — §5.0.0's "content plan", with receipts.
 *
 * The invariant that matters most here: **a complaint we can't trace back to a
 * real comment is dropped.** An unverifiable complaint looks identical to a
 * real one everywhere downstream, and the whole value of this list is that
 * "11 people said this" can be checked.
 */

import { describe, expect, it } from "vitest";
import {
  worthReading,
  prepareComments,
  attachReceipts,
  parseClusters,
  buildComplaintPrompt,
  MAX_COMMENTS_PER_CALL,
  type MinedComment,
} from "../complaints";

const NOW = Date.UTC(2026, 7, 5, 3, 0, 0);
const URL_A = "https://www.tiktok.com/@a/video/1";
const URL_B = "https://www.tiktok.com/@b/video/2";

function c(text: string, sourceUrl = URL_A, postedAt: number | null = null): MinedComment {
  return { text, sourceUrl, postedAt };
}

describe("DON'T PAY TO READ '🔥🔥🔥'", () => {
  it("drops emoji, one-word and tag-only comments", () => {
    expect(worthReading("🔥🔥🔥")).toBe(false);
    expect(worthReading("first")).toBe(false);
    expect(worthReading("@sarah @mike")).toBe(false);
    expect(worthReading("   ")).toBe(false);
  });

  it("keeps anything that says something", () => {
    expect(worthReading("how much does this actually cost though")).toBe(true);
    expect(worthReading("does it work on android?")).toBe(true);
  });

  it("dedupes repeated text and caps the batch", () => {
    // The cap is a cost control: 300 comments is enough to see a pattern, and
    // an uncapped comment section is an uncapped bill.
    const many = Array.from({ length: 400 }, (_, i) =>
      c(`this is a distinct comment number ${i}`)
    );
    expect(prepareComments(many)).toHaveLength(MAX_COMMENTS_PER_CALL);

    const dupes = [
      c("how much does this cost"),
      c("how much does this cost"),
      c("how much does this cost"),
    ];
    expect(prepareComments(dupes)).toHaveLength(1);
  });
});

describe("⭐ A COMPLAINT WITHOUT RECEIPTS IS DROPPED", () => {
  const comments = [
    c("how much does this actually cost", URL_A),
    c("whats the price on this", URL_B),
    c("is there a free tier or", URL_A),
  ];

  it("attaches the source URL of every quote it can match", () => {
    const out = attachReceipts(
      [
        {
          text: "nobody says what it actually costs",
          quotes: ["how much does this actually cost", "whats the price on this"],
          frequency: 2,
        },
      ],
      comments,
      NOW
    );
    expect(out).toHaveLength(1);
    expect(out[0].sourceUrls.sort()).toEqual([URL_A, URL_B]);
  });

  it("⭐ DROPS A COMPLAINT WHOSE QUOTES MATCH NOTHING", () => {
    // The model writing rather than reading. Downstream, an invented complaint
    // is indistinguishable from a real one — and §7 forbids her posting
    // anything she can't trace.
    const out = attachReceipts(
      [
        {
          text: "everyone hates the onboarding",
          quotes: ["the onboarding is terrible"],
          frequency: 9,
        },
      ],
      comments,
      NOW
    );
    expect(out).toEqual([]);
  });

  it("TRUSTS THE RECEIPTS OVER THE MODEL'S OWN COUNT", () => {
    // A model claiming frequency 50 with two quotes is guessing. The quotes are
    // the evidence, so they set the ceiling.
    const out = attachReceipts(
      [
        {
          text: "pricing is unclear",
          quotes: ["how much does this actually cost", "whats the price on this"],
          frequency: 50,
        },
      ],
      comments,
      NOW
    );
    expect(out[0].frequency).toBe(2);
  });

  it("ranks by frequency, loudest first", () => {
    const out = attachReceipts(
      [
        { text: "rare thing", quotes: ["is there a free tier or"], frequency: 1 },
        {
          text: "common thing",
          quotes: ["how much does this actually cost", "whats the price on this"],
          frequency: 2,
        },
      ],
      comments,
      NOW
    );
    expect(out.map((x) => x.text)).toEqual(["common thing", "rare thing"]);
  });

  it("uses the newest quoted comment as lastSeen", () => {
    const dated = [
      c("how much does this actually cost", URL_A, 1_780_000_000),
      c("whats the price on this", URL_B, 1_784_000_000),
    ];
    const out = attachReceipts(
      [
        {
          text: "pricing",
          quotes: dated.map((d) => d.text),
          frequency: 2,
        },
      ],
      dated,
      NOW
    );
    // Seconds promoted to ms — the same vendor-units trap as learn-business.
    expect(out[0].lastSeen).toBe(1_784_000_000_000);
  });
});

describe("PARSING", () => {
  it("reads a fenced response", () => {
    const out = parseClusters(
      '```json\n{"complaints":[{"text":"x","quotes":["a"],"frequency":2}]}\n```'
    );
    expect(out).toEqual([{ text: "x", quotes: ["a"], frequency: 2 }]);
  });

  it("an empty array is a real answer, not a failure", () => {
    // "These people have no repeated complaints" is information.
    expect(parseClusters('{"complaints":[]}')).toEqual([]);
  });

  it("unparseable output yields nothing rather than throwing", () => {
    expect(parseClusters("I could not find any complaints.")).toEqual([]);
  });

  it("survives missing fields", () => {
    const out = parseClusters('{"complaints":[{"text":"x"}]}');
    expect(out).toEqual([{ text: "x", quotes: [], frequency: 1 }]);
  });
});

describe("THE PROMPT", () => {
  it("carries the niche and the comments", () => {
    const prompt = buildComplaintPrompt("csv dashboard, solo founder", [
      c("how much does this cost"),
    ]);
    expect(prompt).toContain("csv dashboard, solo founder");
    expect(prompt).toContain("how much does this cost");
  });

  it("flattens newlines so one comment stays one line", () => {
    // A comment containing newlines would otherwise look like several comments
    // and inflate every frequency count.
    const prompt = buildComplaintPrompt("x", [c("line one\nline two")]);
    expect(prompt).toContain("- line one line two");
  });
});
