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
      "registry.fly.io/heymaya-openclaw@sha256:7b53d73a3c2c40f47865c508bddffccd2fbc21d28bd7ac938ed080fb2a24764d"
    );
    expect(fixture.workspaceFiles["AGENTS.md"]).toContain("Maya GTM");
    expect(fixture.workspaceFiles["TOOLS.md"]).toContain(
      "ScrapeCreators OpenClaw agent skill"
    );
    // BOOT.md starts launch work immediately; HEARTBEAT.md is now only
    // the watchdog/recovery loop.
    expect(fixture.workspaceFiles["BOOT.md"]).toContain("gateway:startup");
    expect(fixture.workspaceFiles["BOOT.md"]).toContain("sessions_spawn");
    expect(fixture.workspaceFiles["HEARTBEAT.md"]).toContain("launch-watchdog");
    expect(fixture.workspaceFiles["HEARTBEAT.md"]).not.toContain("state-hello");
    // Sprint 2.16u-fix8 — firewall removed; voice contract now in SOUL.md.
    expect(fixture.workspaceFiles["HEARTBEAT.md"]).toContain("SOUL.md");
    // Boot cron and heartbeat cron are GONE — only scheduled events
    // (weekly review, monthly channel discovery) live in jobs.json.
    expect(fixture.workspaceFiles["jobs.json"]).not.toContain("gtm_heartbeat");
    expect(fixture.workspaceFiles["jobs.json"]).not.toContain(
      "0001_gtm_first_research"
    );
    expect(fixture.workspaceFiles["jobs.json"]).toContain("gtm_weekly_review");
    expect(fixture.workspaceFiles["jobs.json"]).toContain(
      "gtm_channel_discovery"
    );
    // First hello is BOOT.md/native hook work, not a +300s cron.
    expect(fixture.workspaceFiles["jobs.json"]).not.toContain("0001_kickstart");
    expect(fixture.workspaceFiles["jobs.json"]).not.toContain("FIRST-BOOT KICKSTART");
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
      "registry.fly.io/heymaya-openclaw@sha256:7b53d73a3c2c40f47865c508bddffccd2fbc21d28bd7ac938ed080fb2a24764d",
      "/bin/sh",
      "-lc",
      fixture.bootCommand,
    ]);
  });
});
