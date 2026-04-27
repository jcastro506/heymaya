/**
 * EmptyState render tests — three stages produce distinct visual treatment.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("renders fresh stage with lime accent", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        stage: "fresh",
        title: "Maya is reading",
        body: "First brief lands at 7am.",
      })
    );
    expect(html).toContain("Maya is reading");
    expect(html).toContain('data-stage="fresh"');
    expect(html).toContain("text-lime");
  });

  it("renders ready stage with paper-dim accent", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        stage: "ready",
        title: "Quiet today",
        body: "No drafts pending.",
      })
    );
    expect(html).toContain('data-stage="ready"');
    expect(html).toContain("text-paper-dim");
  });

  it("renders blocked stage with amber accent", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        stage: "blocked",
        title: "Connect your CRM",
        body: "Maya needs CRM access.",
      })
    );
    expect(html).toContain('data-stage="blocked"');
    expect(html).toContain("text-amber-300");
    expect(html).toContain("border-amber-300/30");
  });

  it("renders CTA when provided", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        stage: "blocked",
        title: "Connect",
        body: "Now",
        cta: { label: "Open profile", href: "/biz/profile" },
      })
    );
    expect(html).toContain("/biz/profile");
    expect(html).toContain("Open profile");
  });
});
