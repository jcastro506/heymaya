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
    expect(fixture.workspaceFiles["jobs.json"]).toContain(
      "Do not call ScrapeCreators"
    );
    expect(
      fixture.workspaceFiles["skills/scrapecreators-api/SKILL.md"]
    ).toContain("ScrapeCreators");
    expect(fixture.gatewayConfig).toMatchObject({
      gateway: { mode: "local" },
      agents: { defaults: { workspace: "/data/workspace" } },
      skills: { load: { watch: true } },
    });
    expect(fixture.bootCommand).toContain("openclaw gateway --allow-unconfigured");
    expect(fixture.bootCommand).toContain(
      "test -s /data/workspace/skills/scrapecreators-api/SKILL.md"
    );
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
    expect(args).toContain("OPENCLAW_MODEL=openrouter/google/gemini-3.5-flash");
    expect(args.slice(-5)).toEqual([
      "--",
      "registry.fly.io/heymaya-openclaw:v2026.4.23",
      "/bin/sh",
      "-lc",
      fixture.bootCommand,
    ]);
  });
});
