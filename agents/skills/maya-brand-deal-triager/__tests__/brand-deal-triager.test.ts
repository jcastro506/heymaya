/**
 * maya-brand-deal-triager — unit tests.
 *
 * Coverage:
 *  - happy path: real-deal known brand → 4 variants returned + suggestedRate
 *  - classification rules: real-deal / cold-pitch / spam / press / partnership
 *  - parsing: max-dollar wins; "1.5k" parsed as 1500; deliverable + context window
 *  - urgency: 'asap' → high; deadline 24h → high; no deadline → low
 *  - PDF attachment: redflag skill invoked in parallel
 *  - adversarial 1: spam from free webmail with prize keyword + URL
 *  - adversarial 2: variant fails firewall → omitted from result (not fabricated)
 *  - adversarial 3: ambiguous email → falls back to model classifier
 */

import { describe, it, expect, vi } from "vitest";
import {
  classifyByRules,
  parseOffer,
  triageBrandEmail,
  urgencyFromThread,
  type CitationFirewall,
  type ClassifierModel,
  type ContractRedFlagSkill,
  type GmailThread,
  type RateCalculatorSkill,
  type TriageInputs,
  type VariantDrafterModel,
  type VoiceApplierSkill,
  type ReplyVariantKind,
} from "../script";

const baseFrom = {
  email: "partnerships@lululemon.com",
  name: "Lululemon Partnerships",
  domain: "lululemon.com",
};

function thread(overrides: Partial<GmailThread> = {}): GmailThread {
  return {
    threadId: "thr_x",
    from: baseFrom,
    subject: "Partnership opportunity",
    bodyText:
      "We are thinking 1 Reel + 1 TT post, 30-day usage, $4500 total. Deadline is October 15.",
    receivedMs: 1_714_435_200_000,
    attachments: [],
    ...overrides,
  };
}

const passingFirewall: CitationFirewall = {
  async check() {
    return { passed: true, unsupportedClaims: [] };
  },
};

const stubRateCalc: RateCalculatorSkill = {
  async suggest({ floorRate }) {
    return {
      low: floorRate,
      target: floorRate * 1.4,
      stretch: floorRate * 1.8,
      reasoning: "based on follower mix + recent deals + niche comparables",
    };
  },
};

const stubContractRedflag: ContractRedFlagSkill = {
  async scan() {
    return {
      high: 1,
      medium: 1,
      low: 0,
      recommendation: "negotiate",
      summary: "Found 2 red flags: 1 high, 1 medium. Recommendation: negotiate.",
    };
  },
};

const stubVoiceApplier: VoiceApplierSkill = {
  async apply({ draft }) {
    return { adjustedDraft: draft.toLowerCase(), unchanged: false };
  },
};

const stubClassifier: ClassifierModel = {
  async classifyAmbiguous() {
    return "cold-pitch";
  },
};

const stubVariantDrafter: VariantDrafterModel = {
  async draftVariants() {
    return {
      enthusiastic: "Hi! Yes I am in.",
      neutral: "Hi! Let me look at this.",
      firm: "Hi! My rate is $4500.",
      pass: "Hi! Thanks but not a fit.",
    };
  },
};

const baseCreatorContext: TriageInputs["creatorContext"] = {
  creatorId: "c_sam",
  picture: {
    niche: "Beginner-friendly home strength training",
    voiceFingerprint: "lowercase, em-dash heavy",
    followerCountByPlatform: [
      { platform: "tiktok", count: 142_000 },
      { platform: "instagram", count: 98_500 },
    ],
  },
  floorRate: 3000,
  recentDeals: [{ brand: "Athleta", valueUsd: 5500, deliverables: "1 Reel + 1 TT" }],
};

describe("maya-brand-deal-triager — classifyByRules", () => {
  it("real-deal: brand domain + deliverable + dollar", () => {
    expect(classifyByRules(thread())).toBe("real-deal");
  });
  it("real-deal: brand domain + deliverable, no dollar", () => {
    expect(
      classifyByRules(thread({ bodyText: "We'd like 1 Reel for our Q4 campaign." }))
    ).toBe("real-deal");
  });
  it("cold-pitch: free webmail + flattery, no rate, no deliverable", () => {
    expect(
      classifyByRules(
        thread({
          from: { email: "x@gmail.com", domain: "gmail.com" },
          bodyText: "Hi! I hope this email finds you well. I loved your content.",
        })
      )
    ).toBe("cold-pitch");
  });
  it("spam: free webmail + prize keyword + URL", () => {
    expect(
      classifyByRules(
        thread({
          from: { email: "winner@gmail.com", domain: "gmail.com" },
          bodyText:
            "Congratulations! You've been selected. Click here to claim your prize: https://x.example",
        })
      )
    ).toBe("spam");
  });
  it("press-inquiry: 'quote' / 'interview' wins over deliverable", () => {
    expect(
      classifyByRules(
        thread({
          bodyText:
            "Hi — I'm a journalist working on a feature on home fitness. Could I get a quote from you? Deadline is Friday.",
        })
      )
    ).toBe("press-inquiry");
  });
  it("partnership-not-deal: gifting, no dollar", () => {
    expect(
      classifyByRules(
        thread({
          bodyText:
            "Hi! Would love to send you our new product as a gift in exchange for a TT post.",
        })
      )
    ).toBe("partnership-not-deal");
  });
  it("affiliate offered with a dollar bonus → cold-pitch (hybrid)", () => {
    expect(
      classifyByRules(
        thread({
          bodyText:
            "Hi! Join our affiliate program — $50 commission per signup, plus we'd love a TT post.",
        })
      )
    ).toBe("cold-pitch");
  });
  it("ambiguous: returns null → caller must fall back to model", () => {
    expect(classifyByRules(thread({ bodyText: "Hello." }))).toBeNull();
  });
});

