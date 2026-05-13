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

/* -------------------------------------------------------------------------- */
/* Sprint B.1 — Follow-through protocol (promise-and-stop ban)                 */
/* -------------------------------------------------------------------------- */

describe("generateAgentsMd — Sprint B.1 follow-through protocol", () => {
  // The live failure this section prevents: Kevin 2026-05-12 evening — Maya
  // emitted "Nice—connection is live. Let me take a look at your calendar
  // for the next 2 weeks and get a content plan ready for you. (Give me a
  // few seconds to think through the ideas.)" then stopReason: "stop". Turn
  // ended. No follow-up. The work happened only after the operator nudged.
  it("Follow-through protocol section is present in both embed forms", () => {
    for (const embed of [true, false]) {
      const md = generateAgentsMd({
        ...BASE_INPUTS,
        plan: "manager",
        embedStandingOrders: embed,
      });
      expect(md, `embed=${embed}`).toContain("## Follow-through protocol");
    }
  });

  it("Follow-through protocol enumerates the banned promise-and-stop phrasings", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    // The five canonical banned shapes from the Sprint B.1 brief.
    const bannedShapes = [
      "Give me a few seconds to think through",
      "Let me take a look at",
      "One moment while I",
      "Pulling that up now",
      "Working on it",
    ];
    for (const shape of bannedShapes) {
      expect(md, `missing banned phrasing: ${shape}`).toContain(shape);
    }
    // The terminal-stop reason mention so the model recognizes the failure
    // mode by the runtime signal.
    expect(md).toContain("stopReason");
  });

  it("Follow-through protocol names the 3-step shape of a multi-step turn (read → do → emit)", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    // The shape is enumerated 1./2./3. inside the section.
    const sectionStart = md.indexOf("## Follow-through protocol");
    expect(sectionStart).toBeGreaterThan(0);
    const sectionTail = md.slice(sectionStart);
    expect(sectionTail).toMatch(/1\.\s+Read what's needed/);
    expect(sectionTail).toMatch(/2\.\s+Do the work/);
    expect(sectionTail).toMatch(/3\.\s+Emit ONE final message/);
  });

  it("Follow-through protocol carries the verify-implementation-not-intent rule", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    // Lifted directly from the proactive-agent SKILL.md — the artifact check
    // is the load-bearing piece that keeps Maya honest after each tool call.
    expect(md).toContain("Verify implementation, not intent");
    expect(md).toMatch(/artifact/i);
    expect(md).toContain("publicUrl");
  });

  it("Follow-through protocol points to the proactive-agent ClawHub pin for deeper protocols", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    // The companion ClawHub pin (halthelobster/proactive-agent) ships the
    // full WAL / Working Buffer / Compaction Recovery body. AGENTS.md is the
    // short-form rule; the pin's SKILL.md is the long-form reference.
    expect(md).toContain("halthelobster/proactive-agent");
    expect(md).toMatch(/concepts\/in-flight/);
  });

  it("Follow-through protocol sits adjacent to the iMessage UX block (alongside the silent-abort / no-fake-busy family)", () => {
    // Per the Sprint B.1 brief: "Place it alongside the existing iMessage UX
    // rules / silent-abort rules." The section follows the iMessage UX block
    // so the model reads no-fake-busy → silent-abort → Follow-through in
    // sequence, which is the right reading order for the failure mode.
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    const idxIntegrated = md.indexOf(
      "## You are ONE manager reading an integrated picture"
    );
    const idxImessage = md.indexOf("## iMessage UX rules");
    const idxFollowThrough = md.indexOf("## Follow-through protocol");
    expect(idxIntegrated).toBeGreaterThan(0);
    expect(idxImessage).toBeGreaterThan(idxIntegrated);
    // Follow-through lives after the iMessage block (where no-fake-busy
    // and silent-abort family live) — the rule is the operational companion
    // to those bans.
    expect(idxFollowThrough).toBeGreaterThan(idxImessage);
  });

  it("non-embed form still fits under DEFAULT_BOOTSTRAP_MAX_CHARS after the Follow-through addition", () => {
    const md = generateAgentsMd({
      ...BASE_INPUTS,
      plan: "manager",
      embedStandingOrders: false,
    });
    // Sprint B.1 — we added ~2K to AGENTS.md; non-embed must still fit the
    // 48K cap. If this fails, the cap needs bumping to 56K per the brief.
    expect(md.length).toBeLessThanOrEqual(DEFAULT_BOOTSTRAP_MAX_CHARS);
  });

  // Sibling-file scan: the follow-through enforcement language must also be
  // present in the named standing orders (morning_brief, evening_recap,
  // weekly_review, first_proactive_ping) so the rule fires inside each
  // cron-driven prompt as well as the every-session AGENTS.md context.
  it("named standing orders all carry a Follow-through enforcement sentence", async () => {
    const { STANDING_ORDERS } = await import("../standingOrders");
    const targets = [
      "morning_brief",
      "evening_recap",
      "weekly_review",
      "first_proactive_ping",
    ];
    for (const id of targets) {
      const p = STANDING_ORDERS.find((q) => q.id === id);
      expect(p, `missing standing order: ${id}`).toBeDefined();
      const body = `${p!.scope}\n${p!.cronMessage ?? ""}`;
      expect(
        body,
        `${id}: missing Follow-through enforcement line`
      ).toMatch(/Follow-through enforcement/i);
    }
  });
});
