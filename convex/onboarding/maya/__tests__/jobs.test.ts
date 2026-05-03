/**
 * Wave 3 — onboarding background jobs (`convex/onboarding/maya/jobs.ts`).
 *
 * Five mandatory categories per `feedback_validation_gap_prevention.md`:
 *
 *   1. Cross-tenant isolation
 *      - kickoff actions re-resolve creator from Clerk identity
 *      - getJobStatus filters to signed-in creator only
 *      - cancelJob never touches another creator's row
 *
 *   2. Plan-tier × action matrix
 *      - Onboarding is universal — all tiers can kickoff jobs / read status.
 *        Tested explicitly across starter / pro / studio.
 *
 *   3. Adversarial inputs
 *      - kickoff twice for same creator → idempotent (returns existing jobId,
 *        no double-schedule)
 *      - kickoff synth before bulk-pull done → fail-fast with reason
 *      - cancel without an active job → no-op (returns cancelled=false, NOT
 *        an error)
 *      - getJobStatus when unauthenticated → null
 *      - getJobStatus when no creator row → null
 *      - getJobStatus when no jobs → null
 *
 *   4. Sibling-file scan
 *      - `onboardingJobs` has `creatorId` + `by_creator` + `by_creator_and_type`
 *        indexes (asserted via convex schema validation at insert time).
 *
 *   5. TODO grep — covered repo-wide by sprint1Acceptance.
 *
 * Plus behavior tests:
 *   - kickoffBulkPullJob returns jobId immediately + schedules internal action
 *   - runBulkPullJob patches row → done with result on success path
 *   - runBulkPullJob patches row → failed with errorDetail on failure path
 *   - runSynthJob requires bulk-pull done first
 *   - getJobStatus returns the latest job row for the signed-in creator
 *
 * Implementation note: convex-test exposes
 * `t.finishInProgressScheduledFunctions()` which awaits all in-flight
 * scheduled work — the canonical way to test scheduler.runAfter(0, ...).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api, internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;
const TZ = "America/Los_Angeles";

beforeEach(() => {
  process.env.SCRAPE_CREATORS_API_KEY = "sc-test";
  process.env.OPENROUTER_API_KEY = "or-test";
  // Fake timers are required to deterministically drain scheduled
  // functions via `finishAllScheduledFunctions(vi.runAllTimers)` per
  // convex-test docs. Without this the runAfter(0) callback fires on
  // real-clock setTimeout which can race past test teardown.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Helper that wraps the convex-test instance to also drain any scheduled
 * work after every kickoff call. Tests that pre-seed job rows manually
 * (no scheduling) skip this. Tests that use `t.action(api...)` to kickoff
 * MUST call this before asserting on row state to avoid false negatives.
 */
async function drainScheduler(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "starter" | "pro" | "studio";
  }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: TZ,
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

async function insertDoneJob(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  jobType: "bulk-pull" | "synth-picture",
  startedAt: number = NOW
): Promise<Id<"onboardingJobs">> {
  return await t.run((ctx) =>
    ctx.db.insert("onboardingJobs", {
      creatorId,
      jobType,
      status: "done",
      startedAt,
      completedAt: startedAt + 1_000,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* kickoffBulkPullJob                                                          */
/* -------------------------------------------------------------------------- */

describe("kickoffBulkPullJob", () => {
  it("returns ok=false with reason when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(api.onboarding.maya.jobs.kickoffBulkPullJob, {});
    expect(result.ok).toBe(false);
    expect(result.jobId).toBeNull();
    expect(result.reason).toMatch(/signed-in/);
  });

  it("returns ok=false when creator row not found for signed-in user", async () => {
    const t = convexTest(schema, modules);
    const result = await asUser(t, "ghost").action(
      api.onboarding.maya.jobs.kickoffBulkPullJob,
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/creators row not found/);
  });

  it("inserts a pending job row and returns jobId immediately", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "k1", plan: "pro" });
    const result = await asUser(t, "k1").action(
      api.onboarding.maya.jobs.kickoffBulkPullJob,
      {}
    );
    expect(result.ok).toBe(true);
    expect(result.jobId).toBeDefined();
    expect(result.status).toBe("pending");

    // Job row exists and is owned by this creator (read BEFORE draining so
    // we observe the post-kickoff snapshot, not the post-worker one).
    const row = await t.run((ctx) => ctx.db.get(result.jobId!));
    expect(row).not.toBeNull();
    expect(row!.creatorId).toBe(c);
    expect(row!.jobType).toBe("bulk-pull");
    expect(row!.status).toBe("pending");
    expect(row!.expiresAt).toBeGreaterThan(row!.startedAt);

    // Drain scheduled work so it doesn't leak past test teardown.
    await drainScheduler(t);
  });

  it("ADVERSARIAL: idempotent — second kickoff returns the existing in-flight jobId", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "k2", plan: "pro" });
    const first = await asUser(t, "k2").action(
      api.onboarding.maya.jobs.kickoffBulkPullJob,
      {}
    );
    expect(first.ok).toBe(true);
    const second = await asUser(t, "k2").action(
      api.onboarding.maya.jobs.kickoffBulkPullJob,
      {}
    );
    expect(second.ok).toBe(true);
    expect(second.jobId).toBe(first.jobId);

    // Still only one row.
    const rows = await t.run((ctx) =>
      ctx.db.query("onboardingJobs").collect()
    );
    expect(rows).toHaveLength(1);

    await drainScheduler(t);
  });

  it("schedules the internal worker action via ctx.scheduler.runAfter(0)", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "k3", plan: "pro" });
    await asUser(t, "k3").action(
      api.onboarding.maya.jobs.kickoffBulkPullJob,
      {}
    );

    // Drain the scheduler so the worker fires.
    await drainScheduler(t);

    // No handles → runBulkPullJob marks the row as done with empty result.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("onboardingJobs")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("done");
    expect(rows[0].completedAt).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* runBulkPullJob (internal worker)                                            */
