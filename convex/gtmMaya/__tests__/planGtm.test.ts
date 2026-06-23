import { describe, expect, it } from "vitest";
import {
  canPostXUrlGtm,
  describePlanForMaya,
  GtmPlanGateError,
  planFeaturesGtm,
  requireFeatureGtm,
  requireUnderCapGtm,
} from "../planGtm";

/** Build a gtmPlanJson string from a partial plan object. */
function planJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

// $99 starter: up to 3 active channels, everything EXCEPT video.
const STARTER_FULL = planJson({
  tier: "starter",
  status: "active",
  connectedChannelCap: 6,
  autoPostChannelCap: 3,
  xUrlPostsSoftCapMonth: 30,
  periodStart: 1717200000000,
  usage: { autoPostsThisPeriod: 0, xUrlPostsThisPeriod: 0, videosThisPeriod: 0 },
});

// $149 growth: starter + up to 6 active channels. Still no video.
const GROWTH_FULL = planJson({ tier: "growth", status: "active" });

// $199 studio: growth + video.
const STUDIO_FULL = planJson({ tier: "studio", status: "active" });

// Legacy single-$99 tier, must back-compat-resolve to starter.
const LEGACY_GTM99 = planJson({ tier: "gtm99", status: "active" });

describe("planFeaturesGtm — 3-tier maxActiveChannels + video matrix", () => {
  it("starter → maxActiveChannels 3, canVideo false", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
    expect(f.plan).toBe("starter");
    expect(f.status).toBe("active");
    expect(f.maxActiveChannels).toBe(3);
    expect(f.canVideo).toBe(false);
    expect(f.videoCreditsMonth).toBe(0);
  });

  it("growth → maxActiveChannels 6, canVideo false", () => {
    const f = planFeaturesGtm({ gtmPlanJson: GROWTH_FULL });
    expect(f.plan).toBe("growth");
    expect(f.maxActiveChannels).toBe(6);
    expect(f.canVideo).toBe(false);
    expect(f.videoCreditsMonth).toBe(0);
  });

  it("studio → maxActiveChannels 6, canVideo true, videoCreditsMonth > 0", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STUDIO_FULL });
    expect(f.plan).toBe("studio");
    expect(f.maxActiveChannels).toBe(6);
    expect(f.canVideo).toBe(true);
    expect(f.videoCreditsMonth).toBeGreaterThan(0);
  });

  it("fail-closed default → maxActiveChannels 0", () => {
    expect(planFeaturesGtm({}).maxActiveChannels).toBe(0);
    expect(planFeaturesGtm({ gtmPlanJson: "{corrupt" }).maxActiveChannels).toBe(0);
    expect(
      planFeaturesGtm({
        gtmPlanJson: planJson({ tier: "starter", status: "none" }),
      }).maxActiveChannels
    ).toBe(0);
  });

  it("UGC avatar video — canUgc + ugcCreditsMonth only on studio", () => {
    const starter = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
    expect(starter.canUgc).toBe(false);
    expect(starter.ugcCreditsMonth).toBe(0);

    const growth = planFeaturesGtm({ gtmPlanJson: GROWTH_FULL });
    expect(growth.canUgc).toBe(false);
    expect(growth.ugcCreditsMonth).toBe(0);

    const studio = planFeaturesGtm({ gtmPlanJson: STUDIO_FULL });
    expect(studio.canUgc).toBe(true);
    expect(studio.ugcCreditsMonth).toBeGreaterThan(0);

    // Fail-closed: missing / corrupt / none → no UGC budget at all.
    expect(planFeaturesGtm({}).canUgc).toBe(false);
    expect(planFeaturesGtm({}).ugcCreditsMonth).toBe(0);
    expect(
      planFeaturesGtm({ gtmPlanJson: planJson({ tier: "studio", status: "none" }) })
        .canUgc
    ).toBe(false);
  });

  it("legacy gtm99 plan JSON resolves to starter (maxActiveChannels 3)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: LEGACY_GTM99 });
    expect(f.plan).toBe("starter");
    expect(f.maxActiveChannels).toBe(3);
    expect(f.canVideo).toBe(false);
  });
});

