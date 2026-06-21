/**
 * Creatify static-creative (Growth $149) gating — the mandatory plan-tier ×
 * action + adversarial coverage for the canImage / assetCreditsMonth surface
 * added alongside the existing canVideo gating. Pure-function tests against
 * planGtm; the server-side hard backstop lives in creatifyVideo.startAssetJob
 * (which consults exactly these helpers, fail-closed).
 */
import { describe, expect, it } from "vitest";
import {
  describePlanForMaya,
  GtmPlanGateError,
  planFeaturesGtm,
  requireUnderCapGtm,
} from "../planGtm";

const json = (o: Record<string, unknown>): string => JSON.stringify(o);

describe("canImage / assetCreditsMonth — plan-tier matrix (fail-closed)", () => {
  it("starter → canImage false, assetCreditsMonth 0 (no Creatify image creative)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: json({ tier: "starter", status: "active" }) });
    expect(f.canImage).toBe(false);
    expect(f.assetCreditsMonth).toBe(0);
  });

  it("growth → canImage true, assetCreditsMonth 50", () => {
    const f = planFeaturesGtm({ gtmPlanJson: json({ tier: "growth", status: "active" }) });
    expect(f.canImage).toBe(true);
    expect(f.assetCreditsMonth).toBe(50);
  });

  it("studio → canImage true, assetCreditsMonth 100 (higher ceiling, on top of video)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: json({ tier: "studio", status: "active" }) });
    expect(f.canImage).toBe(true);
    expect(f.assetCreditsMonth).toBe(100);
    expect(f.canVideo).toBe(true);
  });

  it("legacy gtm99 back-compat → starter → canImage false", () => {
    const f = planFeaturesGtm({ gtmPlanJson: json({ tier: "gtm99", status: "active" }) });
    expect(f.canImage).toBe(false);
    expect(f.assetCreditsMonth).toBe(0);
  });

  it("trialing growth → FULL access → canImage true (trial sees the value)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: json({ tier: "growth", status: "trialing" }) });
    expect(f.canImage).toBe(true);
    expect(f.assetCreditsMonth).toBe(50);
  });
});

describe("canImage — adversarial / fail-closed", () => {
  it.each([
    ["missing plan", undefined],
    ["empty string", ""],
    ["corrupt json", "{not json"],
    ["null json", "null"],
    ["unknown tier", json({ tier: "enterprise", status: "active" })],
    ["status none", json({ tier: "growth", status: "none" })],
    ["missing status", json({ tier: "growth" })],
  ])("%s → canImage false, assetCreditsMonth 0", (_label, raw) => {
    const f = planFeaturesGtm({ gtmPlanJson: raw as string | undefined });
    expect(f.canImage).toBe(false);
    expect(f.assetCreditsMonth).toBe(0);
  });

  it("growth with a corrupt assetCreditsMonth override falls back to the tier default (50)", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: json({ tier: "growth", status: "active", assetCreditsMonth: "lots" }),
    });
    expect(f.assetCreditsMonth).toBe(50);
  });

  it("a negative assetCreditsMonth override is rejected → tier default", () => {
    const f = planFeaturesGtm({
      gtmPlanJson: json({ tier: "growth", status: "active", assetCreditsMonth: -5 }),
    });
    expect(f.assetCreditsMonth).toBe(50);
  });
});

describe("requireUnderCapGtm('assetCreditsMonth') — cap enforcement", () => {
  it("growth allows under the cap, throws at/over it", () => {
    const f = planFeaturesGtm({ gtmPlanJson: json({ tier: "growth", status: "active" }) });
    expect(() => requireUnderCapGtm(f, "assetCreditsMonth", 49)).not.toThrow();
    expect(() => requireUnderCapGtm(f, "assetCreditsMonth", 50)).toThrow(GtmPlanGateError);
    expect(() => requireUnderCapGtm(f, "assetCreditsMonth", 51)).toThrow(GtmPlanGateError);
  });

  it("starter (cap 0) blocks the FIRST asset (fail-closed)", () => {
    const f = planFeaturesGtm({ gtmPlanJson: json({ tier: "starter", status: "active" }) });
    expect(() => requireUnderCapGtm(f, "assetCreditsMonth", 0)).toThrow(GtmPlanGateError);
  });

  it("fail-closed default (no plan) blocks the first asset", () => {
    const f = planFeaturesGtm({ gtmPlanJson: undefined });
    expect(() => requireUnderCapGtm(f, "assetCreditsMonth", 0)).toThrow(GtmPlanGateError);
  });
});

describe("describePlanForMaya — static-image awareness line", () => {
  it("starter says images are not on this tier", () => {
    const s = describePlanForMaya(
      planFeaturesGtm({ gtmPlanJson: json({ tier: "starter", status: "active" }) })
    );
    expect(s).toContain("Static images: not on this tier");
  });

  it("growth surfaces the image allowance", () => {
    const s = describePlanForMaya(
      planFeaturesGtm({ gtmPlanJson: json({ tier: "growth", status: "active" }) })
    );
    expect(s).toContain("Static images: yes, ~50/mo.");
  });

  it("studio surfaces both images and video", () => {
    const s = describePlanForMaya(
      planFeaturesGtm({ gtmPlanJson: json({ tier: "studio", status: "active" }) })
    );
    expect(s).toContain("Static images: yes, ~100/mo.");
    expect(s).toContain("Video: yes, ~15/mo.");
  });
});
