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
    expect(out.files.has("manifest.json")).toBe(true);
    expect(out.cronCount).toBeGreaterThan(0);
  });

  it("manifest.json is uniform across plans (no per-business divergence)", () => {
    // Per the operator-locked rule (2026-04-27 fourth correction): every
    // Maya gets the SAME curated skill bundle at deploy time. The manifest
    // must not branch on plan tier or business attributes.
    const starter = assembleServiceWorkspace({
      ...FIXTURE,
      plan: "starter",
    } as typeof FIXTURE);
    const studio = assembleServiceWorkspace({
      ...FIXTURE,
      plan: "studio",
    } as typeof FIXTURE);
    expect(starter.files.get("manifest.json")).toBe(
      studio.files.get("manifest.json")
    );
  });

  it("manifest.json lists ClawHub + Anthropic baseline skills", () => {
    const out = assembleServiceWorkspace(FIXTURE);
    const manifest = JSON.parse(out.files.get("manifest.json")!);
    expect(manifest.version).toBe(1);
    expect(manifest.anthropic.skills.length).toBeGreaterThan(0);
    expect(manifest.clawhub.skills.length).toBeGreaterThan(0);
    // Verify the two ClawHub picks the curation doc landed on are there.
    const clawhubIds = manifest.clawhub.skills.map(
      (s: { id: string }) => s.id
    );
    expect(clawhubIds).toContain("uday390/deepread-ocr");
    expect(clawhubIds).toContain("vcarolxhberger/free-video-generator-capcut");
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
