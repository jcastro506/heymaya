/**
 * Sprint 2.29 — memory write ledger tests.
 *
 * Validates:
 *   1. recordMemoryWriteInternal inserts a gtmMemoryWrites row
 *   2. Idempotency: same idempotencyKey → dedup (no double-insert)
 *   3. /lc_gtm/memory_written HTTP rejects unauthorized
 *   4. /lc_gtm/memory_written HTTP rejects invalid body
 *   5. /lc_gtm/memory_written HTTP happy path: writes ledger row + returns ok:true
 *   6. listMyMemoryWrites returns per-agent rows in desc order
 *   7. Cross-tenant isolation: A doesn't see B's memory writes
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App for ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  return { authed, accountId: started.accountId, agentId: started.agentId };
}

async function mintHookToken(
  t: ReturnType<typeof convexTest>,
  agentId: string
): Promise<string> {
  const hookToken = "fake-test-hook-token-" + Math.random().toString(36).slice(2);
  await t.run(async (ctx) => {
    await ctx.db.patch(agentId as never, { hookToken });
  });
  return hookToken;
}

describe("Sprint 2.29 — recordMemoryWriteInternal", () => {
  it("inserts a gtmMemoryWrites row with all fields", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_mw_basic");

    const result = await t.mutation(
      internal.gtmMaya.memoryLedger.recordMemoryWriteInternal,
      {
        accountId,
        agentId,
        idempotencyKey: "uuid-1",
        target: "daily_memory",
        dateSlot: "2026-05-28",
        op: "append",
        section: "What got done",
        bytes: 412,
        summary: "Added 3 events done + tomorrow's adjustment",
        triggeredBy: "maya-evening-recap",
        writtenAt: Date.now(),
      }
    );

    expect(result.deduped).toBe(false);
    expect(result.rowId).not.toBeNull();

    const row = await t.run((ctx) => ctx.db.get(result.rowId!));
    expect(row?.target).toBe("daily_memory");
    expect(row?.dateSlot).toBe("2026-05-28");
    expect(row?.op).toBe("append");
    expect(row?.section).toBe("What got done");
    expect(row?.bytes).toBe(412);
    expect(row?.triggeredBy).toBe("maya-evening-recap");
  });

  it("dedups on same idempotencyKey (no double-insert)", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_mw_dedup");

    const args = {
      accountId,
      agentId,
      idempotencyKey: "uuid-dedup",
      target: "dreams" as const,
      op: "append" as const,
      section: "Open hypotheses",
      summary: "1 new hypothesis",
      triggeredBy: "maya-weekly-review",
      writtenAt: Date.now(),
    };

    const first = await t.mutation(
      internal.gtmMaya.memoryLedger.recordMemoryWriteInternal,
      args
    );
    const second = await t.mutation(
      internal.gtmMaya.memoryLedger.recordMemoryWriteInternal,
      args
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.rowId).toBe(first.rowId);

    // Only one gtmMemoryWrites row exists.
    const all = await t.run((ctx) =>
      ctx.db
        .query("gtmMemoryWrites")
        .withIndex("by_idempotency", (q) =>
          q.eq("idempotencyKey", "uuid-dedup")
        )
        .collect()
    );
    expect(all.length).toBe(1);
  });
});

describe("Sprint 2.29 — /lc_gtm/memory_written HTTP", () => {
  it("rejects unauthorized (no Bearer token)", async () => {
    const t = convexTest(schema, modules);
    await setupAgent(t, "u_mw_unauth");

    const response = await t.fetch("/lc_gtm/memory_written", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "x",
        target: "dreams",
        op: "append",
        triggeredBy: "test",
      }),
    });
    expect(response.status).toBe(401);
  });

  it("returns invalid_body when fields missing", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_mw_bad");
    const hookToken = await mintHookToken(t, agentId);

    const response = await t.fetch("/lc_gtm/memory_written", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "x",
        // target missing
        op: "append",
        // triggeredBy missing
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("invalid_body");
  });

  it("happy path: writes ledger row + returns ok:true", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_mw_ok");
    const hookToken = await mintHookToken(t, agentId);

    const response = await t.fetch("/lc_gtm/memory_written", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "uuid-http-1",
        target: "daily_memory",
        dateSlot: "2026-05-28",
        op: "append",
        section: "Today's plan",
        bytes: 256,
        summary: "Wrote plan section after morning brief",
        triggeredBy: "maya-morning-brief",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      rowId: string;
      deduped: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.deduped).toBe(false);

    // Ledger row exists.
    const rows = await t.query(
      internal.gtmMaya.memoryLedger.listMyMemoryWrites,
      { agentId }
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.target).toBe("daily_memory");
    expect(rows[0]?.triggeredBy).toBe("maya-morning-brief");
  });
});

describe("Sprint 2.29 — listMyMemoryWrites", () => {
  it("returns per-agent rows in desc order by writtenAt", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_mw_list");

    const base = Date.now();
    await t.mutation(internal.gtmMaya.memoryLedger.recordMemoryWriteInternal, {
      accountId,
      agentId,
      idempotencyKey: "a",
      target: "daily_memory",
      dateSlot: "2026-05-27",
      op: "append",
      triggeredBy: "maya-morning-brief",
      writtenAt: base - 60_000,
    });
    await t.mutation(internal.gtmMaya.memoryLedger.recordMemoryWriteInternal, {
      accountId,
      agentId,
      idempotencyKey: "b",
      target: "dreams",
      op: "append",
      triggeredBy: "maya-weekly-review",
      writtenAt: base,
    });

    const rows = await t.query(
      internal.gtmMaya.memoryLedger.listMyMemoryWrites,
      { agentId }
    );
    expect(rows.length).toBe(2);
    expect(rows[0]?.target).toBe("dreams"); // newest first
    expect(rows[1]?.target).toBe("daily_memory");
  });

  it("cross-tenant isolation: A doesn't see B's memory writes", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_mw_iso_a");
    const b = await setupAgent(t, "u_mw_iso_b");

    await t.mutation(internal.gtmMaya.memoryLedger.recordMemoryWriteInternal, {
      accountId: a.accountId,
      agentId: a.agentId,
      idempotencyKey: "a-write",
      target: "dreams",
      op: "append",
      triggeredBy: "maya-weekly-review",
      writtenAt: Date.now(),
    });
    await t.mutation(internal.gtmMaya.memoryLedger.recordMemoryWriteInternal, {
      accountId: b.accountId,
      agentId: b.agentId,
      idempotencyKey: "b-write",
      target: "dreams",
      op: "append",
      triggeredBy: "maya-weekly-review",
      writtenAt: Date.now(),
    });

    const aList = await t.query(
      internal.gtmMaya.memoryLedger.listMyMemoryWrites,
      { agentId: a.agentId }
    );
    const bList = await t.query(
      internal.gtmMaya.memoryLedger.listMyMemoryWrites,
      { agentId: b.agentId }
    );
    expect(aList.length).toBe(1);
    expect(bList.length).toBe(1);
    expect(aList[0]?.idempotencyKey).toBe("a-write");
    expect(bList[0]?.idempotencyKey).toBe("b-write");
  });
});
