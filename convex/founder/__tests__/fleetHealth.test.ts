/**
 * Fleet health — the gate, and the threshold.
 *
 * The join itself is exercised live; what is pinned here is the security
 * property and the one judgment call, because both fail quietly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STUCK_AFTER_DAYS } from "../fleetHealth";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { minimalRow, type InsertCtx } from "../../../tests/lib/minimalRow";

/** The ops token the view is gated on — fail-closed without it. */
const TOKEN = process.env.ADMIN_DASH_TOKEN ?? "test-ops-token";
const NOW = 1_786_900_000_000;

const SOURCE = readFileSync(
  join(process.cwd(), "convex", "founder", "fleetHealth.ts"),
  "utf8"
);

describe("the token gate", () => {
  /**
   * ⚠️ Must fail CLOSED when `ADMIN_DASH_TOKEN` is unset.
   *
   * An ops view that opens up because an environment variable is missing is
   * worse than one that is down: the failure is invisible, and this endpoint
   * returns per-customer spend and account ids.
   *
   * Asserted against the source because the check is a module-private function
   * reading `process.env` at call time — the shape of the comparison is the
   * thing that must not regress.
   */
  it("requires the variable to exist, not merely to match", () => {
    expect(SOURCE).toContain("Boolean(expected) && token === expected");
  });

  it("returns nothing but `ok: false` when unauthorised", () => {
    // No partial payload on the unauthorised path — a leaked count is still a
    // leak, and this runs before any read.
    expect(SOURCE).toContain("return { ok: false, notYetAnswered: [] };");
  });
});

describe("the stuck threshold", () => {
  /**
   * ⭐ Two days, not one.
   *
   * A single quiet day is a legitimate outcome — §12 is explicit that honest
   * silence beats fake activity. Alerting on it would flag the fleet most
   * mornings and train the operator to ignore the alert, which is how a real
   * outage gets missed.
   */
  it("is 2 days, so one quiet day isn't an alarm", () => {
    expect(STUCK_AFTER_DAYS).toBe(2);
  });

  it("measures from the last placement, not from the streak", () => {
    // A streak of 0 means "nothing yet today", true of everyone before their
    // first post — using it would flag the whole fleet every morning.
    expect(SOURCE).toContain("publishedAt");
    expect(SOURCE).toContain("Stuck is computed from the LAST PLACEMENT");
  });

  it("always lists an account that has never posted", () => {
    // `null` days-since is worse than stale, not unknown — so it bypasses the
    // threshold rather than being compared against it.
    expect(SOURCE).toContain("daysSince === null || daysSince >= STUCK_AFTER_DAYS");
  });
});

describe("honesty about gaps", () => {
  /**
   * §18's exit asks four questions; this answers two. A plausible-looking
   * number for the other two would be worse than a gap — this is the screen
   * someone opens when they already suspect something is wrong.
   */
  it("names what it cannot answer rather than omitting it", () => {
    expect(SOURCE).toContain("notYetAnswered");
    expect(SOURCE).toMatch(/diagnose|directive aggregation/);
  });
});

describe("aggregate learning (§16.9.3)", () => {
  const SOURCE_AGG = readFileSync(
    join(process.cwd(), "convex", "founder", "fleetHealth.ts"),
    "utf8"
  );

  /**
   * ⭐ §14.2.1: "`unknown` is a real answer" — it means no numbers came back.
   * Folding it into the fleet picture would make "we can't see" look like a
   * diagnosis, and at low customer counts it would usually win.
   */
  it("excludes `unknown` from the fleet ladder rather than counting it", () => {
    expect(SOURCE_AGG).toContain('verdict.rung === "unknown"');
    expect(SOURCE_AGG).toContain("continue");
  });

  /**
   * `healthy` is the good outcome. A mostly-healthy fleet would otherwise
   * report "healthy" as the thing to go and fix.
   */
  it("never reports `healthy` as the most common break", () => {
    expect(SOURCE_AGG).toContain('r.rung !== "healthy"');
  });

  /**
   * ⭐ One founder restating a rule five times is one signal, not five —
   * otherwise the loudest customer sets the roadmap.
   */
  it("counts directives per account, not per row", () => {
    expect(SOURCE_AGG).toContain("Set<string>");
    expect(SOURCE_AGG).toContain("accounts: accounts.size");
  });

  /**
   * The fleet number and every per-customer number must be the same
   * arithmetic, or the operator view and the founder's own recap disagree
   * about the same week.
   */
  it("uses the same pure verdict the weekly report and nextIdea use", () => {
    expect(SOURCE_AGG).toContain("diagnoseFrom");
    /**
     * ⚠️ Static import — a dynamic one typechecks and dies at runtime.
     *
     * Built by concatenation rather than written literally: the sibling-file
     * scanner in `tests/sprint1Acceptance.test.ts` reads every `from "…"` in
     * `convex/` and checks it resolves. A literal here looks like an import
     * from `convex/founder/__tests__/`, which would resolve nowhere — the
     * scanner was right to flag it, so the assertion is what changes.
     */
    const ladderPath = "../maya/" + "ladder";
    expect(SOURCE_AGG).toContain(`from "${ladderPath}"`);
    expect(SOURCE_AGG).not.toContain(`await import("${ladderPath}")`);
  });

  it("keeps `notYetAnswered` as a field even when empty", () => {
    // The next thing this view can't answer belongs there. A screen that
    // silently covers three of four questions is how someone concludes the
    // fourth is fine.
    expect(SOURCE_AGG).toContain("notYetAnswered: []");
  });
});

