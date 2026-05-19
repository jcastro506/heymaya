/**
 * standingOrders — Sprint B.1 follow-through enforcement coverage.
 *
 * Sprint B.1 added a one-sentence Follow-through enforcement line to the
 * standing orders most likely to confab the "promise + stop" pattern:
 *   - first_proactive_ping (Day 1 first-touch)
 *   - morning_brief        (8:30am)
 *   - evening_recap        (6pm signal-conditional)
 *   - weekly_review        (Sunday 9pm)
 *
 * The five mandatory test categories applied here:
 *   1. Cross-tenant isolation — the catalog is shared infra; assert no
 *      creatorId / clerkUserId / per-tenant string leaks.
 *   2. Plan-tier × action — these patterns are ungated (tier='all') so the
 *      enforcement language fires for both Coach and Manager.
 *   3. Adversarial — the catalog ban list lives in the markdown; assert the
 *      banned phrasings the operator briefed are present so the model sees
 *      them at session-start.
 *   4. Sibling-file scan — the named standing orders agree with the AGENTS.md
 *      protocol section (also tested in generateAgentsMd.test.ts).
 *   5. TODO grep — the catalog body must not carry TODO/FIXME/eslint-disable.
 */

import { describe, it, expect } from "vitest";
import {
  STANDING_ORDERS,
  standingOrdersForPlan,
  type StandingOrderProgram,
} from "../standingOrders";
import { BUNDLED_SKILLS } from "../skillsRegistry";

const NAMED_TARGETS = [
  "morning_brief",
  "evening_recap",
  "weekly_review",
  "first_proactive_ping",
] as const;

/**
 * Sprint C.2 — three standing orders teach Maya to materialize calendar
 * events via the `maya-calendar-planner` skill (Sprint C.1 ships the skill
 * + the `mayaCalendarEvents` table + the cap-enforcing internal mutation).
 * These tests cover the 5 mandatory categories for the calendar-creation
 * additions only — the B.1 follow-through suite above stays untouched.
 */
const C2_CALENDAR_TARGETS = [
  "weekly_content_plan",
  "trend_watcher",
  "post_publish_reaction",
] as const;

/**
 * The 8 canonical event kinds defined by Sprint C.1 in `mayaCalendarEvents`.
 * Any kind referenced in a standing order MUST be one of these — fabricating
 * a 9th kind is an adversarial failure mode (the planner skill would reject
 * the insert, but the prose must not even suggest it).
 */
const C1_EVENT_KINDS = [
  "trend-strike",
  "content-block",
  "post-publish",
  "niche-scroll",
  "comment-window",
  "brand-outbox",
  "weekly-review",
  "brain-break",
] as const;

function pickById(id: string): StandingOrderProgram {
  const p = STANDING_ORDERS.find((q) => q.id === id);
  if (!p) throw new Error(`missing standing order: ${id}`);
  return p;
}

function bodyOf(p: StandingOrderProgram): string {
  return `${p.scope}\n${p.cronMessage ?? ""}`;
}