/* -------------------------------------------------------------------------- */

describe("runBulkPullJob", () => {
  it("creator with NO handles → marks job done with empty result", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "wb1", plan: "pro" });
    const jobId = await t.run((ctx) =>
      ctx.db.insert("onboardingJobs", {
        creatorId: c,
        jobType: "bulk-pull",
        status: "pending",
        startedAt: Date.now(),
      })
    );
    await t.action(internal.onboarding.maya.jobs.runBulkPullJob, { jobId });
    const row = await t.run((ctx) => ctx.db.get(jobId));
    expect(row?.status).toBe("done");
    expect(row?.completedAt).toBeDefined();
    expect(row?.result).toMatchObject({ handlesProcessed: 0 });
  });

  it("idempotent — re-firing on an already-done job is a no-op", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "wb2", plan: "pro" });
    const jobId = await insertDoneJob(t, c, "bulk-pull");
    const before = await t.run((ctx) => ctx.db.get(jobId));
    await t.action(internal.onboarding.maya.jobs.runBulkPullJob, { jobId });
    const after = await t.run((ctx) => ctx.db.get(jobId));
    // completedAt unchanged.
    expect(after?.completedAt).toBe(before?.completedAt);
  });

  it("ADVERSARIAL: SCRAPE_CREATORS_API_KEY missing → row patched to failed with errorDetail", async () => {
    // When the env var is missing, the ScrapeCreatorsClient constructor
    // throws synchronously inside runFullScrapePull → the action
    // propagates that throw → runBulkPullJob's catch patches the row
    // to `failed`. This is the cleanest way to drive the failure branch
    // without fighting fake timers in the per-request retry/sleep path.
    const previousKey = process.env.SCRAPE_CREATORS_API_KEY;
    delete process.env.SCRAPE_CREATORS_API_KEY;
    try {
      const t = convexTest(schema, modules);
      const c = await insertCreator(t, { suffix: "wb3", plan: "pro" });
      await t.run((ctx) =>
        ctx.db.insert("creatorHandles", {
          creatorId: c,
          platform: "tiktok",
          handle: "wb3_tt",
          verified: true,
          scrapedAt: NOW,
          followerCount: 1_000,
        })
      );
      const jobId = await t.run((ctx) =>
        ctx.db.insert("onboardingJobs", {
          creatorId: c,
          jobType: "bulk-pull",
          status: "pending",
          startedAt: Date.now(),
        })
      );
      await t.action(internal.onboarding.maya.jobs.runBulkPullJob, { jobId });
      const row = await t.run((ctx) => ctx.db.get(jobId));
      expect(row?.status).toBe("failed");
      expect(row?.errorDetail).toMatch(/SCRAPE_CREATORS_API_KEY/);
      expect(row?.completedAt).toBeDefined();
    } finally {
      if (previousKey !== undefined) {
        process.env.SCRAPE_CREATORS_API_KEY = previousKey;
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* kickoffSynthJob                                                             */
/* -------------------------------------------------------------------------- */

describe("kickoffSynthJob", () => {
  it("rejects when no bulk-pull job exists for the creator", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "ks1", plan: "pro" });
    const result = await asUser(t, "ks1").action(
      api.onboarding.maya.jobs.kickoffSynthJob,
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bulk-pull job must complete/);
  });

  it("rejects when bulk-pull job exists but isn't done yet", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "ks2", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("onboardingJobs", {
        creatorId: c,
        jobType: "bulk-pull",
        status: "running",
        startedAt: Date.now(),
      })
    );
    const result = await asUser(t, "ks2").action(
      api.onboarding.maya.jobs.kickoffSynthJob,
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bulk-pull job must complete/);
  });

  it("creates synth job when bulk-pull is done", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "ks3", plan: "pro" });
    await insertDoneJob(t, c, "bulk-pull");
    // Stub fetch: synth's worker would call OpenRouter on drain. Make
    // it 4xx so the worker fails-fast inside its own try/catch and
    // doesn't pollute teardown.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 503, headers: { "content-type": "application/json" } })
      )
    );
    const result = await asUser(t, "ks3").action(
      api.onboarding.maya.jobs.kickoffSynthJob,
      {}
    );
    expect(result.ok).toBe(true);
    expect(result.jobId).toBeDefined();
    expect(result.status).toBe("pending");

    const row = await t.run((ctx) => ctx.db.get(result.jobId!));
    expect(row?.creatorId).toBe(c);
    expect(row?.jobType).toBe("synth-picture");

    await drainScheduler(t);
  });

  it("ADVERSARIAL: idempotent — second synth kickoff returns existing in-flight jobId", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "ks4", plan: "pro" });
    await insertDoneJob(t, c, "bulk-pull");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 503, headers: { "content-type": "application/json" } })
      )
    );
    const first = await asUser(t, "ks4").action(
      api.onboarding.maya.jobs.kickoffSynthJob,
      {}
    );
    const second = await asUser(t, "ks4").action(
      api.onboarding.maya.jobs.kickoffSynthJob,
      {}
    );
    expect(second.jobId).toBe(first.jobId);

    const synthRows = await t.run((ctx) =>
      ctx.db
        .query("onboardingJobs")
        .withIndex("by_creator_and_type", (q) =>
          q.eq("creatorId", c).eq("jobType", "synth-picture")
        )
        .collect()
    );
    expect(synthRows).toHaveLength(1);

    await drainScheduler(t);
  });
});

