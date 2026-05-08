/**
 * Sprint 10 — inbox warm-mining heuristic tests.
 *
 * Coverage:
 *   - Personal-mail domains rejected
 *   - Noise domains (Stripe/Calendly) rejected
 *   - Partnership keyword required
 *   - Hot vs warm based on age
 *   - Stale threads (>365d) dropped
 *   - From-header parsing edge cases
 *   - Brand-name canonicalization from domains
 *   - Gmail search query construction
 *   - dedupeKey shape
 */
import { describe, it, expect } from "vitest";
import {
  scoreInboxMessage,
  parseFromHeader,
  brandFromDomain,
  buildGmailSearchQuery,
  dedupeKey,
  PARTNERSHIP_KEYWORDS,
} from "../warmMining";

const NOW = 1_715_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const baseMsg = {
  fromHeader: '"Sarah at Patagonia" <sarah@patagonia.com>',
  subject: "Partnership opportunity",
  snippet: "Hi! We'd love to partner with you on our spring campaign.",
  internalDateMs: NOW - 5 * DAY,
  threadId: "thread_abc",
  messageId: "msg_001",
};

describe("scoreInboxMessage — happy paths", () => {
  it("classifies a recent partnership email as hot", () => {
    const got = scoreInboxMessage(baseMsg, NOW);
    expect(got).not.toBeNull();
    expect(got?.brand).toBe("Patagonia");
    expect(got?.contactEmail).toBe("sarah@patagonia.com");
    expect(got?.contactName).toBe("Sarah at Patagonia");
    expect(got?.warmth).toBe("hot");
    expect(got?.matchedKeywords.length).toBeGreaterThan(0);
  });

  it("classifies a 90-day-old thread as warm", () => {
    const got = scoreInboxMessage(
      { ...baseMsg, internalDateMs: NOW - 90 * DAY },
      NOW
    );
    expect(got?.warmth).toBe("warm");
  });

  it("strips email subdomain prefixes when deriving brand", () => {
    const got = scoreInboxMessage(
      { ...baseMsg, fromHeader: "<noreply@email.lululemon.com>" },
      NOW
    );
    expect(got?.brand).toBe("Lululemon");
  });

  it("captures role hint when sender display includes 'Marketing'", () => {
    const got = scoreInboxMessage(
      {
        ...baseMsg,
        fromHeader: '"Jamie - Influencer Marketing" <jamie@allbirds.com>',
      },
      NOW
    );
    expect(got?.contactRole).toBeDefined();
  });
});

describe("scoreInboxMessage — rejections", () => {
  it("rejects gmail.com sender (personal mail)", () => {
    const got = scoreInboxMessage(
      { ...baseMsg, fromHeader: "<friend@gmail.com>" },
      NOW
    );
    expect(got).toBeNull();
  });

  it("rejects icloud.com sender", () => {
    const got = scoreInboxMessage(
      { ...baseMsg, fromHeader: "<mom@icloud.com>" },
      NOW
    );
    expect(got).toBeNull();
  });

  it("rejects Stripe / known noise domain", () => {
    const got = scoreInboxMessage(
      {
        ...baseMsg,
        fromHeader: "<receipts@stripe.com>",
        subject: "Your monthly partnership invoice",
      },
      NOW
    );
    expect(got).toBeNull();
  });

  it("rejects emails missing partnership keyword", () => {
    const got = scoreInboxMessage(
      {
        ...baseMsg,
        subject: "Order confirmation",
        snippet: "Your order has shipped",
      },
      NOW
    );
    expect(got).toBeNull();
  });

  it("rejects ancient threads (>365d)", () => {
    const got = scoreInboxMessage(
      { ...baseMsg, internalDateMs: NOW - 400 * DAY },
      NOW
    );
    expect(got).toBeNull();
  });

  it("rejects malformed From headers", () => {
    expect(scoreInboxMessage({ ...baseMsg, fromHeader: "" }, NOW)).toBeNull();
    expect(scoreInboxMessage({ ...baseMsg, fromHeader: "not an email" }, NOW)).toBeNull();
    expect(
      scoreInboxMessage({ ...baseMsg, fromHeader: "<not-an-email>" }, NOW)
    ).toBeNull();
  });

  it("requires actual partnership keyword — role hint alone is not enough", () => {
    const got = scoreInboxMessage(
      {
        ...baseMsg,
        fromHeader: '"Marketing Team" <hello@brand.com>',
        subject: "New product launch",
        snippet: "Check out our new collection",
      },
      NOW
    );
    expect(got).toBeNull();
  });
});

describe("parseFromHeader", () => {
  it('handles "Name" <email> format', () => {
    const r = parseFromHeader('"Sarah K" <sarah@brand.com>');
    expect(r).toEqual({ email: "sarah@brand.com", displayName: "Sarah K" });
  });

  it("handles bare email", () => {
    const r = parseFromHeader("hello@brand.com");
    expect(r).toEqual({ email: "hello@brand.com" });
  });

  it("normalizes email to lowercase", () => {
    const r = parseFromHeader("<HELLO@BRAND.COM>");
    expect(r?.email).toBe("hello@brand.com");
  });

  it("returns null on empty input", () => {
    expect(parseFromHeader("")).toBeNull();
    expect(parseFromHeader("   ")).toBeNull();
  });

  it("returns null when angle brackets contain non-email", () => {
    expect(parseFromHeader('"X" <not-an-email>')).toBeNull();
  });
});

describe("brandFromDomain", () => {
  it.each([
    ["patagonia.com", "Patagonia"],
    ["email.patagonia.com", "Patagonia"],
    ["mail.lululemon.co.uk", "Lululemon"],
    ["marketing.allbirds.com", "Allbirds"],
    ["news.brand.io", "Brand"],
    ["go.shop.brandx.app", "Brandx"],
  ])("%s → %s", (input, expected) => {
    expect(brandFromDomain(input)).toBe(expected);
  });
});

describe("buildGmailSearchQuery", () => {
  it("includes partnership keywords + recency bound + spam exclusion", () => {
    const q = buildGmailSearchQuery();
    expect(q).toContain("partnership");
    expect(q).toContain("collab");
    expect(q).toContain("newer_than:365d");
    expect(q).toContain("-in:spam");
    expect(q).toContain("-in:trash");
  });

  it("respects custom sinceDays", () => {
    expect(buildGmailSearchQuery({ sinceDays: 90 })).toContain("newer_than:90d");
  });
});

describe("dedupeKey", () => {
  it("normalizes brand + email casing", () => {
    expect(dedupeKey("creatorA", "Patagonia", "SARAH@PATAGONIA.COM")).toBe(
      "creatorA::patagonia::sarah@patagonia.com"
    );
  });
  it("handles missing email", () => {
    expect(dedupeKey("creatorA", "Patagonia")).toBe("creatorA::patagonia::");
  });
});

describe("PARTNERSHIP_KEYWORDS — sanity", () => {
  it("includes the load-bearing patterns", () => {
    for (const kw of [
      "partnership",
      "collab",
      "ambassador",
      "sponsored",
      "gifted",
    ]) {
      expect(PARTNERSHIP_KEYWORDS).toContain(kw);
    }
  });
});
