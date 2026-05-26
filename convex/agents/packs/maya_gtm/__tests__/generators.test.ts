import { describe, expect, it } from "vitest";
import {
  buildMayaGtmWorkspace,
  mayaGtmSkillSlugs,
  type MayaGtmWorkspaceInput,
} from "../generators";

const INPUT: MayaGtmWorkspaceInput = {
  accountEmail: "founder@clawlaunch.test",
  timezone: "America/New_York",
  bootKickoffAtMs: Date.UTC(2026, 4, 22, 12, 0, 0),
  app: {
    name: "BugBrief",
    url: "https://bugbrief.test",
    stage: "live-beta",
    weekGoal: "signups",
    founderWhy: "I built it because small teams lose customer bug context.",
    canRecordScreen: true,
    canShowFace: false,
    canRecordVoice: true,
    canProvideScreenshots: true,
    canPostTikTokManually: true,
    canPostInstagramManually: true,
    existingTikTokUrl: "https://www.tiktok.com/@bugbrief",
    existingInstagramUrl: "https://www.instagram.com/bugbrief",
    tiktokWarmupState: "warming",
    tiktokAccountAgeDays: 3,
    tiktokAccountStatusChecked: false,
    openToUgcCreators: true,
    creatorBudgetMonthlyUsd: 250,
    maxWeeklyVisualPosts: 4,
    excludedAudiences: ["enterprise procurement"],
  },
  primaryChannel: "reddit",
  secondaryChannel: "x",
};

