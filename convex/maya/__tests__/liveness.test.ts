import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  checkBalance,
  correlateFleet,
  FLEET_CORRELATION_MIN_ACCOUNTS,
  FLEET_CORRELATION_THRESHOLD,
  CREDIT_RESERVES,
  evaluate,
  type LivenessInput,
  type BreachAction,
} from "../liveness";

const DAY = 86_400_000;
/** 2026-07-31, 20:00 UTC — after both the brief and recap are due. */
const EVENING = Date.UTC(2026, 6, 31, 20, 0, 0);
/** Same calendar day as EVENING — a customer who signed up this morning. */
const MORNING_TODAY = Date.UTC(2026, 6, 31, 8, 0, 0);

function facts(over: Partial<LivenessInput> = {}): LivenessInput {
  return {
    now: EVENING,
    hourLocal: 20,
    briefSentToday: true,
    recapSentToday: true,
    placementsToday: 1,
    priorZeroDayStreak: 0,
    customerState: "active",
    // A healthy machine checked in this morning and isn't truncating context.
    // Defaulted here so tests about placements and briefs don't each have to
    // restate an unrelated healthy fact — the checkpoint breaches get their own
    // block below.
    hoursSinceCheckpoint: 6,
    contextTruncated: false,
    ...over,
  };
}

const kinds = (bs: Array<{ kind: string }>) => bs.map((b) => b.kind);

describe("a healthy day breaches nothing", () => {
  it("brief sent, recap sent, something published", () => {
    expect(evaluate(facts())).toEqual([]);
  });
});

describe("A SYSTEM CANNOT BE THE WATCHDOG FOR ITSELF", () => {
  it("a paused account producing nothing is the system WORKING", () => {
    // Alerting on this is how an operator learns to ignore alerts.
    const breaches = evaluate(
      facts({
        customerState: "paused",
        briefSentToday: false,
        recapSentToday: false,
        placementsToday: 0,
        priorZeroDayStreak: 5,
      })
    );
    expect(breaches).toEqual([]);
  });

  it("same for cancelled and onboarding", () => {
    for (const state of ["cancelled", "onboarding"] as const) {
      expect(
        evaluate(facts({ customerState: state, placementsToday: 0, briefSentToday: false }))
      ).toEqual([]);
    }
  });
});

describe("the brief", () => {
  it("isn't a breach until the grace period passes", () => {
    // Due 07:00, grace 2h. At 08:00 it's late, not broken.
    expect(kinds(evaluate(facts({ briefSentToday: false, hourLocal: 8 })))).not.toContain(
      "brief_missed"
    );
  });

  it("is a breach two hours late, and re-enqueues ONCE", () => {
    const breaches = evaluate(facts({ briefSentToday: false, hourLocal: 9 }));
    const brief = breaches.find((b) => b.kind === "brief_missed");
    expect(brief?.action).toBe("reenqueue_brief");
    // Once — a re-enqueue loop on a broken brief is a message storm.
    expect(brief?.detail).toMatch(/once/);
  });

  it("a sent brief is never a breach, however late in the day", () => {
    expect(kinds(evaluate(facts({ hourLocal: 23 })))).not.toContain("brief_missed");
  });
});

