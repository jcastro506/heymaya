import { describe, expect, it } from "vitest";
import {
  canPostXUrlGtm,
  GtmPlanGateError,
  planFeaturesGtm,
  requireFeatureGtm,
  requireUnderCapGtm,
} from "../planGtm";

/** Build a gtmPlanJson string from a partial plan object. */
function planJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

// Real $99 gtm99: everything EXCEPT video (canVideo false, videoCreditsMonth 0).
const ACTIVE_FULL = planJson({
  tier: "gtm99",
  status: "active",
  connectedChannelCap: 6,
  autoPostChannelCap: 6,
  xUrlPostsSoftCapMonth: 30,
  periodStart: 1717200000000,
  usage: { autoPostsThisPeriod: 0, xUrlPostsThisPeriod: 0, videosThisPeriod: 0 },
});

// $149 studio: everything in gtm99 PLUS video.
const STUDIO_FULL = planJson({ tier: "studio", status: "active" });

describe("planFeaturesGtm — active gtm99 ($99, no video)", () => {
  it("returns all NON-video features true, canVideo false, videoCreditsMonth 0", () => {
    const f = planFeaturesGtm({ gtmPlanJson: ACTIVE_FULL });
    expect(f.plan).toBe("gtm99");
    expect(f.status).toBe("active");
    expect(f.canResearch).toBe(true);
    expect(f.canDraft).toBe(true);
    expect(f.canAutoPost).toBe(true);
    expect(f.canRead).toBe(true);
    expect(f.canMonitor).toBe(true);
    // Video is the studio upsell — OFF for gtm99.
    expect(f.canVideo).toBe(false);
    expect(f.videoCreditsMonth).toBe(0);
    expect(f.banSafetyManualGate).toBe(true);
    expect(f.attributionEnabled).toBe(true);
    expect(f.connectedChannelCap).toBe(6);
    expect(f.autoPostChannelCap).toBe(6);
    expect(f.xUrlPostsSoftCapMonth).toBe(30);
  });

  it("uses fair-use default caps when active plan omits them (video stays 0)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "gtm99", status: "active" }),
    });
    expect(f.canAutoPost).toBe(true);
    expect(f.connectedChannelCap).toBe(6);
    expect(f.autoPostChannelCap).toBe(6);
    expect(f.videoCreditsMonth).toBe(0);
    expect(f.canVideo).toBe(false);
    expect(f.xUrlPostsSoftCapMonth).toBe(30);
  });

  it("honors explicit fair-use cap overrides from the JSON", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({
        tier: "gtm99",
        status: "active",
        connectedChannelCap: 4,
        autoPostChannelCap: 2,
        xUrlPostsSoftCapMonth: 10,
      }),
    });
    expect(f.connectedChannelCap).toBe(4);
    expect(f.autoPostChannelCap).toBe(2);
    expect(f.xUrlPostsSoftCapMonth).toBe(10);
  });

  it("coerces invalid cap values back to the tier's fair-use defaults", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({
        tier: "gtm99",
        status: "active",
        connectedChannelCap: -3,
        autoPostChannelCap: "lots",
        videoCreditsMonth: NaN,
        xUrlPostsSoftCapMonth: null,
      }),
    });
    expect(f.connectedChannelCap).toBe(6);
    expect(f.autoPostChannelCap).toBe(6);
    expect(f.videoCreditsMonth).toBe(0); // gtm99 base
    expect(f.xUrlPostsSoftCapMonth).toBe(30);
  });
});

describe("planFeaturesGtm — active studio ($149, +video)", () => {
  it("returns everything gtm99 has PLUS canVideo + a video cap", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STUDIO_FULL });
    expect(f.plan).toBe("studio");
    expect(f.status).toBe("active");
    // All the gtm99 non-video features still on.
    expect(f.canAutoPost).toBe(true);
    expect(f.canResearch).toBe(true);
    expect(f.connectedChannelCap).toBe(6);
    // The studio unlock.
    expect(f.canVideo).toBe(true);
    expect(f.videoCreditsMonth).toBe(15);
    expect(f.banSafetyManualGate).toBe(true);
    expect(f.attributionEnabled).toBe(true);
  });

  it("studio trialing also gets video (full trial access)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "studio", status: "trialing" }),
    });
    expect(f.status).toBe("trialing");
    expect(f.canVideo).toBe(true);
    expect(f.videoCreditsMonth).toBe(15);
  });

  it("honors an explicit video cap override on studio", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "studio", status: "active", videoCreditsMonth: 30 }),
    });
    expect(f.canVideo).toBe(true);
    expect(f.videoCreditsMonth).toBe(30);
  });
});

