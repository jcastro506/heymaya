import { describe, expect, it } from "vitest";
import { interpretResults } from "../resultsLoop";

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
});
