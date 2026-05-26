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

    expect(fixture.image).toBe("registry.fly.io/heymaya-openclaw:v2026.4.23");
    expect(fixture.workspaceFiles["AGENTS.md"]).toContain("Maya GTM");
    expect(fixture.workspaceFiles["TOOLS.md"]).toContain(
      "ScrapeCreators OpenClaw agent skill"
    );
    expect(fixture.workspaceFiles["HEARTBEAT.md"]).toContain(
      "ScrapeCreators calls"
    );
    expect(fixture.workspaceFiles["jobs.json"]).toContain("gtm_heartbeat");
    // Sprint 2.16c — boot collapsed back into a single unified task
    // owning the whole iterative research loop end-to-end. Was split
    // into phase_1 + phase_2 in 2.14a.7; the split was a workaround
    // for a timeout we've since removed.
    expect(fixture.workspaceFiles["jobs.json"]).toContain(
      "0001_gtm_first_research"
    );
    // Sprint 2.16j — boot cron prompt opens with "BOOT — first turn".
    // Maya does hello + research dispatch in the same focused turn
    // (BOOT.md is a workspace file Maya reads, not a native hook —
    // OpenClaw skips gateway_start hooks without a custom plugin).
    expect(fixture.workspaceFiles["jobs.json"]).toContain("BOOT — first turn");
    expect(fixture.workspaceFiles["jobs.json"]).toContain("HARD CAP: 3 lanes");
    expect(fixture.workspaceFiles["jobs.json"]).toContain(
      "subagents do all external work"
    );
    expect(
      fixture.workspaceFiles["skills/scrapecreators-api/SKILL.md"]
    ).toContain("ScrapeCreators");
    expect(fixture.gatewayConfig).toMatchObject({
      gateway: { mode: "local" },
      agents: {
        defaults: {
          workspace: "/data/workspace",
          model: { primary: "openrouter/google/gemini-3-flash-preview" },
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
            model: "openrouter/google/gemini-3-flash-preview",
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
      "OPENCLAW_MODEL=openrouter/google/gemini-3-flash-preview"
    );
    expect(args.slice(-5)).toEqual([
      "--",
      "registry.fly.io/heymaya-openclaw:v2026.4.23",
      "/bin/sh",
      "-lc",
      fixture.bootCommand,
    ]);
  });
});