describe("planFeaturesGtm — active starter ($99, no video)", () => {
  it("returns all NON-video features true, canVideo false, videoCreditsMonth 0", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
    expect(f.plan).toBe("starter");
    expect(f.status).toBe("active");
    expect(f.canResearch).toBe(true);
    expect(f.canDraft).toBe(true);
    expect(f.canAutoPost).toBe(true);
    expect(f.canRead).toBe(true);
    expect(f.canMonitor).toBe(true);
    // Video is the studio upsell — OFF for starter.
    expect(f.canVideo).toBe(false);
    expect(f.videoCreditsMonth).toBe(0);
    expect(f.banSafetyManualGate).toBe(true);
    expect(f.attributionEnabled).toBe(true);
    expect(f.connectedChannelCap).toBe(6);
    expect(f.autoPostChannelCap).toBe(3);
    expect(f.xUrlPostsSoftCapMonth).toBe(30);
  });

  it("uses fair-use default caps when active plan omits them (video stays 0)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "starter", status: "active" }),
    });
    expect(f.canAutoPost).toBe(true);
    expect(f.connectedChannelCap).toBe(6);
    expect(f.autoPostChannelCap).toBe(3);
    expect(f.videoCreditsMonth).toBe(0);
    expect(f.canVideo).toBe(false);
    expect(f.xUrlPostsSoftCapMonth).toBe(30);
  });

  it("honors explicit fair-use cap overrides from the JSON", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({
        tier: "starter",
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
        tier: "starter",
        status: "active",
        connectedChannelCap: -3,
        autoPostChannelCap: "lots",
        videoCreditsMonth: NaN,
        xUrlPostsSoftCapMonth: null,
      }),
    });
    expect(f.connectedChannelCap).toBe(6);
    expect(f.autoPostChannelCap).toBe(3); // starter base
    expect(f.videoCreditsMonth).toBe(0); // starter base
    expect(f.xUrlPostsSoftCapMonth).toBe(30);
  });
});

describe("planFeaturesGtm — active studio ($199, +video)", () => {
  it("returns everything growth has PLUS canVideo + a video cap", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STUDIO_FULL });
    expect(f.plan).toBe("studio");
    expect(f.status).toBe("active");
    // All the non-video features still on.
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
    ["JSON string literal", { gtmPlanJson: '"starter"' }],
    ["unknown tier", { gtmPlanJson: planJson({ tier: "gtm299", status: "active" }) }],
    ["missing tier", { gtmPlanJson: planJson({ status: "active" }) }],
    ["status none", { gtmPlanJson: planJson({ tier: "starter", status: "none" }) }],
    ["studio status none", { gtmPlanJson: planJson({ tier: "studio", status: "none" }) }],
    ["unknown status", { gtmPlanJson: planJson({ tier: "starter", status: "weird" }) }],
  ];

  it.each(failClosedInputs)(
    "%s → research/draft true, auto-post + video false, caps 0, moats const-true",
    (_label, agent) => {
      const f = planFeaturesGtm(agent);
      expect(f.canResearch).toBe(true);
      expect(f.canDraft).toBe(true);
      expect(f.canAutoPost).toBe(false);
      expect(f.canVideo).toBe(false);
      expect(f.maxActiveChannels).toBe(0);
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
      gtmPlanJson: planJson({ tier: "starter", status: "past_due" }),
    });
    expect(f.status).toBe("past_due");
    expect(f.canResearch).toBe(true);
    expect(f.canDraft).toBe(true);
    expect(f.canAutoPost).toBe(true);
    expect(f.connectedChannelCap).toBe(6);
    expect(f.maxActiveChannels).toBe(3);
  });

  it("starter trialing → FULL non-video access; still NO video", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "starter", status: "trialing" }),
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
      gtmPlanJson: planJson({ tier: "starter", status: "none" }),
    });
    expect(f.canAutoPost).toBe(false);
    expect(f.canResearch).toBe(true);
  });
});

describe("requireFeatureGtm", () => {
  it("does not throw when feature is true (active auto-post)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
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
      gtmPlanJson: planJson({ tier: "starter", status: "trialing" }),
    });
    expect(() =>
      requireFeatureGtm(f, (x) => x.canAutoPost, "auto-post")
    ).not.toThrow();
  });

  it("throws on auto-post attempt with no subscription (status none)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "starter", status: "none" }),
    });
    expect(() =>
      requireFeatureGtm(f, (x) => x.canAutoPost, "auto-post")
    ).toThrow(GtmPlanGateError);
  });
});

describe("requireFeatureGtm — canVideo is the studio tier boundary", () => {
  it("THROWS for active starter (no video)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
    expect(() => requireFeatureGtm(f, (x) => x.canVideo, "video")).toThrow(
      GtmPlanGateError
    );
  });

  it("THROWS for active growth (no video)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: GROWTH_FULL });
    expect(() => requireFeatureGtm(f, (x) => x.canVideo, "video")).toThrow(
      GtmPlanGateError
    );
  });

  it("THROWS for starter trialing (trial doesn't grant video)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: planJson({ tier: "starter", status: "trialing" }),
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

  it("starter video cap is 0 → blocks the first video", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
    expect(() => requireUnderCapGtm(f, "videoCreditsMonth", 0)).toThrow(
      GtmPlanGateError
    );
  });

  it("throws over the cap", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
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
    const f = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
    expect(canPostXUrlGtm(f, 0)).toBe(true);
    expect(canPostXUrlGtm(f, 29)).toBe(true);
  });

  it("blocks at the cap (fail-closed)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
    expect(canPostXUrlGtm(f, 30)).toBe(false);
  });

  it("blocks over the cap", () => {
    const f = planFeaturesGtm({ gtmPlanJson: STARTER_FULL });
    expect(canPostXUrlGtm(f, 31)).toBe(false);
  });

  it("blocks the first post when fail-closed (cap 0)", () => {
    const f = planFeaturesGtm({});
    expect(canPostXUrlGtm(f, 0)).toBe(false);
  });
});

