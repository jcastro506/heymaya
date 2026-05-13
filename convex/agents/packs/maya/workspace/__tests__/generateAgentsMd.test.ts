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

  it("renders all 13 doc sections (operating instructions, integrated picture, date discipline, editing fingerprint, tone, platform, standing orders, chat, auto-send, plan-tier, failure modes, connected toolkits, citation)", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    const expected = [
      "## Operating instructions",
      "## You are ONE manager reading an integrated picture",
      "## Date discipline — cite posts by their actual posted date",
      "## Editing fingerprint — mimic THEIR edit, don't impose a template",
      "## Tone modulation",
      "## Platform expertise",
      "## Standing orders",
      "## Free-form chat handling",
      "## Auto-send escalation (brand emails only)",
      "## Plan-tier behavior matrix",
      "## Failure modes & graceful degradation",
      "## Connected toolkits",
      "## Citation discipline",
    ];
    for (const heading of expected) {
      expect(md).toContain(heading);
    }
  });

  // Sprint A.2 — editing fingerprint section content checks.
  it("editing fingerprint section names the schema fields + the citation rule + the confidence bands", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    expect(md).toContain("creatorPicture.editingFingerprint");
    expect(md).toContain("citedPostIds");
    expect(md).toContain("signatureMoves");
    expect(md).toContain("confidence");
    expect(md).toContain("avgCutEverySec");
    // Confidence bands threshold language.
    expect(md).toContain("confidence >= 0.7");
    expect(md).toContain("confidence < 0.4");
    // Forbids generic auto-editor moves when fingerprint is on file.
    expect(md).toMatch(/OpusClip|generic cuts/);
  });

  it("Connected toolkits section names shipping Composio slugs + keeps TikTok on ScrapeCreators", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    // Composio toolkit slugs (uppercase, v3 dashboard naming)
    expect(md).toContain("GMAIL");
    expect(md).toContain("GOOGLECALENDAR");
    expect(md).toContain("LINKEDIN");
    expect(md).toContain("TWITTER");
    expect(md).toContain("Creator TikTok uses ScrapeCreators public data");
    // Plugin name + per-creator entity authentication line
    expect(md).toContain("@composio/openclaw-plugin");
    // Pointer back to the playbook section that owns the full guidance
    expect(md).toContain("playbook.md");
    // Auth-error recovery: existing OAuth lifecycle, NOT a new ad-hoc flow
    expect(md).toContain("integrations.composio.oauth.startOAuth");
  });

  it("requires stored ScrapeCreators metrics before performance claims", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    expect(md).toContain("Convex is the durable record");
    expect(md).toContain("stored `posts` + `postMetrics` first");
    expect(md).toContain("I never estimate views");
    expect(md).toContain("ScrapeCreators refresh");
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

/* -------------------------------------------------------------------------- */
/* Sprint 12 Phase 1A — integrated-picture re-frame + date discipline           */
/* -------------------------------------------------------------------------- */

describe("generateAgentsMd — Sprint 12 Phase 1A", () => {
  it("integrated-picture rule frames Maya as ONE manager reading USER.md, NOT a stack of if-then rules", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: true,
    });
    expect(md).toContain("ONE manager reading an integrated picture");
    expect(md).toContain("Read. Think. Respond.");
    // Anti-rule guidance is explicit.
    expect(md).toContain("No hardcoded thresholds");
    expect(md).toMatch(/days_since_last_post\s*>\s*30/);
    // The "what a friend asks" framing is present.
    expect(md).toMatch(/like a person reading their notes/i);
  });

  it("date discipline rule lists banned vs acceptable post-recency framings", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: true,
    });
    expect(md).toContain("Date discipline");
    expect(md).toContain("yesterday");
    expect(md).toContain("Banned framings");
    expect(md).toContain("Acceptable framings");
    // Concrete examples from the operator's brief.
    expect(md).toContain("Feb 4");
    expect(md).toContain("couple months back");
  });

  it("date discipline references the synth's date arrays (appearanceDates / citationPostDates) so Maya knows where the data is", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: true,
    });
    expect(md).toContain("appearanceDates");
    expect(md).toContain("citationPostDates");
  });

  it("pleasantries clarification keeps warm closings ALLOWED while still banning forced template signoffs", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: true,
    });
    // Operator-confirmed: pleasantries are kept. Real warmth = good.
    expect(md).toContain("Pleasantries are FINE");
    expect(md).toContain("Piccadilly");
    // Forced template signoffs still called out.
    expect(md).toMatch(/Have a great day|Stay awesome|Talk soon/);
  });

  it("integrated-picture rule sits before the iMessage UX rules so the framing carries through every send", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: true,
    });
    const idxIntegrated = md.indexOf(
      "## You are ONE manager reading an integrated picture"
    );
    const idxImessage = md.indexOf(
      "## iMessage UX rules"
    );
    expect(idxIntegrated).toBeGreaterThan(0);
    expect(idxImessage).toBeGreaterThan(idxIntegrated);
  });
});
