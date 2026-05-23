import { describe, expect, it } from "vitest";
import { decideLearningLoop, interpretResults } from "../resultsLoop";

describe("GTM results loop", () => {
  it("doubles down only when customer movement is strong", () => {
    const result = interpretResults([
      { replies: 4, signups: 2, demos: 1, feedbackItems: 1 },
    ]);

    expect(result.signal).toBe("strong");
    expect(result.recommendation).toBe("double_down");
  });

  it("does not overfit tiny sample sizes", () => {
    const result = interpretResults([{ clicks: 100, replies: 0, signups: 0 }]);

    expect(result.signal).toBe("inconclusive");
    expect(result.recommendation).toBe("do_not_overfit");
  });

  it("iterates on weak but nonzero signal", () => {
    const result = interpretResults([
      { replies: 1, signups: 0 },
      { replies: 1, signups: 0 },
      { replies: 2, feedbackItems: 1 },
    ]);

    expect(result.signal).toBe("weak");
    expect(result.recommendation).toBe("iterate");
  });

  it("does not promote high-click vanity metrics into memory or content bank", () => {
    const decision = decideLearningLoop([
      { clicks: 500, replies: 0, signups: 0, demos: 0, feedbackItems: 0 },
    ]);

    expect(decision.recommendation).toBe("do_not_overfit");
    expect(decision.contentBankOutcome).toBe("inconclusive");
    expect(decision.memoryPromotionAllowed).toBe(false);
    expect(decision.nextAction).toContain("vanity metrics");
  });

  it("promotes repeated customer movement as a provisional winner", () => {
    const decision = decideLearningLoop([
      { replies: 4, signups: 2, demos: 1, feedbackItems: 1 },
      { replies: 3, signups: 1, demos: 0, feedbackItems: 1 },
    ]);

    expect(decision.recommendation).toBe("double_down");
    expect(decision.contentBankOutcome).toBe("winner");
    expect(decision.memoryPromotionAllowed).toBe(true);
    expect(decision.nextAction).toContain("Promote the format");
  });
});