/* -------------------------------------------------------------------------- */

describe("the activation funnel — §16.9.2's headline metric", () => {
  /**
   * ⚠️ Scoped to this block. `authorized` fails CLOSED when `ADMIN_DASH_TOKEN`
   * is unset, and a test above pins exactly that — setting it globally would
   * quietly delete the fail-closed assertion.
   */
  beforeEach(() => {
    process.env.ADMIN_DASH_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.ADMIN_DASH_TOKEN;
  });

  /**
   * ⭐ *"signup → connected → approved → first placement → first click → first
   * signup → month 2. **Time-to-first-placement is the headline metric.**"*
   *
   * ⚠️ It was absent entirely. Every other number on this screen describes
   * customers who are already working; this is the only one that describes the
   * ones who never started — and a founder who signs up, connects a channel and
   * never gets a post is invisible on a view built from placements and spend.
   */
  const seed = async (
    t: ReturnType<typeof convexTest>,
    who: string,
    opts: { connected?: boolean; placedAfterHours?: number; signedUpDaysAgo?: number },
  ) =>
    await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (table: string, value: unknown) => Promise<string> };
      };
      const creator = await c.db.insert(
        "creators",
        await minimalRow(ctx as InsertCtx, "creators", {
          clerkUserId: who,
          email: `${who}@e.com`,
          accountType: "gtm-agent",
        }),
      );
      const signedUpAt = NOW - (opts.signedUpDaysAgo ?? 1) * 86_400_000;
      const customerId = await c.db.insert(
        "customers",
        await minimalRow(ctx as InsertCtx, "customers", {
          accountId: creator,
          // The funnel counts the live product only — a v1 row is the frozen
          // product and would inflate every number on this screen.
          agentVersion: "v2",
          createdAt: signedUpAt,
        }),
      );
      if (opts.connected) {
        await c.db.insert("channels", {
          customerId,
          channel: "x",
          handle: who,
          status: "connected",
          postingMode: "show_me_first",
          createdAt: signedUpAt,
          updatedAt: signedUpAt,
        });
      }
      if (opts.placedAfterHours !== undefined) {
        await c.db.insert("placements", {
          customerId,
          kind: "post",
          channel: "x",
          linkStatus: "live",
          url: `https://x.com/${who}/1`,
          publishedAt: signedUpAt + opts.placedAfterHours * 3_600_000,
          snapshotText: "shipped",
          idempotencyKey: `k_${who}`,
        });
      }
      return customerId;
    });

  it("⭐ reports median hours from signup to first live placement", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "fast", { connected: true, placedAfterHours: 2 });
    await seed(t, "slow", { connected: true, placedAfterHours: 10 });

    const out = await t.query(api.founder.fleetHealth.health, {
      token: TOKEN,
      now: NOW,
    });
    expect(out.activation?.placed).toBe(2);
    expect(out.activation?.medianHours).toBeGreaterThan(0);
  });

  it("⭐ names the connected accounts that never placed", async () => {
    const t = convexTest(schema, modules);
    const stuck = await seed(t, "stalled", {
      connected: true,
      signedUpDaysAgo: 9,
    });

    const out = await t.query(api.founder.fleetHealth.health, {
      token: TOKEN,
      now: NOW,
    });
    // Named, not counted — a count cannot be opened.
    expect(out.activation?.stalled.map((s) => s.customerId)).toContain(stuck);
    expect(out.activation?.stalled[0].daysSinceSignup).toBe(9);
  });

  it("⚠️ someone mid-onboarding is not 'stalled'", async () => {
    /**
     * Signed up, hasn't connected anything. Flagging them would bury the
     * accounts that genuinely are stuck behind everyone who joined this week.
     */
    const t = convexTest(schema, modules);
    await seed(t, "fresh", { connected: false, signedUpDaysAgo: 0 });

    const out = await t.query(api.founder.fleetHealth.health, {
      token: TOKEN,
      now: NOW,
    });
    expect(out.activation?.stalled).toEqual([]);
    expect(out.activation?.connected).toBe(0);
  });

  it("⚠️ reports null rather than zero when nobody has placed", async () => {
    // A zero here would read as "instant" — the exact opposite of the truth.
    const t = convexTest(schema, modules);
    await seed(t, "none", { connected: true, signedUpDaysAgo: 3 });

    const out = await t.query(api.founder.fleetHealth.health, {
      token: TOKEN,
      now: NOW,
    });
    expect(out.activation?.medianHours).toBeNull();
  });
});
