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
 * Sprint C.3 additions (2026-05-13):
 *   - `calendar-scan` check present and references the schema surface
 *     (`mayaCalendarEvents`, `preEventNudgeSentAt`, `postEventCheckInSentAt`).
 *   - Pre-event T-30min window + post-event T+45-60min window documented.
 *   - One-ping-max enforcement documented.
 *   - Plan-tier × action: Starter cap (5 pre/wk + 3 post/wk) + Pro/Studio
 *     unlimited; Coach and Manager get the same playbook (autonomy lives
 *     in standing orders, not here — Coach IS the Starter UX in this
 *     internal-naming convention).
 *   - Adversarial windows: bounded — pre-event check guards against firing
 *     on past events (window is forward-looking) and the post-event window
 *     guards against firing on future events (window is backward-looking).
 *   - HEARTBEAT_SOFT_CAP_CHARS bumped 2_000 → 3_000 to absorb the check;
 *     output still ≤ cap.
 *   - TODO grep.
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

  it("contains all ordered checks under the 'Ordered checks' section (Sprint C.3: 13 total after calendar-scan added at #2)", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("## Ordered checks (stop on first ACT)");
    // Every numbered prefix from 1. through 13. must appear at line-start.
    for (let i = 1; i <= 13; i += 1) {
      const re = new RegExp(`(^|\\n)${i}\\. \\*\\*`);
      expect(re.test(out), `missing ordered check ${i}.`).toBe(true);
    }
    // Sanity: the named topics are all referenced by keyword in the file.
    const requiredTopics = [
      "Unread `chatMessages`",
      "Calendar scan", // Sprint C.3 — new check at position 2
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

  it("HEARTBEAT_SOFT_CAP_CHARS export is the Sprint C.3 documented 3_000", () => {
    // Sprint C.3 (2026-05-13) — bumped 2_000 → 3_000 to absorb the
    // calendar-scan check. The bump is documented in the source comment;
    // this lock guards against silent regression of the cap.
    expect(HEARTBEAT_SOFT_CAP_CHARS).toBe(3_000);
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
/* Sprint C.3 — calendar-scan check coverage                                  */
/* -------------------------------------------------------------------------- */

describe("generateHeartbeatMd — Sprint C.3 calendar-scan check", () => {
  /**
   * 1. Sibling-file scan: the playbook depends on Sprint C.1's
   *    `mayaCalendarEvents` schema fields. Lock the surface area here so a
   *    rename in the schema (e.g. preEventNudgeSentAt → preEventPingedAt)
   *    fails this test before it ever reaches a live tick.
   */
  it("calendar-scan check references mayaCalendarEvents + the two timestamp stamps (Sprint C.1 schema)", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out, "missing mayaCalendarEvents table reference").toContain(
      "`mayaCalendarEvents`"
    );
    expect(out, "missing preEventNudgeSentAt field").toContain(
      "preEventNudgeSentAt"
    );
    expect(out, "missing postEventCheckInSentAt field").toContain(
      "postEventCheckInSentAt"
    );
    expect(out, "missing postEventCheckInWaiveReason field").toContain(
      "postEventCheckInWaiveReason"
    );
  });

  /**
   * 2. Adversarial windows: a pre-event nudge must NOT fire on past events
   *    (window is forward-looking — [now+25m, now+35m]) and a post-event
   *    check-in must NOT fire on future events (window is backward-looking
   *    — [now-65m, now-45m]). Lock both windows literally so a regex/typo
   *    flip is caught.
   */
  it("pre-event window is forward-looking (now+25m to now+35m) — never fires on past events", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("[now+25m, now+35m]");
    expect(out).toMatch(/Pre-event T-30/i);
  });

  it("post-event window is backward-looking (now-65m to now-45m) — never fires on future events", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("[now-65m, now-45m]");
    expect(out).toMatch(/Post-event T\+45-60/i);
  });

  /**
   * 3. Adversarial: one-ping-max enforcement documented in playbook text so
   *    Maya doesn't re-fire across ticks. Two acceptable phrasings —
   *    "One-ping-max" header phrasing OR "never re-fire" rule statement.
   */
  it("one-ping-max enforcement documented in playbook text", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toMatch(/(one-ping-max|never re-fire)/i);
  });

  /**
   * 4. Plan-tier × action matrix: Starter cap is named explicitly (5 pre/wk
   *    + 3 post/wk) and Pro/Studio are unlimited. This is gating prose Maya
   *    enforces by reading planFeatures at fire time. The cap on the
   *    Starter tier is the load-bearing line — Pro/Studio surface is
   *    looser by design.
   */
  it("plan-tier caps spelled out: Starter (5 pre/wk + 3 post/wk), Pro/Studio unlimited", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toMatch(/Starter.*5 pre\/wk.*3 post\/wk/i);
    expect(out).toMatch(/Pro\/Studio unlimited/i);
    expect(out, "must reference planFeatures source-of-truth").toContain(
      "`planFeatures`"
    );
  });

  /**
   * 5. Cross-tenant isolation: the scan is documented as per-creator
   *    ("for THIS creatorId"). This locks the playbook prose at the lowest
   *    level — the scan never reads across tenants. The Convex query
   *    (Sprint C.1) carries the same guarantee; this is the agent-side
   *    mirror.
   */
  it("cross-tenant isolation — scan documented as scoped to THIS creator", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toMatch(/THIS\s+`?creatorId`?/i);
  });

  /**
   * 6. Telemetry surface: calendar-scan entries land in mayaActionLog with
   *    entryId='calendar-scan' and the three documented outcomes. Lock the
   *    enum so an HQ dashboard or reporting query can rely on the shape.
   */
  it("calendar-scan telemetry surface (entryId + outcome enum) documented", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("`entryId='calendar-scan'`");
    expect(out).toContain("`pre-event-nudge`");
    expect(out).toContain("`post-event-checkin`");
    expect(out).toContain("`skipped`");
  });

  /**
   * 7. Outbound surface: pings ship through claw-messenger.sendText with
   *    maya-voice-applier. Two tools are named.
   */
  it("outbound tools named: claw-messenger.sendText + maya-voice-applier", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("`claw-messenger.sendText`");
    expect(out).toContain("`maya-voice-applier`");
  });

  /**
   * 8. Self-report waiver path: when the creator already messaged Maya
   *    about the deliverable, the post-event check-in is skipped + stamped
   *    with `postEventCheckInWaiveReason='creator-self-reported'`. Lock
   *    the waiver string so the Sprint C.1 mutation and this playbook stay
   *    in sync.
   */
  it("self-report waiver path documented with the exact reason string", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).toContain("'creator-self-reported'");
  });

  /**
   * 9. TODO grep — Sprint C.3 additions don't introduce TODO/FIXME/
   *    eslint-disable without justification.
   */
  it("TODO grep — Sprint C.3 additions don't introduce TODO/FIXME/eslint-disable", () => {
    const out = generateHeartbeatMd({ plan: "manager" });
    expect(out).not.toMatch(/\bTODO\b/);
    expect(out).not.toMatch(/\bFIXME\b/);
    expect(out).not.toMatch(/\/\/\s*eslint-disable/);
  });
});
