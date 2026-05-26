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
    // Sprint 2.16r — BOOT.md owns hello composition. Maya reads USER.md
    // + APP.md, writes a unique intro, and appends a `hello_sent_at:`
    // marker to MEMORY.md so future turns skip the greeting. No more
    // hardcoded Convex hello.
    expect(files.get("BOOT.md")).toContain("MEMORY.md FIRST");
    expect(files.get("BOOT.md")).toContain("hello_sent_at:");
    expect(files.get("BOOT.md")).toContain("USER.md");
    expect(files.get("BOOT.md")).toContain("APP.md");
    expect(files.get("BOOT.md")).toContain("operator may reply");
    expect(files.get("BOOT.md")).toContain("/lc_gtm/send_update");
    // Sprint 2.16u-fix8 — voice firewall removed per operator: "I hate
    // hardcoded string blockers. Get rid of all of that and just add
    // it to her prompt where appropriate." Voice contract now lives in
    // SOUL.md "What I never say" section, enforced by Maya's judgment.
    expect(files.get("BOOT.md")).toContain('SOUL.md');
    expect(files.get("SOUL.md")).toContain("never identify as an AI");
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
    // Sprint 2.16t — removed `model: main_maya` style references because
    // those aliases were being passed as model IDs to sessions_spawn and
    // OpenRouter rejected them ("openrouter/hard_research_beta is not a
    // valid model ID"). Now the contracts use `agentId: "..."` and the
    // gateway-configured model resolves automatically.
    expect(agents).toContain("DO NOT pass a `model` argument");
    expect(agents).toContain('agentId: "reddit_research"');
    expect(agents).toContain("timeout_minutes");
    expect(agents).toContain("maxScrapeCreatorsCalls");
    expect(agents).toContain("coverageChecklist");
    expect(agents).toContain("failureBehavior");
    expect(agents).toContain("TikTok format research");
    expect(agents).toContain("slideshow/carousel");
  });

  it("HEARTBEAT.md is a state machine gated by MEMORY.md markers (Sprint 2.16u)", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);
    const heartbeat = files.get("HEARTBEAT.md") ?? "";

    // State-machine tasks — each gated by a MEMORY.md marker so they
    // run exactly once on the path from boot to steady state.
    expect(heartbeat).toContain("state-hello");
    expect(heartbeat).toContain("state-channels-picked");
    expect(heartbeat).toContain("state-subagents-dispatched");
    expect(heartbeat).toContain("state-plan-synthesis");
    expect(heartbeat).toContain("hello_sent_at:");
    expect(heartbeat).toContain("channels_picked:");
    expect(heartbeat).toContain("subagents_spawned:");
    expect(heartbeat).toContain("plan_sent_at:");
    // Steady-state maintenance tasks (these survived from the old
    // HEARTBEAT.md — same per-task interval gating just with explicit
    // markers + state progression now at the top).
    expect(heartbeat).toContain("pending-approvals");
    expect(heartbeat).toContain("calendar-due");
    expect(heartbeat).toContain("open-loops");
    expect(heartbeat).toContain("published-results-scan");
    // HEARTBEAT_OK literal-token reply pattern still required for
    // quiet ticks — silent ticks are the common case once the state
    // machine has progressed past plan-synthesis.
    expect(heartbeat).toContain("HEARTBEAT_OK");
    // Sprint 2.16u-fix8 — voice firewall removed; HEARTBEAT.md now
    // references SOUL.md voice contract for inline self-check.
    expect(heartbeat).toContain("SOUL.md");
    // Strategic sends still need evidence_ids — guard mentioned for
    // the state-plan-synthesis task.
    expect(heartbeat).toContain("evidence_ids");
  });

  it("Sprint 2.16u — jobs.json carries ONLY scheduled events (no boot cron, no heartbeat cron)", () => {
    // Sprint 2.16u: dropped `0001_gtm_first_research` boot cron and
    // `gtm_heartbeat` cron. Per OpenClaw docs (/automation/index.md +
    // /gateway/heartbeat.md), cron is for exact-timing scheduled events;
    // continuous "work toward a goal" loops live in HEARTBEAT.md's
    // `tasks:` block with per-task interval gating + heartbeatTaskState
    // persistence across restarts.
    //
    // Boot work (hello → channel pick → subagent dispatch → plan synth)
    // now lives in HEARTBEAT.md as a MEMORY.md-marker-gated state
    // machine. The native heartbeat (agents.defaults.heartbeat.every:
    // "5m") drives it.
    //
    // The two crons that REMAIN are real scheduled events:
    //   - gtm_weekly_review (Mondays 10am, week-over-week refresh)
    //   - gtm_channel_discovery (1st of month, new-channel hunt)
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

    // The OLD heavy boot crons stay GONE — they orchestrated 45-min
    // research turns that held main session captive (Sprint 2.16u).
    expect(
      jobs.jobs.find((j) => j.id === "0001_gtm_first_research")
    ).toBeUndefined();
    expect(jobs.jobs.find((j) => j.id === "gtm_heartbeat")).toBeUndefined();
    expect(
      jobs.jobs.find((j) => j.id === "0001_gtm_boot_phase_1")
    ).toBeUndefined();
    expect(
      jobs.jobs.find((j) => j.id === "0002_gtm_boot_phase_2")
    ).toBeUndefined();

    // Sprint 2.16u-fix11 — kickstart one-shot cron RE-ADDED (lightweight,
    // single message, deletes after run). Fires ~180s after deploy via
    // OpenClaw native scheduler. Replaces unreliable heartbeat-driven hello.
    const kickstart = jobs.jobs.find((j) => j.id === "0001_kickstart");
    expect(kickstart, "kickstart cron must exist").toBeTruthy();
    expect(kickstart?.sessionTarget).toBe("isolated");
    expect((kickstart as unknown as { wakeMode?: string }).wakeMode).toBe(
      "now"
    );
    expect(
      (kickstart as unknown as { deleteAfterRun?: boolean }).deleteAfterRun
    ).toBe(true);
    expect(kickstart?.payload.message).toContain("FIRST-BOOT KICKSTART");
    expect(kickstart?.payload.message).toContain("SOUL.md");
    expect(kickstart?.payload.message).toContain("hello_sent_at");
    // Sprint 2.16u-fix12 — kickstart uses OpenClaw native message tool
    // (action=send, channel=telegram) via the cron's delivery config,
    // NOT exec+curl. Faster + native + uses channel adapter routing.
    expect(kickstart?.payload.message).toContain("message` tool");
    // lightContext is critical for fast agent turn (matches creator app)
    expect(
      (kickstart?.payload as { lightContext?: boolean }).lightContext
    ).toBe(true);

    // Weekly review survives — it's a real exact-timing scheduled event
    // (Mondays 10am), and still drives the compounding cycle.
    const weeklyReview = jobs.jobs.find((j) => j.id === "gtm_weekly_review");
    expect(weeklyReview).toBeTruthy();
    expect(weeklyReview?.payload.message).toContain("WEEKLY REVIEW");
    expect(weeklyReview?.payload.message).toContain("compounding cycle");
    expect(weeklyReview?.payload.message).toContain("subagent");
    expect(weeklyReview?.payload.message).toContain(
      "/lc_gtm/get_my_recent_post_results"
    );
    expect(weeklyReview?.payload.message).toContain("BANS");

    // Channel discovery survives too — monthly hunt for new channels.
    const channelDiscovery = jobs.jobs.find(
      (j) => j.id === "gtm_channel_discovery"
    );
    expect(channelDiscovery).toBeTruthy();
  });

  it("Sprint 2.16u-fix8 — every user-facing cron prompt references SOUL.md for voice (firewall removed)", () => {
    // Sibling-file scan: prevent silent regression of the voice
    // contract enforcement. The hardcoded validate_outbound firewall
    // was ripped out in Sprint 2.16u-fix8 — Maya now self-checks
    // against SOUL.md's "What I never say" ban list before send.
    // Each user-facing cron prompt must still REFERENCE SOUL.md so
    // Maya knows where the contract lives.
    const { files } = buildMayaGtmWorkspace(INPUT);
    const jobs = JSON.parse(files.get("jobs.json") ?? "{}") as {
      jobs: Array<{ id: string; payload: { message: string } }>;
    };
    const userFacingIds = ["gtm_channel_discovery", "gtm_weekly_review"];
    for (const id of userFacingIds) {
      const job = jobs.jobs.find((j) => j.id === id);
      expect(job, `cron ${id} must exist`).toBeTruthy();
      expect(
        job!.payload.message,
        `cron ${id} must reference SOUL.md voice contract before sendMessage`
      ).toContain("SOUL.md");
    }
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