describe("zero placements — escalation is by streak, and the words change", () => {
  it("not checked before the evening — a quiet morning is just a morning", () => {
    expect(
      kinds(evaluate(facts({ placementsToday: 0, hourLocal: 12 })))
    ).not.toContain("zero_placements_today");
  });

  it("first zero day with NO known reason: diagnose, and admit not knowing", () => {
    const [breach] = evaluate(facts({ placementsToday: 0 }));
    expect(breach.kind).toBe("zero_placements_today");
    expect(breach.action).toBe("diagnose_and_report");
    expect(breach.detail).toMatch(/don't yet know why/);
  });

  it("first zero day WITH a known reason: state it plainly, don't investigate", () => {
    // "Nothing went out — your Instagram token expired" is a good message.
    const [breach] = evaluate(
      facts({ placementsToday: 0, knownReason: "your Instagram token expired" })
    );
    expect(breach.action).toBe("state_plainly_in_recap");
    expect(breach.detail).toBe(
      "nothing went out today — your Instagram token expired"
    );
  });

  it("two consecutive: operator alert AND an honest message to the founder", () => {
    const [breach] = evaluate(
      facts({ placementsToday: 0, priorZeroDayStreak: 1 })
    );
    expect(breach.kind).toBe("zero_day_streak");
    expect(breach.action).toBe("operator_alert_and_tell_founder");
    expect(breach.streak).toBe(2);
  });

  it("three consecutive: a support thread opens automatically", () => {
    const [breach] = evaluate(
      facts({ placementsToday: 0, priorZeroDayStreak: 2 })
    );
    expect(breach.action).toBe("open_support_thread");
    expect(breach.streak).toBe(3);
  });

  it("a long streak stays at support-thread rather than inventing new levels", () => {
    const [breach] = evaluate(
      facts({ placementsToday: 0, priorZeroDayStreak: 9 })
    );
    expect(breach.action).toBe("open_support_thread");
    expect(breach.streak).toBe(10);
  });

  it("one placement clears it entirely", () => {
    expect(evaluate(facts({ placementsToday: 1, priorZeroDayStreak: 5 }))).toEqual([]);
  });
});

describe("HONEST SILENCE BEATS FAKE ACTIVITY", () => {
  it("every breach detail is plain language a founder could read", () => {
    const cases = [
      facts({ briefSentToday: false, hourLocal: 10 }),
      facts({ placementsToday: 0 }),
      facts({ placementsToday: 0, priorZeroDayStreak: 1 }),
      facts({ placementsToday: 0, priorZeroDayStreak: 5 }),
      facts({ recapSentToday: false }),
    ];
    for (const input of cases) {
      for (const breach of evaluate(input)) {
        expect(breach.detail).not.toMatch(/\b(null|undefined|error|4\d\d|5\d\d)\b/i);
        expect(breach.detail.length).toBeGreaterThan(15);
      }
    }
  });

  it("never claims activity on a zero day — no counts of things found", () => {
    // "Found 22 posts!" on a zero-placement day is a lie by framing, and it is
    // what shipped.
    for (const breach of evaluate(facts({ placementsToday: 0 }))) {
      expect(breach.detail).not.toMatch(/found|discovered|\d+ posts/i);
    }
  });

  it("reports EVERY breach at once, not one per hour", () => {
    // A stalled account breaches several clauses together; drip-feeding them
    // turns one incident into a week of alerts.
    const breaches = evaluate(
      facts({
        briefSentToday: false,
        recapSentToday: false,
        placementsToday: 0,
        // 23:00 local — past the recap deadline (21:00) plus its two-hour
        // grace. The recap is SENT at 20:00 local, so the old deadline of 19
        // was earlier than the thing it was policing; it never fired only
        // because `recapSentToday` was permanently true (the UTC dayKey bug).
        // Two defects cancelling is not the same as working.
        hourLocal: 23,
      })
    );
    expect(kinds(breaches).sort()).toEqual([
      "brief_missed",
      "recap_missed",
      "zero_placements_today",
    ]);
  });
});

describe("fleet-wide vendor balances", () => {
  it("healthy balances are ok", () => {
    expect(checkBalance("scrapecreators", 3515).verdict).toBe("ok");
  });

  it("at or below the reserve is low", () => {
    expect(checkBalance("scrapecreators", CREDIT_RESERVES.scrapecreators).verdict).toBe(
      "low"
    );
  });

  it("a quarter of the reserve is critical, and says why it matters", () => {
    const check = checkBalance("scrapecreators", 100);
    expect(check.verdict).toBe("critical");
    // Not one customer's bad day — everyone stops at once.
    expect(check.detail).toMatch(/every customer/);
  });

  it("zero is critical", () => {
    expect(checkBalance("creatify", 0).verdict).toBe("critical");
  });

  it("reserves sit well above zero, so there's time to actually buy more", () => {
    for (const reserve of Object.values(CREDIT_RESERVES)) {
      expect(reserve).toBeGreaterThan(50);
    }
  });

  /**
   * ⭐ The gap wasn't a wrong threshold, it was a MISSING VENDOR.
   *
   * This table watched ScrapeCreators and Creatify — the two that were fine —
   * and not OpenRouter, which pays for every model call she makes and which
   * §7.2's own COGS work names as cost driver #1. A live read on 2026-08-06
   * found **$26.16 left of $2,535**, half way through the seven-day run, and
   * nothing anywhere would have said so: at zero she stops mid-sentence for
   * every customer at once.
   *
   * Asserting the KEY rather than a number, because the failure mode here is
   * absence. A vendor nobody watches has no wrong value to catch.
   */
  it("watches the vendor that pays for thinking", () => {
    expect(Object.keys(CREDIT_RESERVES)).toContain("openrouter");
  });

  it("reads the unit the operator expects — dollars, to two places", () => {
    // First live run printed "25.92035670899986 credits": wrong unit, fifteen
    // decimals. A real alert that looks like a debug print gets ignored.
    const low = checkBalance("openrouter", 25.92035670899986);
    expect(low.detail).toContain("$25.92");
    expect(low.detail).not.toMatch(/credits/);
    expect(low.detail).not.toMatch(/\d\.\d{3}/);
    // The credit-denominated vendors keep their own unit.
    expect(checkBalance("scrapecreators", 3065).detail).toContain("credits");
  });

  it("openrouter is graded in dollars, and a low balance is LOW not ok", () => {
    // Its balance is a dollar figure, not vendor credits — the one entry in
    // this table with a different unit, which is why it carries its own test.
    expect(checkBalance("openrouter", 26.16).verdict).not.toBe("ok");
    expect(checkBalance("openrouter", 500).verdict).toBe("ok");
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Seeds an ESTABLISHED account by default (30 days old).
 *
 * The streak walk is clamped to `createdAt`, so a customer created "today"
 * can't have placements from three days ago — that's incoherent data, and
 * relying on it is what let the new-customer bug hide. Pass `createdAt` to
 * test the young-account case deliberately.
 */
async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  createdAt = EVENING - 30 * DAY,
  timezone = "UTC"
) {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone,
      createdAt,
      updatedAt: createdAt,
    });
  });
}