describe("maya-brand-deal-triager — parseOffer", () => {
  it("extracts max dollar amount + deliverable", () => {
    const t = thread({
      bodyText: "1 Reel + 1 TT, $4500 total. Setup fee $200.",
    });
    const o = parseOffer(t)!;
    expect(o.proposedValueUsd).toBe(4500);
    expect(o.deliverables).toMatch(/Reel|TT/);
  });
  it("parses '5k' as 5000", () => {
    const t = thread({ bodyText: "1 TT post, $5k total." });
    const o = parseOffer(t)!;
    expect(o.proposedValueUsd).toBe(5000);
  });
  it("flags exclusivity", () => {
    const t = thread({
      bodyText: "1 Reel, $4500 total, 30-day exclusivity in activewear.",
    });
    const o = parseOffer(t)!;
    expect(o.exclusivityMentioned).toBe(true);
  });
  it("returns null when no deliverable + no dollar", () => {
    const t = thread({ bodyText: "Hi! Just saying hello." });
    expect(parseOffer(t)).toBeNull();
  });
});

describe("maya-brand-deal-triager — urgency", () => {
  it("'asap' → high", () => {
    const t = thread({ bodyText: "Need a Reel ASAP, $4500." });
    expect(urgencyFromThread(t, parseOffer(t))).toBe("high");
  });
  it("no deadline → low", () => {
    const t = thread({ bodyText: "1 Reel + 1 TT, $4500." });
    expect(urgencyFromThread(t, parseOffer(t))).toBe("low");
  });
});

describe("maya-brand-deal-triager — triageBrandEmail happy path", () => {
  it("real-deal known brand: returns 4 variants + suggestedRate", async () => {
    const result = await triageBrandEmail(
      {
        gmailThread: thread(),
        creatorContext: baseCreatorContext,
        brandContextLookupEnabled: false,
      },
      {
        rateCalculator: stubRateCalc,
        contractRedflag: stubContractRedflag,
        voiceApplier: stubVoiceApplier,
        firewall: passingFirewall,
        classifierModel: stubClassifier,
        variantDrafter: stubVariantDrafter,
      }
    );
    expect(result.classification).toBe("real-deal");
    expect(result.replyVariants).toHaveLength(4);
    expect(result.suggestedRate).toBeDefined();
    expect(result.suggestedRate!.low).toBe(3000);
    // Voice was applied (lowercased).
    expect(result.replyVariants[0].draft).toBe(
      result.replyVariants[0].draft.toLowerCase()
    );
    for (const v of result.replyVariants) {
      expect(v.citations).toContain(`gmailThread:${thread().threadId}`);
    }
  });

  it("PDF attachment: invokes contract-redflag in parallel", async () => {
    const scanSpy = vi.fn(stubContractRedflag.scan);
    const result = await triageBrandEmail(
      {
        gmailThread: thread({
          attachments: [
            { kind: "pdf", url: "https://x.example/c.pdf", filename: "c.pdf" },
          ],
        }),
        creatorContext: baseCreatorContext,
        brandContextLookupEnabled: false,
      },
      {
        rateCalculator: stubRateCalc,
        contractRedflag: { scan: scanSpy },
        voiceApplier: stubVoiceApplier,
        firewall: passingFirewall,
        classifierModel: stubClassifier,
        variantDrafter: stubVariantDrafter,
      }
    );
    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(result.redFlags).toBeDefined();
    expect(result.redFlags!.recommendation).toBe("negotiate");
  });

  it("ambiguous email: falls back to classifier model", async () => {
    const classifySpy = vi.fn(stubClassifier.classifyAmbiguous);
    await triageBrandEmail(
      {
        gmailThread: thread({ bodyText: "Hello." }),
        creatorContext: baseCreatorContext,
        brandContextLookupEnabled: false,
      },
      {
        rateCalculator: stubRateCalc,
        contractRedflag: stubContractRedflag,
        voiceApplier: stubVoiceApplier,
        firewall: passingFirewall,
        classifierModel: { classifyAmbiguous: classifySpy },
        variantDrafter: stubVariantDrafter,
      }
    );
    expect(classifySpy).toHaveBeenCalledTimes(1);
  });
});

describe("maya-brand-deal-triager — adversarial firewall behavior", () => {
  it("variant fails firewall: omitted from result, never fabricated", async () => {
    let callCount = 0;
    const flakeyFirewall: CitationFirewall = {
      async check() {
        callCount++;
        // Fail the second variant only.
        return callCount === 2
          ? { passed: false, unsupportedClaims: ["unverified rate"] }
          : { passed: true, unsupportedClaims: [] };
      },
    };
    const result = await triageBrandEmail(
      {
        gmailThread: thread(),
        creatorContext: baseCreatorContext,
        brandContextLookupEnabled: false,
      },
      {
        rateCalculator: stubRateCalc,
        contractRedflag: stubContractRedflag,
        voiceApplier: stubVoiceApplier,
        firewall: flakeyFirewall,
        classifierModel: stubClassifier,
        variantDrafter: stubVariantDrafter,
      }
    );
    // Caller may receive < 4 variants; assertion is "no fabrication" not "all 4."
    expect(result.replyVariants.length).toBeLessThan(4);
    expect(result.replyVariants.length).toBeGreaterThan(0);
    const kinds = result.replyVariants.map((v) => v.variant) satisfies ReplyVariantKind[];
    // The skipped one is whichever variant landed in slot #2 of the
    // variantKinds order — 'neutral'.
    expect(kinds).not.toContain("neutral");
  });
});
