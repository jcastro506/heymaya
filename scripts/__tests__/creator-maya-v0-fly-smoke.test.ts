import { describe, expect, it } from "vitest";
import {
  buildCreatorMayaFlySmokeFixture,
  buildFlyMachineRunArgs,
  runMockSmoke,
} from "../creator-maya-v0-fly-smoke";

describe("creator-maya-v0-fly-smoke", () => {
  it("builds an iMessage-only Creator Maya workspace for OpenClaw", () => {
    const fixture = buildCreatorMayaFlySmokeFixture("heymaya-cmv0-smoke-test", "iad");

    expect(fixture.image).toBe("registry.fly.io/heymaya-openclaw:v2026.4.23");
    expect(fixture.workspaceFiles["AGENTS.md"]).toContain("TikTok-first social media manager");
    expect(fixture.workspaceFiles["AGENTS.md"]).toContain("primary outbound channel is iMessage");
    expect(fixture.workspaceFiles["AGENTS.md"]).toContain(
      "Do not use SMS, WhatsApp, email, or web chat in v0"
    );
    expect(fixture.workspaceFiles["TOOLS.md"]).not.toMatch(/sms|whatsapp/i);
    expect(fixture.workspaceFiles["TOOLS.md"]).toContain("brand.send_approved_email");
    expect(fixture.workspaceFiles["TOOLS.md"]).toContain("fail closed");
    expect(fixture.workspaceFiles["USER.md"]).toContain("Calendar: connected");
    expect(fixture.workspaceFiles["jobs.json"]).toContain("morning_brief");
    expect(fixture.workspaceFiles["skills/creator-calendar-content-planner/SKILL.md"]).toContain(
      "name: creator-calendar-content-planner"
    );
    // Sprint 2 Slice D — pin set refresh. remotion-video-toolkit dropped;
    // video-frames is the new ClawHub pin we smoke-check (it's the closest
    // analog and keeps the lock file healthy through hydration-stub state).
    expect(fixture.workspaceFiles[".clawhub/lock.json"]).toContain(
      "video-frames"
    );
    expect(fixture.workspaceFiles["skills/video-frames/SKILL.md"]).toContain(
      "name: video-frames"
    );
    expect(fixture.workspaceFiles["skills/tiktok/SKILL.md"]).toContain("name: tiktok");
    expect(fixture.gatewayConfig).toMatchObject({
      agents: { defaults: { workspace: "/data/workspace" } },
      skills: { load: { watch: true } },
    });
    expect(fixture.bootCommand).toContain("openclaw gateway --allow-unconfigured");
    expect(fixture.bootCommand).toContain("test -w /data/cron");
  });

  it("maps every workspace file into the expected Fly machine paths", () => {
    const result = runMockSmoke();

    expect(result.fileTargets).toContain("/data/workspace/AGENTS.md");
    expect(result.fileTargets).toContain("/data/workspace/SOUL.md");
    expect(result.fileTargets).toContain("/data/workspace/USER.md");
    expect(result.fileTargets).toContain("/data/cron/jobs.json");
    expect(result.fileTargets).toContain("/data/openclaw.json");
  });

  it("uses a paid-live guarded Fly command shape", () => {
    const fixture = buildCreatorMayaFlySmokeFixture("heymaya-cmv0-smoke-test", "iad");
    const args = buildFlyMachineRunArgs(fixture, "/tmp/cmv0");

    expect(args).toContain("machine");
    expect(args).toContain("run");
    expect(args).toContain("--detach");
    expect(args).toContain("--restart");
    expect(args).toContain("always");
    expect(args).toContain("--vm-memory");
    expect(args).toContain("1024");
    expect(args).toContain("OPENCLAW_STATE_DIR=/data");
    expect(args.slice(-5)).toEqual([
      "--",
      "registry.fly.io/heymaya-openclaw:v2026.4.23",
      "/bin/sh",
      "-lc",
      fixture.bootCommand,
    ]);
  });
});