describe("planFeaturesGtm — fail-closed defaults", () => {
  const failClosedInputs: Array<[string, { gtmPlanJson?: string | null }]> = [
    ["missing field", {}],
    ["null", { gtmPlanJson: null }],
    ["empty string", { gtmPlanJson: "" }],
    ["whitespace", { gtmPlanJson: "   " }],
    ["corrupt JSON", { gtmPlanJson: "{not json" }],
    ["JSON null literal", { gtmPlanJson: "null" }],
    ["JSON array", { gtmPlanJson: "[1,2,3]" }],
    ["JSON string literal", { gtmPlanJson: '"gtm99"' }],
    ["unknown tier", { gtmPlanJson: planJson({ tier: "gtm299", status: "active" }) }],
    ["missing tier", { gtmPlanJson: planJson({ status: "active" }) }],
    ["status none", { gtmPlanJson: planJson({ tier: "gtm99", status: "none" }) }],
    ["studio status none", { gtmPlanJson: planJson({ tier: "studio", status: "none" }) }],
    ["unknown status", { gtmPlanJson: planJson({ tier: "gtm99", status: "weird" }) }],
  ];

  it.each(failClosedInputs)(
    "%s → research/draft true, auto-post + video false, caps 0, moats const-true",
    (_label, agent) => {
      const f = planFeaturesGtm(agent);
      expect(f.canResearch).toBe(true);
      expect(f.canDraft).toBe(true);
      expect(f.canAutoPost).toBe(false);
      expect(f.canVideo).toBe(false);
      expect(f.connectedChannelCap).toBe(0);
      expect(f.autoPostChannelCap).toBe(0);
      expect(f.videoCreditsMonth).toBe(0);
      expect(f.xUrlPostsSoftCapMonth).toBe(0);
      // Anti-churn moats are const-true even in the fail-closed default.
      expect(f.banSafetyManualGate).toBe(true);
      expect(f.attributionEnabled).toBe(true);
    }
  );
});

describe("planFeaturesGtm — status handling (most-restrictive-valid)", () => {
  it("past_due keeps the full active feature set (billing recovery, not a gate)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "gtm99", status: "past_due" }),
    });
    expect(f.status).toBe("past_due");
    expect(f.canResearch).toBe(true);
    expect(f.canDraft).toBe(true);
    expect(f.canAutoPost).toBe(true);
    expect(f.connectedChannelCap).toBe(6);
  });

  it("gtm99 trialing → FULL non-video access; still NO video", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "gtm99", status: "trialing" }),
    });
    expect(f.status).toBe("trialing");
    expect(f.canResearch).toBe(true);
    expect(f.canDraft).toBe(true);
    expect(f.canAutoPost).toBe(true);
    expect(f.autoPostChannelCap).toBeGreaterThan(0);
    expect(f.xUrlPostsSoftCapMonth).toBeGreaterThan(0);
    expect(f.canVideo).toBe(false); // video is studio-only
    expect(f.banSafetyManualGate).toBe(true);
    expect(f.attributionEnabled).toBe(true);
  });

  it("none → fail-closed default", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "gtm99", status: "none" }),
    });
    expect(f.canAutoPost).toBe(false);
    expect(f.canResearch).toBe(true);
  });
});

describe("requireFeatureGtm", () => {
  it("does not throw when feature is true (active auto-post)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: ACTIVE_FULL });
    expect(() =>
      requireFeatureGtm(f, (x) => x.canAutoPost, "auto-post")
    ).not.toThrow();
  });

  it("throws GtmPlanGateError on a gated feature when fail-closed", () => {
    const f = planFeaturesGtm({});
    expect(() =>
      requireFeatureGtm(f, (x) => x.canAutoPost, "auto-post")
    ).toThrow(GtmPlanGateError);
  });

  it("never blocks research even when fail-closed", () => {
    const f = planFeaturesGtm({ gtmPlanJson: "garbage" });
    expect(() =>
      requireFeatureGtm(f, (x) => x.canResearch, "research")
    ).not.toThrow();
  });

  it("does NOT throw on trialing auto-post (trial has full access)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "gtm99", status: "trialing" }),
    });
    expect(() =>
      requireFeatureGtm(f, (x) => x.canAutoPost, "auto-post")
    ).not.toThrow();
  });

  it("throws on auto-post attempt with no subscription (status none)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "gtm99", status: "none" }),
    });
    expect(() =>
      requireFeatureGtm(f, (x) => x.canAutoPost, "auto-post")
    ).toThrow(GtmPlanGateError);
  });
});

