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

  it("emits mode:announce with telegram routing when chat is paired", () => {
    const { files } = buildMayaGtmWorkspace({
      ...BASE_INPUT,
      telegramChatId: "555111222",
      channelPreference: "telegram",
    });
    const { jobs } = getJobs(files);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.delivery.mode).toBe("announce");
      expect(job.delivery.channel).toBe("telegram");
      expect(job.delivery.to).toBe("555111222");
      expect(job.delivery.bestEffort).toBe(true);
    }
  });

  it("REGRESSION GUARD: zero cron jobs ever emit mode:none when paired", () => {
    // The Sprint 14 contract per Part III: a paired account must never get
    // a workspace bundle with a mode:none cron. This test will catch any
    // future code change that accidentally regresses to the silent default.
    const { files } = buildMayaGtmWorkspace({
      ...BASE_INPUT,
      telegramChatId: "9999",
      channelPreference: "telegram",
    });
    const { jobs } = getJobs(files);
    const offenders = jobs.filter((j) => j.delivery.mode === "none");
    expect(offenders).toEqual([]);
  });

  it("templates failureDestination URL when provided", () => {
    const { files } = buildMayaGtmWorkspace({
      ...BASE_INPUT,
      telegramChatId: "555111222",
      channelPreference: "telegram",
      deliveryFailureDestination:
        "https://precise-canary-781.convex.site/lc_gtm/delivery_failure",
    });
    const { jobs } = getJobs(files);
    for (const job of jobs) {
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
