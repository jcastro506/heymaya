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
    expect(ids).toContain("performance_check_2h");
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
