/**
 * maya-contract-redflag — unit tests.
 *
 * Coverage:
 *  - happy path: a clean contract returns 'sign' with zero flags
 *  - high-severity: contract with perpetual IP + unilateral extension → 'walk'
 *  - severity ladder: NET-75 (medium) vs NET-120 (high)
 *  - adversarial 1: empty PDF rejected
 *  - adversarial 2: firewall drops a flag → final result excludes it
 *  - adversarial 3: morality clause WITH due-process language → not flagged
 *  - whole-doc: FTC absence detected once even across many pages
 */

import { describe, it, expect } from "vitest";
import {
  detectFlags,
  detectFlagsInPage,
  recommendFromFlags,
  scanContract,
  type CitationFirewall,
  type ParsedPdf,
  type RedFlag,
} from "../script";

const passingFirewall: CitationFirewall = {
  async check() {
    return { passed: true, unsupportedClaims: [] };
  },
};

const failingFirewall: CitationFirewall = {
  async check() {
    return { passed: false, unsupportedClaims: ["unverifiable clause"] };
  },
};

function pdf(...pages: string[]): ParsedPdf {
  return {
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  };
}

describe("maya-contract-redflag — detection", () => {
  it("clean contract: zero flags + sign", async () => {
    const parsed = pdf(
      "Creator delivers one Reel. NET 30. Term 30 days. Exclusivity: 14 days post-publish, fitness only. " +
        "Brand approval required, up to 2 rounds of revisions within 5 business days. Creator includes #ad per FTC. " +
        "Termination requires 7 days notice and a 14-day cure period. Kill fee: 50% if Brand cancels within 7 days of shoot."
    );
    const result = await scanContract({ parsed }, { firewall: passingFirewall });
    expect(result.redFlags).toHaveLength(0);
    expect(result.recommendation).toBe("sign");
    expect(result.summary).toMatch(/No red flags/i);
    expect(result.summary).toMatch(/not legal advice/i);
  });

  it("perpetual IP grant: high severity, walk", () => {
    const parsed = pdf(
      "Creator grants Brand a perpetual, royalty-free license to use the content in any media now known or hereafter devised. " +
        "NET 30. #ad disclosure required."
    );
    const flags = detectFlags(parsed);
    const ip = flags.find((f) => f.category === "ip-grant-perpetual");
    expect(ip).toBeDefined();
    expect(ip!.severity).toBe("high");
    expect(recommendFromFlags(flags)).toBe("walk");
  });

  it("unilateral term extension: walk", () => {
    const parsed = pdf(
      "Brand may unilaterally extend the term of this Agreement for an additional 60 days. NET 30. #ad."
    );
    const flags = detectFlags(parsed);
    expect(
      flags.some((f) => f.category === "unilateral-term-extension" && f.severity === "high")
    ).toBe(true);
    expect(recommendFromFlags(flags)).toBe("walk");
  });

  it("NET-75: medium severity", () => {
    const parsed = pdf("Payment terms: NET 75. #ad disclosure required.");
    const flags = detectFlags(parsed);
    const pay = flags.find((f) => f.category === "payment-net-days");
    expect(pay?.severity).toBe("medium");
  });

  it("NET-120: high severity", () => {
    const parsed = pdf("Payment terms: NET 120. #ad disclosure required.");
    const flags = detectFlags(parsed);
    const pay = flags.find((f) => f.category === "payment-net-days");
    expect(pay?.severity).toBe("high");
  });

  it("exclusivity 6 months: high", () => {
    const parsed = pdf(
      "Exclusivity: Creator shall not promote any competing brand for 6 months. #ad."
    );
    const flags = detectFlags(parsed);
    const ex = flags.find((f) => f.category === "exclusivity-duration");
    expect(ex?.severity).toBe("high");
  });

  it("exclusivity 21 days: not flagged (industry baseline)", () => {
    const parsed = pdf("Exclusivity: 21 days post-publish. #ad.");
    const flags = detectFlags(parsed);
    expect(flags.some((f) => f.category === "exclusivity-duration")).toBe(false);
  });

  it("exclusivity 60 days: medium", () => {
    const parsed = pdf("Exclusivity period of 60 days. #ad.");
    const flags = detectFlags(parsed);
    const ex = flags.find((f) => f.category === "exclusivity-duration");
    expect(ex?.severity).toBe("medium");
  });

  it("morality clause WITH cure-period language: not flagged", () => {
    const parsed = pdf(
      "Termination on conduct that brings disrepute, with 14-day notice and opportunity to respond. NET 30. #ad."
    );
    const flags = detectFlags(parsed);
    expect(flags.some((f) => f.category === "morality-clause-overreach")).toBe(false);
  });

  it("morality clause WITHOUT due process: medium", () => {
    const parsed = pdf(
      "Brand may terminate immediately on conduct that brings disrepute. NET 30. #ad."
    );
    const flags = detectFlags(parsed);
    expect(
      flags.some((f) => f.category === "morality-clause-overreach" && f.severity === "medium")
    ).toBe(true);
  });

  it("paid shoot without kill fee: medium", () => {
    const parsed = pdf("In-person shoot scheduled for production day. NET 30. #ad.");
    const flags = detectFlags(parsed);
    expect(flags.some((f) => f.category === "missing-kill-fee" && f.severity === "medium")).toBe(true);
  });

  it("paid shoot WITH kill fee: not flagged", () => {
    const parsed = pdf("In-person shoot scheduled. Kill fee: 50%. NET 30. #ad.");
    const flags = detectFlags(parsed);
    expect(flags.some((f) => f.category === "missing-kill-fee")).toBe(false);
  });

  it("approval bottleneck (4 rounds): medium", () => {
    const parsed = pdf(
      "Brand approval required, with 4 rounds of revisions. NET 30. #ad."
    );
    const flags = detectFlags(parsed);
    expect(
      flags.some(
        (f) => f.category === "content-approval-bottleneck" && f.severity === "medium"
      )
    ).toBe(true);
  });

  it("approval cycles (2 rounds): not flagged", () => {
    const parsed = pdf("Brand approval required, with 2 rounds of revisions. NET 30. #ad.");
    const flags = detectFlags(parsed);
    expect(flags.some((f) => f.category === "content-approval-bottleneck")).toBe(false);
  });

  it("FTC absence: detected once across multi-page doc", () => {
    const parsed = pdf(
      "Page one of contract. Term 30 days. NET 30.",
      "Page two with delivery details only."
    );
    const flags = detectFlags(parsed);
    const ftc = flags.filter((f) => f.category === "ftc-disclosure-absent");
    expect(ftc).toHaveLength(1);
    expect(ftc[0].severity).toBe("high");
  });
});