describe("anti-churn moats are NEVER false (parametrized over all states)", () => {
  const allInputs: Array<[string, { gtmPlanJson?: string | null }]> = [
    ["active starter", { gtmPlanJson: STARTER_FULL }],
    ["active growth", { gtmPlanJson: GROWTH_FULL }],
    ["active no caps", { gtmPlanJson: planJson({ tier: "starter", status: "active" }) }],
    ["active studio", { gtmPlanJson: STUDIO_FULL }],
    ["legacy gtm99", { gtmPlanJson: LEGACY_GTM99 }],
    ["past_due", { gtmPlanJson: planJson({ tier: "starter", status: "past_due" }) }],
    ["trialing", { gtmPlanJson: planJson({ tier: "starter", status: "trialing" }) }],
    ["none", { gtmPlanJson: planJson({ tier: "starter", status: "none" }) }],
    ["missing field", {}],
    ["null", { gtmPlanJson: null }],
    ["empty", { gtmPlanJson: "" }],
    ["corrupt", { gtmPlanJson: "{bad" }],
    ["unknown tier", { gtmPlanJson: planJson({ tier: "gtm299", status: "active" }) }],
    ["JSON array", { gtmPlanJson: "[]" }],
    ["unknown status", { gtmPlanJson: planJson({ tier: "starter", status: "???" }) }],
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

describe("describePlanForMaya — human-readable plan awareness", () => {
  it("starter: names the tier + price, the 3-channel allowance, no-video wording, active status, and the Growth/Studio nudge", () => {
    const s = describePlanForMaya(planFeaturesGtm({ gtmPlanJson: STARTER_FULL }));
    expect(s).toContain("Starter plan ($99/mo)");
    expect(s).toContain("active");
    expect(s).toContain("Up to 3 active channels");
    // Video wording — NOT available off Studio.
    expect(s.toLowerCase()).toContain("video: not on this tier");
    expect(s).not.toMatch(/Video: yes/);
    // Upgrade nudge present (Growth = 6 channels; Studio = video).
    expect(s).toContain("Growth unlocks 6 channels");
    expect(s).toContain("Studio");
    // Active plans never tell the founder to start their plan.
    expect(s).not.toContain("NOT ACTIVE");
  });

  it("growth: 6-channel allowance, still no video, Studio-for-video nudge", () => {
    const s = describePlanForMaya(planFeaturesGtm({ gtmPlanJson: GROWTH_FULL }));
    expect(s).toContain("Growth plan ($149/mo)");
    expect(s).toContain("Up to 6 active channels");
    expect(s.toLowerCase()).toContain("video: not on this tier");
    expect(s).toContain("Studio unlocks video");
    expect(s).not.toContain("NOT ACTIVE");
  });

  it("studio: 6 channels + video allowance, top-tier note, no upgrade push", () => {
    const s = describePlanForMaya(planFeaturesGtm({ gtmPlanJson: STUDIO_FULL }));
    expect(s).toContain("Studio plan ($199/mo)");
    expect(s).toContain("Up to 6 active channels");
    // Video IS available — wording asserts the affirmative + the monthly count.
    expect(s).toMatch(/Video: yes, ~15\/mo/);
    expect(s.toLowerCase()).toContain("top tier");
    expect(s).not.toContain("NOT ACTIVE");
  });

  it("fail-closed (missing plan): NOT ACTIVE + the explicit 'start your plan so you can post' note, and 0 active channels", () => {
    const s = describePlanForMaya(planFeaturesGtm({}));
    expect(s).toContain("NOT active");
    expect(s).toContain("NOT ACTIVE");
    expect(s.toLowerCase()).toContain("start their plan so you can post");
    expect(s).toContain("0 right now");
    // Never claims video on the fail-closed default.
    expect(s.toLowerCase()).toContain("video: not on this tier");
  });

  it("fail-closed (status none): same 'start your plan' note", () => {
    const s = describePlanForMaya(
      planFeaturesGtm({ gtmPlanJson: planJson({ tier: "starter", status: "none" }) })
    );
    expect(s).toContain("NOT ACTIVE");
    expect(s.toLowerCase()).toContain("start their plan so you can post");
  });

  it("trialing: full-access wording, never NOT ACTIVE", () => {
    const s = describePlanForMaya(
      planFeaturesGtm({ gtmPlanJson: planJson({ tier: "starter", status: "trialing" }) })
    );
    expect(s.toLowerCase()).toContain("free trial");
    expect(s).toContain("Up to 3 active channels");
    expect(s).not.toContain("NOT ACTIVE");
  });

  it("is pure — same input yields identical output", () => {
    const f = planFeaturesGtm({ gtmPlanJson: GROWTH_FULL });
    expect(describePlanForMaya(f)).toBe(describePlanForMaya(f));
  });
});
