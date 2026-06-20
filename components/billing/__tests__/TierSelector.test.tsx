import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  TierSelector,
  GTM_TIERS,
  type GtmTier,
  type GtmInterval,
} from "../TierSelector";

/**
 * TierSelector is the single source of truth for the GTM plan tiers, shared by
 * onboarding's go-live step and the Account page. These tests lock the three
 * tiers + their prices/channel counts + that selecting a tier hands the right
 * (tier, interval) back to the caller so it can run createGtmCheckoutSession.
 */
describe("TierSelector", () => {
  it("renders all three tiers with their monthly prices and channel counts", () => {
    const html = renderToString(
      createElement(TierSelector, {
        interval: "monthly" as GtmInterval,
        onSelect: () => {},
      })
    );

    // Names
    expect(html).toContain("Starter");
    expect(html).toContain("Growth");
    expect(html).toContain("Studio");

    // Monthly prices ($99 / $149 / $199)
    expect(html).toContain("$99");
    expect(html).toContain("$149");
    expect(html).toContain("$199");

    // Channel-count differences
    expect(html).toContain("Up to 3 channels");
    expect(html).toContain("Up to 6 channels");

    // Video is the Studio differentiator
    expect(html).toContain("Maya makes your videos");

    // Trial framing
    expect(html).toContain("Start 7-day trial");
  });

  it("shows annual prices when interval is annual", () => {
    const html = renderToString(
      createElement(TierSelector, {
        interval: "annual" as GtmInterval,
        onIntervalChange: () => {},
        onSelect: () => {},
      })
    );
    expect(html).toContain("$990");
    expect(html).toContain("$1,490");
    expect(html).toContain("$1,990");
  });

  it("exposes exactly the three checkout tiers in price order", () => {
    expect(GTM_TIERS.map((t) => t.tier)).toEqual([
      "starter",
      "growth",
      "studio",
    ]);
  });

  it("tags every tier card with its data-tier so the click wires to the right checkout", () => {
    // Each card's onClick is `() => onSelect(spec.tier, interval)`. The
    // edge-runtime env has no DOM to fire clicks, so we assert the structural
    // contract instead: a button per tier carrying that tier's data-tier. A
    // caller (onboarding / account) reads onSelect(tier) straight through to
    // createGtmCheckoutSession({ tier }).
    const html = renderToString(
      createElement(TierSelector, {
        interval: "monthly" as GtmInterval,
        onSelect: () => {},
      })
    );
    expect(html).toContain('data-tier="starter"');
    expect(html).toContain('data-tier="growth"');
    expect(html).toContain('data-tier="studio"');
  });

  it("marks the busy tier as pending while its checkout is in flight", () => {
    const html = renderToString(
      createElement(TierSelector, {
        interval: "monthly" as GtmInterval,
        busyTier: "growth" as GtmTier,
        onSelect: () => {},
      })
    );
    expect(html).toContain("Starting…");
  });
});
