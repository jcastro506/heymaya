/**
 * ⭐ The vendor circuit breaker (Sprint 6).
 *
 * `CREDIT_RESERVES` and `checkBalance` shipped with nothing fetching a real
 * number. The hourly sweep fixed that — and then only logged it. So a vendor at
 * zero changed nothing: every sweep still fired, every call still failed, every
 * retry still burned, and the founder got silence.
 *
 * **Knowing a vendor is down and behaving as though it is are different
 * things**, and only the second is a breaker.
 */
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { READING_TTL_MS } from "../breaker";

const NOW = Date.UTC(2026, 7, 8, 12, 0);

async function reading(
  t: ReturnType<typeof convexTest>,
  verdict: "ok" | "low" | "critical",
  at = NOW
) {
  await t.mutation(internal.maya.breaker.record, {
    vendor: "scrapecreators",
    verdict,
    balance: verdict === "critical" ? 12 : 3000,
    detail: `scrapecreators is at 12 credits — every customer stops when this hits zero`,
    now: at,
  });
}

describe("⚠️ IT FAILS OPEN, AND THAT IS THE POINT", () => {
  it("never checked means GO", async () => {
    // A breaker that fails closed turns "we have never checked this vendor"
    // into "nothing runs" — which is what a fresh deploy looks like.
    const t = convexTest(schema, modules);
    const res = await t.query(internal.maya.breaker.vendorOpen, {
      vendor: "scrapecreators",
      now: NOW,
    });
    expect(res.open).toBe(true);
  });

  it("a STALE critical reopens on its own", async () => {
    // A vendor marked critical by a sweep that has since stopped running must
    // not hold the product shut forever. An unattended breaker that never
    // reopens is an outage with a good explanation.
    const t = convexTest(schema, modules);
    await reading(t, "critical", NOW - READING_TTL_MS - 1);

    const res = await t.query(internal.maya.breaker.vendorOpen, {
      vendor: "scrapecreators",
      now: NOW,
    });
    expect(res.open).toBe(true);
  });

  it("an unknown vendor is open, not blocked", async () => {
    const t = convexTest(schema, modules);
    await reading(t, "critical");
    const res = await t.query(internal.maya.breaker.vendorOpen, {
      vendor: "somethingelse",
      now: NOW,
    });
    expect(res.open).toBe(true);
  });
});

describe("what actually trips it", () => {
  it("⚠️ LOW does not trip — that threshold is set for comfort", async () => {
    // Low means "top this up this week", not "stop working". Tripping here
    // would halt the product on a number chosen to give us warning time.
    const t = convexTest(schema, modules);
    await reading(t, "low");
    const res = await t.query(internal.maya.breaker.vendorOpen, {
      vendor: "scrapecreators",
      now: NOW,
    });
    expect(res.open).toBe(true);
  });

  it("critical trips, and says why in the founder's language", async () => {
    const t = convexTest(schema, modules);
    await reading(t, "critical");
    const res = await t.query(internal.maya.breaker.vendorOpen, {
      vendor: "scrapecreators",
      now: NOW,
    });
    expect(res.open).toBe(false);
    expect(res.reason).toMatch(/credits/);
    // Relayed unchanged, so it cannot carry a status code or a stack.
    expect(res.reason).not.toMatch(/\b[45]\d{2}\b|undefined|null/);
  });

  it("recovery closes it again", async () => {
    // The breaker follows the balance rather than latching — topping up is the
    // fix, and it should take effect on the next reading, not a redeploy.
    const t = convexTest(schema, modules);
    await reading(t, "critical");
    await reading(t, "ok");
    const res = await t.query(internal.maya.breaker.vendorOpen, {
      vendor: "scrapecreators",
      now: NOW,
    });
    expect(res.open).toBe(true);
  });

  it("one row per vendor, however many readings", async () => {
    const t = convexTest(schema, modules);
    for (const v of ["ok", "low", "critical"] as const) await reading(t, v);
    const all = await t.query(internal.maya.breaker.allVendors, {});
    expect(all.filter((r) => r.vendor === "scrapecreators")).toHaveLength(1);
    expect(all[0].verdict).toBe("critical");
  });
});