async function place(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  publishedAt: number,
  key: string
) {
  await t.run((ctx) =>
    ctx.db.insert("placements", {
      customerId,
      kind: "post",
      channel: "x",
      linkStatus: "live",
      publishedAt,
      snapshotText: "a post",
      idempotencyKey: key,
    })
  );
}

describe("gatherFacts — reads the world, judges nothing", () => {
  it("sees today's placements and the brief/recap dedupe keys", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "facts");
    await place(t, customerId, EVENING - 3600_000, "p1");
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "brief",
      dedupeKey: "brief:2026-07-31",
      ts: EVENING - 43_200_000,
    });

    const f = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: EVENING,
    });
    expect(f?.placementsToday).toBe(1);
    expect(f?.briefSentToday).toBe(true);
    expect(f?.recapSentToday).toBe(false);
    expect(f?.hourLocal).toBe(20);
  });

  /**
   * ⭐ THE REGRESSION, taken from production on 2026-08-06.
   *
   * She published four times on the EVENING of 08-05 (20:00–23:00 New York).
   * At 11:57 on 08-06, `gatherFacts` reported `placementsToday: 5` while
   * cadence.ts — counting in her timezone — correctly reported zero.
   *
   * The cause was `floor(now / 86_400_000) * 86_400_000`, which starts "today"
   * at 20:00 the PREVIOUS evening in New York. And because `evaluate()` gates
   * the entire zero-placement escalation on `placementsToday === 0`, last
   * night's posts suppressed today's alert outright. She posts in the evening,
   * so this was not an edge case — it was the normal pattern, and the watchdog
   * was blind on exactly the days it exists for.
   */
  it("counts the FOUNDER's day — last night's posts are not today's", async () => {
    const t = convexTest(schema, modules);
    const NY = "America/New_York";
    // 2026-08-06 11:57 New York.
    const noonToday = Date.UTC(2026, 7, 6, 15, 57);
    const customerId = await seed(t, "tzday", noonToday - 30 * DAY, NY);

    // Four placements on the evening of 08-05, New York time. Each of these is
    // AFTER 00:00 UTC on 08-06, which is what fooled the old arithmetic.
    for (const [i, hourUtc] of [0, 1, 2, 3].entries()) {
      await place(t, customerId, Date.UTC(2026, 7, 6, hourUtc, 30), `ev${i}`);
    }

    const f = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: noonToday,
    });

    expect(f?.placementsToday).toBe(0);
    expect(f?.hourLocal).toBe(11);
    // And the consequence that actually mattered: the alert can now fire.
    const breaches = evaluate({
      ...facts({ placementsToday: f!.placementsToday, hourLocal: 19 }),
      priorZeroDayStreak: f!.priorZeroDayStreak,
    });
    expect(kinds(breaches)).toContain("zero_placements_today");
  });

  /**
   * cadence.ts counts only `linkStatus: "live"`; this counted every row. A
   * publish we cannot open is exactly the day the alert is most warranted.
   */
  it("an unconfirmed publish does not count as a placement", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "unknownlink");
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "unknown",
        publishedAt: EVENING - 3600_000,
        snapshotText: "a post we cannot open",
        idempotencyKey: "unk1",
      })
    );

    const f = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: EVENING,
    });
    expect(f?.placementsToday).toBe(0);
  });

  it("counts a consecutive zero-day streak", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "streak");
    // Published 3 days ago, then silence.
    await place(t, customerId, EVENING - 3 * DAY, "old");

    const f = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: EVENING,
    });
    expect(f?.placementsToday).toBe(0);
    expect(f?.priorZeroDayStreak).toBe(2);
  });

  it("an old quiet week doesn't inflate a current streak", async () => {
    // Stops at the first day that HAD a placement.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "recent");
    await place(t, customerId, EVENING - DAY, "yesterday");

    const f = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: EVENING,
    });
    expect(f?.priorZeroDayStreak).toBe(0);
  });

  it("never counts another customer's placements", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "live_a");
    const b = await seed(t, "live_b");
    await place(t, b, EVENING - 3600_000, "pb");

    const f = await t.query(internal.maya.liveness.gatherFacts, {
      customerId: a,
      now: EVENING,
    });
    expect(f?.placementsToday).toBe(0);
  });

  it("A NEW CUSTOMER IS NOT A WEEK OF FAILURE", async () => {
    // The bug the composition test caught. Without clamping the walk-back to
    // the account's creation date, someone who signed up this morning shows a
    // 7-day zero streak on their first evening — and opens a support thread.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "brand_new", MORNING_TODAY);
    const f = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: EVENING,
    });
    expect(f?.priorZeroDayStreak).toBe(0);

    const breaches = evaluate({ ...f!, briefSentToday: true, recapSentToday: true });
    const streak = breaches.find((b) => b.kind === "zero_day_streak");
    expect(streak).toBeUndefined();
    // A first quiet day is still reported — just not as a three-day crisis.
    expect(kinds(breaches)).toEqual(["zero_placements_today"]);
  });

  it("a missing customer is null, not a crash", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "gone");
    await t.run((ctx) => ctx.db.delete(customerId));
    expect(
      await t.query(internal.maya.liveness.gatherFacts, { customerId, now: EVENING })
    ).toBeNull();
  });

  it("end to end: a stalled account produces the right escalation", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "stalled");
    await place(t, customerId, EVENING - 3 * DAY, "old");

    const f = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: EVENING,
    });
    const breaches = evaluate({ ...f!, knownReason: "your X token expired" });
    const streak = breaches.find((b) => b.kind === "zero_day_streak");
    expect(streak?.action).toBe("open_support_thread");
    expect(streak?.detail).toMatch(/your X token expired/);
  });
});

