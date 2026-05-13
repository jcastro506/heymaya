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
import { HEARTBEAT_SOFT_CAP_CHARS } from "../generateHeartbeatMd";
import {
  CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK,
  CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS,
  CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS,
} from "../../../../../creatorMayaV0/pinnedClawhubSkills";
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
  "SOUL.md",
  "IDENTITY.md",
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

  it("every bootstrap-loaded file fits under the 28K bootstrap cap (we override the 12K default in gateway config)", () => {
    // OpenClaw's default `agents.defaults.bootstrapMaxChars` is 12K. Maya
    // ships with 28K so the canonical standing-orders inventory embeds
    // INSIDE AGENTS.md (per the OpenClaw 2026.4.23 convention — only
    // root canonical files are auto-injected; standalone .md files in the
    // workspace root are not guaranteed to load). The override lives in the
    // gateway config emitted by configGeneratorMaya (phase C).
    //
    // The cap applies to BOOTSTRAP-loaded files only — the canonical root
    // files OpenClaw auto-injects at session start (AGENTS / SOUL / USER /
    // HEARTBEAT / TOOLS / MEMORY / BOOTSTRAP / IDENTITY) plus the
    // standalone standing-orders.md when split. Skill files under
    // `skills/<slug>/SKILL.md` are auto-discovered by OpenClaw's skill
    // loader on a different code path and are not bootstrap-loaded; they
    // can be larger than the cap (the maya-platform inventory is ~33K
    // because it lists every shipped skill with sourcing).
    // Sprint 12.6+ — bumped 40K → 45K to fit timezone-discipline +
    // abort-silence rules added after the 2026-05-10 evening leak.
    // Sprint A.2 — bumped 45K → 48K for the editing-fingerprint section.
    // Sprint C.2/C.3 — bumped 48K → 56K to fit the calendar-creation
    // additions to weekly_content_plan / trend_watcher /
    // post_publish_reaction (C.2) + the calendar-weave addition to
    // morning_brief (C.3). The split standing-orders.md grew from
    // ~47K to ~53K with all four additions; production never actually
    // splits (MAYA_BOOTSTRAP_MAX_CHARS=105K embeds AGENTS inline), but
    // this defense-in-depth test forces the split path so the per-file
    // cap is still asserted.
    const CAP = 56_000;
    for (const plan of ["coach", "manager"] as const) {
      const inputs = baseInputs({ plan });
      inputs.creator = { ...inputs.creator, plan };
      const bundle = assembleWorkspaceBundle(inputs, { bootstrapMaxChars: CAP });
      for (const [name, content] of bundle.files) {
        // Skip auto-discovered skill files (loaded outside the bootstrap
        // path) and the Daily Notes seeds (loaded on-demand).
        if (name.startsWith("skills/")) continue;
        if (name.startsWith("Operations/")) continue;
        expect(
          content.length,
          `${plan}: ${name} = ${content.length} chars (cap ${CAP})`
        ).toBeLessThanOrEqual(CAP);
      }
    }
  });

  it("HEARTBEAT.md fits the HEARTBEAT_SOFT_CAP_CHARS budget (token-burn discipline)", () => {
    // Sprint C.3 — bumped 2_000 → 3_000 to absorb the calendar-scan check
    // (pre-event T-30 + post-event T+45-60). Reference the exported constant
    // so future bumps don't silently regress.
    const bundle = assembleWorkspaceBundle(baseInputs());
    const hb = bundle.files.get("HEARTBEAT.md")!;
    expect(hb.length).toBeLessThanOrEqual(HEARTBEAT_SOFT_CAP_CHARS);
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

  it("BUNDLED_SKILLS ships all 22+ creator-side maya-* skills (Sprint 2 Slice C)", () => {
    // Sprint 2 Slice C bundles every custom maya-* skill — Slice A's deploy
    // pipeline previously orphaned ~22 of them by shipping only a hand-picked
    // subset. The full set (alphabetical) must be present so the OpenClaw
    // skill loader sees them under skills/<slug>/SKILL.md on the Fly machine.
    expect(BUNDLED_SKILLS.length).toBeGreaterThanOrEqual(22);

    const slugs = BUNDLED_SKILLS.map((s) => s.slug);
    // Sample 5 slugs spanning different concern areas: brand, content, voice,
    // platform meta, performance.
    const required = [
      "maya-content-cross-poster",
      "maya-platform",
      "maya-rate-calculator",
      "maya-citation-firewall",
      "maya-voice-applier",
    ];
    for (const slug of required) {
      expect(slugs, `BUNDLED_SKILLS missing ${slug}`).toContain(slug);
    }

    // Every maya-* slug must carry the OpenClaw discovery frontmatter so the
    // gateway's skill loader picks them up. Verify metadata.openclaw is in
    // the inlined SKILL.md content for each.
    for (const skill of BUNDLED_SKILLS) {
      if (!skill.slug.startsWith("maya-")) continue;
      expect(
        skill.content,
        `${skill.slug}: SKILL.md missing metadata.openclaw frontmatter`
      ).toContain("openclaw:");
    }
  });

  it("coach bundle's jobsJson is the Sprint 3 Slice 1 cron set (6 entries, all tier='all', revenue_snapshot included)", () => {
    // Sprint 3 Slice 1: the cron set collapsed from 21 → 6. The previously-
    // advisory programs (competitor, calendar, intel, opportunity_scout,
    // collab_matchmaker) became kind="heartbeat" and run off heartbeat
    // ticks. manager_readiness_packet_quarterly + algo_research_* were
    // deleted entirely for MVP. Only revenue_snapshot (Mon 9am — needs
    // precise timing because it pairs with the prior week's Stripe pull)
    // remains in the cron set among the former advisory list.
    const inputs = baseInputs({ plan: "coach" });
    inputs.creator = { ...inputs.creator, plan: "coach" };
    const bundle = assembleWorkspaceBundle(inputs);
    const ids = bundle.jobsJson.jobs.map((j) => j.id);
    expect(ids).toContain("revenue_snapshot");
    // Heartbeat-kind entries must NOT appear in jobsJson.
    expect(ids).not.toContain("competitor_watch");
    expect(ids).not.toContain("calendar_lookahead");
    expect(ids).not.toContain("industry_intel_daily");
    expect(ids).not.toContain("opportunity_scout_daily");
    expect(ids).not.toContain("collab_matchmaker_weekly");
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
      expect(catalog).toContain("### First weekly plan (immediate, after picture lock)");
      // The intro entry must reference the OAuth invocation — sibling file
      // scan: AGENTS.md / standing-orders.md must reach the action name so
      // Maya knows what to invoke. Sprint 9.7+ renamed from
      // `composio.oauth.startOAuth` to the canonical lc_maya HTTP endpoint
      // `start_oauth` (the actual surface Maya hits).
      expect(catalog).toContain("start_oauth");
    }
  });

  it("AGENTS.md instructs Maya to run the first-boot introduction on session start", () => {
    // The "first-boot check" instruction in AGENTS.md is what makes Maya
    // notice she's on her first session and run the introduction
    // standing order BEFORE anything else. Verify the prose is present
    // in both the embedded form (production 28K cap) and the split form
    // (low cap fallback).
    const PROD_CAP = 66_000;
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

  it("Wave 5 (OpenClaw 2026.4.23): at production cap, standing orders embed inline (no separate file)", () => {
    // Per https://docs.openclaw.ai/automation/standing-orders only the
    // canonical root files (AGENTS / SOUL / USER / HEARTBEAT / TOOLS / MEMORY /
    // BOOTSTRAP / IDENTITY) are auto-injected at session start; arbitrary
    // .md files in the workspace root are NOT guaranteed to load. So Maya
    // sets a generous cap (MAYA_BOOTSTRAP_MAX_CHARS in configGeneratorMaya.ts,
    // currently 80K) and embeds standing orders inline. Verify the production
    // cap path actually fits — keep this aligned with MAYA_BOOTSTRAP_MAX_CHARS
    // every time it bumps.
    // Sprint 12.7 — bumped 80K → 100K alongside the trend-grounding section
    // + chat_trend_lookup standing order. Keep this in sync with
    // MAYA_BOOTSTRAP_MAX_CHARS in configGeneratorMaya.ts.
    // Sprint C.3 — bumped 100K → 105K alongside the calendar-event nudge
    // section in AGENTS.md + the calendar-weave addition to
    // `morning_brief.scope`.
    const PROD_CAP = 105_000;
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

  it("ClawHub pin manifest carries the four MVP pins (tiktok + ffmpeg + carousel + proactive-agent)", () => {
    // Sprint 12.7.5 (A.4) — added `g0atbot-tiktok-carousel`.
    // Sprint B.1 — added `proactive-agent` (halthelobster/proactive-agent
    // @ 3.1.0) as the 4th pin so Maya carries WAL / Working Buffer /
    // Compaction Recovery / Verify Implementation patterns.
    // The lock + slug array + skill-list must all agree.
    expect(CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS).toContain("tiktok");
    expect(CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS).toContain(
      "ffmpeg-video-editor"
    );
    expect(CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS).toContain(
      "g0atbot-tiktok-carousel"
    );
    expect(CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS).toContain(
      "proactive-agent"
    );
    expect(CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS.length).toBe(4);

    // Lock entries are present + agree on slug set.
    const lockSlugs = Object.keys(CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK.skills);
    expect(lockSlugs.sort()).toEqual(
      [...CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS].sort()
    );
    expect(
      CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK.skills["g0atbot-tiktok-carousel"]
    ).toEqual({
      version: "1.0.0",
      source: "clawhub:g0atfac3/g0atbot-tiktok-carousel",
    });
    expect(
      CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK.skills["proactive-agent"]
    ).toEqual({
      version: "3.1.0",
      source: "clawhub:halthelobster/proactive-agent",
    });

    // Skill bodies list also has all four.
    const bodySlugs = CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS.map((s) => s.slug).sort();
    expect(bodySlugs).toEqual(
      [...CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS].sort()
    );
  });

  it("workspace bundle ships the carousel ClawHub pin at skills/g0atbot-tiktok-carousel/SKILL.md", () => {
    const bundle = assembleWorkspaceBundle(baseInputs());
    const path = "skills/g0atbot-tiktok-carousel/SKILL.md";
    expect(bundle.files.has(path)).toBe(true);
    const skill = bundle.files.get(path)!;
    // Frontmatter shape (name / version / description / when-to-use /
    // plan-tier / thinking-budget / metadata.openclaw).
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toContain("name: g0atbot-tiktok-carousel");
    expect(skill).toContain("version: 1.0.0");
    expect(skill).toContain("description:");
    expect(skill).toContain("when-to-use:");
    expect(skill).toContain("plan-tier:");
    expect(skill).toContain("thinking-budget:");
    expect(skill).toContain("metadata:");
    expect(skill).toContain("openclaw:");
    // Heading present (markdown is parseable).
    expect(skill).toContain("# TikTok Carousel Generator");
    // Core content sections the public skill page lists.
    expect(skill).toContain("6-slide formula");
    expect(skill).toContain("Image prompt rules");
    expect(skill).toContain("Text overlay rules");
    expect(skill).toContain("hook formula");
    expect(skill).toContain("Learning loop");
    // Routing guidance — carousel is photo-deck sibling, NOT a video
    // replacement. Maya needs to know when to route to the video pipeline.
    expect(skill).toContain("maya-clip-editor");
    expect(skill).toContain("ffmpeg-video-editor");
  });

  // Sprint C.1 — Maya-authored Google Calendar planner skill. Sibling to
  // the new `mayaCalendarEvents` schema table + per-tier weekly cap
  // helper. The planner SKILL.md teaches Maya the 8 event kinds, gap-
  // finder rules, voice-applier requirement, and the 30-min popup
  // reminder convention. Bundled alphabetically alongside the rest of
  // the maya-* skills via scripts/sync-bundled-skills.ts.
  it("workspace bundle ships the calendar-planner skill at skills/maya-calendar-planner/SKILL.md (Sprint C.1)", () => {
    const bundle = assembleWorkspaceBundle(baseInputs());
    const path = "skills/maya-calendar-planner/SKILL.md";
    expect(bundle.files.has(path)).toBe(true);
    const skill = bundle.files.get(path)!;
    // Frontmatter shape.
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toContain("name: maya-calendar-planner");
    expect(skill).toContain("description:");
    expect(skill).toContain("when-to-use:");
    expect(skill).toContain("plan-tier:");
    expect(skill).toContain("thinking-budget:");
    expect(skill).toContain("metadata:");
    expect(skill).toContain("openclaw:");
    // All 8 event kinds present in the taxonomy section.
    const kinds = [
      "trend-strike",
      "content-block",
      "post-publish",
      "niche-scroll",
      "comment-window",
      "brand-outbox",
      "weekly-review",
      "brain-break",
    ];
    for (const kind of kinds) {
      expect(skill, `SKILL.md missing kind=${kind}`).toContain(kind);
    }
    // Voice + citation gates are mandatory.
    expect(skill).toContain("maya-voice-applier");
    expect(skill).toContain("maya-citation-firewall");
    // 30-min popup reminder convention.
    expect(skill).toContain("popup");
    expect(skill).toContain("30");
    // References the schema table + backend file.
    expect(skill).toContain("mayaCalendarEvents");
  });

  it("workspace bundle ships .clawhub/lock.json listing all four pinned skills", () => {
    const bundle = assembleWorkspaceBundle(baseInputs());
    const lockRaw = bundle.files.get(".clawhub/lock.json");
    expect(lockRaw).toBeDefined();
    const lock = JSON.parse(lockRaw!) as {
      version: number;
      skills: Record<string, { version: string; source: string }>;
    };
    expect(lock.version).toBe(1);
    expect(Object.keys(lock.skills).sort()).toEqual([
      "ffmpeg-video-editor",
      "g0atbot-tiktok-carousel",
      "proactive-agent",
      "tiktok",
    ]);
    expect(lock.skills["g0atbot-tiktok-carousel"].version).toBe("1.0.0");
    expect(lock.skills["proactive-agent"].version).toBe("3.1.0");
  });

  // Sprint B.1 — proactive-agent pin ships with the canonical WAL Protocol /
  // Working Buffer / Compaction Recovery / Autonomous-vs-Prompted-Crons /
  // Verify-Implementation-Not-Intent / Relentless-Resourcefulness body. The
  // pin is the deeper reference for Maya's follow-through protocol section
  // in AGENTS.md.
  it("workspace bundle ships the proactive-agent ClawHub pin at skills/proactive-agent/SKILL.md with the real ClawHub-vendored body", () => {
    const bundle = assembleWorkspaceBundle(baseInputs());
    const path = "skills/proactive-agent/SKILL.md";
    expect(bundle.files.has(path)).toBe(true);
    const skill = bundle.files.get(path)!;
    // Frontmatter shape — real ClawHub install has name/version/description/author.
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toContain("name: proactive-agent");
    expect(skill).toContain("version: 3.1.0");
    expect(skill).toContain("author: halthelobster");
    // Heading present (markdown is parseable).
    expect(skill).toContain("# Proactive Agent");
    // Every load-bearing section heading the operator briefed (the canonical
    // Hal-Stack v3.1.0 inventory).
    const requiredSections = [
      "## What's New in v3.1.0",
      "## The Three Pillars",
      "## Memory Architecture",
      "## The WAL Protocol",
      "## Working Buffer Protocol",
      "## Compaction Recovery",
      "## Unified Search Protocol",
      "## Security Hardening",
      "## Relentless Resourcefulness",
      "## Self-Improvement Guardrails",
      "## Autonomous vs Prompted Crons",
      "## Verify Implementation, Not Intent",
      "## Tool Migration Checklist",
    ];
    for (const heading of requiredSections) {
      expect(skill, `proactive-agent SKILL.md missing section: ${heading}`).toContain(heading);
    }
  });

  it("ClawHub pin manifest carries no per-creator references (shared infra, not tenant-scoped)", () => {
    // Cross-tenant invariant: pinned skill content is shared across every
    // Maya — there must be no creator/clerk/handle/tenant identifier
    // embedded in the manifest. The lock + skill bodies are tenant-neutral
    // strings.
    for (const skill of CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS) {
      for (const [path, body] of Object.entries(skill.files)) {
        const where = `${skill.slug}/${path}`;
        expect(body, `${where} leaks creatorId`).not.toMatch(/creatorId/);
        expect(body, `${where} leaks clerkUserId`).not.toMatch(/clerkUserId/);
        // Convex IDs start with `k_` — guard against accidental fixture
        // leakage. (The string "ko" in arbitrary prose is fine; we look
        // for the canonical `k_` Convex prefix.)
        expect(body, `${where} leaks a Convex k_ id`).not.toMatch(/\bk_[a-z0-9]{10,}/);
      }
    }
  });
});
