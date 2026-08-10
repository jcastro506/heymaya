/**
 * The generated rung — the rules that must hold without a vendor.
 *
 * §2.7 is "grounded or silent", extended to images: *"never a fabricated UI, an
 * invented metric, or a fake testimonial."* A generated screenshot is the
 * single most damaging thing this rung could produce — it looks like evidence,
 * it is indistinguishable from the real thing at a glance, and it would sit on
 * the founder's own account making a claim about their own product.
 */

import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_SUBJECTS,
  IMAGE_COST_USD,
  parseDataUrl,
  sanitiseBrief,
} from "../imagery";
import { detectImageType } from "../media";
import { ASSET_RANK } from "../assetFloor";

describe("sanitiseBrief", () => {
  it("passes an ordinary background brief", () => {
    expect(sanitiseBrief("a quiet desk at night, one lamp, laptop closed").ok).toBe(
      true
    );
  });

  /**
   * ⭐ A model can be talked into a dashboard by an innocent-sounding brief.
   * The prompt forbids it; this is what makes the rule hold when the prompt
   * doesn't.
   */
  it("refuses a brief that asks for something resembling evidence", () => {
    for (const brief of [
      "a screenshot of the export screen",
      "a clean dashboard showing growth",
      "a chart showing 40% more signups",
      "a testimonial card from a happy customer",
    ]) {
      const check = sanitiseBrief(brief);
      expect(check.ok, `should have refused: ${brief}`).toBe(false);
      expect(check.matched).toBeTruthy();
    }
  });

  it("names what tripped it, so the refusal can be explained", () => {
    // "I won't draw that" is unarguable; naming the subject lets the founder
    // correct the brief instead.
    expect(sanitiseBrief("a dashboard at sunset").matched).toBe("dashboard");
  });

  it("is case-insensitive", () => {
    expect(sanitiseBrief("A DASHBOARD").ok).toBe(false);
  });

  it("covers the fabricated-evidence families §2.7 names", () => {
    const joined = FORBIDDEN_SUBJECTS.join(" ");
    for (const family of ["screenshot", "dashboard", "testimonial", "chart"]) {
      expect(joined, `no rule covers ${family}`).toContain(family);
    }
  });
});

describe("parseDataUrl", () => {
  it("reads the base64 payload off the first image", () => {
    const out = parseDataUrl([
      { image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
    expect(out).toEqual({ mime: "image/jpeg", data: "AAAA" });
  });

  it("skips entries with no url rather than failing the whole response", () => {
    const out = parseDataUrl([
      {},
      { image_url: {} },
      { image_url: { url: "data:image/png;base64,BBBB" } },
    ]);
    expect(out?.data).toBe("BBBB");
  });

  it("returns null when nothing usable came back", () => {
    // The caller turns this into a named failure. A plain background is the
    // fallback, so an empty generation costs quality, never the post.
    expect(parseDataUrl([])).toBeNull();
    expect(parseDataUrl([{ image_url: { url: "https://not-a-data-url" } }])).toBeNull();
  });
});

describe("detectImageType", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...Array(12).fill(0)]);

  /**
   * ⚠️ Measured 2026-08-10: the image model returned **JPEG**, not PNG.
   *
   * The guard originally demanded PNG, which would have rejected every
   * generated background as "not an image" — a legitimate file failing a
   * format check reads as a broken generator.
   */
  it("accepts the formats a platform will take", () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(detectImageType(bytes(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(
      detectImageType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
      )
    ).toBe("image/webp");
  });

  /**
   * ⭐ The reason the check exists at all: an SSO redirect or a JSON error
   * stored as an image publishes as a broken post, and the failure surfaces on
   * the platform hours later rather than here.
   */
  it("rejects a web page pretending to be an image", () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html><head>");
    expect(detectImageType(html)).toBeNull();
    const json = new TextEncoder().encode('{"error":"unauthorized"}');
    expect(detectImageType(json)).toBeNull();
  });

  it("rejects something too short to identify", () => {
    expect(detectImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("the authenticity floor still holds", () => {
  /**
   * ⭐ This rung must never outrank something real.
   *
   * §7.5.3's ordering only works if a generated asset says what it is —
   * `backgroundFor` labels it `generated_background`, and that label is
   * meaningless unless it ranks below `product_screenshot` here.
   */
  it("ranks a generated background below a real screenshot", () => {
    expect(ASSET_RANK.indexOf("generated_background")).toBeGreaterThan(
      ASSET_RANK.indexOf("product_screenshot")
    );
    expect(ASSET_RANK.indexOf("generated_background")).toBeGreaterThan(
      ASSET_RANK.indexOf("founder_footage")
    );
  });
});

describe("cost", () => {
  it("carries the measured price, not the one §7.5.4a assumed", () => {
    // §7.5.4a compared a per-image figure to a per-set one and landed on $0.03.
    // Measured is $0.039 — the difference is ~30% on the only rung that costs
    // anything, so it matters for the tier maths.
    expect(IMAGE_COST_USD).toBeCloseTo(0.039, 3);
  });
});
