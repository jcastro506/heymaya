import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  COSINE_CLUSTER_THRESHOLD,
  similarityFromVectors,
} from "../embeddings";
import { JACCARD_CLUSTER_THRESHOLD, rankComplaints } from "../buyerMap";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

describe("cosineSimilarity", () => {
  it("identical vectors are 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("orthogonal vectors are 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("magnitude doesn't matter, only direction", () => {
    expect(cosineSimilarity([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 10);
  });

  it("opposite vectors are -1", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it("degenerate inputs are 0, not NaN", () => {
    // A zero vector or a length mismatch is a bad embedding, and NaN
    // propagating into a clustering threshold silently clusters everything.
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(Number.isNaN(cosineSimilarity([0, 0], [0, 0]))).toBe(false);
  });
});

describe("similarityFromVectors — degrading safely", () => {
  const vectors = new Map<string, number[]>([
    ["a", [1, 0, 0]],
    ["b", [1, 0, 0]],
    ["c", [0, 1, 0]],
  ]);
  const sim = similarityFromVectors(vectors);

  it("scores two known texts", () => {
    expect(sim("a", "b")).toBeCloseTo(1, 10);
    expect(sim("a", "c")).toBeCloseTo(0, 10);
  });

  it("a text with no vector scores 0 — it does not throw mid-sweep", () => {
    // Under-clustering is the safe direction to fail: the complaint still
    // appears, just at frequency 1. Throwing would lose the whole sweep.
    expect(sim("a", "missing")).toBe(0);
    expect(sim("missing", "alsomissing")).toBe(0);
  });
});

describe("the threshold, and why it's a constant with a caveat", () => {
  it("sits between the highest observed non-match and the lowest true match", () => {
    // Measured live 2026-07-31 on five strings:
    //   true matches   0.711, 0.812
    //   non-matches    0.584, 0.640, 0.573
    // The band is real but narrow — about 0.07 either side.
    expect(COSINE_CLUSTER_THRESHOLD).toBeGreaterThan(0.64);
    expect(COSINE_CLUSTER_THRESHOLD).toBeLessThan(0.711);
  });

  it("is a different scale from the Jaccard threshold — they are not swappable", () => {
    // Passing one where the other belongs would cluster everything or nothing.
    expect(COSINE_CLUSTER_THRESHOLD).not.toBe(JACCARD_CLUSTER_THRESHOLD);
    expect(COSINE_CLUSTER_THRESHOLD).toBeGreaterThan(JACCARD_CLUSTER_THRESHOLD);
  });
});

describe("rankComplaints with an injected similarity", () => {
  /** The case word overlap misses: same complaint, no shared vocabulary. */
  const sources = [
    {
      text: "pricing page is confusing, cant tell what tier I need",
      sourceUrl: "https://x.com/a/1",
      postedAt: NOW - 2 * 86_400_000,
    },
    {
      text: "I genuinely cannot work out what this would cost me",
      sourceUrl: "https://x.com/b/2",
      postedAt: NOW - 86_400_000,
    },
    {
      text: "the docs are great honestly",
      sourceUrl: "https://x.com/c/3",
      postedAt: NOW,
    },
  ];

  it("WORD OVERLAP MISSES IT — three complaints, all frequency 1", () => {
    // This is the failure that made embeddings worth the call. The same
    // grievance, twice, counted separately and never surfacing.
    const ranked = rankComplaints(sources);
    expect(ranked).toHaveLength(3);
    expect(ranked.every((r) => r.frequency === 1)).toBe(true);
  });

  it("cosine catches it — the two pricing complaints become one at frequency 2", () => {
    // Vectors stand in for the live embeddings, using the RATIOS actually
    // measured: the two pricing complaints ~0.71, everything else below 0.64.
    const vectors = new Map<string, number[]>([
      [sources[0].text, [1, 0.55, 0]],
      [sources[1].text, [1, 0.55, 0.35]],
      [sources[2].text, [0.2, 1, 0]],
    ]);
    const ranked = rankComplaints(sources, {
      similarityFn: similarityFromVectors(vectors),
      threshold: COSINE_CLUSTER_THRESHOLD,
    });

    expect(ranked[0].frequency).toBe(2);
    expect(ranked[0].sourceUrls).toHaveLength(2);
    // Still a real quote, not a synthesis — the invariant survives the swap.
    expect(sources.map((s) => s.text)).toContain(ranked[0].text);
    // And the unrelated praise stays out of the cluster.
    expect(ranked[1].text).toBe("the docs are great honestly");
  });

  it("with every vector missing it degrades to no clustering, not a crash", () => {
    const ranked = rankComplaints(sources, {
      similarityFn: similarityFromVectors(new Map()),
      threshold: COSINE_CLUSTER_THRESHOLD,
    });
    expect(ranked).toHaveLength(3);
  });

  it("the default is still word overlap, so nothing needs a network call", () => {
    // Callers that don't opt in keep a pure, offline-testable function.
    const ranked = rankComplaints([
      { text: "pricing page is confusing", sourceUrl: "u1", postedAt: NOW },
      { text: "the pricing page is confusing", sourceUrl: "u2", postedAt: NOW },
    ]);
    expect(ranked[0].frequency).toBe(2);
  });
});