/* -------------------------------------------------------------------------- */
/* getJobStatus                                                                */
/* -------------------------------------------------------------------------- */

describe("getJobStatus", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const res = await t.query(api.onboarding.maya.jobs.getJobStatus, {
      jobType: "bulk-pull",
    });
    expect(res).toBeNull();
  });

  it("returns null when no creator row exists for signed-in user", async () => {
    const t = convexTest(schema, modules);
    const res = await asUser(t, "missing").query(
      api.onboarding.maya.jobs.getJobStatus,
      { jobType: "bulk-pull" }
    );
    expect(res).toBeNull();
  });

  it("returns null when no jobs of that type exist", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "g1", plan: "pro" });
    const res = await asUser(t, "g1").query(
      api.onboarding.maya.jobs.getJobStatus,
      { jobType: "bulk-pull" }
    );
    expect(res).toBeNull();
  });

  it("returns the latest job row for the signed-in creator", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "g2", plan: "pro" });
    const oldJobId = await t.run((ctx) =>
      ctx.db.insert("onboardingJobs", {
        creatorId: c,
        jobType: "bulk-pull",
        status: "failed",
        startedAt: NOW - 10_000,
        completedAt: NOW - 9_000,
        errorDetail: "old-failure",
      })
    );
    const newJobId = await t.run((ctx) =>
      ctx.db.insert("onboardingJobs", {
        creatorId: c,
        jobType: "bulk-pull",
        status: "done",
        startedAt: NOW,
        completedAt: NOW + 1_000,
      })
    );
    const res = await asUser(t, "g2").query(
      api.onboarding.maya.jobs.getJobStatus,
      { jobType: "bulk-pull" }
    );
    expect(res).not.toBeNull();
    expect(res!.jobId).toBe(newJobId);
    expect(res!.jobId).not.toBe(oldJobId);
    expect(res!.status).toBe("done");
  });

  it("CROSS-TENANT: filters to signed-in creator only", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "ga", plan: "pro" });
    const b = await insertCreator(t, { suffix: "gb", plan: "pro" });
    await insertDoneJob(t, a, "bulk-pull");
    await insertDoneJob(t, b, "bulk-pull");

    const aRes = await asUser(t, "ga").query(
      api.onboarding.maya.jobs.getJobStatus,
      { jobType: "bulk-pull" }
    );
    const bRes = await asUser(t, "gb").query(
      api.onboarding.maya.jobs.getJobStatus,
      { jobType: "bulk-pull" }
    );
    // Both creators see their own row, never the other's.
    expect(aRes).not.toBeNull();
    expect(bRes).not.toBeNull();
    expect(aRes!.jobId).not.toBe(bRes!.jobId);
    // Confirm the row each saw belongs to the right creator.
    const aRow = await t.run((ctx) => ctx.db.get(aRes!.jobId));
    const bRow = await t.run((ctx) => ctx.db.get(bRes!.jobId));
    expect(aRow?.creatorId).toBe(a);
    expect(bRow?.creatorId).toBe(b);
  });
});

