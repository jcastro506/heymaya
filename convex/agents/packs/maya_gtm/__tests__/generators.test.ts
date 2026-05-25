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
    expect(files.get("BOOT.md")).toContain("PLAYBOOK.md");
    expect(files.get("BOOT.md")).toContain(
      "APP.md, GTM.md, MEMORY.md, and USER.md"
    );
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
    // Sprint 2.16c — single unified boot task. Maya owns the whole
    // iterative research loop end-to-end in ONE long-running turn.
    // No phase 1/phase 2 split. Matches the OpenClaw agentic shape.
    const bootJob = jobs.jobs.find(
      (job) => job.id === "0001_gtm_first_research"
    );
    const heartbeat = jobs.jobs.find((job) => job.id === "gtm_heartbeat");
    const weeklyReview = jobs.jobs.find((job) => job.id === "gtm_weekly_review");

    expect(jobs.jobs[0]?.id).toBe("0001_gtm_first_research");
    expect(bootJob).toBeTruthy();
    expect(bootJob?.sessionTarget).toBe("isolated");
    // No timeoutSeconds — Maya takes as long as she needs.
    expect(bootJob?.payload.timeoutSeconds).toBeUndefined();
    // Medium thinking for the strategist judging subagent outputs.
    expect(bootJob?.payload.thinking).toBe("medium");
    expect(bootJob?.payload.message).toContain("FIRST HEARTBEAT");
    expect(bootJob?.payload.message).toContain("/lc_gtm/target_thread");
    expect(bootJob?.payload.message).toContain("/lc_gtm/send_update");
    expect(bootJob?.payload.message).toContain("validate_outbound");
    expect(bootJob?.payload.message).toContain("GROUNDED-OR-SILENT");
    // No phase 1/phase 2 split — assert the old ids are gone.
    expect(jobs.jobs.find((j) => j.id === "0001_gtm_boot_phase_1")).toBeUndefined();
    expect(jobs.jobs.find((j) => j.id === "0002_gtm_boot_phase_2")).toBeUndefined();
    expect(heartbeat).toBeTruthy();
    expect(heartbeat?.sessionTarget).toBe("isolated");
    expect(heartbeat?.payload.kind).toBe("agentTurn");
    expect(heartbeat?.payload.thinking).toBe("off");
    expect(heartbeat?.payload.timeoutSeconds).toBe(60);
    expect(heartbeat?.delivery).toEqual({ mode: "none", bestEffort: true });
    expect(heartbeat?.payload.message).toContain("Read HEARTBEAT.md");
    expect(heartbeat?.payload.message).toContain("Do not call ScrapeCreators");
    expect(heartbeat?.payload.message).toContain("paid external API");
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

  it("Sprint 2.15.1 — boot prompt enforces grounded-or-silent on calendar + thread claims", () => {
    // Live 2026-05-25 regression: Maya claimed "I've populated your
    // calendar for the next 14 days" with 0 actual gtmCalendarEvents
    // rows. Grounded-or-silent (CLAUDE.md Architecture #3) was the
    // missing guard. The unified boot task (Sprint 2.16c) must call
    // this out explicitly so the LLM doesn't re-invent the same
    // hallucination.
    const { files } = buildMayaGtmWorkspace(INPUT);
    const jobs = JSON.parse(files.get("jobs.json") ?? "{}") as {
      jobs: Array<{ id: string; payload: { message: string } }>;
    };
    const boot = jobs.jobs.find((j) => j.id === "0001_gtm_first_research");
    expect(boot).toBeTruthy();
    expect(boot!.payload.message).toContain("GROUNDED-OR-SILENT");
    expect(boot!.payload.message).toContain("CLAUDE.md");
    expect(boot!.payload.message).toContain("calendar populated");
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

  it("documents WhatsApp fallback to direct gateway/session smoke", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);

    expect(files.get("BOOT.md")).toContain(
      "If WhatsApp is unavailable, write the status to the gateway session"
    );
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