describe("requireFeatureGtm — canVideo is the studio tier boundary", () => {
  it("THROWS for active gtm99 (no video)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: ACTIVE_FULL });
    expect(() => requireFeatureGtm(f, (x) => x.canVideo, "video")).toThrow(
      GtmPlanGateError
    );
  });

  it("THROWS for gtm99 trialing (trial doesn't grant video)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "gtm99", status: "trialing" }),
    });
    expect(() => requireFeatureGtm(f, (x) => x.canVideo, "video")).toThrow(
      GtmPlanGateError
    );
  });

  it("THROWS when fail-closed", () => {
    const f = planFeaturesGtm({});
    expect(() => requireFeatureGtm(f, (x) => x.canVideo, "video")).toThrow(
      GtmPlanGateError
    );
  });

  it("does NOT throw for active studio", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STUDIO_FULL });
    expect(() => requireFeatureGtm(f, (x) => x.canVideo, "video")).not.toThrow();
  });

  it("does NOT throw for studio trialing", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "studio", status: "trialing" }),
    });
    expect(() => requireFeatureGtm(f, (x) => x.canVideo, "video")).not.toThrow();
  });
});

describe("requireUnderCapGtm", () => {
  it("allows video usage strictly under the cap (studio)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STUDIO_FULL });
    expect(() => requireUnderCapGtm(f, "videoCreditsMonth", 14)).not.toThrow();
  });

  it("throws at the video cap (studio, fail-closed at the boundary)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STUDIO_FULL });
    expect(() => requireUnderCapGtm(f, "videoCreditsMonth", 15)).toThrow(
      GtmPlanGateError
    );
  });

  it("gtm99 video cap is 0 → blocks the first video", () => {
    const f = planFeaturesGtm({ gtmPlanJson: ACTIVE_FULL });
    expect(() => requireUnderCapGtm(f, "videoCreditsMonth", 0)).toThrow(
      GtmPlanGateError
    );
  });

  it("throws over the cap", () => {
    const f = planFeaturesGtm({ gtmPlanJson: ACTIVE_FULL });
    expect(() =>
      requireUnderCapGtm(f, "autoPostChannelCap", 99)
    ).toThrow(GtmPlanGateError);
  });

  it("blocks the first attempt when cap is 0 (fail-closed default)", () => {
    const f = planFeaturesGtm({});
    expect(() =>
      requireUnderCapGtm(f, "connectedChannelCap", 0)
    ).toThrow(GtmPlanGateError);
  });
});

describe("canPostXUrlGtm — X soft cap", () => {
  it("allows when under the cap", () => {
    const f = planFeaturesGtm({ gtmPlanJson: ACTIVE_FULL });
    expect(canPostXUrlGtm(f, 0)).toBe(true);
    expect(canPostXUrlGtm(f, 29)).toBe(true);
  });

  it("blocks at the cap (fail-closed)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: ACTIVE_FULL });
    expect(canPostXUrlGtm(f, 30)).toBe(false);
  });

  it("blocks over the cap", () => {
    const f = planFeaturesGtm({ gtmPlanJson: ACTIVE_FULL });
    expect(canPostXUrlGtm(f, 31)).toBe(false);
  });

  it("blocks the first post when fail-closed (cap 0)", () => {
    const f = planFeaturesGtm({});
    expect(canPostXUrlGtm(f, 0)).toBe(false);
  });
});

describe("anti-churn moats are NEVER false (parametrized over all states)", () => {
  const allInputs: Array<[string, { gtmPlanJson?: string | null }]> = [
    ["active gtm99", { gtmPlanJson: ACTIVE_FULL }],
    ["active no caps", { gtmPlanJson: planJson({ tier: "gtm99", status: "active" }) }],
    ["active studio", { gtmPlanJson: STUDIO_FULL }],
    ["past_due", { gtmPlanJson: planJson({ tier: "gtm99", status: "past_due" }) }],
    ["trialing", { gtmPlanJson: planJson({ tier: "gtm99", status: "trialing" }) }],
    ["none", { gtmPlanJson: planJson({ tier: "gtm99", status: "none" }) }],
    ["missing field", {}],
    ["null", { gtmPlanJson: null }],
    ["empty", { gtmPlanJson: "" }],
    ["corrupt", { gtmPlanJson: "{bad" }],
    ["unknown tier", { gtmPlanJson: planJson({ tier: "gtm299", status: "active" }) }],
    ["JSON array", { gtmPlanJson: "[]" }],
    ["unknown status", { gtmPlanJson: planJson({ tier: "gtm99", status: "???" }) }],
  ];

  it.each(allInputs)(
    "%s → banSafetyManualGate=true and attributionEnabled=true",
    (_label, agent) => {
      const f = planFeaturesGtm(agent);
      expect(f.banSafetyManualGate).toBe(true);
      expect(f.attributionEnabled).toBe(true);
    }
  );
});
