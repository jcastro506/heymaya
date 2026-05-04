/**
 * generateAgentsMd — pure-logic unit tests.
 *
 * Coverage:
 *   - Determinism: same inputs twice → identical output.
 *   - Plan-tier gating: Starter does NOT include any "pro+" standing orders
 *     (e.g. brand_email_triage, competitor_watch, calendar_lookahead).
 *   - Bootstrap-cap respect: when `embedStandingOrders: false`, AGENTS.md
 *     fits under 12K. The standalone `standing-orders.md` document
 *     contains every program for the tier.
 *   - Every standing-order behavior gets a program block in the embedded
 *     form (or the standalone document when split).
 *   - Canonical 4-part format: every program has Scope / Triggers /
 *     Approval gates / Escalation rules.
 */

import { describe, it, expect } from "vitest";
import {
  generateAgentsMd,
  renderStandingOrdersDocument,
  DEFAULT_BOOTSTRAP_MAX_CHARS,
} from "../generateAgentsMd";
import { STANDING_ORDERS, standingOrdersForPlan } from "../standingOrders";

const BASE_INPUTS = {
  creatorDisplayName: "Test Creator",
  handles: [
    { platform: "tiktok", handle: "@testcreator" },
    { platform: "instagram", handle: "@testcreator" },
  ],
};

describe("generateAgentsMd", () => {
  it("is deterministic for identical inputs", () => {
    const a = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    const b = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    expect(a).toBe(b);
  });

  it("starter plan excludes every pro+ standing-order title", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "coach",
      embedStandingOrders: true,
    });
    const proOnly = STANDING_ORDERS.filter((p) => p.tier === "manager");
    expect(proOnly.length).toBeGreaterThan(0);
    for (const p of proOnly) {
      expect(md).not.toContain(`### ${p.title}`);
    }
  });

  it("pro plan includes every standing-order program inline when embedded", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: true,
    });
    for (const p of STANDING_ORDERS) {
      expect(md).toContain(`### ${p.title}`);
    }
  });

  it("non-embedded form fits under default bootstrap cap", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    expect(md.length).toBeLessThanOrEqual(DEFAULT_BOOTSTRAP_MAX_CHARS);
  });

  it("non-embedded form references standing-orders.md", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    expect(md).toContain("`standing-orders.md`");
  });

  it("renders all 9 doc sections (operating instructions, tone, platform, standing orders, chat, auto-send, plan-tier, failure modes, citation)", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    const expected = [
      "## Operating instructions",
      "## Tone modulation",
      "## Platform expertise",
      "## Standing orders",
      "## Free-form chat handling",
      "## Auto-send escalation (brand emails only)",
      "## Plan-tier behavior matrix",
      "## Failure modes & graceful degradation",
      "## Citation discipline",
    ];
    for (const heading of expected) {
      expect(md).toContain(heading);
    }
  });

  it("weaves creator-specific identifiers (display name, plan, handles) into the header", () => {
    const md = generateAgentsMd({
      creatorDisplayName: "Jane Doe",
      plan: "manager",
      handles: [{ platform: "youtube", handle: "@janedoe" }],
      embedStandingOrders: false,
    });
    expect(md).toContain("Jane Doe");
    expect(md).toContain("Manager");
    expect(md).toContain("youtube: @janedoe");
  });

  it("falls back gracefully when no handles are provided", () => {
    const md = generateAgentsMd({
      creatorDisplayName: "Jane Doe",
      plan: "coach",
      handles: [],
      embedStandingOrders: false,
    });
    expect(md).toContain("(no handles connected yet)");
  });
});

describe("renderStandingOrdersDocument", () => {
  it("emits one program per tier-allowed standing order", () => {
    const doc = renderStandingOrdersDocument("coach");
    const allowed = standingOrdersForPlan("coach");
    for (const p of allowed) {
      expect(doc).toContain(`### ${p.title}`);
    }
    // Pro-only programs do not appear in the Starter document.
    const proOnly = STANDING_ORDERS.filter((p) => p.tier === "manager");
    for (const p of proOnly) {
      expect(doc).not.toContain(`### ${p.title}`);
    }
  });

  it("every program in the document has all 4 canonical labels", () => {
    const doc = renderStandingOrdersDocument("manager");
    const programs = standingOrdersForPlan("manager");
    for (const p of programs) {
      // After the program title, the next 4 bold labels must appear in
      // canonical order. We assert each substring is present somewhere
      // after the title in the document.
      const idx = doc.indexOf(`### ${p.title}`);
      expect(idx).toBeGreaterThanOrEqual(0);
      const tail = doc.slice(idx);
      expect(tail).toMatch(/\*\*Scope\.\*\*/);
      expect(tail).toMatch(/\*\*Triggers\.\*\*/);
      expect(tail).toMatch(/\*\*Approval gates\.\*\*/);
      expect(tail).toMatch(/\*\*Escalation rules\.\*\*/);
    }
  });

  it("is deterministic for the same plan", () => {
    const a = renderStandingOrdersDocument("manager");
    const b = renderStandingOrdersDocument("manager");
    expect(a).toBe(b);
  });
});