describe("maya-contract-redflag — recommend logic", () => {
  it("perpetual IP alone forces walk", () => {
    const flags: RedFlag[] = [
      {
        severity: "high",
        category: "ip-grant-perpetual",
        clause: "perpetual",
        page: 1,
        concern: "perpetual",
        suggestion: "x",
        citation: { pageNumber: 1, clauseHash: "00000000" },
      },
    ];
    expect(recommendFromFlags(flags)).toBe("walk");
  });
  it("two mediums → negotiate", () => {
    const flags: RedFlag[] = [
      {
        severity: "medium",
        category: "morality-clause-overreach",
        clause: "x",
        page: 1,
        concern: "x",
        suggestion: "x",
        citation: { pageNumber: 1, clauseHash: "00000000" },
      },
      {
        severity: "medium",
        category: "missing-kill-fee",
        clause: "x",
        page: 1,
        concern: "x",
        suggestion: "x",
        citation: { pageNumber: 1, clauseHash: "00000001" },
      },
    ];
    expect(recommendFromFlags(flags)).toBe("negotiate");
  });
  it("zero high + zero medium → sign", () => {
    expect(recommendFromFlags([])).toBe("sign");
  });
});

describe("maya-contract-redflag — citation firewall integration", () => {
  it("firewall fail drops the flag from the final result", async () => {
    const parsed = pdf("Brand may unilaterally extend the term. NET 30. #ad.");
    const result = await scanContract({ parsed }, { firewall: failingFirewall });
    // No flags survive — recommendation collapses to 'sign'.
    expect(result.redFlags).toHaveLength(0);
    expect(result.recommendation).toBe("sign");
  });
});

describe("maya-contract-redflag — adversarial", () => {
  it("zero pages: throws", () => {
    expect(() => detectFlags({ pages: [] })).toThrow(/zero pages/);
  });
  it("page-level detector handles empty text", () => {
    expect(detectFlagsInPage({ pageNumber: 1, text: "" })).toEqual([]);
  });
});