/* -------------------------------------------------------------------------- */
/* cancelJob                                                                   */
/* -------------------------------------------------------------------------- */

describe("cancelJob", () => {
  it("ADVERSARIAL: no-op (returns cancelled=false) when no job exists", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "c1", plan: "pro" });
    const res = await asUser(t, "c1").mutation(
      api.onboarding.maya.jobs.cancelJob,
      { jobType: "bulk-pull" }
    );
    expect(res.cancelled).toBe(false);
  });

  it("no-op (returns cancelled=false) when job is already done/failed", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "c2", plan: "pro" });
    await insertDoneJob(t, c, "bulk-pull");
    const res = await asUser(t, "c2").mutation(
      api.onboarding.maya.jobs.cancelJob,
      { jobType: "bulk-pull" }
    );
    expect(res.cancelled).toBe(false);
  });

  it("marks pending/running jobs as failed with cancelled-by-user marker", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "c3", plan: "pro" });
    const jobId = await t.run((ctx) =>
      ctx.db.insert("onboardingJobs", {
        creatorId: c,
        jobType: "bulk-pull",
        status: "running",
        startedAt: Date.now(),
      })
    );
    const res = await asUser(t, "c3").mutation(
      api.onboarding.maya.jobs.cancelJob,
      { jobType: "bulk-pull" }
    );
    expect(res.cancelled).toBe(true);
    const row = await t.run((ctx) => ctx.db.get(jobId));
    expect(row?.status).toBe("failed");
    expect(row?.errorDetail).toBe("cancelled-by-user");
  });

  it("returns cancelled=false when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.onboarding.maya.jobs.cancelJob, {
      jobType: "bulk-pull",
    });
    expect(res.cancelled).toBe(false);
  });

  it("CROSS-TENANT: cannot cancel another creator's job", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "ca", plan: "pro" });
    const b = await insertCreator(t, { suffix: "cb", plan: "pro" });
    const aJob = await t.run((ctx) =>
      ctx.db.insert("onboardingJobs", {
        creatorId: a,
        jobType: "bulk-pull",
        status: "running",
        startedAt: Date.now(),
      })
    );
    // Even though b also has no job of their own, cancel from b must
    // never touch a's row.
    const res = await asUser(t, "cb").mutation(
      api.onboarding.maya.jobs.cancelJob,
      { jobType: "bulk-pull" }
    );
    expect(res.cancelled).toBe(false);
    const aRow = await t.run((ctx) => ctx.db.get(aJob));
    expect(aRow?.status).toBe("running");
    expect(aRow?.errorDetail).toBeUndefined();

    // a can cancel their own.
    const ownCancel = await asUser(t, "ca").mutation(
      api.onboarding.maya.jobs.cancelJob,
      { jobType: "bulk-pull" }
    );
    expect(ownCancel.cancelled).toBe(true);
    void b; // referenced for clarity above
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier × action matrix (universal — onboarding bypasses billing)         */
/* -------------------------------------------------------------------------- */

describe("Plan-tier × action matrix", () => {
  for (const plan of ["starter", "pro", "studio"] as const) {
    it(`${plan}: kickoffBulkPullJob succeeds (onboarding is universal)`, async () => {
      const t = convexTest(schema, modules);
      await insertCreator(t, { suffix: `pt-${plan}`, plan });
      const res = await asUser(t, `pt-${plan}`).action(
        api.onboarding.maya.jobs.kickoffBulkPullJob,
        {}
      );
      expect(res.ok).toBe(true);
      await drainScheduler(t);
    });

    it(`${plan}: getJobStatus returns the row (no plan gating on reads)`, async () => {
      const t = convexTest(schema, modules);
      const c = await insertCreator(t, { suffix: `pg-${plan}`, plan });
      await insertDoneJob(t, c, "bulk-pull");
      const res = await asUser(t, `pg-${plan}`).query(
        api.onboarding.maya.jobs.getJobStatus,
        { jobType: "bulk-pull" }
      );
      expect(res).not.toBeNull();
      expect(res!.status).toBe("done");
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Cross-tenant isolation (kickoff actions)                                    */
/* -------------------------------------------------------------------------- */

describe("Cross-tenant isolation — kickoff actions re-resolve from Clerk", () => {
  it("creator A's kickoff never inserts a job for creator B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "xa", plan: "pro" });
    const b = await insertCreator(t, { suffix: "xb", plan: "pro" });

    await asUser(t, "xa").action(api.onboarding.maya.jobs.kickoffBulkPullJob, {});

    const bJobs = await t.run((ctx) =>
      ctx.db
        .query("onboardingJobs")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(bJobs).toHaveLength(0);

    const aJobs = await t.run((ctx) =>
      ctx.db
        .query("onboardingJobs")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    expect(aJobs).toHaveLength(1);

    await drainScheduler(t);
  });
});
