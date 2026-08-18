/**
 * Three things about the landing page that broke silently, or nearly did, and
 * are not visible in a screenshot.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LANDING = readFileSync(
  join(process.cwd(), "app/clawlaunch/page.tsx"),
  "utf8",
);
const SPEC = readFileSync(
  join(process.cwd(), "docs/CLEAN_SHEET_SPEC.md"),
  "utf8",
);

/** The CSS that ships inside the JSX template literal in `PageStyles`. */
function styleBlock(): string {
  const fn = LANDING.slice(LANDING.indexOf("function PageStyles("));
  return fn.slice(fn.indexOf("{`") + 2, fn.indexOf("`}"));
}

describe("the stylesheet survives being a template literal", () => {
  it("⚠️ contains no backtick — it would terminate the string", () => {
    /**
     * Broke the build TWICE in one sitting, both times from a CSS *comment*
     * that quoted a property name in backticks the way the rest of this
     * codebase does. Inside <style>{`…`}</style> a backtick ends the literal,
     * so the remaining CSS is parsed as TypeScript and the errors point at
     * whatever brace comes next — never at the quote that caused it.
     *
     * Cheap to prevent, expensive to diagnose, and invisible to review.
     */
    expect(styleBlock()).not.toContain("`");
  });
});

describe("one section per screen actually engages", () => {
  it("⭐ snaps mandatory, not proximity", () => {
    /**
     * Shipped as `proximity` and reported as "still not snapping". Every other
     * value was already right — the root element was the scroller and carried
     * scroll-snap-type, and every section carried scroll-snap-align: start —
     * so strictness was the only variable left.
     *
     * Proximity only engages when a scroll happens to come to REST near a snap
     * point, which under trackpad momentum essentially never happens. It is
     * not a gentler snap; it is usually no snap at all.
     */
    const css = styleBlock();
    // The DECLARATIONS, not the prose — the comment above them explains why
    // proximity was wrong, and that explanation is worth keeping.
    const declared = [...css.matchAll(/scroll-snap-type:\s*([^;]+);/g)].map(
      (m) => m[1].trim(),
    );
    // "none" is the reduced-motion override, and belongs here.
    expect(declared).toContain("y mandatory");
    expect(declared.filter((d) => d !== "none")).toEqual(["y mandatory"]);
    expect(css).toContain("scroll-snap-align: start");
  });

  it("⚠️ stays off for anyone who asked for less motion", () => {
    // Snapping moves the page further than the reader asked it to move, which
    // is exactly what prefers-reduced-motion is about.
    expect(styleBlock()).toContain("prefers-reduced-motion");
  });
});

describe("the price on the page is the price in the spec", () => {
  it("⭐ matches the MVP tier, whatever the spec currently says", () => {
    /**
     * ⚠️ The landing page advertised $99 while §17.2.7 had settled on one tier
     * at $149 — and §17.4 argues the low anchor directly: at ~$45 blended COGS
     * a double-digit price lands near 55% margin and "anchors the product as a
     * tool" rather than an employee.
     *
     * Read from the spec rather than hardcoded, so this test tracks a repricing
     * instead of having to be updated by the person doing it.
     */
    const mvp = SPEC.slice(SPEC.indexOf("**MVP — one tier:**"));
    const priceRow = /\|\s*\*\*Price\*\*\s*\|(.+?)\|/.exec(mvp.slice(0, 900));
    expect(priceRow, "spec no longer states an MVP price").not.toBeNull();

    const price = /\$([\d,]+)/.exec(priceRow![1])![1];
    expect(LANDING).toContain(`$${price}`);
  });

  it("⚠️ states no OTHER dollar figure that could be read as the price", () => {
    /**
     * The $300 anchor is a creator's invoice, deliberately kept. Anything else
     * with a dollar sign on this page is a second number a visitor has to
     * reconcile, and the one that got stale last time was a leftover.
     */
    const mvp = SPEC.slice(SPEC.indexOf("**MVP — one tier:**"));
    const price = /\$([\d,]+)/.exec(
      /\|\s*\*\*Price\*\*\s*\|(.+?)\|/.exec(mvp.slice(0, 900))![1],
    )![1];

    const figures = new Set(
      [...LANDING.matchAll(/\$(\d[\d,]*)/g)].map((m) => m[1]),
    );
    expect([...figures].sort()).toEqual([price, "300"].sort());
  });
});
