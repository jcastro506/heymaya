import { describe, expect, it } from "vitest";
import {
  buildFlyMachineRunArgs,
  buildGtmOpenClawFlySmokeFixture,
  runMockSmoke,
} from "../gtm-openclaw-fly-smoke";

describe("gtm-openclaw-fly-smoke", () => {
  it("builds a GTM workspace with cron jobs and ScrapeCreators skill", () => {
    const fixture = buildGtmOpenClawFlySmokeFixture(
      "clawlaunch-gtm-smoke-test",
      "iad"
    );

    expect(fixture.image).toBe(
      "registry.fly.io/heymaya-openclaw@sha256:dd4fd47d15e641c726fc9e3914b2dbd967d07bbdc806e80e6b8743978b68deed"
    );
    // ── Test-design rule for this file ────────────────────────────────────
    // ASSERT ON STRUCTURE AND STABLE IDENTIFIERS. NEVER ON GENERATED PROSE.
    //
    // This block previously substring-matched sentences inside AGENTS.md,
    // BOOT.md and HEARTBEAT.md ("Maya GTM", "gateway:startup", "launch-watchdog",
    // "ScrapeCreators OpenClaw agent skill"...). Those files are prompt prose that
    // is edited most weeks, so every edit broke this smoke test for reasons that
    // had nothing to do with the thing it exists to protect — that the workspace
    // BUILDS, with every required file present and non-empty.
    //
    // Config identifiers (jobs.json cron ids), file presence, the gateway config
    // shape, and the Fly command are all stable and stay asserted below.
    const REQUIRED_WORKSPACE_FILES = [
      "AGENTS.md",
      "BOOT.md",
      "HEARTBEAT.md",
      "TOOLS.md",
      "SOUL.md",
      "jobs.json",
      "skills/scrapecreators-api/SKILL.md",
    ];
    for (const name of REQUIRED_WORKSPACE_FILES) {
      const contents = fixture.workspaceFiles[name];
      expect(contents, `${name} missing from the built workspace`).toBeTypeOf(
        "string"
      );
      // Catches the real failure mode: a generator that silently emits nothing.
      expect(
        (contents ?? "").length,
        `${name} was emitted but is suspiciously small`
      ).toBeGreaterThan(200);
    }
    // Cron ids are STABLE IDENTIFIERS (jobs.json ships them deterministically and
    // the agent is forbidden from inventing crons at runtime), so asserting the
    // exact set is safe — and it catches additions as well as removals, which
    // substring checks never did. The previous assertions looked for a
    // `gtm_weekly_review` / `gtm_channel_discovery` naming scheme that no longer
    // exists, and for `hello_sent_at`, which is prose inside a job message.
    const jobIds = (
      JSON.parse(fixture.workspaceFiles["jobs.json"]) as {
        jobs: Array<{ id: string }>;
      }
    ).jobs.map((j) => j.id);
    expect(jobIds).toEqual([
      "0001_kickstart",
      "0002_foundation_resume_8m",
      "0003_foundation_resume_16m",
      "0004_foundation_resume_24m",
      "0010_morning_brief",
      "0011_midday_pulse",
      "0012_evening_recap",
      "0013_weekly_review",
      "0014_monthly_reset",
      "0015_dreaming",
    ]);
    // The heartbeat cron stays gone — re-adding it is the runaway-loop regression.
    expect(jobIds).not.toContain("gtm_heartbeat");
    expect(
      fixture.workspaceFiles["skills/scrapecreators-api/SKILL.md"]
    ).toContain("ScrapeCreators");
    expect(fixture.gatewayConfig).toMatchObject({
      gateway: { mode: "local" },
      agents: {
        defaults: {
          workspace: "/data/workspace",
          model: { primary: "openrouter/anthropic/claude-sonnet-4.5" },
          memorySearch: { enabled: false },
          subagents: {
            // Sprint 2.16j — bumped 4 → 8 per external-architect review.
            maxConcurrent: 8,
            maxChildrenPerAgent: 4,
            runTimeoutSeconds: 900,
            archiveAfterMinutes: 60,
          },
        },
        list: [
          {
            id: "main",
            default: true,
            name: "Maya",
            workspace: "/data/workspace",
            model: "openrouter/anthropic/claude-sonnet-4.5",
            subagents: { allowAgents: ["main", "hard_research_beta"] },
            tools: { profile: "coding" },
          },
          {
            id: "hard_research_beta",
            name: "Hard Research Beta",
            workspace: "/data/workspace",
            model: "openrouter/anthropic/claude-sonnet-4.5",
            tools: { profile: "coding" },
          },
        ],
      },
      plugins: {
        entries: {
          acpx: { enabled: false },
          browser: { enabled: false },
          "device-pair": { enabled: false },
          "phone-control": { enabled: false },
          "talk-voice": { enabled: false },
        },
      },
      discovery: { mdns: { mode: "off" } },
      skills: { load: { watch: true } },
    });
    expect(fixture.bootCommand).toContain("openclaw gateway --allow-unconfigured");
    expect(fixture.bootCommand).toContain(
      "test -s /data/workspace/skills/scrapecreators-api/SKILL.md"
    );
    expect(fixture.bootCommand).toContain("chmod 700 /data/cron");
  });

  it("maps the GTM workspace into Fly/OpenClaw runtime paths", () => {
    const result = runMockSmoke();

    expect(result.fileTargets).toContain("/data/workspace/AGENTS.md");
    expect(result.fileTargets).toContain("/data/workspace/TOOLS.md");
    expect(result.fileTargets).toContain("/data/workspace/HEARTBEAT.md");
    expect(result.fileTargets).toContain(
      "/data/workspace/skills/scrapecreators-api/SKILL.md"
    );
    expect(result.fileTargets).toContain("/data/cron/jobs.json");
    expect(result.fileTargets).toContain("/data/openclaw.json");
  });

  it("uses a guarded Fly command shape for paid live smoke", () => {
    const fixture = buildGtmOpenClawFlySmokeFixture(
      "clawlaunch-gtm-smoke-test",
      "iad"
    );
    const args = buildFlyMachineRunArgs(fixture, "/tmp/gtm");

    expect(args).toContain("machine");
    expect(args).toContain("run");
    expect(args).toContain("--detach");
    expect(args).toContain("--restart");
    expect(args).toContain("always");
    expect(args).toContain("OPENCLAW_STATE_DIR=/data");
    expect(args).toContain("OPENCLAW_CONFIG_PATH=/data/openclaw.json");
    expect(args).toContain("OPENCLAW_DISABLE_BONJOUR=1");
    expect(args).toContain(
      "OPENCLAW_MODEL=openrouter/anthropic/claude-sonnet-4.5"
    );
    expect(args.slice(-5)).toEqual([
      "--",
      "registry.fly.io/heymaya-openclaw@sha256:dd4fd47d15e641c726fc9e3914b2dbd967d07bbdc806e80e6b8743978b68deed",
      "/bin/sh",
      "-lc",
      fixture.bootCommand,
    ]);
  });
});
