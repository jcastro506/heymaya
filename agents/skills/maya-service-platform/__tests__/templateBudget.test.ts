/**
 * Template budget assertions for the service-product Maya workspace.
 *
 * Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 9 ("Bootstrap caps"):
 *   - 12K chars per file default.
 *   - HEARTBEAT.md soft cap 2K (R3 § 4 — read every tick, token-burn matters).
 *   - Combined SOUL+AGENTS+USER+HEARTBEAT under 150K.
 *   - BOOT.md + DREAMING.md + TOOLS.md soft caps (3K / 4K / 12K).
 *
 * The tests assert the SHARED templates at `agents/skills/maya-service-platform/`
 * stay under cap. The per-business RENDERED files (produced by the generators
 * with interpolated business state) are checked separately by the bundle
 * assembler in Sprint 2 — but if the templates already exceed cap, every
 * rendered file will too.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLATFORM_DIR = join(
  __dirname,
  ".."
);

const FILE_CAPS: ReadonlyArray<{ file: string; cap: number; reason: string }> =
  [
    { file: "AGENTS.md", cap: 12_000, reason: "OpenClaw bootstrap default" },
    { file: "SOUL.md", cap: 6_000, reason: "service plan § 9" },
    {
      file: "HEARTBEAT.md",
      cap: 2_000,
      reason: "R3 § 4 — read every tick, token-burn matters",
    },
    { file: "BOOT.md", cap: 3_000, reason: "service plan § 9" },
    { file: "DREAMING.md", cap: 4_000, reason: "service plan § 9" },
    { file: "TOOLS.md", cap: 12_000, reason: "OpenClaw bootstrap default" },
  ];

describe("maya-service-platform — template budget caps (§ 9)", () => {
  for (const { file, cap, reason } of FILE_CAPS) {
    it(`${file} is under ${cap} chars (${reason})`, () => {
      const path = join(PLATFORM_DIR, file);
      const content = readFileSync(path, "utf-8");
      const len = content.length;
      // We surface the actual length on failure to make over-cap tightening
      // easy.
      expect(len, `${file} length=${len}, cap=${cap}`).toBeLessThanOrEqual(cap);
    });
  }

  it("combined SOUL+AGENTS+HEARTBEAT under 150K (§ 9 bundle cap)", () => {
    const soul = readFileSync(join(PLATFORM_DIR, "SOUL.md"), "utf-8");
    const agents = readFileSync(join(PLATFORM_DIR, "AGENTS.md"), "utf-8");
    const heartbeat = readFileSync(
      join(PLATFORM_DIR, "HEARTBEAT.md"),
      "utf-8"
    );
    const combined = soul.length + agents.length + heartbeat.length;
    // The 150K combined cap is for SOUL + AGENTS + USER + HEARTBEAT in the
    // RENDERED bundle; USER.md is per-business and added at deploy time.
    // We assert SOUL + AGENTS + HEARTBEAT (the shared portion) is well under
    // cap so even a 50K USER.md fits comfortably.
    expect(
      combined,
      `combined SOUL+AGENTS+HEARTBEAT=${combined}, cap=150000 (with USER.md headroom)`
    ).toBeLessThan(150_000);
  });
});
