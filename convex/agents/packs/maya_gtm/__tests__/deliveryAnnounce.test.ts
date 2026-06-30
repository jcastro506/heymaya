import { describe, expect, it } from "vitest";
import { buildMayaGtmWorkspace } from "../generators";

const BASE_INPUT = {
  accountEmail: "rwtc@heymaya.test",
  timezone: "America/New_York",
  bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
  app: {
    name: "Sprint 14 Fixture",
    url: "https://sprint14.test/",
    stage: "live-beta" as const,
    weekGoal: "signups" as const,
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  },
};

// Internal/conditional crons silenced by the 2026-06-28 status-leak fix: their
// raw turn reply is never announced — they reach the founder ONLY via the
// explicit send_update tool (Convex→Telegram). Founder-facing daily crons keep
// announce. Keep this in sync with SILENT_JOB_IDS in generators.ts.
const SILENT_IDS = new Set([
  "0001_kickstart",
  "0002_foundation_resume_8m",
  "0003_foundation_resume_16m",
  "0004_foundation_resume_24m",
  "0015_dreaming",
  "0016_discovery_pulse",
]);

interface CronJob {
  id: string;
  delivery: {
    mode: string;
    channel?: string;
    to?: string;
    failureDestination?: string;
    bestEffort?: boolean;
  };
}

interface JobsBundle {
  version: number;
  jobs: CronJob[];
}

function getJobs(files: Map<string, string>): JobsBundle {
  const json = files.get("jobs.json");
  if (!json) throw new Error("jobs.json missing");
  return JSON.parse(json) as JobsBundle;
}

describe("Sprint 14 — native cron delivery", () => {
  it("emits mode:none when telegramChatId is unset (pre-pairing fallback)", () => {
    const { files } = buildMayaGtmWorkspace({ ...BASE_INPUT });
    const { jobs } = getJobs(files);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.delivery.mode).toBe("none");
      expect(job.delivery.channel).toBeUndefined();
      expect(job.delivery.to).toBeUndefined();
    }
  });

  it("emits mode:announce + telegram routing for founder-facing crons, mode:none for silenced ones, when paired", () => {
    const { files } = buildMayaGtmWorkspace({
      ...BASE_INPUT,
      telegramChatId: "555111222",
      channelPreference: "telegram",
    });
    const { jobs } = getJobs(files);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      if (SILENT_IDS.has(job.id)) {
        // Status-leak fix: raw turn reply never announced; send_update only.
        expect(job.delivery.mode).toBe("none");
        expect(job.delivery.channel).toBeUndefined();
        continue;
      }
      expect(job.delivery.mode).toBe("announce");
      expect(job.delivery.channel).toBe("telegram");
      expect(job.delivery.to).toBe("555111222");
      expect(job.delivery.bestEffort).toBe(true);
    }
  });

  it("REGRESSION GUARD: EXACTLY the known internal/conditional crons are silent when paired; every other cron announces", () => {
    // The contract: founder-facing daily crons must announce when paired, and
    // only the documented internal/conditional set is silenced. Catches both a
    // regression that re-announces a leaky internal cron AND one that
    // accidentally mutes a founder-facing brief.
    const { files } = buildMayaGtmWorkspace({
      ...BASE_INPUT,
      telegramChatId: "9999",
      channelPreference: "telegram",
    });
    const { jobs } = getJobs(files);
    const allIds = new Set(jobs.map((j) => j.id));
    const silent = jobs
      .filter((j) => j.delivery.mode === "none")
      .map((j) => j.id)
      .sort();
    // 0016_discovery_pulse only renders when the realtime-operator pulse flag is
    // on, so intersect the expected silent set with what's actually present.
    const expectedSilent = [...SILENT_IDS].filter((id) => allIds.has(id)).sort();
    expect(silent).toEqual(expectedSilent);
  });

  it("templates failureDestination URL on announce crons when provided (silent crons carry none)", () => {
    const { files } = buildMayaGtmWorkspace({
      ...BASE_INPUT,
      telegramChatId: "555111222",
      channelPreference: "telegram",
      deliveryFailureDestination:
        "https://precise-canary-781.convex.site/lc_gtm/delivery_failure",
    });
    const { jobs } = getJobs(files);
    for (const job of jobs) {
      if (SILENT_IDS.has(job.id)) {
        expect("failureDestination" in job.delivery).toBe(false);
        continue;
      }
      expect(job.delivery.failureDestination).toBe(
        "https://precise-canary-781.convex.site/lc_gtm/delivery_failure"
      );
    }
  });

  it("does not emit a failureDestination key when the input is unset", () => {
    const { files } = buildMayaGtmWorkspace({
      ...BASE_INPUT,
      telegramChatId: "555111222",
      channelPreference: "telegram",
    });
    const { jobs } = getJobs(files);
    for (const job of jobs) {
      expect("failureDestination" in job.delivery).toBe(false);
    }
  });

  it("falls back to mode:none if channelPreference is not telegram", () => {
    // Defensive: even with a telegramChatId set, if channelPreference says
    // imessage/whatsapp/web we don't claim Telegram is the right delivery.
    const { files } = buildMayaGtmWorkspace({
      ...BASE_INPUT,
      telegramChatId: "555111222",
      channelPreference: "imessage",
    });
    const { jobs } = getJobs(files);
    for (const job of jobs) {
      expect(job.delivery.mode).toBe("none");
    }
  });
});