describe("Maya GTM workspace pack", () => {
  it("renders the required OpenClaw workspace files", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);

    expect([...files.keys()].sort()).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "SOUL.md",
        "USER.md",
        "APP.md",
        "GTM.md",
        "TOOLS.md",
        "BOOT.md",
        "HEARTBEAT.md",
        "MEMORY.md",
        "DREAMING.md",
        "jobs.json",
      ])
    );
    expect(files.get("AGENTS.md")).toContain("Evidence before strategy");
    expect(files.get("APP.md")).toContain("BugBrief");
    expect(files.get("GTM.md")).toContain("Primary: reddit");
    expect(files.get("AGENTS.md")).toContain("read APP.md and GTM.md");
    // Sprint 2.16j — BOOT.md is now a real native one-shot that sends
    // hello and exits. It reads USER.md + SOUL.md and posts to
    // /lc_gtm/send_update with messageClass: "tactical" (no claims
    // required for the hello).
    expect(files.get("BOOT.md")).toContain("USER.md");
    expect(files.get("BOOT.md")).toContain("SOUL.md");
    expect(files.get("BOOT.md")).toContain("/lc_gtm/send_update");
    expect(files.get("BOOT.md")).toContain("/lc_gtm/validate_outbound");
    expect(files.get("BOOT.md")).toContain('messageClass": "tactical"');
    // BOOT.md must NOT instruct Maya to do research, channel selection,
    // or any external API work in this turn — that's the 0001 cron's job.
    expect(files.get("BOOT.md")).toContain("Hello and out.");
    expect(files.get("USER.md")).toContain("Will manually post Instagram: yes");
    expect(files.get("USER.md")).toContain("TikTok warm-up state: warming");
    expect(files.get("USER.md")).toContain("TikTok account age days: 3");
    expect(files.get("USER.md")).toContain(
      "TikTok Account Check completed: no"
    );
    expect(files.get("USER.md")).toContain("Creator/content budget: $250/month");
    expect(files.get("GTM.md")).toContain("Do not recommend TikTok/Instagram");
  });

  it("bundles every GTM skill needed for research, calendar, approval, and review", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);

    for (const slug of mayaGtmSkillSlugs()) {
      const body = files.get(`skills/${slug}/SKILL.md`);
      expect(body).toBeTruthy();
      // Sprint 17 part B: skills now ship real SOPs (>1000 chars) instead
      // of 7-line stubs. Each must reference PLAYBOOK.md (the launch
      // doctrine) OR cite ScrapeCreators (the read layer) so Maya
      // grounds against shipped doctrine, not first-principles.
      expect(body!.length).toBeGreaterThan(800);
      const groundedReference =
        body!.includes("PLAYBOOK.md") || body!.includes("ScrapeCreators");
      expect(groundedReference).toBe(true);
    }
    expect(files.get("skills/scrapecreators-api/SKILL.md")).toContain(
      "ScrapeCreators"
    );
    expect(files.get("skills/scrapecreators-api/SKILL.md")).toContain(
      "x-api-key"
    );
    expect(files.get("skills/scrapecreators-api/SKILL.md")).toContain(
      "Never use POST for search endpoints"
    );
    expect(files.get("skills/scrapecreators-api/SKILL.md")).toContain(
      "/v1/reddit/search"
    );
    // Sprint 17B real slop-critic body cites banned phrases by name, not
    // the prior placeholder "generic AI phrasing" string. Verify the real
    // anti-slop banned-phrase list ships.
    expect(files.get("skills/maya-slop-critic/SKILL.md")).toContain(
      "supercharge"
    );
    expect(files.get("skills/maya-slop-critic/SKILL.md")).toContain(
      "Excited to announce"
    );
    expect(mayaGtmSkillSlugs()).toEqual(
      expect.arrayContaining([
        "maya-tiktok-format-researcher",
        "maya-distribution-motion-tester",
        "maya-viral-demo-moment-miner",
        "maya-ugc-system-advisor",
      ])
    );
    expect(files.get("skills/maya-tiktok-format-researcher/SKILL.md")).toContain(
      "slideshow_photo_mode"
    );
    expect(files.get("skills/maya-ugc-system-advisor/SKILL.md")).toContain(
      "premature"
    );
  });

  it("renders bounded subagent contracts with model, budget, coverage, and failure behavior", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);
    const agents = files.get("AGENTS.md") ?? "";

    expect(agents).toContain("Bounded Subagent Contracts");
    expect(agents).toContain("model: one of main_maya");
    expect(agents).toContain("timeout_minutes");
    expect(agents).toContain("maxScrapeCreatorsCalls");
    expect(agents).toContain("coverageChecklist");
    expect(agents).toContain("failureBehavior");
    expect(agents).toContain("TikTok format research");
    expect(agents).toContain("slideshow/carousel");
  });

  it("keeps heartbeat cheap and forbids external spend", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);
    const heartbeat = files.get("HEARTBEAT.md") ?? "";

    expect(heartbeat).toContain("Heartbeat is cheap");
    expect(heartbeat).toContain("Hard forbid (every task)");
    expect(heartbeat).toContain("ScrapeCreators calls");
    expect(heartbeat).toContain("Gemini deep research");
    expect(heartbeat).toContain("X recent search");
    // Sprint 2.10 — voice-contract firewall gate must be referenced for
    // every user-visible heartbeat reply
    expect(heartbeat).toContain("/lc_gtm/validate_outbound");
  });

  it("ships OpenClaw cron jobs that isolate heartbeat from paid research", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);
    const jobs = JSON.parse(files.get("jobs.json") ?? "{}") as {
      version?: number;
      jobs: Array<{
        id: string;
        sessionTarget: string;
        payload: {
          kind: string;
          message: string;
          thinking?: string;
          timeoutSeconds?: number;
        };
        delivery?: { mode: string; bestEffort: boolean };
        state?: Record<string, never>;
      }>;
    };

    expect(jobs.version).toBe(1);
    expect(jobs.jobs.every((job) => job.state != null)).toBe(true);
    // Sprint 2.16j — three-turn architecture:
    //   1. BOOT.md (native one-shot on gateway startup) — hello only
    //   2. 0001_gtm_first_research cron — pick ≤3 lanes, spawn subagents, yield
    //   3. Push-resume phase 2 (PHASE_2_PROMPT_BODY in phase2Trigger.ts)
    //      fires when /lc_gtm/subagent_complete count meets expected
    //      — synthesize, calendar build, evidence-guarded send.
    //
    // The boot cron is the SECOND turn; BOOT.md is the first. This test
    // covers turn 2 (the cron); BOOT.md is asserted in the workspace
    // file test above; PHASE_2_PROMPT_BODY has its own test file.
    const bootJob = jobs.jobs.find(
      (job) => job.id === "0001_gtm_first_research"
    );
    const heartbeat = jobs.jobs.find((job) => job.id === "gtm_heartbeat");
    const weeklyReview = jobs.jobs.find((job) => job.id === "gtm_weekly_review");

    expect(jobs.jobs[0]?.id).toBe("0001_gtm_first_research");
    expect(bootJob).toBeTruthy();
    expect(bootJob?.sessionTarget).toBe("isolated");
    // No timeoutSeconds — Maya takes as long as she needs to dispatch.
    expect(bootJob?.payload.timeoutSeconds).toBeUndefined();
    // Medium thinking for the judgment-call channel pick.
    expect(bootJob?.payload.thinking).toBe("medium");
    // Sprint 2.16j prompt: "BOOT — first turn ... Two jobs this turn:
    // (1) send the operator a voice-clean hello, (2) pick channel lanes
    // and spawn research." Hello + dispatch in one turn (BOOT.md is
    // unused as a native hook — OpenClaw's "creator runtime" skips
    // gateway_start hooks without a custom plugin).
    expect(bootJob?.payload.message).toContain("BOOT — first turn");
    expect(bootJob?.payload.message).toContain("send the operator a voice-clean hello");
    expect(bootJob?.payload.message).toContain("HARD CAP: 3 lanes");
    expect(bootJob?.payload.message).toContain("/lc_gtm/target_thread");
    expect(bootJob?.payload.message).toContain("/lc_gtm/send_update");
    expect(bootJob?.payload.message).toContain("validate_outbound");
    // This turn does NOT send the strategic plan — that's phase 2.
    // Only tactical messages (e.g., clarification questions on vague
    // positioning) are allowed here.
    expect(bootJob?.payload.message).toContain('messageClass: "tactical"');
    expect(bootJob?.payload.message).toContain("sessions_yield");
    // Push-resume architecture (subagent_complete → runAgentTurn webhook)
    // owns phase 2. The cron no longer carries old phase ids.
    expect(jobs.jobs.find((j) => j.id === "0001_gtm_boot_phase_1")).toBeUndefined();
    expect(jobs.jobs.find((j) => j.id === "0002_gtm_boot_phase_2")).toBeUndefined();
    expect(heartbeat).toBeTruthy();
    expect(heartbeat?.sessionTarget).toBe("isolated");
    expect(heartbeat?.payload.kind).toBe("agentTurn");
    expect(heartbeat?.payload.thinking).toBe("off");
    expect(heartbeat?.payload.timeoutSeconds).toBe(60);
    expect(heartbeat?.delivery).toEqual({ mode: "none", bestEffort: true });
    expect(heartbeat?.payload.message).toContain("Read HEARTBEAT.md");
    // Sprint 2.16k-3 — case-changed to uppercase "Do NOT" as part of the
    // strict-token-or-silent rewrite. The forbidden-API spend list is the
    // same set, just emphasized differently.
    expect(heartbeat?.payload.message).toContain("Do NOT call ScrapeCreators");
    expect(heartbeat?.payload.message).toContain("paid external API");
    // Sprint 2.16k-3 — must enforce literal-token-only reply to stop the
    // 2026-05-26 leak where the model wrote out reasoning then said
    // "HEARTBEAT_OK" and the whole reasoning chain reached Telegram.
    expect(heartbeat?.payload.message).toContain("ENTIRE reply MUST be exactly the literal");
    expect(heartbeat?.payload.message).toContain("12 characters and nothing else");
    // Sprint 2.7 — weekly review prompt rewritten to dispatch FRESH
    // _research subagents (not just summarize old state). Old assertions
    // (`explicit bounded research job`, `maxScrapeCreatorsCalls`) are
    // replaced by the new compounding-cycle vocabulary.
    expect(weeklyReview?.payload.message).toContain("WEEKLY REVIEW");
    expect(weeklyReview?.payload.message).toContain("compounding cycle");
    expect(weeklyReview?.payload.message).toContain("subagent");
    expect(weeklyReview?.payload.message).toContain(
      "/lc_gtm/get_my_recent_post_results"
    );
    expect(weeklyReview?.payload.message).toContain("BANS");
  });

  it("Sprint 2.10 — every user-facing cron prompt mandates the validate_outbound firewall", () => {
    // Sibling-file scan: prevent silent regression of the voice
    // contract enforcement. boot_kickoff, gtm_channel_discovery,
    // and gtm_weekly_review all send user-visible Telegram messages;
    // each must instruct Maya to POST drafts through the firewall
    // before sendMessage. (gtm_heartbeat replies HEARTBEAT_OK on
    // quiet ticks; HEARTBEAT.md's top-of-file gate covers it for
    // the rare task that does send a message.)
    const { files } = buildMayaGtmWorkspace(INPUT);
    const jobs = JSON.parse(files.get("jobs.json") ?? "{}") as {
      jobs: Array<{ id: string; payload: { message: string } }>;
    };
    const userFacingIds = [
      "0001_gtm_first_research",
      "gtm_channel_discovery",
      "gtm_weekly_review",
    ];
    for (const id of userFacingIds) {
      const job = jobs.jobs.find((j) => j.id === id);
      expect(job, `cron ${id} must exist`).toBeTruthy();
      expect(
        job!.payload.message,
        `cron ${id} must mandate /lc_gtm/validate_outbound before sendMessage`
      ).toContain("/lc_gtm/validate_outbound");
    }
  });

  it("Sprint 2.16j — boot cron forbids strategic claims (calendar/thread/channel)", () => {
    // Live 2026-05-25 regression: Maya claimed "I've populated your
    // calendar for the next 14 days" with 0 actual gtmCalendarEvents
    // rows in phase 1. Sprint 2.16j's fix is structural: phase 1 is
    // research dispatch ONLY (no synthesis, no plan, no calendar) —
    // strategic claims require evidence_ids that don't exist until
    // subagents complete in phase 2. Server-side evidence-guard blocks
    // strategic messages from the boot cron entirely; the prompt must
    // tell Maya to send only tactical messages this turn.
    const { files } = buildMayaGtmWorkspace(INPUT);
    const jobs = JSON.parse(files.get("jobs.json") ?? "{}") as {
      jobs: Array<{ id: string; payload: { message: string } }>;
    };
    const boot = jobs.jobs.find((j) => j.id === "0001_gtm_first_research");
    expect(boot).toBeTruthy();
    // Phase 1 = dispatch, not delivery.
    expect(boot!.payload.message).toContain("DO NOT send the operator the plan");
    expect(boot!.payload.message).toContain("DO NOT populate calendar");
    expect(boot!.payload.message).toContain("DO NOT review subagent results");
    expect(boot!.payload.message).toContain("DO NOT send a strategic message");
    expect(boot!.payload.message).toContain("Only tactical updates are allowed");
  });

  it("keeps the prompt-context bundle (workspace minus playbook/ + skills/*) inside a prompt budget", () => {
    // Sprint 2.5 + 17B: PLAYBOOK.md + playbook/*.md + skills/<slug>/SKILL.md
    // + clawhub-skills/<slug>/SKILL.md are REFERENCE files Maya reads only
    // when the relevant operation fires (channel-judge, slop-critic,
    // platform-specific subagent). They aren't every-turn prompt context.
    // AGENTS.md / SOUL.md / USER.md / APP.md / GTM.md / etc. ARE every-turn
    // context and stay capped.
    const { files } = buildMayaGtmWorkspace(INPUT);
    const promptContextChars = [...files.entries()]
      .filter(
        ([path]) =>
          path !== "PLAYBOOK.md" &&
          !path.startsWith("playbook/") &&
          !path.startsWith("skills/") &&
          !path.startsWith("clawhub-skills/")
      )
      .reduce((sum, [, body]) => sum + body.length, 0);

    expect(promptContextChars).toBeLessThan(75_000);
    expect(files.get("AGENTS.md")?.length).toBeLessThan(25_000);
  });

  it("playbook reference files ship with the workspace and are substantive", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);
    const playbookChars = [...files.entries()]
      .filter(([path]) => path === "PLAYBOOK.md" || path.startsWith("playbook/"))
      .reduce((sum, [, body]) => sum + body.length, 0);
    expect(playbookChars).toBeGreaterThan(150_000);
    expect(files.get("PLAYBOOK.md")?.length).toBeGreaterThan(15_000);
  });

  it("documents direct gateway/session smoke fallback for pre-pairing", () => {
    // Sprint 2.16j: BOOT.md no longer carries the WhatsApp fallback
    // checklist (BOOT.md is now hello-only). The smoke-test fallback
    // documentation lives in TOOLS.md, where Maya looks when she needs
    // to send a status outside the paired channel.
    const { files } = buildMayaGtmWorkspace(INPUT);

    expect(files.get("TOOLS.md")).toContain(
      "Direct gateway/session pings for smoke tests"
    );
  });

  it("does not leak secret-shaped placeholders into workspace files", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);
    const all = [...files.values()]
      .join("\n")
      .replaceAll("x-api-key:", "x-api-key header");

    // Real OpenAI-style keys are 20+ alphanumeric chars after `sk-`. The
    // shorter regex was tripping on substrings like "Musk-acquisition" in
    // playbook citations.
    expect(all).not.toMatch(/\bsk-[A-Za-z0-9]{20,}/);
    expect(all).not.toMatch(/api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_-]/i);
    expect(all).not.toMatch(/\bsecret\s*[:=]\s*['"][A-Za-z0-9_-]/i);
  });
});
