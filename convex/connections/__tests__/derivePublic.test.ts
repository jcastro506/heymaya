/** B1: the public-count read says only what views can say. */
import { describe, expect, it } from "vitest";
import { derive, derivePublic } from "../analytics";

describe("derivePublic", () => {
  it("broke out at 3×, even while fresh (the multiple is a lower bound)", () => {
    expect(derivePublic(3.2, false)?.diagnosis).toBe("broke_out");
    expect(derivePublic(110, true)?.diagnosis).toBe("broke_out");
  });
  it("never calls a fresh post below normal", () => {
    expect(derivePublic(0.2, false)?.diagnosis).toBe("unknown");
    expect(derivePublic(0.2, true)?.diagnosis).toBe("below_normal");
  });
  it("no multiple, no read", () => {
    expect(derivePublic(null, true)).toBeNull();
  });
  it("connected: reach at 3× their normal is a breakout", () => {
    const c = { platform: "tiktok" as const, postId: "1", url: null, publishedAt: null, asOf: null, syncStatus: "synced" as const, views: 30_000, likes: 3000, comments: 100, shares: 100, saves: 100, impressions: null, reach: 30_000, clicks: null, follows: null, avgWatchMs: null, totalWatchMs: null, skipRatePct: null, durationSec: null, completionRate: null, profileViews: null, viewSources: null, viewerTypes: null, viewerCountries: null };
    expect(derive(c, { reach: 10_000, engagementPerReach: null }).diagnosis).toBe("broke_out");
  });
});
