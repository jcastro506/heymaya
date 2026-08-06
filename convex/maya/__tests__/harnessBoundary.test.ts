/**
 * The boundary between OpenClaw and Convex (§18 Sprint 2.9).
 *
 * > **OpenClaw owns the agent's life. Convex owns facts and enforcement.**
 *
 * This file exists because that line was crossed and nothing noticed. The build
 * disabled OpenClaw's heartbeat, shipped no cron store, and grew a Convex
 * scheduler with a durable queue and a `wake_agent` job to replace them —
 * reimplementing a framework we pay for, while the replacement dead-lettered
 * and the whole proactive path silently did nothing.
 *
 * Every test here is a guard that would have caught some part of that on the
 * day it was written.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HANDLED_KINDS } from "../scheduler";
import {
  buildMayaWorkspace,
  CRON_STORE_PATH,
  OPENCLAW_CONFIG_PATH,
  type MayaWorkspaceInput,
} from "../../agents/packs/maya/generators";

const MAYA_DIR = join(__dirname, "..");
const CRONS = readFileSync(join(MAYA_DIR, "..", "crons.ts"), "utf8");

const INPUT: MayaWorkspaceInput = {
  founder: { email: "f@example.com", timezone: "America/Los_Angeles" },
  product: { name: "Widgetly", url: "https://widgetly.dev" },
  channels: [{ channel: "x", postingMode: "just_go" }],
};

/**
 * The only things Convex is allowed to schedule.
 *
 * Both earn their place by surviving something OpenClaw can't:
 *
 * - **delivery** — a message written but never delivered is indistinguishable,
 *   from the founder's side, from one never written. That receipt has to
 *   outlive the machine.
 * - **liveness** — a system cannot be the watchdog for itself. An agent that
 *   has stopped waking up cannot notice that it has stopped waking up.
 * - **metrics refresh** — pure collection, no judgment, which §2.3 puts in
 *   deterministic code by definition. It earns its place the same way the
 *   other two do: the machine AUTO-STOPS, so on her clock the numbers would
 *   only exist when she happened to be awake — and the evening recap, which
 *   reports them, is exactly when she has just woken up. "The database is the
 *   truth" cannot depend on the participant being running.
 *
 * Anything else on a Convex schedule is the drift returning. Adding to this
 * list should feel like a decision, which is why it's a literal and not a
 * pattern.
 */
const CONVEX_MAY_SCHEDULE = [
  /**
   * A founder connecting an account at 2am must be noticed whether or not she
   * is awake — and it is collection with no judgment in it (§2.3). Without
   * this, three channels were connected live and nothing updated until someone
   * ran the sync by hand.
   */
  "maya-sync-channels",
  "maya-refresh-metrics",
  "maya-drain-jobs",
  "maya-liveness-sweep",
] as const;

