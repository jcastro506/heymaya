/**
 * buildCronJobsJson — pure-logic unit tests.
 *
 * Coverage:
 *   - Plan-tier gating: Starter gets only "all"-tier programs; Pro/Studio
 *     get all programs.
 *   - 5-field cron expression validation per entry.
 *   - IANA timezone validation.
 *   - Session assignment: accountability_nudge uses "main"; everything
 *     else uses "isolated".
 *   - Determinism: same inputs twice → identical output (sort by name).
 *   - Each emitted job carries a stable `id` matching cron.md.
 *   - Sprint 3 Slice 1: cron set collapsed to exactly 6 precise-timing
 *     entries (morning_brief, evening_recap, weekly_content_plan,
 *     weekly_review, accountability_nudge, revenue_snapshot). Other 9
 *     standing-orders moved to kind="heartbeat"; 6 deleted for MVP.
 */

import { describe, it, expect } from "vitest";
import { buildCronJobsJson } from "../buildCronJobsJson";
import { STANDING_ORDERS } from "../standingOrders";

const FIVE_FIELD_CRON = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

function creator(plan: "coach" | "manager", tz = "America/Los_Angeles") {
  return { plan, timezone: tz };
}

describe("buildCronJobsJson", () => {
  it("coach excludes any Manager-only cron programs (autonomy gating)", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("coach") });
    const ids = jobs.map((j) => j.id);
    const managerOnlyCronIds = STANDING_ORDERS.filter(
      (p) => p.tier === "manager" && p.kind === "cron"
    )
      .map((p) => p.cronEntryId!)
      .filter(Boolean);
    // After the advisory-program reclassification (revenue_snapshot,
    // competitor_watch, calendar_lookahead, manager_readiness_packet,
    // industry_intel, algo_research_*) → tier:"all", there may be ZERO
    // Manager-only cron programs (autonomy gates land on event / folded
    // triggers like brand_outreach, pitch_strategy, hook_library_build).
    // The invariant we're asserting: NONE of any Manager-only crons that
    // do exist may appear in Coach's cron set.
    for (const id of managerOnlyCronIds) {
      expect(ids).not.toContain(id);
    }
  });

  it("pro receives the full cron set", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const ids = jobs.map((j) => j.id);
    const allCronIds = STANDING_ORDERS.filter((p) => p.kind === "cron").map(
      (p) => p.cronEntryId!
    );
    for (const id of allCronIds) {
      expect(ids).toContain(id);
    }
  });

  it("studio receives the same set as pro (cron coverage is identical; cadence differences are out of scope here)", () => {
    const pro = buildCronJobsJson({ creator: creator("manager") }).jobs;
    const studio = buildCronJobsJson({ creator: creator("manager") }).jobs;
    expect(studio.map((j) => j.id).sort()).toEqual(
      pro.map((j) => j.id).sort()
    );
  });

  it("every emitted job has a valid 5-field cron expression", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    for (const j of jobs) {
      expect(j.schedule.kind).toBe("cron");
      expect(FIVE_FIELD_CRON.test(j.schedule.expr)).toBe(true);
    }
  });

  it("every emitted job carries the creator's timezone", () => {
    const { jobs } = buildCronJobsJson({
      creator: creator("manager", "Asia/Tokyo"),
    });
    for (const j of jobs) {
      expect(j.schedule.tz).toBe("Asia/Tokyo");
    }
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() =>
      buildCronJobsJson({ creator: creator("manager", "not a tz") })
    ).toThrow(/invalid IANA timezone/);
  });

  it("accountability_nudge uses session='main'; other entries use 'isolated'", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const nudge = jobs.find((j) => j.id === "accountability_nudge");
    expect(nudge?.sessionTarget).toBe("main");
    expect(nudge?.payload.kind).toBe("systemEvent");
    const others = jobs.filter((j) => j.id !== "accountability_nudge");
    for (const j of others) {
      expect(j.sessionTarget).toBe("isolated");
      expect(j.payload.kind).toBe("agentTurn");
      expect(j.delivery?.mode).toBe("announce");
    }
  });

  it("emits jobs sorted by name for deterministic deploy diffs", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const names = jobs.map((j) => j.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("is deterministic across calls", () => {
    const a = buildCronJobsJson({ creator: creator("manager") });
    const b = buildCronJobsJson({ creator: creator("manager") });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("each emitted job has a non-empty message", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    for (const j of jobs) {
      const message =
        j.payload.kind === "agentTurn" ? j.payload.message : j.payload.text;
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("starter emits the morning_brief, evening_recap, weekly_review entries", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("coach") });
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain("morning_brief");
    expect(ids).toContain("evening_recap");
    expect(ids).toContain("weekly_review");
    expect(ids).toContain("weekly_content_plan");
  });

  /* ----- Sprint 3 Slice 1: cron count locked at exactly 6 ----- */

  // The six precise-timing entries Maya runs as real cron jobs. Everything
  // else fires off heartbeat ticks during waking hours, where the LLM
  // decides whether the trigger condition is met. Adding a cron without
  // moving the corresponding cron.md prose + agent UX line is a bug; this
  // assertion is the trip wire.
  const SPRINT_3_CRON_SET: ReadonlyArray<string> = [
    "morning_brief",
    "evening_recap",
    "weekly_content_plan",
    "weekly_review",
    "accountability_nudge",
    "revenue_snapshot",
  ];

  // Standing orders that USED to be cron and are now heartbeat-driven.
  // They MUST still exist in the catalog (Slice 2 reads them for
  // generateHeartbeatMd.ts) but MUST NOT appear in jobsJson.
  const SPRINT_3_HEARTBEAT_SET: ReadonlyArray<string> = [
    "performance_check_2h",
    "daily_niche_scan",
    "trend_watcher",
    "comment_triage",
    "competitor_watch",
    "calendar_lookahead",
    "industry_intel_daily",
    "opportunity_scout_daily",
    "collab_matchmaker_weekly",
  ];

  // Standing orders deleted entirely for MVP. They MUST NOT exist in
  // STANDING_ORDERS at all. If a future sprint reintroduces any of them,
  // delete the corresponding line here.
  const SPRINT_3_DELETED_SET: ReadonlyArray<string> = [
    "manager_readiness_packet_quarterly",
    "algo_research_tiktok",
    "algo_research_instagram",
    "algo_research_youtube",
    "algo_research_linkedin",
    "algo_research_x",
  ];

  it("Sprint 3 Slice 1: emits exactly 6 cron entries (Manager) — collapsed from 21", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    expect(jobs.length).toBe(6);
  });

  it("Sprint 3 Slice 1: emits exactly 6 cron entries (Coach) — same 6, all tier='all'", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("coach") });
    expect(jobs.length).toBe(6);
  });

  it("Sprint 3 Slice 1: each of the 6 kept slugs is present in the emitted cron set", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const ids = jobs.map((j) => j.entryId);
    for (const slug of SPRINT_3_CRON_SET) {
      expect(ids, `missing required cron slug: ${slug}`).toContain(slug);
    }
  });

  it("Sprint 3 Slice 1: emitted cron set is EXACTLY the 6 kept slugs (no extras)", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const emitted = new Set(jobs.map((j) => j.entryId));
    const expected = new Set(SPRINT_3_CRON_SET);
    expect(emitted).toEqual(expected);
  });

  it("Sprint 3 Slice 1: moved-to-heartbeat slugs still exist in STANDING_ORDERS with kind='heartbeat'", () => {
    for (const slug of SPRINT_3_HEARTBEAT_SET) {
      const program = STANDING_ORDERS.find((p) => p.id === slug);
      expect(program, `heartbeat slug missing from catalog: ${slug}`).toBeDefined();
      expect(
        program!.kind,
        `slug '${slug}' should be kind='heartbeat' but is '${program!.kind}'`
      ).toBe("heartbeat");
    }
  });

  it("Sprint 3 Slice 1: moved-to-heartbeat slugs do NOT appear in jobsJson", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const ids = new Set(jobs.map((j) => j.entryId));
    for (const slug of SPRINT_3_HEARTBEAT_SET) {
      expect(
        ids.has(slug),
        `slug '${slug}' is heartbeat-kind and must NOT be in jobsJson`
      ).toBe(false);
    }
  });

  it("Sprint 3 Slice 1: deleted slugs are NOT in STANDING_ORDERS at all", () => {
    const ids = new Set(STANDING_ORDERS.map((p) => p.id));
    for (const slug of SPRINT_3_DELETED_SET) {
      expect(
        ids.has(slug),
        `slug '${slug}' should be deleted but is still in catalog`
      ).toBe(false);
    }
  });

  it("emits OpenClaw 2026 normalized job objects", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    for (const job of jobs) {
      expect(job.id).toMatch(/^[a-z0-9_]+$/);
      expect(job.enabled).toBe(true);
      expect(job.createdAtMs).toBe(0);
      expect(job.updatedAtMs).toBe(0);
      expect(job.wakeMode).toBe("now");
      expect(job.schedule.kind).toBe("cron");
      expect(job.payload.kind).toMatch(/^(agentTurn|systemEvent)$/);
      expect("cron" in job).toBe(false);
      expect("session" in job).toBe(false);
      expect("message" in job).toBe(false);
      expect("entryId" in job).toBe(false);
    }
  });
});