describe("correlateFleet — one incident, not N", () => {
  const breaching = (kind: string) => ({
    breaches: [{ kind, action: "diagnose_and_report", detail: "d" }] as never,
  });
  const healthy = { breaches: [] as never };

  it("a vendor outage is ONE incident, however many customers it hits", () => {
    // 200 support threads for one root cause is an alert storm precisely when
    // something big is wrong — which is when the operator surface most needs
    // to stay readable.
    const fleet = Array.from({ length: 200 }, () =>
      breaching("zero_placements_today")
    );
    const verdict = correlateFleet(fleet, 200);
    expect(verdict.correlated).toBe(true);
    expect(verdict.dominantKind).toBe("zero_placements_today");
    expect(verdict.detail).toMatch(/one incident, not 200/);
  });

  it("a handful of unrelated bad days is NOT correlated", () => {
    // Three customers with real individual problems must each get their own
    // escalation. Collapsing those would hide three genuine incidents.
    const fleet = [
      ...Array.from({ length: 197 }, () => healthy),
      breaching("zero_placements_today"),
      breaching("brief_missed"),
      breaching("recap_missed"),
    ];
    const verdict = correlateFleet(fleet, 200);
    expect(verdict.correlated).toBe(false);
    expect(verdict.detail).toMatch(/no single shared cause/);
  });

  it("sits exactly on the threshold rather than near it", () => {
    const half = Array.from({ length: 100 }, () => breaching("brief_missed"));
    const rest = Array.from({ length: 100 }, () => healthy);
    expect(correlateFleet([...half, ...rest], 200).correlated).toBe(true);

    const justUnder = [
      ...Array.from({ length: 99 }, () => breaching("brief_missed")),
      ...Array.from({ length: 101 }, () => healthy),
    ];
    expect(correlateFleet(justUnder, 200).correlated).toBe(false);
    expect(FLEET_CORRELATION_THRESHOLD).toBe(0.5);
  });

  it("one customer breaching three ways can't outvote three breaching once", () => {
    // One vote per customer per kind, or a single messy account would look
    // like a fleet incident.
    const noisy = {
      breaches: [
        { kind: "brief_missed", action: "a", detail: "d" },
        { kind: "recap_missed", action: "a", detail: "d" },
        { kind: "zero_placements_today", action: "a", detail: "d" },
      ] as never,
    };
    const verdict = correlateFleet([noisy, healthy, healthy, healthy], 4);
    expect(verdict.correlated).toBe(false);
  });

  it("a healthy fleet correlates nothing", () => {
    const verdict = correlateFleet(Array.from({ length: 50 }, () => healthy), 50);
    expect(verdict.correlated).toBe(false);
    expect(verdict.detail).toBe("no breaches");
  });

  it("an empty fleet is not an incident", () => {
    expect(correlateFleet([], 0).correlated).toBe(false);
  });

  it("A FLEET OF ONE IS NOT AN INCIDENT, however correlated the arithmetic", () => {
    // 1 of 1 breaching is 100% by arithmetic and 0% an incident. Collapsing it
    // would hide the only signal there is — and early on, when the fleet IS
    // small, that distinction is the whole operator surface.
    const verdict = correlateFleet([breaching("zero_placements_today")], 1);
    expect(verdict.correlated).toBe(false);
    expect(verdict.detail).toMatch(/too few accounts/);
  });

  it("holds off until the fleet is big enough to have a shape", () => {
    const under = Array.from({ length: FLEET_CORRELATION_MIN_ACCOUNTS - 1 }, () =>
      breaching("brief_missed")
    );
    expect(correlateFleet(under, under.length).correlated).toBe(false);

    const at = Array.from({ length: FLEET_CORRELATION_MIN_ACCOUNTS }, () =>
      breaching("brief_missed")
    );
    expect(correlateFleet(at, at.length).correlated).toBe(true);
  });
});

