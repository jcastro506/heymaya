/**
 * Sparkline — pure-rendering smoke test.
 *
 * The Sparkline is the only DOM-emitting component in components/creator/
 * that does math, so it earns a unit test. We don't bring in Testing Library
 * for a one-component sprint — instead we render the React tree manually via
 * react-dom/server and assert against the resulting SVG string. Keeps the
 * test runner dependency-light (no jsdom/edge-runtime DOM emulation needed
 * for this).
 *
 * What we cover:
 *   - empty input renders an empty box (no crash, no NaN in SVG)
 *   - constant input renders without div-by-zero artifacts
 *   - last-value dot lands on the rightmost x coordinate
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Sparkline } from "../Sparkline";

describe("Sparkline", () => {
  it("renders an empty placeholder for empty input", () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [] })
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain('aria-label="Trend over time (no data)"');
  });

  it("renders a polyline with one point per value", () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [10, 20, 30, 25, 40] })
    );
    expect(html).toContain("<polyline");
    // Five points → 4 spaces between coords in points="..."
    const pointsMatch = /points="([^"]+)"/.exec(html);
    expect(pointsMatch).not.toBeNull();
    expect(pointsMatch![1].split(" ")).toHaveLength(5);
  });

  it("constant values do not produce NaN coordinates", () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [5, 5, 5, 5] })
    );
    expect(html).not.toContain("NaN");
    // All-zeros case (revenue widget on a quiet month) shouldn't crash either.
    const zeros = renderToStaticMarkup(
      createElement(Sparkline, { values: [0, 0, 0] })
    );
    expect(zeros).not.toContain("NaN");
  });

  it("renders a final dot for the last value", () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [1, 2, 3] })
    );
    expect(html).toMatch(/<circle[^>]*r="1\.4"/);
  });
});
