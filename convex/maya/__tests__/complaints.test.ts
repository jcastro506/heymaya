/**
 * The ranked complaint list — §5.0.0's "content plan", with receipts.
 *
 * The invariant that matters most here: **a complaint we can't trace back to a
 * real comment is dropped.** An unverifiable complaint looks identical to a
 * real one everywhere downstream, and the whole value of this list is that
 * "11 people said this" can be checked.
 */

import { describe, expect, it } from "vitest";
import { minimalRow, type InsertCtx } from "../../../tests/lib/minimalRow";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  worthReading,
  prepareComments,
  attachReceipts,
  parseClusters,
  buildComplaintPrompt,
  COMPLAINT_SYSTEM,
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

/**
 * ⭐ THE BUYER MAP HAS TO ACCUMULATE, OR IT ISN'T A MAP.
 *
 * `storeComplaints` overwrote the entire complaint list on every run, so what
 * §5.0.0 calls the buyer map was a snapshot of one sweep's eight posts. Two
 * consequences, both silent:
 *
 *  - a complaint that was loud in week one vanished in week two if that week's
 *    eight posts happened not to mention it
 *  - frequency never counted past a single run, so "people keep saying this"
 *    could never actually be measured
 *
 * CLAUDE.md's pitch is that she "mines what buyers are complaining about, and
 * THEN writes". A list that resets weekly cannot support that claim.
 *
 * ⚠️ Merging is the MODEL's job, not a similarity threshold's. Word overlap
 * scores "pricing is confusing" against "I can't work out what this would cost
 * me" at 0.07 — the same complaint, counted twice as frequency-1, therefore
 * never surfaced. `buyerMap.rankComplaints` exists for that deterministic
 * approach and is deliberately not used here.
 */
