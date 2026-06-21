/**
 * Founder dashboard per-agent spend — GAP 2 (the "surprise OpenRouter bill").
 *
 * Five mandatory categories:
 *   1. Cross-tenant — `agentSpend` sums ONLY the requested account's ledger;
 *      another account's rows never leak into the total (asserted directly).
 *   2. Plan-tier — admin-scoped (ADMIN_DASH_TOKEN), fail-closed: no/wrong token
 *      → { ok: false }, never data.
 *   3. Adversarial — empty/zero ledger → all-zero windows; rows older than 7d
 *      are excluded; discovery rows split out from operational.
 *   4. Windowing — pure `windowLedgerSpend` folds today/last-7d with the
 *      discovery split correctly (boundary + bucket-subset behavior).
 *   5. TODO grep — clean.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { windowLedgerSpend } from "../dashboard";

// agentSpend reads against the real Date.now() (it is not parameterized), so
// the ledger fixtures must be anchored to wall-clock now, not a frozen epoch.
const NOW = Date.now();
const DAY = 1000 * 60 * 60 * 24;
const TOKEN = "test-admin-token";

async function insertAccount(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@test.com`,
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      accountType: "gtm-agent",
      createdAt: NOW,
    })
  );
}

async function insertLedger(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"creators">,
  costUsd: number,
  createdAt: number,
  discovery = false
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("gtmCostLedger", {
      accountId,
      provider: "openrouter",
      operation: discovery ? "discovery_scan" : "operational_turn",
      reason: "test",
      costUsd,
      cacheStatus: "called",
      discovery,
      createdAt,
    })
  );
}

// ── Pure windowing helper ────────────────────────────────────────────────────
describe("windowLedgerSpend", () => {
  it("buckets today as a subset of last-7d and splits discovery from other", () => {
    const rows = [
      { costUsd: 1.0, createdAt: NOW - 1000, discovery: false }, // today, other
      { costUsd: 0.5, createdAt: NOW - 1000, discovery: true }, // today, discovery
      { costUsd: 2.0, createdAt: NOW - 3 * DAY, discovery: false }, // 7d only, other
      { costUsd: 0.25, createdAt: NOW - 3 * DAY, discovery: true }, // 7d only, discovery
      { costUsd: 9.0, createdAt: NOW - 10 * DAY, discovery: false }, // excluded (>7d)
    ];
    const out = windowLedgerSpend(rows, NOW);
    expect(out.today.totalUsd).toBeCloseTo(1.5);
    expect(out.today.discoveryUsd).toBeCloseTo(0.5);
    expect(out.today.otherUsd).toBeCloseTo(1.0);
    expect(out.last7d.totalUsd).toBeCloseTo(3.75);
    expect(out.last7d.discoveryUsd).toBeCloseTo(0.75);
    expect(out.last7d.otherUsd).toBeCloseTo(3.0);
  });

  it("returns all-zero windows for no rows", () => {
    const out = windowLedgerSpend([], NOW);
    expect(out.today).toEqual({ totalUsd: 0, discoveryUsd: 0, otherUsd: 0 });
    expect(out.last7d).toEqual({ totalUsd: 0, discoveryUsd: 0, otherUsd: 0 });
  });
});

// ── agentSpend query (auth + isolation) ──────────────────────────────────────
describe("founder/dashboard.agentSpend", () => {
  beforeEach(() => {
    process.env.ADMIN_DASH_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.ADMIN_DASH_TOKEN;
  });

  it("fails closed without a valid token", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "a");
    const bad = await t.query(api.founder.dashboard.agentSpend, {
      token: "wrong",
      accountId,
    });
    expect(bad).toEqual({ ok: false });
  });

  it("fails closed when ADMIN_DASH_TOKEN is unset", async () => {
    delete process.env.ADMIN_DASH_TOKEN;
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "a");
    const res = await t.query(api.founder.dashboard.agentSpend, {
      token: TOKEN,
      accountId,
    });
    expect(res).toEqual({ ok: false });
  });

  it("returns correct windowed totals for the caller's account only (cross-tenant isolation)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertAccount(t, "a");
    const b = await insertAccount(t, "b");

    // Account A: $1 today (other), $0.5 today (discovery), $2 three days ago.
    await insertLedger(t, a, 1.0, NOW - 1000, false);
    await insertLedger(t, a, 0.5, NOW - 1000, true);
    await insertLedger(t, a, 2.0, NOW - 3 * DAY, false);
    // Account A: an old row (>7d) that must be excluded by the windowed read.
    await insertLedger(t, a, 99.0, NOW - 10 * DAY, false);
    // Account B: large spend that must NEVER appear in A's totals.
    await insertLedger(t, b, 50.0, NOW - 1000, false);

    const res = await t.query(api.founder.dashboard.agentSpend, {
      token: TOKEN,
      accountId: a,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.spend.today.totalUsd).toBeCloseTo(1.5);
    expect(res.spend.today.discoveryUsd).toBeCloseTo(0.5);
    expect(res.spend.today.otherUsd).toBeCloseTo(1.0);
    expect(res.spend.last7d.totalUsd).toBeCloseTo(3.5); // 1 + 0.5 + 2, NOT the 99 or B's 50
  });
});
