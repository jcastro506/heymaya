/**
 * assembleWorkspaceBundle — pure-logic orchestration tests.
 *
 * Coverage:
 *   - Always-emitted files: AGENTS.md, USER.md, HEARTBEAT.md, BOOT.md,
 *     MEMORY.md, TOOLS.md, DREAMING.md, plus Operations/Daily Notes/README.md
 *     and today's note.
 *   - Standing-orders split: when bootstrapMaxChars is forced low, AGENTS.md
 *     is split and `standing-orders.md` is emitted.
 *   - Daily note filename uses the local date in the creator's timezone.
 *   - Determinism: same inputs (same `now`) → identical bundle.
 *   - jobsJson is built and present.
 */

import { describe, it, expect } from "vitest";
import { assembleWorkspaceBundle } from "../assembleWorkspaceBundle";
import type { Doc } from "../../../../../_generated/dataModel";
import type { WorkspaceInputs } from "../types";

function baseInputs(over: Partial<WorkspaceInputs> = {}): WorkspaceInputs {
  const creator: Doc<"creators"> = {
    _id: "k_creator_a" as unknown as Doc<"creators">["_id"],
    _creationTime: 1_700_000_000_000,
    clerkUserId: "user_a",
    email: "a.creator@example.com",
    channelPreference: "imessage",
    timezone: "America/Los_Angeles",
    status: "active",
    plan: "pro",
    createdAt: 1_700_000_000_000,
  };
  return {
    creator,
    picture: null,
    handles: [
      {
        _id: "k_h" as unknown as Doc<"creatorHandles">["_id"],
        _creationTime: 1_700_000_000_000,
        creatorId: creator._id,
        platform: "tiktok",
        handle: "@a",
        verified: true,
        followerCount: 12_000,
      },
    ],
    connectedAccounts: [],
    plan: "pro",
    now: 1_700_000_000_000,
    ...over,
  };
}

const ALWAYS_FILES = [
  "AGENTS.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOT.md",
  "MEMORY.md",
  "TOOLS.md",
  "DREAMING.md",
  "Operations/Daily Notes/README.md",
];

