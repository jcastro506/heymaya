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
  activeResearchJobId: "job_test_123",
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
    expect(files.get("BOOT.md")).toContain("gateway:startup");
    expect(files.get("BOOT.md")).toContain("message` tool");
    expect(files.get("BOOT.md")).toContain("sessions_spawn");
    expect(files.get("BOOT.md")).toContain("sessions_yield");
    // Sprint 2.17 Phase C — BOOT routes on foundation existence:
    // empty → invoke maya-foundation-research skill, populated →
    // invoke maya-continuous-research + maya-morning-brief.
    expect(files.get("BOOT.md")).toContain("/lc_gtm/get_my_foundation");
    expect(files.get("BOOT.md")).toContain("maya-foundation-research");
    expect(files.get("BOOT.md")).toContain("maya-continuous-research");
    expect(files.get("BOOT.md")).toContain("foundation_completed_at:");
    expect(files.get("BOOT.md")).toContain("last_morning_brief_at:");
    // Native lifecycle tools — BOOT delegates worker mgmt to subagents.
    expect(files.get("BOOT.md")).toContain("subagents action=list");
    expect(files.get("BOOT.md")).toContain("subagents action=kill");
    expect(files.get("BOOT.md")).toContain("subagents action=steer");
    // Self-schedules its own cadence via native cron.
    expect(files.get("BOOT.md")).toContain("cron action=add");
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

  it("HEARTBEAT.md is the out-of-band recovery loop, not the primary launch driver", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);
    const heartbeat = files.get("HEARTBEAT.md") ?? "";

    // Sprint 2.17 Phase C — HEARTBEAT collapses to recovery only. The
    // primary cadence (morning brief / evening recap / weekly review)
    // runs via self-scheduled crons added by BOOT step 4. Worker
    // lifecycle uses native subagents tools, not heartbeat polling.
    expect(heartbeat).toContain("out-of-band recovery");
    expect(heartbeat).toContain("self-scheduled crons");

    // launch-watchdog is GONE — BOOT.md now routes foundation vs
    // continuous itself; heartbeat doesn't drive launch.
    expect(heartbeat).not.toContain("launch-watchdog");
    expect(heartbeat).not.toContain("state-hello");
    expect(heartbeat).not.toContain("state-channels-picked");

    // New recovery + maintenance tasks.
    expect(heartbeat).toContain("missed-cadence");
    expect(heartbeat).toContain("pending-approvals");
    expect(heartbeat).toContain("calendar-due");
    expect(heartbeat).toContain("open-loops");
    expect(heartbeat).toContain("published-results-scan");
    // Stuck-worker sweep uses native lifecycle: subagents kill clears
    // the gateway lane immediately per OpenClaw source.
    expect(heartbeat).toContain("stuck-worker-sweep");
    expect(heartbeat).toContain("subagents action=list");
    expect(heartbeat).toContain("subagents\n    action=kill");

    // missed-cadence references the manager-mode markers.
    expect(heartbeat).toContain("foundation_completed_at:");
    expect(heartbeat).toContain("last_morning_brief_at:");

    // Existing-state primitives still in play.
    expect(heartbeat).toContain("HEARTBEAT_OK");
    expect(heartbeat).toContain("SOUL.md");
    expect(heartbeat).toContain("$CONVEX_SITE_URL");
  });

  it("jobs.json carries only exact scheduled events; boot work is native BOOT.md", () => {
    // OpenClaw docs split the primitives clearly: BOOT.md starts the
    // launch on gateway startup, heartbeat monitors/retries, cron is for
    // exact scheduled events. The first hello must not wait on a +300s
    // one-shot cron.
    //
    // The two crons that remain are real scheduled events:
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

    // Sprint 2.16u-fix14 — kickstart RE-ADDED. boot-md hook didn't reliably
    // fire BOOT.md on our patched OpenClaw 2026.4.23 image (verified failure
    // 2026-05-27: hooks loaded, "skipping optional post-channel sidecars"
    // line fired, but no [gateway/boot] log or session files). Cron is the
    // proven mechanism from the creator app.
    const kickstart = jobs.jobs.find((j) => j.id === "0001_kickstart");
    expect(kickstart, "kickstart cron must exist").toBeTruthy();
    expect(kickstart?.sessionTarget).toBe("isolated");
    expect((kickstart as unknown as { wakeMode?: string }).wakeMode).toBe("now");
    expect(
      (kickstart as unknown as { deleteAfterRun?: boolean }).deleteAfterRun
    ).toBe(true);
    // Sprint 2.16u-fix15 — kickstart is now JUST the hello. Launch
    // workflow moved to HEARTBEAT.md watchdog (fix14's prompt packed
    // too much into one 5-min cron turn and got timed out at 362s).
    expect(kickstart?.payload.message).toContain("SOUL.md");
    expect(kickstart?.payload.message).toContain("hello_sent_at");
    expect(kickstart?.payload.message).toContain("message tool");
    // Explicit non-assertions: kickstart MUST NOT spawn subagents or
    // claim launch_flow here — those are HEARTBEAT.md's job now.
    expect(kickstart?.payload.message).not.toContain("sessions_spawn");
    expect(kickstart?.payload.message).not.toContain("phase_1_announce");
    expect(
      (kickstart?.payload as { lightContext?: boolean }).lightContext,
      "lightContext: true matches creator app pattern for fast agent turn"
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
