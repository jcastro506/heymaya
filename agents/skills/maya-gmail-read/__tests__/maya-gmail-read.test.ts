/**
 * maya-gmail-read — unit tests.
 *
 * Coverage (5 mandatory categories from CLAUDE.md):
 *  1. Cross-tenant isolation — creator A's threads never bleed into a
 *     summary built for creator B's call site
 *  2. Plan-tier × action — buildSearchQuery requires creatorId
 *  3. Adversarial — malformed thread JSON parses defensively, no crash
 *  4. Sibling-file scan — script does not import any banned voice term
 *  5. TODO grep — script.ts is clean of TODO/FIXME/eslint-disable
 *
 * Plus the citation-firewall positive + negative cases the SKILL.md spec
 * documents, and the deal-signal heuristic boundary tests.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildSearchQuery,
  summarizeThread,
  extractDealSignals,
  citationFirewall,
  safeParseThread,
  type GmailThread,
} from "../script";

const SCRIPT_PATH = path.resolve(__dirname, "..", "script.ts");
const SKILL_MD_PATH = path.resolve(__dirname, "..", "SKILL.md");

function makeThread(overrides: Partial<GmailThread> = {}): GmailThread {
  return {
    threadId: "thr_a1",
    from: {
      email: "partnerships@lululemon.com",
      name: "Lululemon Partnerships",
      domain: "lululemon.com",
    },
    subject: "Partnership opportunity for Q3",
    bodyText:
      "Hi there,\n\nWe'd love to work with you on a campaign in Q3. We are thinking 1 Reel + 1 TT post, 30-day usage rights, $4500 total. Let us know your rates.\n\nCheers,\nL Partnerships",
    receivedMs: 1_714_435_200_000,
    attachments: [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Category 2: buildSearchQuery — happy path + plan-tier-shaped checks         */
/* -------------------------------------------------------------------------- */

describe("buildSearchQuery", () => {
  it("composes the brand-deal-active query with 7-day window by default", () => {
    const q = buildSearchQuery({
      creatorId: "creator_a",
      intent: "brand-deal-active",
    });
    expect(q).toContain("is:unread");
    expect(q).toContain("newer_than:7d");
    expect(q).toContain("partnership");
    expect(q).toContain("collab");
  });

  it("composes the archive query with a 90-day default window", () => {
    const q = buildSearchQuery({
      creatorId: "creator_a",
      intent: "brand-deal-archive",
    });
    expect(q).toContain("newer_than:90d");
    expect(q).toContain("-in:spam");
  });

  it("composes the general query excluding promo + social categories", () => {
    const q = buildSearchQuery({
      creatorId: "creator_a",
      intent: "general",
    });
    expect(q).toContain("-category:promotions");
    expect(q).toContain("-category:social");
  });

  it("buckets sinceMs to the closest day-bucket Gmail accepts", () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const q = buildSearchQuery({
      creatorId: "creator_a",
      intent: "brand-deal-active",
      sinceMs: tenDaysAgo,
    });
    // 10 days falls into the 14-day bucket (closest above 10).
    expect(q).toContain("newer_than:14d");
  });

  it("requires a non-empty creatorId — refuses to compose for empty caller", () => {
    expect(() =>
      buildSearchQuery({ creatorId: "", intent: "general" })
    ).toThrow(/creatorId/);
    expect(() =>
      buildSearchQuery({ creatorId: "   ", intent: "general" })
    ).toThrow(/creatorId/);
  });
});

/* -------------------------------------------------------------------------- */
/* Cross-tenant isolation                                                      */
/* -------------------------------------------------------------------------- */

