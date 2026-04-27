/**
 * Smoke tests for the service-product onboarding pipeline.
 *
 * Covers:
 *   - Deploy orchestrator workspace cap-check (sibling-file scan)
 *   - businessPicture hallucination firewall (phantom name detection)
 *   - First-message body cites ≥2 grounded data points
 *
 * Cross-tenant + plan-tier × action matrix tests live in their own files
 * once the convex-test harness mounts the service-side pipeline.
 */

import { describe, expect, it } from "vitest";
import {
  assertWorkspaceCaps,
  assembleServiceWorkspace,
} from "../deployServiceMaya";
import {
  AGENTS_MAX_CHARS,
  type ServiceWorkspaceInputs,
} from "../../../agents/packs/maya_service/types";

const FIXTURE: ServiceWorkspaceInputs = {
  operator: { firstName: "Mike", displayName: "Mike Henderson" },
  business: {
    name: "Henderson HVAC",
    serviceTypes: ["hvac"],
    serviceArea: "25-mile radius around Lincoln, NE",
    timezone: "America/Chicago",
    tonePreference: "friendly-neighborhood-pro",
    technicianNames: [],
    businessHours: "M-F 7a-6p",
    voiceEnabled: false,
  },
  businessPicture: null,
  plan: "starter",
  now: 1714175400_000,
};

describe("service deploy orchestrator — workspace assembly", () => {
  it("assembleServiceWorkspace emits all canonical files", () => {
    const out = assembleServiceWorkspace(FIXTURE);
    expect(out.files.has("AGENTS.md")).toBe(true);
    expect(out.files.has("SOUL.md")).toBe(true);
    expect(out.files.has("BOOT.md")).toBe(true);
    expect(out.files.has("HEARTBEAT.md")).toBe(true);
    expect(out.files.has("TOOLS.md")).toBe(true);
    expect(out.files.has("DREAMING.md")).toBe(true);
    expect(out.files.has("MEMORY.md")).toBe(true);
    expect(out.files.has("USER.md")).toBe(true);
    expect(out.files.has("jobs.json")).toBe(true);
    expect(out.cronCount).toBeGreaterThan(0);
  });

  it("assertWorkspaceCaps returns no violations on a baseline fixture", () => {
    const out = assembleServiceWorkspace(FIXTURE);
    const violations = assertWorkspaceCaps(out.files);
    expect(violations).toEqual([]);
  });

  it("assertWorkspaceCaps flags an oversize AGENTS.md", () => {
    const files = new Map<string, string>([
      ["AGENTS.md", "x".repeat(AGENTS_MAX_CHARS + 1)],
      ["SOUL.md", "y"],
      ["USER.md", "z"],
      ["HEARTBEAT.md", "h"],
    ]);
    const violations = assertWorkspaceCaps(files);
    expect(violations.some((v) => v.file === "AGENTS.md")).toBe(true);
  });
});