describe("the buyer map accumulates across weeks", () => {
  const known = [
    {
      text: "nobody explains what it actually costs",
      frequency: 6,
      sourceUrls: ["https://tiktok.com/@a/video/1"],
      lastSeen: Date.UTC(2026, 7, 1),
    },
  ];

  it("carries what we already knew into the prompt, with its frequency", () => {
    const prompt = buildComplaintPrompt("pricing tools", [c("what's the price")], known);
    expect(prompt).toContain("ALREADY KNOWN");
    expect(prompt).toContain("[6x] nobody explains what it actually costs");
  });

  it("tells the model to merge rather than start over", () => {
    const prompt = buildComplaintPrompt("x", [c("how much is it")], known);
    expect(prompt).toMatch(/merge into these, don't start over/i);
  });

  it("a first run has no known section at all — not an empty one", () => {
    // An empty "ALREADY KNOWN:" header reads as "we looked and found nothing",
    // which is a different claim from "this is the first week".
    const prompt = buildComplaintPrompt("x", [c("how much is it")]);
    expect(prompt).not.toContain("ALREADY KNOWN");
    expect(prompt).toContain("NEW COMMENTS:");
  });

  it("the system prompt says frequency across weeks beats a loud single week", () => {
    // The judgement that makes accumulation worth anything.
    expect(COMPLAINT_SYSTEM).toMatch(/three weeks is stronger evidence/i);
    expect(COMPLAINT_SYSTEM).toMatch(/carry forward/i);
  });
});

/* -------------------------------------------------------------------------- */

describe("a complaint has to belong to this buyer", () => {
  /**
   * ⭐ Measured live 2026-08-17, the first two complaints ever banked:
   * "It doesn't work for me." and "How do I get an invisible username?" — the
   * second a question about TikTok itself, mined for a founder selling a
   * CSV-to-dashboard tool.
   *
   * ⚠️ It scored **0.79** against a previous top of 0.175, because
   * `SOURCE_WEIGHT.complaint` is the ceiling of the scoring function. It would
   * have won the next morning's post outright. A niche is not a buyer.
   */
  it("⭐ the prompt states what the founder sells and who buys it", () => {
    const out = buildComplaintPrompt("solo founder, saas", [], [], {
      whatItIs: "turns a CSV into a dashboard in one paste",
      whoItsFor: "indie founders drowning in spreadsheets",
    });
    expect(out).toContain("turns a CSV into a dashboard");
    expect(out).toContain("indie founders drowning in spreadsheets");
  });

  it("⚠️ still clusters when no product has been read yet", () => {
    /**
     * The degrade-gracefully case. A customer mid-onboarding has no product
     * truth, and returning nothing would be worse than clustering without the
     * relevance judgement — §2.10, budgets never booleans.
     */
    const out = buildComplaintPrompt("solo founder, saas", [], [], null);
    expect(out).toContain("NICHE: solo founder, saas");
    expect(out).not.toContain("THE FOUNDER SELLS");
  });

  it("⚠️ the relevance rule is judged by the model, not pattern-matched here", () => {
    /**
     * The standing rule: no regex enforcement, prompt-primary. There is no
     * keyword denylist for "username" or "followers" — a list like that fails
     * on the next phrasing and trains the miner toward whatever it misses.
     * The instruction asks the model to decide.
     */
    expect(COMPLAINT_SYSTEM).toMatch(/would the person who buys this product/i);
    expect(COMPLAINT_SYSTEM).toMatch(/not evidence about this buyer/i);
  });
});

/* -------------------------------------------------------------------------- */

describe("the complaint list is actually ranked", () => {
  /**
   * ⭐ §5.0.0: *"The ranked complaint list IS the content plan. If 11 people in
   * this niche asked about pricing confusion this month, that's not an insight
   * to file — it's next week's post."*
   *
   * ⚠️ Returned in the model's arbitrary order until 2026-08-17, which made
   * "ranked" a claim the spec made and nothing kept. It matters now that
   * `bankFromComplaints` is wired — the order decides which complaint the
   * founder is shown first as justification for what gets written.
   */
  it("⭐ puts the most-said complaint first", async () => {
    const t = convexTest(schema, modules);
    const customerId = await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (table: string, value: unknown) => Promise<string> };
      };
      const creator = await c.db.insert(
        "creators",
        await minimalRow(ctx as InsertCtx, "creators", {
          clerkUserId: "ranked",
          email: "ranked@e.com",
          accountType: "gtm-agent",
        })
      );
      const customerId = await c.db.insert(
        "customers",
        await minimalRow(ctx as InsertCtx, "customers", { accountId: creator })
      );
      await (
        ctx as unknown as { db: { patch: (id: string, v: unknown) => Promise<void> } }
      ).db.patch(customerId, {
        buyerJson: JSON.stringify({
          complaints: [
            { text: "said once", frequency: 1, sourceUrls: ["https://e/1"], lastSeen: 900 },
            { text: "said eleven times", frequency: 11, sourceUrls: ["https://e/2"], lastSeen: 100 },
            { text: "said three times", frequency: 3, sourceUrls: ["https://e/3"], lastSeen: 500 },
          ],
        }),
      });
      return customerId;
    });

    const out = await t.query(internal.maya.complaints.complaintsFor, {
      customerId: customerId as never,
    });
    expect(out.map((c) => c.frequency)).toEqual([11, 3, 1]);
  });

  it("⚠️ breaks a tie on recency, not on insertion order", async () => {
    const t = convexTest(schema, modules);
    const customerId = await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (table: string, value: unknown) => Promise<string> };
      };
      const creator = await c.db.insert(
        "creators",
        await minimalRow(ctx as InsertCtx, "creators", {
          clerkUserId: "tie",
          email: "tie@e.com",
          accountType: "gtm-agent",
        })
      );
      const customerId = await c.db.insert(
        "customers",
        await minimalRow(ctx as InsertCtx, "customers", { accountId: creator })
      );
      await (
        ctx as unknown as { db: { patch: (id: string, v: unknown) => Promise<void> } }
      ).db.patch(customerId, {
        buyerJson: JSON.stringify({
          complaints: [
            { text: "older", frequency: 4, sourceUrls: ["https://e/1"], lastSeen: 100 },
            { text: "fresher", frequency: 4, sourceUrls: ["https://e/2"], lastSeen: 900 },
          ],
        }),
      });
      return customerId;
    });

    const out = await t.query(internal.maya.complaints.complaintsFor, {
      customerId: customerId as never,
    });
    expect(out[0].text).toBe("fresher");
  });

  it("⚠️ does NOT re-cluster — that approach was already abandoned", () => {
    /**
     * `buyerMap.rankComplaints` clusters by word overlap, and this module
     * recorded why that was replaced: "'pricing is confusing' against 'I can't
     * work out what this would cost me' at 0.07 — the same complaint, counted
     * twice, therefore never surfaced." The model merges across weeks and
     * returns the frequency. Re-clustering here would reintroduce the bug it
     * replaced, so this asserts the sort reads the model's number rather than
     * recomputing one.
     */
    const src = readFileSync(
      join(process.cwd(), "convex/maya/complaints.ts"),
      "utf8"
    );
    const block = src.slice(src.indexOf("export const complaintsFor"));
    // The CALL forms, not the words — the comment above the sort names the
    // abandoned approach on purpose, and matching prose fails on documentation.
    expect(block.slice(0, 1800)).not.toContain("rankComplaints(");
    expect(block.slice(0, 1800)).not.toContain("similarity(");
  });
});