describe("standingOrders — Sprint B.1 follow-through enforcement", () => {
  it("named promise-and-stop-prone standing orders all carry a Follow-through enforcement sentence", () => {
    for (const id of NAMED_TARGETS) {
      const p = pickById(id);
      const body = bodyOf(p);
      expect(body, `${id}: missing Follow-through enforcement`).toMatch(
        /Follow-through enforcement/i
      );
    }
  });

  it("Follow-through enforcement language calls out a banned promise-shape per order", () => {
    // Each enforcement sentence names at least one concrete banned phrasing
    // tied to that order's surface (the kickstart's "let me pull a trend",
    // morning_brief's "let me look at your day", evening_recap's "give me a
    // sec to check signals", weekly_review's "let me plan next week").
    const expectations: Record<string, RegExp> = {
      morning_brief:
        /(let me look at your day|give me a sec to scan|pulling that up now)/i,
      evening_recap:
        /(let me wrap up the day|give me a sec to check signals)/i,
      weekly_review:
        /(let me plan next week|give me a sec to look at the week)/i,
      first_proactive_ping:
        /(let me pull a trend|give me a sec to find something)/i,
    };
    for (const [id, re] of Object.entries(expectations)) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: enforcement does not name a banned shape`).toMatch(re);
    }
  });

  it("plan-tier × action — Follow-through enforcement fires for BOTH Coach and Manager (these are all tier='all')", () => {
    for (const id of NAMED_TARGETS) {
      const p = pickById(id);
      expect(p.tier, `${id}: should be tier='all' so the rule reaches Coach`).toBe(
        "all"
      );
    }
    // And the rule actually ships in both plans' rendered list.
    for (const plan of ["coach", "manager"] as const) {
      const programs = standingOrdersForPlan(plan);
      for (const id of NAMED_TARGETS) {
        const p = programs.find((q) => q.id === id);
        expect(p, `${plan}: missing ${id}`).toBeDefined();
        expect(bodyOf(p!)).toMatch(/Follow-through enforcement/i);
      }
    }
  });

  it("cross-tenant isolation — the standing-orders catalog carries NO per-tenant identifiers", () => {
    // Shared infra: same prose for every Maya. Catch accidental creatorId /
    // clerkUserId / Convex k_ id leaks the way the pin manifest test does.
    for (const p of STANDING_ORDERS) {
      const body = `${p.id}\n${p.title}\n${p.scope}\n${p.triggers}\n${p.approvalGates}\n${p.escalation}\n${p.cronMessage ?? ""}`;
      expect(body, `${p.id} leaks creatorId`).not.toMatch(/creatorId\s*[:=]\s*['"]/);
      expect(body, `${p.id} leaks clerkUserId`).not.toMatch(/clerkUserId/);
      expect(body, `${p.id} leaks a Convex k_ id`).not.toMatch(/\bk_[a-z0-9]{10,}/);
    }
  });

  it("adversarial — Sprint B.1 enforcement adds the operator-briefed banned phrasings to the cronMessage surface so they're seen at every cron tick", () => {
    // The model reads the cronMessage as the prompt at fire time. The banned
    // shapes need to be visible there, not just buried in AGENTS.md.
    for (const id of NAMED_TARGETS) {
      const p = pickById(id);
      const cron = p.cronMessage ?? "";
      // morning_brief / evening_recap / weekly_review are kind:"cron"; the
      // body must carry the Follow-through line directly. first_proactive_ping
      // is kind:"event" — the rule lives in scope, not cronMessage.
      if (p.kind === "cron") {
        expect(cron, `${id} cronMessage missing Follow-through enforcement`).toMatch(
          /Follow-through enforcement/i
        );
      } else {
        expect(p.scope, `${id} scope missing Follow-through enforcement`).toMatch(
          /Follow-through enforcement/i
        );
      }
    }
  });

  it("TODO grep — Sprint B.1 additions don't introduce TODO/FIXME/eslint-disable without justification", () => {
    for (const p of STANDING_ORDERS) {
      const body = `${p.scope}\n${p.cronMessage ?? ""}`;
      expect(body, `${p.id} carries TODO`).not.toMatch(/\bTODO\b/);
      expect(body, `${p.id} carries FIXME`).not.toMatch(/\bFIXME\b/);
      expect(body, `${p.id} carries // eslint-disable`).not.toMatch(
        /\/\/\s*eslint-disable/
      );
    }
  });

  it("sibling-file scan — Follow-through enforcement sentence references the Sprint name so the catalog stays traceable", () => {
    // Lock the audit trail: the enforcement line carries "Sprint B.1" so a
    // future sweep can grep the marker across AGENTS.md + standing orders.
    for (const id of NAMED_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: enforcement missing Sprint B.1 marker`).toMatch(
        /Sprint B\.1/
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint C.3 — morning_brief calendar-weave coverage                          */
/* -------------------------------------------------------------------------- */

/**
 * Sprint C.3 (2026-05-13) added a "Calendar weave" sub-section to the
 * `morning_brief` standing order's scope. The brief must:
 *   - Read today's `mayaCalendarEvents` BEFORE composing.
 *   - Window is 8:30am-11:59pm LOCAL in `creators.timezone`.
 *   - Surface events inline alongside performance + email signals (not as
 *     a separate bullet block).
 *   - Never fabricate events when the day is empty.
 *
 * The five mandatory categories applied:
 *   1. Cross-tenant isolation — the catalog stays per-creator-scoped (no
 *      hardcoded ids leak through the new sub-section).
 *   2. Plan-tier × action — calendar-weave fires for both Coach + Manager
 *      (morning_brief is tier='all').
 *   3. Adversarial — fabrication ban + window-bound language explicit.
 *   4. Sibling-file scan — references `mayaCalendarEvents` (Sprint C.1
 *      schema) + `creators.timezone` (existing schema).
 *   5. TODO grep — handled by the existing block above.
 */
describe("standingOrders — Sprint C.3 morning_brief calendar weave", () => {
  it("morning_brief.scope carries the Sprint C.3 Calendar-weave sub-section", () => {
    const p = pickById("morning_brief");
    expect(p.scope, "calendar weave header missing").toMatch(
      /Calendar weave \(Sprint C\.3\)/
    );
  });

  it("calendar-weave reads today's mayaCalendarEvents BEFORE composing the brief", () => {
    const scope = pickById("morning_brief").scope;
    expect(scope).toMatch(/BEFORE composing, READ today's `mayaCalendarEvents`/);
  });

  it("calendar-weave window semantics: 8:30am-11:59pm LOCAL in creators.timezone", () => {
    const scope = pickById("morning_brief").scope;
    // Sprint 12.6 / Sprint C.3 — never compare a UTC instant directly to a
    // local-hour rule. The brief explicitly cites both the window and the
    // tz source-of-truth.
    expect(scope, "window string missing").toContain("8:30am-11:59pm LOCAL");
    expect(scope, "tz source missing").toContain("`creators.timezone`");
    expect(scope, "tz-conversion rule missing").toMatch(
      /never compare a UTC instant directly to a local-hour rule/
    );
  });

  it("calendar-weave fabrication ban — 'do NOT fabricate' is explicit when no events today", () => {
    const scope = pickById("morning_brief").scope;
    // Anti-confabulation, mirrors the Sprint 12.7 trend-fabrication
    // lesson. Filler ban also called out so a no-event day doesn't pad
    // with "no events today" template tells.
    expect(scope, "fabrication ban missing").toMatch(/do NOT fabricate/);
    expect(scope, "filler ban missing").toMatch(/do NOT pad with "no events today" filler/);
  });

  it("calendar-weave plan-tier × action — fires for BOTH Coach and Manager (morning_brief is tier='all')", () => {
    for (const plan of ["coach", "manager"] as const) {
      const programs = standingOrdersForPlan(plan);
      const p = programs.find((q) => q.id === "morning_brief");
      expect(p, `${plan}: morning_brief missing`).toBeDefined();
      expect(p!.scope, `${plan}: missing calendar weave`).toMatch(
        /Calendar weave \(Sprint C\.3\)/
      );
    }
  });

  it("calendar-weave sibling-file scan — references mayaCalendarEvents (Sprint C.1 schema) without leaking creator-specific ids", () => {
    const p = pickById("morning_brief");
    const scope = p.scope;
    expect(scope, "Sprint C.1 schema ref missing").toContain(
      "`mayaCalendarEvents`"
    );
    // Cross-tenant: the new sub-section carries no leaked creator-specific id.
    expect(scope, "calendar weave leaks creatorId").not.toMatch(
      /creatorId\s*[:=]\s*['"]/
    );
    expect(scope, "calendar weave leaks clerkUserId").not.toMatch(/clerkUserId/);
    expect(scope, "calendar weave leaks Convex k_ id").not.toMatch(
      /\bk_[a-z0-9]{10,}/
    );
  });

  it("calendar-weave bullet-salad ban — events surface inline, not as a separate bullet block", () => {
    const scope = pickById("morning_brief").scope;
    expect(scope, "inline-integration rule missing").toMatch(
      /integrate them inline with the loudest signal/i
    );
    expect(scope, "no-bullet-salad reference missing").toMatch(
      /no bullet salad still applies/i
    );
  });
});

describe("standingOrders — Sprint C.2 calendar-creation wiring", () => {
  it("the three named standing orders all carry a Calendar creation sub-section marked Sprint C.2", () => {
    // Audit-trail marker: a future sweep can grep `Sprint C.2` to find the
    // exact prose that teaches the planner-skill invocation pattern.
    for (const id of C2_CALENDAR_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing Calendar creation sub-section`).toMatch(
        /Calendar creation \(Sprint C\.2/i
      );
    }
  });

  it("the three named standing orders reference the `maya-calendar-planner` skill by name", () => {
    for (const id of C2_CALENDAR_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing maya-calendar-planner reference`).toMatch(
        /maya-calendar-planner/
      );
    }
  });

  it("plan-tier × action — weekly_content_plan states the right caps for content-block + post-publish kinds (Assistant 1+3/wk, Manager 2+unlimited)", () => {
    const body = bodyOf(pickById("weekly_content_plan"));
    // Cap matrix mirrors C.1's mayaCalendarEvents enforcement.
    expect(body).toMatch(/Assistant.*1\s*`?content-block`?\/?week/i);
    expect(body).toMatch(/Assistant.*3\s*`?post-publish`?\/?week/i);
    expect(body).toMatch(/Manager.*2\s*`?content-block`?\/?week/i);
    expect(body).toMatch(/Manager.*unlimited\s*`?post-publish`?/i);
  });

  it("plan-tier × action — trend_watcher states the right caps for trend-strike (Assistant 1/wk, Manager 3/wk)", () => {
    const body = bodyOf(pickById("trend_watcher"));
    expect(body).toMatch(/Assistant\s*=\s*1\s*`?trend-strike`?\/?week/i);
    expect(body).toMatch(/Manager\s*=\s*3\s*`?trend-strike`?\/?week/i);
  });

  it("plan-tier × action — post_publish_reaction states the right caps for comment-window (Assistant 1/wk, Manager 3/wk)", () => {
    const body = bodyOf(pickById("post_publish_reaction"));
    expect(body).toMatch(/Assistant\s*=\s*1\s*`?comment-window`?\/?week/i);
    expect(body).toMatch(/Manager\s*=\s*3\s*`?comment-window`?\/?week/i);
  });

  it("plan-tier × action — the three calendar-creating standing orders all stay tier='all' so caps reach Coach + Manager from the same prose", () => {
    // Both tiers see the standing order; the per-kind caps inside the prose
    // are what differentiate Coach (Assistant) and Manager. Tier itself must
    // NOT gate the standing order off Coach — the cap matrix is the gate.
    for (const id of C2_CALENDAR_TARGETS) {
      const p = pickById(id);
      expect(p.tier, `${id}: should be tier='all' so the cap rule reaches Coach`).toBe(
        "all"
      );
    }
    for (const plan of ["coach", "manager"] as const) {
      const programs = standingOrdersForPlan(plan);
      for (const id of C2_CALENDAR_TARGETS) {
        const found = programs.find((q) => q.id === id);
        expect(found, `${plan}: missing ${id}`).toBeDefined();
        expect(bodyOf(found!)).toMatch(/Calendar creation \(Sprint C\.2/i);
      }
    }
  });

  it("cross-tenant isolation — Sprint C.2 calendar prose carries no per-tenant identifiers", () => {
    // The prose is shared infra: same standing-order text for every Maya.
    // The per-creator binding happens at the planner-skill invocation layer
    // (via the creatorId on the actual Convex call), never in the catalog.
    for (const id of C2_CALENDAR_TARGETS) {
      const p = pickById(id);
      const body = `${p.id}\n${p.title}\n${p.scope}\n${p.triggers}\n${p.approvalGates}\n${p.escalation}\n${p.cronMessage ?? ""}`;
      expect(body, `${id} leaks creatorId literal`).not.toMatch(/creatorId\s*[:=]\s*['"]/);
      expect(body, `${id} leaks clerkUserId`).not.toMatch(/clerkUserId/);
      expect(body, `${id} leaks a Convex k_ id`).not.toMatch(/\bk_[a-z0-9]{10,}/);
    }
  });

  it("adversarial — the three standing orders only reference event kinds from C.1's 8-kind catalog (no fabricated 9th kind)", () => {
    // The planner skill would reject an unknown kind, but the prose itself
    // must not even suggest one. Scan for the pattern `<word>-<word>` event-
    // kind shapes near the word "event" and assert each is in the allowlist.
    for (const id of C2_CALENDAR_TARGETS) {
      const body = bodyOf(pickById(id));
      // Pull every `kind-word` pattern that appears with the suffix " event" or
      // inside backticks adjacent to "event" / "kind". Conservatively scan all
      // backticked tokens of the form `<word>-<word>` and check membership.
      const candidates = body.match(/`([a-z]+-[a-z]+)`/g) ?? [];
      for (const tok of candidates) {
        const inner = tok.slice(1, -1);
        // Filter to things that look like calendar-event kinds (two-segment,
        // lowercase, no slash). Drop API paths / table names / hyphenated
        // descriptors that aren't event kinds.
        const looksLikeEventKind =
          /^[a-z]+-[a-z]+$/.test(inner) &&
          !inner.startsWith("lc-") &&
          !inner.includes("/") &&
          ![
            "format-not", "kitchen-counter", "walking-monologue", "handheld-pov",
            "tone-adjusted", "post-publish", "anti-niches", "side-hustle",
            "full-time", "follow-through", "promise-and",
          ].includes(inner);
        if (!looksLikeEventKind) continue;
        // If it does look like an event-kind shape, it must be in the C.1 catalog.
        if (
          (C1_EVENT_KINDS as ReadonlyArray<string>).includes(inner) ||
          // Allow general descriptors that are obviously NOT event kinds.
          false
        ) {
          continue;
        }
        // Stricter check: only enforce membership when the candidate appears
        // in a context that names it as an event kind (preceded/followed by
        // "event" within ~30 chars). Otherwise let it through — it's a
        // descriptive phrase, not an event kind.
        const idx = body.indexOf(tok);
        const window = body.slice(Math.max(0, idx - 30), idx + tok.length + 30);
        if (/\bevent\b|\bkind[s]?\b/i.test(window)) {
          expect(
            (C1_EVENT_KINDS as ReadonlyArray<string>).includes(inner),
            `${id}: prose references unknown event kind \`${inner}\` — not in C.1's 8-kind catalog`
          ).toBe(true);
        }
      }
    }
  });

  it("adversarial — the three standing orders do not override C.1's plan-tier cap matrix with a different cap (defer to server-side enforcement)", () => {
    // The prose must not invent a NEW cap shape (e.g. \"5 per day\") that
    // would diverge from C.1's `listMayaCalendarEventsForCreatorAndWindow`.
    // The only cap-language allowed is per-week, mirroring the planner skill.
    for (const id of C2_CALENDAR_TARGETS) {
      const body = bodyOf(pickById(id));
      // Look for the "Plan-tier caps" anchor — any cap line under it should
      // be per-week, not per-day / per-month / per-hour.
      const idx = body.indexOf("Plan-tier caps");
      if (idx < 0) continue;
      const tail = body.slice(idx, idx + 600);
      expect(tail, `${id}: cap matrix uses non-weekly granularity`).not.toMatch(
        /\/\s*day\b|\/\s*hour\b|\/\s*month\b|\bper\s+day\b|\bper\s+hour\b|\bper\s+month\b/i
      );
    }
  });

  it("adversarial — the three standing orders explicitly forbid fabricating event kinds", () => {
    // Prose-level guardrail: each addition states the 8-kind allowlist is
    // exhaustive. Mirrors the AGENTS.md no-fabrication contract for trends.
    for (const id of C2_CALENDAR_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing no-fabrication clause for event kinds`).toMatch(
        /(only.*(trend-strike|content-block|post-publish|comment-window).*exist|never.*(invent|fabricate|make up).*(kind|event))/i
      );
    }
  });

  it("sibling-file scan — the three standing orders reference `mayaCalendarEvents` (C.1's table) OR the planner skill that wraps it", () => {
    // The standing orders must point at C.1's surface — either the table
    // name directly or the planner skill that brokers writes to it. This
    // is the catalog's contract that C.1's schema actually exists.
    for (const id of C2_CALENDAR_TARGETS) {
      const body = bodyOf(pickById(id));
      const referencesC1Surface =
        /maya-calendar-planner/.test(body) || /mayaCalendarEvents/.test(body);
      expect(
        referencesC1Surface,
        `${id}: missing reference to maya-calendar-planner skill or mayaCalendarEvents table`
      ).toBe(true);
    }
  });

  it("sibling-file scan — the three standing orders reference the gap-finder endpoint `/lc_maya/calendar_list_events` (existing C.1 dependency)", () => {
    // C.2's "never book over an existing event" rule depends on a real
    // pre-check call. The endpoint already exists in `convex/http.ts`.
    for (const id of C2_CALENDAR_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing /lc_maya/calendar_list_events pre-check`).toMatch(
        /\/lc_maya\/calendar_list_events/
      );
    }
  });

  it("sibling-file scan — the planner skill is bundled (Sprint C.1 dependency check; soft-skipped until C.1 lands)", () => {
    // C.1 ships `maya-calendar-planner` into BUNDLED_SKILLS. Until C.1 lands
    // this assertion can't be enforced, so we soft-skip when the slug is
    // missing — but if C.1 has landed, the slug MUST be present to validate
    // the cross-file invariant.
    const slugs = BUNDLED_SKILLS.map((s) => s.slug);
    const present = slugs.includes("maya-calendar-planner");
    if (!present) {
      // C.1 not landed yet — log and skip without failing.
      // eslint-disable-next-line no-console
      console.warn(
        "[Sprint C.2 sibling-file scan] maya-calendar-planner not yet in BUNDLED_SKILLS — C.1 must land before this invariant is enforceable"
      );
      return;
    }
    expect(present, "maya-calendar-planner must ship in BUNDLED_SKILLS once C.1 lands").toBe(
      true
    );
  });

  it("TODO grep — Sprint C.2 additions don't introduce TODO/FIXME/eslint-disable", () => {
    for (const id of C2_CALENDAR_TARGETS) {
      const p = pickById(id);
      const body = `${p.scope}\n${p.cronMessage ?? ""}`;
      expect(body, `${id} carries TODO`).not.toMatch(/\bTODO\b/);
      expect(body, `${id} carries FIXME`).not.toMatch(/\bFIXME\b/);
      expect(body, `${id} carries // eslint-disable`).not.toMatch(
        /\/\/\s*eslint-disable/
      );
    }
  });

  it("Sprint C.2 additions enforce the 30-minute popup reminder convention for actionable events", () => {
    // C.1's planner-skill templates set reminders.overrides. The standing
    // orders that book actionable events (content-block, trend-strike,
    // comment-window) all state the 30min popup explicitly so a future
    // regression that drops the field is caught by sibling-file scan.
    for (const id of C2_CALENDAR_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing 30-minute popup reminder convention`).toMatch(
        /30\s*min(?:ute)?s?\s*(?:popup\s*)?reminder|reminders.*30.*popup|popup.*30/i
      );
    }
  });

  it("Sprint C.2 additions teach Maya to call `/lc_maya/calendar_list_events` BEFORE booking (gap-finder discipline)", () => {
    // The "never book over an existing event" rule needs to be operational,
    // not aspirational. Each standing order must explicitly order the call
    // before the insert.
    for (const id of C2_CALENDAR_TARGETS) {
      const body = bodyOf(pickById(id));
      // The gap-finder language must precede or accompany the booking word.
      expect(body, `${id}: missing gap-finder before-booking discipline`).toMatch(
        /(before\s+book|first.*calendar_list_events|calendar_list_events.*(before|first))/i
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint C.4 — midday + afternoon calendar-check cron entries                */
/*                                                                            */
/* The Sprint C.3 calendar-scan check briefly lived on heartbeat (every-min). */
/* Sprint C.4 moves it to two cron-driven standing orders to keep COGS sane:  */
/*   - midday_calendar_check  (11am local)                                    */
/*   - afternoon_calendar_check (3pm local)                                   */
/* Combined with morning_brief (8:30am) + evening_recap (6pm), 4 calendar-aware */
/* ticks per day carry the nudge surface. These tests cover the 5 mandatory  */
/* categories for the two new entries.                                        */
/* -------------------------------------------------------------------------- */

const C4_CALENDAR_TICK_TARGETS = [
  "midday_calendar_check",
  "afternoon_calendar_check",
] as const;

describe("standingOrders — Sprint C.4 cron-driven calendar nudge ticks", () => {
  function pickById(id: string): StandingOrderProgram {
    const entry = STANDING_ORDERS.find((o) => o.id === id);
    if (!entry) throw new Error(`Standing order ${id} not found`);
    return entry;
  }

  function bodyOf(o: StandingOrderProgram): string {
    return `${o.scope}\n${o.cronMessage ?? ""}\n${o.triggers ?? ""}\n${o.escalation ?? ""}`;
  }

  it("both new entries exist with kind='cron' (not heartbeat)", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const entry = pickById(id);
      expect(entry.kind, `${id}: must be kind='cron'`).toBe("cron");
      expect(entry.cronEntryId, `${id}: cronEntryId must match id`).toBe(id);
      expect(entry.defaultCron, `${id}: must declare a defaultCron`).toMatch(
        /^\d+\s+\d+\s+\*\s+\*\s+\*$/
      );
    }
  });

  it("midday_calendar_check fires at 11am local", () => {
    const entry = pickById("midday_calendar_check");
    expect(entry.defaultCron).toBe("0 11 * * *");
  });

  it("afternoon_calendar_check fires at 3pm local", () => {
    const entry = pickById("afternoon_calendar_check");
    expect(entry.defaultCron).toBe("0 15 * * *");
  });

  it("plan-tier × action — both entries are tier='all' (Starter + Manager both get the surface; cap is enforced per-tier inside scope)", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const entry = pickById(id);
      expect(entry.tier, `${id}: tier must be 'all'`).toBe("all");
    }
  });

  it("plan-tier caps documented — Starter weekly cap across all four ticks (5 pre + 3 post)", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing Starter weekly cap`).toMatch(
        /Starter.*5\s*pre.*3\s*post/i
      );
      expect(body, `${id}: must reference planFeatures or weekly cap`).toMatch(
        /Pro\/Studio\s+unlimited/i
      );
    }
  });

  it("adversarial — one-ping-max enforcement documented (sidecar stamps prevent re-fire)", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing one-ping-max language`).toMatch(
        /(one-ping-max|ONE PING MAX|never re-fire)/i
      );
      // Sidecar stamps must be named — these are the C.1 schema surface.
      expect(body, `${id}: missing preEventNudgeSentAt sidecar field`).toContain(
        "preEventNudgeSentAt"
      );
      expect(body, `${id}: missing postEventCheckInSentAt sidecar field`).toContain(
        "postEventCheckInSentAt"
      );
    }
  });

  it("adversarial — both windows are bounded (pre-event forward-looking, post-event backward-looking)", () => {
    // Midday: pre window is now → 6pm local; post window is 7am → now.
    const midday = bodyOf(pickById("midday_calendar_check"));
    expect(midday).toMatch(/today after now.*6pm/i);
    expect(midday).toMatch(/since 7am today/i);

    // Afternoon: pre window is now → 10pm local; post window is 11am → now.
    const afternoon = bodyOf(pickById("afternoon_calendar_check"));
    expect(afternoon).toMatch(/now through 10pm/i);
    expect(afternoon).toMatch(/between 11am and now/i);
  });

  it("adversarial — self-report waiver path documented with exact reason string ('creator-self-reported')", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing self-report waiver`).toContain(
        "creator-self-reported"
      );
    }
  });

  it("TZ discipline — both entries explicitly require converting timestamps to creator.timezone before window comparison", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing TZ discipline`).toMatch(
        /(creators?.timezone|convert.*timezone|TZ discipline)/i
      );
      expect(body, `${id}: must warn against direct UTC-to-local comparison`).toMatch(
        /(never compare.*UTC|LOCAL.*never|forbidden.*UTC)/i
      );
    }
  });

  it("outbound surface — both entries name claw-messenger.sendText + maya-voice-applier", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing claw-messenger.sendText`).toContain(
        "`claw-messenger.sendText`"
      );
      expect(body, `${id}: missing maya-voice-applier`).toContain(
        "`maya-voice-applier`"
      );
    }
  });

  it("cross-tenant isolation — scan documented as scoped to THIS creator (per-creator only)", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing THIS creator scoping`).toMatch(
        /THIS\s+`?creatorId`?/i
      );
    }
  });

  it("sibling-file scan — entries reference mayaCalendarEvents (Sprint C.1 schema)", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing mayaCalendarEvents reference`).toContain(
        "`mayaCalendarEvents`"
      );
    }
  });

  it("Sprint B.1 follow-through enforcement language is present (no fake-busy stalls)", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing B.1 follow-through enforcement`).toMatch(
        /Follow-through enforcement.*Sprint\s*B\.1/i
      );
    }
  });

  it("silence-when-empty semantics — both entries return silently when both windows are empty (no \"nothing to check\" filler)", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: missing silence-when-empty rule`).toMatch(
        /silent\s+if\s+both\s+windows\s+(are\s+)?empty/i
      );
    }
  });

  it("TODO grep — Sprint C.4 additions don't introduce TODO/FIXME/eslint-disable without justification", () => {
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const body = bodyOf(pickById(id));
      expect(body, `${id}: stray TODO`).not.toMatch(/\bTODO\b/);
      expect(body, `${id}: stray FIXME`).not.toMatch(/\bFIXME\b/);
      expect(body, `${id}: stray eslint-disable`).not.toMatch(
        /\/\/\s*eslint-disable/
      );
    }
  });

  it("Sprint C.4 marker — both entries reference the Sprint number in source comments", () => {
    // The source-level comments anchor the architecture decision so future
    // refactors don't accidentally move these back onto heartbeat.
    for (const id of C4_CALENDAR_TICK_TARGETS) {
      const entry = pickById(id);
      // Title carries the human-readable purpose.
      expect(entry.title, `${id}: title must mention calendar`).toMatch(
        /calendar/i
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint C.5 — first-week calendar bootstrap (event-driven, one-shot)         */
/*                                                                            */
/* Problem this fixes: the Sunday `weekly_content_plan` cron (Sun 4pm local)  */
/* is the steady-state engine that populates next week's calendar. A creator  */
/* who onboards Tuesday waits 5+ days for that first cron, so their first-    */
/* week-with-Maya calendar is empty. The new event-driven standing order      */
/* `first_week_calendar_bootstrap` fills the gap: it fires ONCE post-         */
/* calendar-OAuth, conversationally sketches the rest of this week + next     */
/* week via the maya-calendar-planner skill, and stamps                       */
/* `firstWeekCalendarBootstrappedAt` so it does not re-fire on subsequent     */
/* calendar reconnects.                                                       */
/*                                                                            */
/* The five mandatory categories applied here:                                */
/*   1. Cross-tenant isolation — per-creator scope (the cursor lives on       */
/*      `creators`; no shared global state).                                  */
/*   2. Plan-tier × action — tier='all'; cap matrix mirrors C.1 inside scope. */
/*   3. Adversarial — null editingFingerprint path (asks alignment), no-gaps  */
/*      path (single weekly-review only), declined-plan path (stamp anyway).  */
/*   4. Sibling-file scan — references maya-calendar-planner skill, the       */
/*      `firstWeekCalendarBootstrappedAt` cursor, and the C.1 endpoint        */
/*      `/lc_maya/calendar_list_events`.                                      */
/*   5. TODO grep — handled below.                                            */
/* -------------------------------------------------------------------------- */

describe("standingOrders — Sprint C.5 first-week calendar bootstrap", () => {
  const TARGET_ID = "first_week_calendar_bootstrap";

  function pickEntry(): StandingOrderProgram {
    const entry = STANDING_ORDERS.find((o) => o.id === TARGET_ID);
    if (!entry) throw new Error(`Standing order ${TARGET_ID} not found`);
    return entry;
  }

  function bodyOfEntry(o: StandingOrderProgram): string {
    return `${o.scope}\n${o.cronMessage ?? ""}\n${o.triggers ?? ""}\n${o.approvalGates ?? ""}\n${o.escalation ?? ""}`;
  }

  it("the entry exists and is event-driven (kind='event', tier='all')", () => {
    const entry = pickEntry();
    expect(entry.kind, "first_week_calendar_bootstrap: must be kind='event'").toBe(
      "event"
    );
    expect(
      entry.tier,
      "first_week_calendar_bootstrap: must be tier='all' so the rule reaches both Coach and Manager"
    ).toBe("all");
    // No defaultCron / cronEntryId — this is purely event-driven.
    expect(
      entry.defaultCron,
      "first_week_calendar_bootstrap: event-driven, no defaultCron"
    ).toBeUndefined();
    expect(
      entry.cronEntryId,
      "first_week_calendar_bootstrap: event-driven, no cronEntryId"
    ).toBeUndefined();
  });

  it("trigger references `calendarConnectionCompletedAt` AND the `firstWeekCalendarBootstrappedAt` dedupe cursor", () => {
    const entry = pickEntry();
    // The trigger MUST name both: the event that fires it AND the cursor that
    // dedupes it. Drift on either side breaks the one-shot semantics.
    expect(entry.triggers).toContain("calendarConnectionCompletedAt");
    expect(entry.triggers).toContain("firstWeekCalendarBootstrappedAt");
  });

  it("schema-dedupe assertion — scope text references `firstWeekCalendarBootstrappedAt` so a future schema rename fails this test loudly", () => {
    // Sibling-file scan: the cursor name lives in BOTH the schema
    // (`convex/schema.ts:creators.firstWeekCalendarBootstrappedAt`) AND the
    // standing-order prose. A rename in one place without the other is the
    // exact regression this assertion catches.
    const body = bodyOfEntry(pickEntry());
    expect(
      body,
      "first_week_calendar_bootstrap: scope must reference `firstWeekCalendarBootstrappedAt` (schema cursor)"
    ).toContain("firstWeekCalendarBootstrappedAt");
  });

  it("plan-tier × action — the entry ships in BOTH Coach and Manager plans (tier='all' + present in standingOrdersForPlan output)", () => {
    for (const plan of ["coach", "manager"] as const) {
      const programs = standingOrdersForPlan(plan);
      const found = programs.find((p) => p.id === TARGET_ID);
      expect(
        found,
        `${plan}: first_week_calendar_bootstrap must be in standingOrdersForPlan output`
      ).toBeDefined();
    }
  });

  it("plan-tier × action — cap matrix mirrors C.1 (Starter caps content-block + post-publish + niche-scroll + comment-window + weekly-review; Pro/Studio unlimited)", () => {
    const body = bodyOfEntry(pickEntry());
    // The cap line names the exact tier shapes from C.1 and the 5 caps the
    // brief locked. Drift on any of these is a regression — the planner skill
    // enforces server-side so prose-level drift would produce a confusing
    // mismatch where Maya proposes the plan and the planner silently rejects.
    expect(body).toMatch(/Starter.*1\s*`?content-block`?\/?week/i);
    expect(body).toMatch(/Starter.*3\s*`?post-publish`?\/?week/i);
    expect(body).toMatch(/Starter.*1\s*`?niche-scroll`?\/?day/i);
    expect(body).toMatch(/Starter.*1\s*`?comment-window`?\/?week/i);
    expect(body).toMatch(/Starter.*1\s*`?weekly-review`?/i);
    expect(body).toMatch(/Pro\/Studio.*unlimited/i);
  });

  it("cross-tenant isolation — the standing-order text carries NO per-tenant identifiers", () => {
    // Shared infra: same prose for every Maya. Same isolation check as the
    // other catalog entries — no creatorId / clerkUserId / Convex k_ id leaks.
    const entry = pickEntry();
    const body = `${entry.id}\n${entry.title}\n${entry.scope}\n${entry.triggers}\n${entry.approvalGates}\n${entry.escalation}\n${entry.cronMessage ?? ""}`;
    expect(body, "first_week_calendar_bootstrap leaks creatorId literal").not.toMatch(
      /creatorId\s*[:=]\s*['"]/
    );
    expect(body, "first_week_calendar_bootstrap leaks clerkUserId").not.toMatch(
      /clerkUserId/
    );
    expect(body, "first_week_calendar_bootstrap leaks a Convex k_ id").not.toMatch(
      /\bk_[a-z0-9]{10,}/
    );
  });

  it("adversarial — null/low-confidence editingFingerprint path asks an alignment question instead of forcing a plan", () => {
    // Mirror weekly_content_plan's divergence handling. Without an
    // editingFingerprint anchor, the proposed style would be unfounded —
    // ask the creator what they want first instead of inventing a plan.
    const entry = pickEntry();
    const escalation = entry.escalation;
    expect(
      escalation,
      "first_week_calendar_bootstrap: must handle null/low-confidence editingFingerprint with an alignment question"
    ).toMatch(/editingFingerprint.*null|confidence\s*<\s*0\.5/i);
    expect(
      escalation,
      "first_week_calendar_bootstrap: must ASK alignment question on null fingerprint"
    ).toMatch(/ASK|alignment\s+question/i);
  });

  it("adversarial — no-gaps path (zero open gaps in next 14 days) proposes a single weekly-review event only", () => {
    // The planner skill cap-rejection contract: if calendar is wall-to-wall
    // for 14d, don't try to cram filming in — propose only the self-renewing
    // weekly-review event so the standard cron loop picks up from next Sunday.
    const entry = pickEntry();
    const escalation = entry.escalation;
    expect(escalation).toMatch(/zero\s+open\s+gaps|no\s+open\s+gaps|wall-to-wall/i);
    expect(escalation).toMatch(/single\s+`?weekly-review`?/i);
  });

  it("adversarial — declined-plan path stamps the cursor anyway so the standing order does NOT re-fire on subsequent reconnects", () => {
    const entry = pickEntry();
    const escalation = entry.escalation;
    expect(escalation).toMatch(/declin.*plan|let me think about it/i);
    expect(
      escalation,
      "first_week_calendar_bootstrap: declined plan must still stamp the cursor"
    ).toMatch(/stamp.*firstWeekCalendarBootstrappedAt/);
  });

  it("adversarial — first-boot-not-complete path defers to the kickstart's content_plan_initial beat", () => {
    // If firstBootCompletedAt is undefined, the kickstart's content_plan_initial
    // beat owns the calendar surface during onboarding. The bootstrap waits.
    const entry = pickEntry();
    const escalation = entry.escalation;
    expect(escalation).toMatch(/firstBootCompletedAt\s*===\s*undefined/);
    expect(escalation).toMatch(/(content_plan_initial|kickstart)/i);
  });

  it("sibling-file scan — references the `maya-calendar-planner` skill (Sprint C.1 dependency)", () => {
    const body = bodyOfEntry(pickEntry());
    expect(
      body,
      "first_week_calendar_bootstrap: missing maya-calendar-planner skill reference"
    ).toContain("maya-calendar-planner");
  });

  it("sibling-file scan — references the `/lc_maya/calendar_list_events` gap-finder endpoint (existing C.1 dependency)", () => {
    const body = bodyOfEntry(pickEntry());
    expect(
      body,
      "first_week_calendar_bootstrap: missing /lc_maya/calendar_list_events gap-finder reference"
    ).toContain("/lc_maya/calendar_list_events");
  });

  it("sibling-file scan — references the `/lc_maya/calendar_create_event` write endpoint (events get written through the existing endpoint)", () => {
    const body = bodyOfEntry(pickEntry());
    expect(
      body,
      "first_week_calendar_bootstrap: missing /lc_maya/calendar_create_event write endpoint reference"
    ).toContain("/lc_maya/calendar_create_event");
  });

  it("event-kind discipline — only references the 8 C.1 catalog kinds (no fabricated 9th kind)", () => {
    // Same adversarial check the C.2 suite runs: every backtick-quoted
    // `<word>-<word>` pattern adjacent to "event" / "kind" must be in the
    // C.1 8-kind allowlist.
    const body = bodyOfEntry(pickEntry());
    const candidates = body.match(/`([a-z]+-[a-z]+)`/g) ?? [];
    for (const tok of candidates) {
      const inner = tok.slice(1, -1);
      const looksLikeEventKind =
        /^[a-z]+-[a-z]+$/.test(inner) &&
        !inner.startsWith("lc-") &&
        !inner.includes("/") &&
        ![
          "format-not", "kitchen-counter", "walking-monologue", "handheld-pov",
          "tone-adjusted", "anti-niches", "side-hustle",
          "full-time", "follow-through", "promise-and",
          "daily-ish",
        ].includes(inner);
      if (!looksLikeEventKind) continue;
      const idx = body.indexOf(tok);
      const window = body.slice(Math.max(0, idx - 30), idx + tok.length + 30);
      if (/\bevent\b|\bkind[s]?\b/i.test(window)) {
        expect(
          (C1_EVENT_KINDS as ReadonlyArray<string>).includes(inner),
          `first_week_calendar_bootstrap: prose references unknown event kind \`${inner}\` — not in C.1's 8-kind catalog`
        ).toBe(true);
      }
    }
  });

  it("adversarial — the entry explicitly forbids fabricating event kinds", () => {
    const body = bodyOfEntry(pickEntry());
    expect(
      body,
      "first_week_calendar_bootstrap: missing no-fabrication clause for event kinds"
    ).toMatch(
      /(only.*8.*C\.1.*kinds|never\s+(invent|fabricate|make up).*(kind|event))/i
    );
  });

  it("approval gates — each proposed event must be CONFIRMED in chat before any /lc_maya/calendar_create_event call", () => {
    const entry = pickEntry();
    expect(entry.approvalGates).toMatch(/CONFIRMED?\s+in\s+chat/i);
    expect(entry.approvalGates).toMatch(/\/lc_maya\/calendar_create_event/);
  });

  it("Sprint B.1 follow-through enforcement language is present (no fake-busy stalls)", () => {
    const body = bodyOfEntry(pickEntry());
    expect(
      body,
      "first_week_calendar_bootstrap: missing B.1 follow-through enforcement"
    ).toMatch(/Follow-through enforcement.*Sprint\s*B\.1/i);
    // The classic fake-busy phrasings get explicitly named so the model sees
    // the bans inline.
    expect(body).toMatch(/let me look at your calendar|give me a sec to plan/i);
  });

  it("30-minute popup reminder convention is documented (matches C.2's planner-skill template default)", () => {
    const body = bodyOfEntry(pickEntry());
    expect(
      body,
      "first_week_calendar_bootstrap: missing 30-minute popup reminder convention"
    ).toMatch(/30[\s-]?min(?:ute)?s?.*popup|popup.*30/i);
  });

  it("gap-finder-before-booking discipline — calendar_list_events runs before any insert", () => {
    const body = bodyOfEntry(pickEntry());
    expect(
      body,
      "first_week_calendar_bootstrap: missing gap-finder before-booking discipline"
    ).toMatch(
      /(before\s+book|first.*calendar_list_events|never\s+book.*existing\s+event)/i
    );
  });

  it("TODO grep — Sprint C.5 additions don't introduce TODO/FIXME/eslint-disable without justification", () => {
    const entry = pickEntry();
    const body = `${entry.scope}\n${entry.cronMessage ?? ""}\n${entry.triggers}\n${entry.approvalGates}\n${entry.escalation}`;
    expect(body, "first_week_calendar_bootstrap carries TODO").not.toMatch(
      /\bTODO\b/
    );
    expect(body, "first_week_calendar_bootstrap carries FIXME").not.toMatch(
      /\bFIXME\b/
    );
    expect(body, "first_week_calendar_bootstrap carries // eslint-disable").not.toMatch(
      /\/\/\s*eslint-disable/
    );
  });

  it("Sprint C.5 marker — first_proactive_ping carries the calendar-bootstrap lookahead one-liner", () => {
    // The existing first_proactive_ping entry got a brief append teaching
    // Maya to preview the bootstrap value-prop in the Google-connect offer.
    // The append must reference Sprint C.5 + the bootstrap promise verbatim.
    const ping = STANDING_ORDERS.find((p) => p.id === "first_proactive_ping");
    expect(ping, "first_proactive_ping missing from catalog").toBeDefined();
    expect(ping!.scope).toContain("Calendar-bootstrap lookahead (Sprint C.5)");
    expect(ping!.scope).toMatch(/rest of this week\s*\+\s*next week/i);
    expect(ping!.scope).toMatch(
      /content-blocks?,?\s*post times?,?\s*scroll\/comment windows?/i
    );
  });
});
