import { describe, expect, it } from "vitest";
import {
  buildCreatorMayaFlySmokeFixture,
  buildFlyMachineRunArgs,
  runMockSmoke,
} from "../creator-maya-v0-fly-smoke";

describe("creator-maya-v0-fly-smoke", () => {
  it("builds a Creator Maya workspace from the canonical assembleWorkspaceBundle", () => {
    // Sprint 2 (slice A) deploy-path consolidation: the workspace now comes
    // from `convex/agents/packs/maya/workspace/assembleWorkspaceBundle` via
    // the thin `workspaceManifest.ts` adapter. Old thin-stub prose-only
    // assertions (e.g. "TikTok-first social media manager",
    // "Calendar: connected", `creator-calendar-content-planner` SKILL.md)
    // moved out when those stubs were deleted. Slice C will re-assert the
    // 13 maya-* / creator-* skills once they're bundled into the canonical
    // BUNDLED_SKILLS registry.
    const fixture = buildCreatorMayaFlySmokeFixture("heymaya-cmv0-smoke-test", "iad");

    expect(fixture.image).toBe("registry.fly.io/heymaya-openclaw:v2026.4.23");
    // Canonical AGENTS.md prose lives in `generateAgentsMd.ts`. Verify the
    // load-bearing first-message header is present.
    expect(fixture.workspaceFiles["AGENTS.md"]).toContain("# AGENTS.md — Maya for");
    expect(fixture.workspaceFiles["AGENTS.md"]).toContain("Operating instructions");
    // Canonical SOUL.md (Sprint 2 slice A — generated from generateSoulMd.ts)
    // is now an always-emitted root file and must carry the anti-sycophancy
    // frame.
    expect(fixture.workspaceFiles["SOUL.md"]).toContain("# SOUL.md — Maya for");
    expect(fixture.workspaceFiles["SOUL.md"]).toContain("Anti-sycophancy");
    // Canonical IDENTITY.md (Sprint 2 slice A — generated from
    // generateIdentityMd.ts) — small + stable cosmetic identity.
    expect(fixture.workspaceFiles["IDENTITY.md"]).toContain("**Name:** Maya");
    // Sprint 9.7+ — tier-aware role label. Smoke fixture uses Manager tier
    // by default → expect "content manager". Assistant tier (internal Plan
    // enum value `coach`) would emit "content assistant".
    expect(fixture.workspaceFiles["IDENTITY.md"]).toMatch(/\*\*Creature:\*\* content (manager|assistant)/);
    // Cron jobs.json includes the morning_brief entry from the canonical
    // standing-orders catalog.
    expect(fixture.workspaceFiles["jobs.json"]).toContain("morning_brief");
    // Sprint 2 final post-merge: BUNDLED + custom-maya + ClawHub pin.
    // creator-* prose stubs deleted (Slice A), maya-* skills now bundled
    // (Slice C), remotion-video-toolkit replaced with video-frames (Slice D).
    expect(fixture.workspaceFiles["skills/maya-platform/SKILL.md"]).toContain(
      "name: maya-platform"
    );
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