function convexCronNames(): string[] {
  return [...CRONS.matchAll(/crons\.(?:daily|interval|cron|hourly)\(\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((name) => name.startsWith("maya-"));
}

describe("CONVEX DOES NOT SCHEDULE WHAT OPENCLAW OWNS", () => {
  it("every maya Convex cron is on the allow-list", () => {
    // The guard whose absence let a morning brief and an evening recap get
    // built as Convex crons next to a cron store that already does exactly
    // that — in the founder's timezone, which the Convex ones were not.
    for (const name of convexCronNames()) {
      expect(
        (CONVEX_MAY_SCHEDULE as readonly string[]).includes(name),
        `"${name}" is a Convex cron doing OpenClaw's job — see §18 Sprint 2.9`
      ).toBe(true);
    }
  });

  it("no Convex cron re-creates the agent cadence by name", () => {
    // Belt and braces: catches a rename that slips past the allow-list.
    for (const banned of [
      "morning",
      "brief",
      "recap",
      "evening",
      "weekly",
      "heartbeat",
      "dream",
    ]) {
      for (const name of convexCronNames()) {
        expect(
          name.toLowerCase().includes(banned),
          `Convex cron "${name}" looks like agent cadence`
        ).toBe(false);
      }
    }
  });

  it("the cadence IS scheduled — just by OpenClaw", () => {
    // The inverse failure: deleting the Convex crons and forgetting to put the
    // cadence anywhere would leave a silent agent and a passing test suite.
    const cron = JSON.parse(
      buildMayaWorkspace(INPUT).files.get(CRON_STORE_PATH)!
    ) as { jobs: Array<{ id: string; schedule: { tz: string } }> };
    expect(cron.jobs.length).toBeGreaterThanOrEqual(3);
    expect(cron.jobs.some((j) => j.id.includes("brief"))).toBe(true);
    expect(cron.jobs.some((j) => j.id.includes("recap"))).toBe(true);
    // And in the founder's timezone, which is the half the Convex version got
    // wrong: a 07:00 UTC brief is a 23:00 brief in Los Angeles.
    for (const job of cron.jobs) {
      expect(job.schedule.tz).toBe("America/Los_Angeles");
    }
  });

  it("the heartbeat is enabled, so the loop has a pulse at all", () => {
    const config = JSON.parse(
      buildMayaWorkspace(INPUT).files.get(OPENCLAW_CONFIG_PATH)!
    );
    expect(config.agents.defaults.heartbeat.every).not.toBe("0m");
  });
});

describe("EVERY JOB KIND ENQUEUED HAS A HANDLER", () => {
  /**
   * Reads the actual `enqueue` call sites rather than a list someone maintains.
   *
   * `wake_agent` and `publish_placement` were both enqueued and neither was
   * routed. They dead-lettered, which *is* correct queue behaviour — a failing
   * job is a healthy queue. What nobody asked was whether the kinds being
   * produced could ever be consumed, and the suite stayed green for three PRs
   * while the proactive path did nothing.
   */
  function enqueuedKinds(): string[] {
    const kinds = new Set<string>();
    const files = ["telegram.ts", "hooks.ts", "scheduler.ts", "messages.ts"];
    for (const file of files) {
      const source = readFileSync(join(MAYA_DIR, file), "utf8");
      for (const m of source.matchAll(/kind:\s*"([a-z_]+)"/g)) {
        // Only inside an enqueue call — other `kind:` fields exist (placements,
        // drafts, breaches) and are unrelated.
        const idx = m.index ?? 0;
        const before = source.slice(Math.max(0, idx - 300), idx);
        if (/jobs\.enqueue,\s*\{[^}]*$/.test(before)) kinds.add(m[1]);
      }
    }
    return [...kinds];
  }

  it("finds the enqueue sites at all", () => {
    // A matcher that silently finds nothing would make every assertion below
    // vacuously true — the exact failure mode of the first skill-coherence test.
    expect(enqueuedKinds().length).toBeGreaterThan(0);
  });

  it("every enqueued kind is one the drainer can actually run", () => {
    const orphans = enqueuedKinds().filter((k) => !HANDLED_KINDS.has(k));
    expect(
      orphans,
      `enqueued with no handler — these dead-letter silently: ${orphans.join(", ")}`
    ).toEqual([]);
  });

  it("HANDLED_KINDS is not empty, and stays small", () => {
    // Small on purpose. Convex should be running almost nothing; a growing list
    // here is the drift coming back one job at a time.
    expect(HANDLED_KINDS.size).toBeGreaterThan(0);
    expect(HANDLED_KINDS.size).toBeLessThanOrEqual(3);
  });

  it("wake_agent is gone — the machine is always on now", () => {
    // It existed to boot an auto-stopped machine, had no handler, and its whole
    // reason for existing was removed with auto-stop.
    expect(HANDLED_KINDS.has("wake_agent")).toBe(false);
    for (const file of ["telegram.ts", "scheduler.ts"]) {
      const source = readFileSync(join(MAYA_DIR, file), "utf8");
      const enqueuesWake = /kind:\s*"wake_agent"/.test(source);
      expect(enqueuesWake, `${file} still enqueues wake_agent`).toBe(false);
    }
  });
});