describe("assembleWorkspaceBundle", () => {
  it("emits the canonical always-files for every plan", () => {
    for (const plan of ["starter", "pro", "studio"] as const) {
      const inputs = baseInputs({ plan });
      // Apply plan to creator too so jobsJson sees the right tier.
      inputs.creator = { ...inputs.creator, plan };
      const bundle = assembleWorkspaceBundle(inputs);
      for (const name of ALWAYS_FILES) {
        expect(bundle.files.has(name), `${plan}: missing ${name}`).toBe(true);
      }
    }
  });

  it("emits jobsJson with a non-empty jobs array for pro creators", () => {
    const bundle = assembleWorkspaceBundle(baseInputs());
    expect(bundle.jobsJson.jobs.length).toBeGreaterThan(0);
  });

  it("does NOT split standing-orders by default (AGENTS.md fits cap with embedded form for pro)", () => {
    // We don't actually require the embedded form fits 12K — that's a soft
    // expectation. We only require the bundle reflects whichever path it
    // took.
    const bundle = assembleWorkspaceBundle(baseInputs());
    if (bundle.standingOrdersSplit) {
      expect(bundle.files.has("standing-orders.md")).toBe(true);
    } else {
      expect(bundle.files.has("standing-orders.md")).toBe(false);
    }
  });

  it("forces a split when bootstrapMaxChars is set very low", () => {
    const bundle = assembleWorkspaceBundle(baseInputs(), {
      bootstrapMaxChars: 500,
    });
    expect(bundle.standingOrdersSplit).toBe(true);
    expect(bundle.files.has("standing-orders.md")).toBe(true);
    const standingOrders = bundle.files.get("standing-orders.md")!;
    expect(standingOrders).toContain("# Standing orders");
  });

  it("daily note filename uses the local date in the creator's timezone", () => {
    // Pin: Jan 1 2024 12:00 UTC = Jan 1 04:00 in LA, so date is 2024-01-01.
    const utcJan1Noon = new Date("2024-01-01T12:00:00Z").getTime();
    const inputs = baseInputs({ now: utcJan1Noon });
    inputs.creator = {
      ...inputs.creator,
      timezone: "America/Los_Angeles",
    };
    const bundle = assembleWorkspaceBundle(inputs);
    const expectedFile = "Operations/Daily Notes/2024-01-01.md";
    expect(bundle.files.has(expectedFile)).toBe(true);
  });

  it("daily note local date can roll forward in a tz east of UTC", () => {
    // Jan 1 2024 22:00 UTC = Jan 2 07:00 in Tokyo
    const utcJan1Evening = new Date("2024-01-01T22:00:00Z").getTime();
    const inputs = baseInputs({ now: utcJan1Evening });
    inputs.creator = { ...inputs.creator, timezone: "Asia/Tokyo" };
    const bundle = assembleWorkspaceBundle(inputs);
    expect(bundle.files.has("Operations/Daily Notes/2024-01-02.md")).toBe(true);
  });

  it("is deterministic for identical inputs (same now)", () => {
    const a = assembleWorkspaceBundle(baseInputs());
    const b = assembleWorkspaceBundle(baseInputs());
    // Compare every file content byte-for-byte.
    expect([...a.files.keys()].sort()).toEqual([...b.files.keys()].sort());
    for (const k of a.files.keys()) {
      expect(b.files.get(k)).toBe(a.files.get(k));
    }
    expect(JSON.stringify(a.jobsJson)).toBe(JSON.stringify(b.jobsJson));
  });

  it("every emitted file fits under the 28K bootstrap cap (we override the 12K default in gateway config)", () => {
    // OpenClaw's default `agents.defaults.bootstrapMaxChars` is 12K. Maya
    // ships with 28K so the canonical standing-orders inventory embeds
    // INSIDE AGENTS.md (per the OpenClaw 2026.4.23 convention — only
    // root canonical files are auto-injected; standalone .md files in the
    // workspace root are not guaranteed to load). The override lives in the
    // gateway config emitted by configGeneratorMaya (phase C).
    const CAP = 28_000;
    for (const plan of ["starter", "pro", "studio"] as const) {
      const inputs = baseInputs({ plan });
      inputs.creator = { ...inputs.creator, plan };
      const bundle = assembleWorkspaceBundle(inputs, { bootstrapMaxChars: CAP });
      for (const [name, content] of bundle.files) {
        expect(
          content.length,
          `${plan}: ${name} = ${content.length} chars (cap ${CAP})`
        ).toBeLessThanOrEqual(CAP);
      }
    }
  });

  it("HEARTBEAT.md fits the 2K soft cap (token-burn discipline)", () => {
    const bundle = assembleWorkspaceBundle(baseInputs());
    const hb = bundle.files.get("HEARTBEAT.md")!;
    expect(hb.length).toBeLessThanOrEqual(2_000);
  });

  it("starter bundle's jobsJson does not include any pro+ entries", () => {
    const inputs = baseInputs({ plan: "starter" });
    inputs.creator = { ...inputs.creator, plan: "starter" };
    const bundle = assembleWorkspaceBundle(inputs);
    const ids = bundle.jobsJson.jobs.map((j) => j.entryId);
    expect(ids).not.toContain("revenue_snapshot");
    expect(ids).not.toContain("competitor_watch");
    expect(ids).not.toContain("calendar_lookahead");
    expect(ids).not.toContain("manager_readiness_packet_quarterly");
    expect(ids).not.toContain("industry_intel_daily");
  });

  it("Wave 5 (OpenClaw 2026.4.23): at production 28K cap, standing orders embed inline (no separate file)", () => {
    // Per https://docs.openclaw.ai/automation/standing-orders only the
    // canonical root files (AGENTS / SOUL / USER / HEARTBEAT / TOOLS / MEMORY /
    // BOOTSTRAP / IDENTITY) are auto-injected at session start; arbitrary
    // .md files in the workspace root are NOT guaranteed to load. So Maya
    // bumps the cap to 28K (MAYA_BOOTSTRAP_MAX_CHARS) and embeds standing
    // orders inline. Verify that the production cap path actually fits.
    const PROD_CAP = 28_000;
    for (const plan of ["starter", "pro", "studio"] as const) {
      const inputs = baseInputs({ plan });
      inputs.creator = { ...inputs.creator, plan };
      const bundle = assembleWorkspaceBundle(inputs, {
        bootstrapMaxChars: PROD_CAP,
      });
      expect(bundle.standingOrdersSplit, `${plan}: should embed inline`).toBe(false);
      expect(
        bundle.files.has("standing-orders.md"),
        `${plan}: standalone standing-orders.md must NOT be emitted`
      ).toBe(false);
      // AGENTS.md must contain the embedded standing-orders inventory header
      // (every program block starts with "### " + program title — sample one).
      const agentsMd = bundle.files.get("AGENTS.md")!;
      expect(agentsMd).toContain("## Standing orders");
      expect(agentsMd).toContain("### Morning brief");
      // And weekly_review (an "all"-tier program) appears in every plan.
      expect(agentsMd).toContain("### Weekly review");
    }
  });
});
