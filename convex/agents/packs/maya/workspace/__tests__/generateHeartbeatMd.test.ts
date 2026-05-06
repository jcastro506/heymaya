/**
 * generateHeartbeatMd — content + voice tests.
 *
 * Sprint 3 Slice 2 acceptance:
 *   - 11 ordered checks present
 *   - Idle-window guard (10pm-7am + URGENT override)
 *   - Max-1-push rule
 *   - Citation firewall callout
 *   - Anti-sycophancy callout
 *   - Cooldown reference to mayaActionLog
 *   - Telemetry block names the schema fields tick decisions write
 *   - Soft cap: ≤ 2K chars
 *   - Voice: no banned terms (the word "AI" stays out of agent-readable
 *     prose per CLAUDE.md "no AI in marketing copy" rule extended to
 *     agent-internal docs per Sprint 3 Slice 2 brief).
 */

import { describe, it, expect } from "vitest";
import {
  generateHeartbeatMd,
  HEARTBEAT_SOFT_CAP_CHARS,
} from "../generateHeartbeatMd";

const PLANS = ["coach", "manager"] as const;

describe("generateHeartbeatMd — content shape", () => {
  it("emits an H1 HEARTBEAT.md heading", () => {
    for (const plan of PLANS) {
      const out = generateHeartbeatMd({ plan });
      expect(out.startsWith("# HEARTBEAT.md")).toBe(true);
    }
  });

  it("contains all 11 ordered checks under the 'Ordered checks' section", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("## Ordered checks (stop on first ACT)");
    // Every numbered prefix from 1. through 11. must appear at line-start.
    for (let i = 1; i <= 11; i += 1) {
      const re = new RegExp(`(^|\\n)${i}\\. \\*\\*`);
      expect(re.test(out), `missing ordered check ${i}.`).toBe(true);
    }
    // Sanity: the 11 named topics are all referenced by keyword in the file.
    const requiredTopics = [
      "Unread `chatMessages`",
      "Past-due `contentPlans`",
      "Post-outlier",
      "Brand-email triage",
      "Niche + trend scan",
      "Competitor pull",
      "Comment triage",
      "Calendar peek",
      "Opportunity scout",
      "Collab matchmaker",
      "Industry intel",
    ];
    for (const topic of requiredTopics) {
      expect(out, `missing topic "${topic}"`).toContain(topic);
    }
  });

  it("declares the idle-window guard (10pm-7am) with the URGENT override and named overrides", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("Idle 10pm-7am");
    expect(out).toContain("URGENT");
    // The two URGENT overrides spelled out in the brief: post-crash + paid-deal-pending.
    expect(out).toContain("0.3× baseline");
    expect(out).toContain("paid-deal-pending");
  });

  it("declares the max-1-push rule explicitly", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toMatch(/Max\s*1\s*push\s*per\s*tick/i);
  });

  it("declares the citation-firewall rule explicitly", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toMatch(/citation firewall/i);
  });

  it("declares the anti-sycophancy posture", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toMatch(/anti-sycophancy/i);
  });

  it("instructs Maya to honor cooldowns via mayaActionLog", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("`mayaActionLog`");
    expect(out).toMatch(/cooldown/i);
  });

  it("includes a telemetry block naming the four tick-decision fields", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("## Telemetry");
    expect(out).toContain("`entryId`");
    expect(out).toContain("`outcome`");
    expect(out).toContain("`pushed`");
    expect(out).toContain("`tickKind`");
  });

  it("references the per-check cooldowns called out in the spec (60m / 30m / 6h / 12h / 7d)", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    // 60min for outlier, 30min for brand-email, 6h for niche/competitor/comment,
    // 12h for calendar/opportunity/industry, 7d for collab.
    expect(out).toContain("60m cd");
    expect(out).toContain("30m cd");
    expect(out).toContain("6h cd");
    expect(out).toContain("12h cd");
    expect(out).toContain("7d cd");
  });
});

describe("generateHeartbeatMd — soft cap", () => {
  it("stays under the OpenClaw 2K-char soft cap (token burn discipline)", () => {
    for (const plan of PLANS) {
      const out = generateHeartbeatMd({ plan });
      expect(
        out.length,
        `${plan}: ${out.length} chars > ${HEARTBEAT_SOFT_CAP_CHARS}`
      ).toBeLessThanOrEqual(HEARTBEAT_SOFT_CAP_CHARS);
    }
  });

  it("HEARTBEAT_SOFT_CAP_CHARS export is the documented 2_000", () => {
    expect(HEARTBEAT_SOFT_CAP_CHARS).toBe(2_000);
  });
});

describe("generateHeartbeatMd — voice fixture", () => {
  // The agent-readable HEARTBEAT.md should not refer to Maya as "AI." The
  // SOUL.md / AGENTS.md backbone positions her as a manager. The brief
  // explicitly extends the marketing-copy rule to this file.
  const BANNED_TERMS = [
    /\bAI\b/, // capitalized acronym — covers "AI manager", "AI tool", etc.
    /\bartificial intelligence\b/i,
    /\bchatbot\b/i,
    /\bbot\b/i,
    // Anti-sycophancy guards — pattern phrases that historically slip in.
    /\bamazing work!/i,
    /\bgreat job!/i,
  ];

  it("does not contain banned voice terms (no 'AI', no chatbot, no sycophant phrases)", () => {
    for (const plan of PLANS) {
      const out = generateHeartbeatMd({ plan });
      for (const banned of BANNED_TERMS) {
        expect(
          banned.test(out),
          `${plan}: HEARTBEAT.md contains banned voice term ${banned}`
        ).toBe(false);
      }
    }
  });
});

describe("generateHeartbeatMd — determinism", () => {
  it("identical inputs yield identical output (pure function)", () => {
    const a = generateHeartbeatMd({ plan: "manager" });
    const b = generateHeartbeatMd({ plan: "manager" });
    expect(a).toBe(b);
  });

  it("Coach and Manager get the same checklist (autonomy lives in standing orders, not here)", () => {
    const coach = generateHeartbeatMd({ plan: "coach" });
    const manager = generateHeartbeatMd({ plan: "manager" });
    expect(coach).toBe(manager);
  });
});
