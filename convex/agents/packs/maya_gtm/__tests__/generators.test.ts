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
      expect(body).toContain("Do not spend external API budget");
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
    expect(files.get("skills/maya-slop-critic/SKILL.md")).toContain(
      "generic AI phrasing"
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
      "slideshows"
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
    expect(heartbeat).toContain("Forbidden on heartbeat");
    expect(heartbeat).toContain("ScrapeCreators calls");
    expect(heartbeat).toContain("Gemini deep research");
    expect(heartbeat).toContain("X recent search");
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
    const bootKickoff = jobs.jobs.find(
      (job) => job.id === "0001_gtm_boot_kickoff"
    );
    const heartbeat = jobs.jobs.find((job) => job.id === "gtm_heartbeat");
    const weeklyReview = jobs.jobs.find((job) => job.id === "gtm_weekly_review");

    expect(jobs.jobs[0]?.id).toBe("0001_gtm_boot_kickoff");
    expect(bootKickoff).toBeTruthy();
    expect(bootKickoff?.sessionTarget).toBe("isolated");
    expect(bootKickoff?.payload.kind).toBe("agentTurn");
    expect(bootKickoff?.delivery).toEqual({ mode: "none", bestEffort: true });
    expect(bootKickoff?.payload.message).toContain("FIRST WAKE");
    expect(bootKickoff?.payload.message).toContain("Read BOOT.md");
    expect(bootKickoff?.payload.message).toContain("onboarding deep research");
    expect(bootKickoff?.payload.message).toContain("maxScrapeCreatorsCalls");
    expect(heartbeat).toBeTruthy();
    expect(heartbeat?.sessionTarget).toBe("isolated");
    expect(heartbeat?.payload.kind).toBe("agentTurn");
    expect(heartbeat?.payload.thinking).toBe("off");
    expect(heartbeat?.payload.timeoutSeconds).toBe(60);
    expect(heartbeat?.delivery).toEqual({ mode: "none", bestEffort: true });
    expect(heartbeat?.payload.message).toContain("Read HEARTBEAT.md");
    expect(heartbeat?.payload.message).toContain("Do not call ScrapeCreators");
    expect(heartbeat?.payload.message).toContain("paid external API");
    expect(weeklyReview?.payload.message).toContain(
      "explicit bounded research job"
    );
    expect(weeklyReview?.payload.message).toContain("maxScrapeCreatorsCalls");
  });

  it("keeps the prompt-context bundle (workspace minus playbook/) inside a prompt budget", () => {
    // Sprint 2.5: PLAYBOOK.md + playbook/*.md are REFERENCE files Maya reads
    // only when channel-judging or content-drafting. They aren't part of the
    // every-turn prompt context, so they're excluded from the prompt budget.
    // AGENTS.md / SOUL.md / etc. ARE every-turn context and stay capped.
    const { files } = buildMayaGtmWorkspace(INPUT);
    const promptContextChars = [...files.entries()]
      .filter(
        ([path]) => path !== "PLAYBOOK.md" && !path.startsWith("playbook/")
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
