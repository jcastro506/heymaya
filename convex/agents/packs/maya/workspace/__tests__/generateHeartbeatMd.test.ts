/**
 * generateHeartbeatMd — content + voice tests.
 *
 * Sprint 3 Slice 2 acceptance (original):
 *   - Ordered checks present
 *   - Idle-window guard (10pm-7am + URGENT override)
 *   - Max-1-push rule
 *   - Citation firewall callout
 *   - Anti-sycophancy callout
 *   - Cooldown reference to mayaActionLog
 *   - Telemetry block names the schema fields tick decisions write
 *   - Soft cap respected
 *   - Voice: no banned terms (the word "AI" stays out of agent-readable
 *     prose per CLAUDE.md "no AI in marketing copy" rule extended to
 *     agent-internal docs).
 *
 * Sprint C.4 (2026-05-13) — calendar-scan check moved OFF heartbeat to
 * cron-driven `midday_calendar_check` (11am) + `afternoon_calendar_check`
 * (3pm) standing orders. Reverted HEARTBEAT_SOFT_CAP_CHARS 3_000 → 2_000.
 * Heartbeat ordered-check count back to 12 (was briefly 13 in C.3).
 * Calendar-nudge anchor still in heartbeat playbook as a CROSS-REFERENCE
 * paragraph pointing at the cron standing orders + the native Google
 * Calendar reminder layer.
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

  it("contains all 12 ordered checks under the 'Ordered checks' section (Sprint C.4 — calendar-scan moved to cron)", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("## Ordered checks (stop on first ACT)");
    // Every numbered prefix from 1. through 12. must appear at line-start.
    for (let i = 1; i <= 12; i += 1) {
      const re = new RegExp(`(^|\\n)${i}\\. \\*\\*`);
      expect(re.test(out), `missing ordered check ${i}.`).toBe(true);
    }
    // Sanity: the named topics are all referenced by keyword in the file.
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
      "Wiki mirror sync",
    ];
    for (const topic of requiredTopics) {
      expect(out, `missing topic "${topic}"`).toContain(topic);
    }
    // Sprint C.4 — calendar-scan must NOT be a heartbeat check anymore.
    expect(out).not.toMatch(/^\s*\d+\.\s+\*\*Calendar scan/m);
  });

  it("declares the idle-window guard (10pm-7am) with the URGENT override and named overrides", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("10pm-7am local");
    expect(out).toContain("URGENT");
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
  it("stays under the OpenClaw soft cap (token burn discipline)", () => {
    for (const plan of PLANS) {
      const out = generateHeartbeatMd({ plan });
      expect(
        out.length,
        `${plan}: ${out.length} chars > ${HEARTBEAT_SOFT_CAP_CHARS}`
      ).toBeLessThanOrEqual(HEARTBEAT_SOFT_CAP_CHARS);
    }
  });

  it("HEARTBEAT_SOFT_CAP_CHARS is 2_400 in Sprint C.4 (down from C.3's 3_000)", () => {
    // Sprint C.4 (2026-05-13) — landed at 2_400 after calendar-scan moved off
    // heartbeat to cron-driven standing orders. The Sprint C.3 bump to 3_000
    // was a brief stop on the way to the right architecture; the every-minute
    // calendar check at full LLM invocation didn't survive the unit-economics
    // review. The +400 char delta vs original 2_000 covers the cross-reference
    // paragraph telling Maya where the calendar surface lives now.
    expect(HEARTBEAT_SOFT_CAP_CHARS).toBe(2_400);
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

/* -------------------------------------------------------------------------- */
/* Sprint C.4 — calendar-nudges-on-cron cross-reference                       */
/* -------------------------------------------------------------------------- */

describe("generateHeartbeatMd — Sprint C.4 calendar-nudges-on-cron reference", () => {
  /**
   * The heartbeat playbook stays heartbeat-shaped — calendar nudges left.
   * What stays is a short cross-reference paragraph telling Maya WHERE the
   * calendar surface lives now (cron standing orders + native Google
   * reminders) so she doesn't go looking for a heartbeat check that no
   * longer exists.
   */
  it("calendar-nudges cross-reference paragraph points to the four cron standing orders", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toMatch(/calendar/i);
    expect(out).toContain("`morning_brief`");
    expect(out).toContain("`midday_calendar_check`");
    expect(out).toContain("`afternoon_calendar_check`");
    expect(out).toContain("`evening_recap`");
  });

  it("calendar-nudges cross-reference names the four ticks/day", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toMatch(/4 calendar-aware ticks per day/i);
  });

  it("calendar-nudges cross-reference points at the native Google reminder layer", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toMatch(/`reminders.overrides`|native Google Calendar reminders/i);
  });

  it("Sprint C.4 — no heartbeat-driven calendar-scan check remains", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    // The earlier Sprint C.3 markers must be gone.
    expect(out).not.toContain("preEventNudgeSentAt");
    expect(out).not.toContain("postEventCheckInSentAt");
    expect(out).not.toContain("`entryId='calendar-scan'`");
    expect(out).not.toContain("[now+25m, now+35m]");
    expect(out).not.toContain("[now-65m, now-45m]");
  });

  it("TODO grep — no TODO/FIXME/eslint-disable in heartbeat playbook", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).not.toMatch(/\bTODO\b/);
    expect(out).not.toMatch(/\bFIXME\b/);
    expect(out).not.toMatch(/\/\/\s*eslint-disable/);
  });
});
