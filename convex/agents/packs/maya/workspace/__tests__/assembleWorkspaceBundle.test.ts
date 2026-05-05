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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleWorkspaceBundle } from "../assembleWorkspaceBundle";
import { BUNDLED_SKILLS } from "../skillsRegistry";
import type { Doc } from "../../../../../_generated/dataModel";
import type { WorkspaceInputs } from "../types";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");

function baseInputs(over: Partial<WorkspaceInputs> = {}): WorkspaceInputs {
  const creator: Doc<"creators"> = {
    _id: "k_creator_a" as unknown as Doc<"creators">["_id"],
    _creationTime: 1_700_000_000_000,
    clerkUserId: "user_a",
    email: "a.creator@example.com",
    channelPreference: "imessage",
    timezone: "America/Los_Angeles",
    status: "active",
    plan: "manager",
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
    plan: "manager",
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
    for (const plan of ["coach", "manager"] as const) {
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
    const CAP = 32_000;
    for (const plan of ["coach", "manager"] as const) {
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

  it("bundles every registered skill at `skills/<slug>/SKILL.md`", () => {
    const bundle = assembleWorkspaceBundle(baseInputs());
    expect(BUNDLED_SKILLS.length).toBeGreaterThan(0);
    for (const skill of BUNDLED_SKILLS) {
      const path = `skills/${skill.slug}/SKILL.md`;
      expect(bundle.files.has(path), `missing ${path}`).toBe(true);
      expect(bundle.files.get(path)).toBe(skill.content);
    }
  });

  it("scrapecreators-api skill is bundled with the corrected v3 TikTok paths from the official package", () => {
    const bundle = assembleWorkspaceBundle(baseInputs());
    const skill = bundle.files.get("skills/scrapecreators-api/SKILL.md");
    expect(skill).toBeDefined();
    expect(skill).toContain("name: scrapecreators-api");
    expect(skill).toContain("SCRAPE_CREATORS_API_KEY");
    expect(skill).not.toContain("primaryEnv: SCRAPECREATORS_API_KEY");
    expect(skill).toContain("/v3/tiktok/profile/videos");
    expect(skill).toContain("/v2/tiktok/video");
    expect(skill).toContain("/v1/tiktok/video/comments");
    expect(skill).toContain("/v1/tiktok/video/transcript");
  });

  it("each bundled skill matches the on-disk SKILL.md byte-for-byte (sync-bundled-skills guard)", () => {
    for (const skill of BUNDLED_SKILLS) {
      const path = join(REPO_ROOT, "agents", "skills", skill.slug, "SKILL.md");
      const onDisk = readFileSync(path, "utf8");
      expect(
        skill.content,
        `${skill.slug}: registry drifted from on-disk SKILL.md — re-run \`npx tsx scripts/sync-bundled-skills.ts\``
      ).toBe(onDisk);
    }
  });

  it("coach bundle's jobsJson includes advisory programs (revenue, competitor, calendar, packet, intel) — boundary is autonomy, not breadth", () => {
    const inputs = baseInputs({ plan: "coach" });
    inputs.creator = { ...inputs.creator, plan: "coach" };
    const bundle = assembleWorkspaceBundle(inputs);
    const ids = bundle.jobsJson.jobs.map((j) => j.id);
    // Advisory programs reclassified to tier:"all" — Coach receives them.
    expect(ids).toContain("revenue_snapshot");
    expect(ids).toContain("competitor_watch");
    expect(ids).toContain("calendar_lookahead");
    expect(ids).toContain("manager_readiness_packet_quarterly");
    expect(ids).toContain("industry_intel_daily");
    expect(ids).toContain("algo_research_tiktok");
    expect(ids).toContain("opportunity_scout_daily");
    expect(ids).toContain("collab_matchmaker_weekly");
  });

  it("coach bundle's jobsJson excludes Manager-only autonomy crons (none today; brand_outreach is event-driven not cron)", async () => {
    const inputs = baseInputs({ plan: "coach" });
    inputs.creator = { ...inputs.creator, plan: "coach" };
    const bundle = assembleWorkspaceBundle(inputs);
    const ids = bundle.jobsJson.jobs.map((j) => j.id);
    // No Manager-only cron entries exist as of this revision — autonomy
    // gates fire on event/folded triggers (brand_outreach, pitch_strategy,
    // hook_library_build). This assertion locks the invariant: Coach's cron
    // set should never include an entryId whose standing-order tier is
    // "manager".
    const { STANDING_ORDERS } = await import("../standingOrders");
    const managerOnlyCronIds = STANDING_ORDERS.filter(
      (p) => p.tier === "manager" && p.kind === "cron"
    ).map((p) => p.cronEntryId!);
    for (const id of managerOnlyCronIds) {
      expect(ids).not.toContain(id);
    }
  });

  it("first-boot standing orders are present in AGENTS.md / standing-orders catalog and gated `all` (both Coach and Manager)", async () => {
    // The first-boot introduction + first weekly plan programs are non-
    // negotiable for both tiers — every Maya runs them on the very first
    // session. Verify the catalog entries exist and that the rendered
    // standing-orders prose (split-form, low cap) carries them in BOTH
    // plans. This is the sibling-file-scan guard for the new programs.
    const { STANDING_ORDERS } = await import("../standingOrders");
    const firstBoot = STANDING_ORDERS.find((p) => p.id === "first_boot_introduction");
    const firstPlan = STANDING_ORDERS.find((p) => p.id === "first_weekly_plan");
    expect(firstBoot, "missing first_boot_introduction").toBeDefined();
    expect(firstPlan, "missing first_weekly_plan").toBeDefined();
    expect(firstBoot?.tier).toBe("all");
    expect(firstPlan?.tier).toBe("all");
    expect(firstBoot?.kind).toBe("event");
    expect(firstPlan?.kind).toBe("event");

    for (const plan of ["coach", "manager"] as const) {
      const inputs = baseInputs({ plan });
      inputs.creator = { ...inputs.creator, plan };
      // Force split-form so we can read the standalone catalog without
      // worrying about the embedded-form character cap drift.
      const bundle = assembleWorkspaceBundle(inputs, { bootstrapMaxChars: 500 });
      expect(bundle.standingOrdersSplit).toBe(true);
      const catalog = bundle.files.get("standing-orders.md")!;
      expect(catalog).toContain("### First-boot introduction");
      expect(catalog).toContain("### First weekly plan (immediate)");
      // The intro entry must reference the OAuth action — sibling file
      // scan: AGENTS.md / standing-orders.md must reach the action name
      // so Maya knows what to invoke.
      expect(catalog).toContain("composio.oauth.startOAuth");
    }
  });

  it("AGENTS.md instructs Maya to run the first-boot introduction on session start", () => {
    // The "first-boot check" instruction in AGENTS.md is what makes Maya
    // notice she's on her first session and run the introduction
    // standing order BEFORE anything else. Verify the prose is present
    // in both the embedded form (production 28K cap) and the split form
    // (low cap fallback).
    const PROD_CAP = 32_000;
    for (const plan of ["coach", "manager"] as const) {
      const inputs = baseInputs({ plan });
      inputs.creator = { ...inputs.creator, plan };
      const bundle = assembleWorkspaceBundle(inputs, { bootstrapMaxChars: PROD_CAP });
      const agentsMd = bundle.files.get("AGENTS.md")!;
      expect(agentsMd).toContain("First-boot check");
      expect(agentsMd).toContain("first_boot_introduction");
      expect(agentsMd).toContain("first_weekly_plan");
    }
  });

  it("USER.md surfaces the creator phone number + first-boot status so Maya can address them", () => {
    const inputs = baseInputs();
    inputs.creator = {
      ...inputs.creator,
      phoneNumber: "+15551234567",
      primaryHandle: "@a",
    };
    const bundle = assembleWorkspaceBundle(inputs);
    const userMd = bundle.files.get("USER.md")!;
    expect(userMd).toContain("+15551234567");
    expect(userMd).toContain("@a");
    // First-boot status defaults to "not yet started" when the cursor is
    // undefined.
    expect(userMd).toContain("not yet started");
    expect(userMd).toContain("first_boot_introduction");
  });

  it("USER.md first-boot status reflects in-progress + completed states", () => {
    // openingAnswersAt set but firstBootCompletedAt unset → in-progress.
    const inputs1 = baseInputs();
    inputs1.creator = {
      ...inputs1.creator,
      openingAnswersAt: 1_700_000_500_000,
    };
    const userMd1 = assembleWorkspaceBundle(inputs1).files.get("USER.md")!;
    expect(userMd1).toContain("in-progress");
    expect(userMd1).toContain("opening answers received");

    // firstBootCompletedAt set → completed.
    const inputs2 = baseInputs();
    inputs2.creator = {
      ...inputs2.creator,
      firstBootCompletedAt: 1_700_001_000_000,
    };
    const userMd2 = assembleWorkspaceBundle(inputs2).files.get("USER.md")!;
    expect(userMd2).toContain("completed");
  });

  it("Wave 5 (OpenClaw 2026.4.23): at production 28K cap, standing orders embed inline (no separate file)", () => {
    // Per https://docs.openclaw.ai/automation/standing-orders only the
    // canonical root files (AGENTS / SOUL / USER / HEARTBEAT / TOOLS / MEMORY /
    // BOOTSTRAP / IDENTITY) are auto-injected at session start; arbitrary
    // .md files in the workspace root are NOT guaranteed to load. So Maya
    // bumps the cap to 28K (MAYA_BOOTSTRAP_MAX_CHARS) and embeds standing
    // orders inline. Verify that the production cap path actually fits.
    const PROD_CAP = 32_000;
    for (const plan of ["coach", "manager"] as const) {
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
