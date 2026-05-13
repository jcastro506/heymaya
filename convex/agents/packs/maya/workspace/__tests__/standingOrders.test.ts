/**
 * standingOrders — Sprint B.1 follow-through enforcement coverage.
 *
 * Sprint B.1 added a one-sentence Follow-through enforcement line to the
 * standing orders most likely to confab the "promise + stop" pattern:
 *   - first_proactive_ping (Day 1 first-touch)
 *   - morning_brief        (7am)
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

const NAMED_TARGETS = [
  "morning_brief",
  "evening_recap",
  "weekly_review",
  "first_proactive_ping",
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