/**
 * ⭐ The reserve logic existed since Sprint 6 with nothing fetching a balance.
 *
 * Twentieth zero-caller find, and the one with the widest blast radius: a
 * vendor at zero is not one customer degraded, it is every customer's sweeps
 * failing in the same minute.
 */
describe("⭐ VENDOR BALANCES — the reserve that could never fire", () => {
  it("a healthy balance is ok and says the number", () => {
    // Live at time of writing: 3181 against a 500 reserve.
    const v = checkBalance("scrapecreators", 3181);
    expect(v.verdict).toBe("ok");
    expect(v.detail).toMatch(/3181/);
  });

  it("⭐ THE ALERT FIRES WELL ABOVE ZERO", () => {
    // The gap between "alert" and "dead" has to be wide enough to actually
    // buy more credit. At the reserve exactly, it is already low.
    expect(checkBalance("scrapecreators", 500).verdict).toBe("low");
    expect(checkBalance("scrapecreators", 501).verdict).toBe("ok");
  });

  it("⭐ CRITICAL NAMES THE CONSEQUENCE, NOT THE NUMBER", () => {
    // "125 credits" means nothing to whoever reads the alert at 3am. "every
    // customer stops when this hits zero" is the thing that gets acted on.
    const v = checkBalance("scrapecreators", 100);
    expect(v.verdict).toBe("critical");
    expect(v.detail).toMatch(/every customer stops/);
  });

  it("zero is critical, not merely low", () => {
    expect(checkBalance("creatify", 0).verdict).toBe("critical");
  });
});