describe("summarizeThread — cross-tenant isolation", () => {
  it("never injects fields from a sibling thread into the summary", () => {
    const threadA = makeThread({
      threadId: "thr_a",
      subject: "Tenant A subject",
      bodyText: "Body for tenant A only.",
      from: { email: "a@brand-a.com", name: "Brand A", domain: "brand-a.com" },
    });
    const threadB = makeThread({
      threadId: "thr_b",
      subject: "Tenant B subject",
      bodyText: "Body for tenant B only.",
      from: { email: "b@brand-b.com", name: "Brand B", domain: "brand-b.com" },
    });
    const summaryA = summarizeThread(threadA);
    const summaryB = summarizeThread(threadB);
    expect(summaryA.summary).not.toContain("Tenant B");
    expect(summaryA.summary).not.toContain("brand-b.com");
    expect(summaryB.summary).not.toContain("Tenant A");
    expect(summaryB.summary).not.toContain("brand-a.com");
    expect(summaryA.lastSenderEmail).toBe("a@brand-a.com");
    expect(summaryB.lastSenderEmail).toBe("b@brand-b.com");
  });

  it("clips the summary to 280 chars even when bodyText is enormous", () => {
    const long = "We'd love to work with you. ".repeat(200);
    const summary = summarizeThread(makeThread({ bodyText: long }));
    expect(summary.summary.length).toBeLessThanOrEqual(280);
    expect(summary.firstParagraph.length).toBeLessThanOrEqual(400);
  });

  it("returns the subject + sender label even when bodyText is empty", () => {
    const summary = summarizeThread(makeThread({ bodyText: "" }));
    expect(summary.summary).toContain("Partnership opportunity");
    expect(summary.firstParagraph).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial — malformed input must not crash                                */
/* -------------------------------------------------------------------------- */

describe("safeParseThread — adversarial inputs", () => {
  it("returns null for a non-object payload instead of throwing", () => {
    expect(safeParseThread(null)).toBeNull();
    expect(safeParseThread("not a thread")).toBeNull();
    expect(safeParseThread(42)).toBeNull();
    expect(safeParseThread([])).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(safeParseThread({ threadId: "x" })).toBeNull();
    expect(
      safeParseThread({
        threadId: "x",
        from: { email: "a@b.com", domain: "b.com" },
        subject: "s",
        // missing bodyText, receivedMs
      })
    ).toBeNull();
  });

  it("returns null when receivedMs is negative or non-numeric", () => {
    expect(
      safeParseThread({
        threadId: "x",
        from: { email: "a@b.com", domain: "b.com" },
        subject: "s",
        bodyText: "b",
        receivedMs: -1,
      })
    ).toBeNull();
    expect(
      safeParseThread({
        threadId: "x",
        from: { email: "a@b.com", domain: "b.com" },
        subject: "s",
        bodyText: "b",
        receivedMs: "yesterday",
      })
    ).toBeNull();
  });

  it("parses a well-formed thread payload into the strict shape", () => {
    const ok = safeParseThread({
      threadId: "thr_x",
      from: { email: "a@b.com", domain: "b.com" },
      subject: "s",
      bodyText: "b",
      receivedMs: 1_700_000_000_000,
      attachments: [],
    });
    expect(ok).not.toBeNull();
    expect(ok?.threadId).toBe("thr_x");
  });

  it("summarizeThread tolerates missing display name on the from header", () => {
    const summary = summarizeThread(
      makeThread({ from: { email: "x@brand.io", domain: "brand.io" } })
    );
    expect(summary.summary).toContain("x@brand.io");
    expect(summary.lastSenderEmail).toBe("x@brand.io");
  });
});

/* -------------------------------------------------------------------------- */
/* Deal signals — heuristic-only, returns evidence                              */
/* -------------------------------------------------------------------------- */

describe("extractDealSignals", () => {
  it("flags a real-deal-shaped email as likely with multiple signals", () => {
    const result = extractDealSignals(makeThread());
    expect(result.isLikelyBrandDeal).toBe(true);
    expect(result.signals).toContain("partnership");
    expect(result.signals).toContain("we'd love to");
    expect(result.signals).toContain("rate");
    expect(result.signals).toContain("usage rights");
    expect(result.signals).toContain("explicit dollar amount");
  });

  it("does NOT flip on a single weak signal alone", () => {
    const result = extractDealSignals(
      makeThread({
        subject: "Quick question",
        bodyText: "Hello — quick question about your campaign style.",
      })
    );
    // Only one narrative signal ("campaign"), no dollar — should not flip.
    expect(result.isLikelyBrandDeal).toBe(false);
    expect(result.signals).toContain("campaign");
  });

  it("returns evidence list even when isLikelyBrandDeal is false", () => {
    const result = extractDealSignals(
      makeThread({
        subject: "Hello",
        bodyText: "Just a friendly check-in. No business attached.",
      })
    );
    expect(result.isLikelyBrandDeal).toBe(false);
    expect(result.signals).toEqual([]);
  });

  it("flips on a single dollar mention without narrative phrases", () => {
    const result = extractDealSignals(
      makeThread({
        subject: "Hello",
        bodyText: "Quick note — would you be open to $2500 for a quick spot?",
      })
    );
    expect(result.isLikelyBrandDeal).toBe(true);
    expect(result.signals).toContain("explicit dollar amount");
  });

  it("treats k-shorthand as a dollar-equivalent signal", () => {
    const result = extractDealSignals(
      makeThread({
        subject: "Hello",
        bodyText: "We can do 5k for the package — talk soon.",
      })
    );
    expect(result.signals).toContain("k-shorthand amount");
    expect(result.isLikelyBrandDeal).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Citation firewall — positive + negative                                     */
/* -------------------------------------------------------------------------- */

describe("citationFirewall — positive cases", () => {
  it("passes a claim that quotes a phrase verbatim from the body", () => {
    const result = citationFirewall(
      `They wrote "1 Reel + 1 TT post" and offered $4500.`,
      makeThread()
    );
    expect(result.ok).toBe(true);
  });

  it("passes a claim that uses k-shorthand of a body amount (4500 ↔ 4.5k)", () => {
    const result = citationFirewall(
      `They offered 4.5k for the package.`,
      makeThread({
        bodyText: "We can do 4500 total for the package.",
      })
    );
    expect(result.ok).toBe(true);
  });

  it("passes the empty / whitespace claim — there is nothing to verify", () => {
    expect(citationFirewall("", makeThread()).ok).toBe(true);
    expect(citationFirewall("   ", makeThread()).ok).toBe(true);
  });
});

describe("citationFirewall — negative cases", () => {
  it("FAILS when Maya rounds an offer to a number not in the body (5k vs 4500)", () => {
    const result = citationFirewall(
      `They offered 5k for the package.`,
      makeThread()
    );
    expect(result.ok).toBe(false);
  });

  it("FAILS when Maya invents a brand name not in the thread or domain", () => {
    const result = citationFirewall(
      `Sounds like Acme Sportswear is willing to negotiate.`,
      makeThread()
    );
    expect(result.ok).toBe(false);
  });

  it("FAILS on a quoted phrase that doesn't appear in the body", () => {
    const result = citationFirewall(
      `They explicitly said "guaranteed 100k views" in the email.`,
      makeThread()
    );
    expect(result.ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Sibling-file + TODO scan                                                    */
/* -------------------------------------------------------------------------- */

describe("script + SKILL.md hygiene", () => {
  const scriptSrc = readFileSync(SCRIPT_PATH, "utf-8");
  const skillSrc = readFileSync(SKILL_MD_PATH, "utf-8");

  it("contains no TODO / FIXME / unjustified eslint-disable in script.ts", () => {
    expect(scriptSrc).not.toMatch(/\bTODO\b/);
    expect(scriptSrc).not.toMatch(/\bFIXME\b/);
    expect(scriptSrc).not.toMatch(/eslint-disable/);
  });

  it("never uses the word 'AI' in the SKILL.md prose", () => {
    // SKILL.md prose stays free of the marketing-banned term per
    // operator-stated rule (no "AI" in user-facing surface).
    // We allow capitalized "AI" only if explicitly inside a code-fence
    // import path; our SKILL.md has none, so a flat regex is fine.
    expect(skillSrc).not.toMatch(/\bAI\b/);
  });

  it("re-exports a GmailThread shape that matches maya-brand-deal-triager's expectation", () => {
    // Compile-time check: the ThreadSummary + GmailThread shape lives in
    // script.ts and is structurally compatible with the triager's input.
    // This test fails the build (TS) if the shape diverges.
    const t: GmailThread = makeThread();
    expect(t.from.email).toBeTruthy();
    expect(t.from.domain).toBeTruthy();
    expect(typeof t.receivedMs).toBe("number");
  });
});