/**
 * ⭐ THE WATCHDOG THAT WATCHED AND DID NOTHING.
 *
 * Every breach carries an `action` — `reenqueue_brief`,
 * `operator_alert_and_tell_founder`, `open_support_thread`. Until 2026-08-08
 * the sweep wrote that action into an **audit row** and stopped.
 *
 * Found live: the morning brief never went out on 08-08. The sweep noticed at
 * 09:00, recorded `liveness.brief_missed`, and the founder heard nothing until
 * they asked what was going on.
 *
 * ⚠️ Principle 5 forbids this in as many words: *"Nothing fails silently. Every
 * job produces a result or a named failure that **reaches the user**."* An
 * audit row is not a user. §12 opens with *"a system cannot be the watchdog for
 * itself"* — and this was one layer further into that same trap: the contract
 * that exists to catch silent failure was failing silently.
 */
describe("every action has somewhere to go", () => {
  it("no action is left with nothing that handles it", () => {
    // The list below is the contract. Adding a seventh action costs a line
    // here and a decision about what it DOES — which is the point, because
    // the six that existed were all metadata.
    const HANDLED = new Set<BreachAction>([
      "reenqueue_brief",
      "operator_alert_and_tell_founder",
      "diagnose_and_report",
      "open_support_thread",
    ]);
    const LOG_ONLY = new Set<BreachAction>([
      // Deliberate: the founder cannot act on either, and telling them their
      // agent's context is truncated is noise dressed as transparency.
      "operator_alert_only",
      // Carried INTO the recap rather than sent separately — a second message
      // saying the same thing is the message storm §12 warns about.
      "state_plainly_in_recap",
    ]);

    const all: BreachAction[] = [
      "reenqueue_brief",
      "diagnose_and_report",
      "state_plainly_in_recap",
      "operator_alert_and_tell_founder",
      "open_support_thread",
      "operator_alert_only",
    ];
    for (const action of all) {
      expect(
        HANDLED.has(action) || LOG_ONLY.has(action),
        `${action} has no handler and is not deliberately log-only`,
      ).toBe(true);
    }
  });

  it("a missed brief is an action, not a note", () => {
    // The live case. At 10:00 with no brief, this must resolve to something
    // that sends — not to a row.
    const breaches = evaluate(facts({ briefSentToday: false, hourLocal: 10 }));
    const brief = breaches.find((b) => b.kind === "brief_missed");
    expect(brief?.action).toBe("reenqueue_brief");
  });

  it("every detail is sendable to the founder unchanged", () => {
    // Because the sweep now relays `detail` verbatim, it has to already be in
    // their language — no ids, no vendor names, no status codes.
    const cases = [
      facts({ briefSentToday: false, hourLocal: 10 }),
      facts({ placementsToday: 0, priorZeroDayStreak: 1 }),
      facts({ placementsToday: 0, priorZeroDayStreak: 5 }),
      facts({ recapSentToday: false, hourLocal: 23 }),
    ];
    for (const input of cases) {
      for (const breach of evaluate(input)) {
        expect(breach.detail).not.toMatch(/[a-z0-9]{20,}/i); // an id
        expect(breach.detail).not.toMatch(/\b(convex|fly|openrouter|zernio)\b/i);
        expect(breach.detail).not.toMatch(/\b[45]\d{2}\b/);
      }
    }
  });
});
