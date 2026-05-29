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
  it("renders digested onboarding diagnosis into APP.md", () => {
    const { files } = buildMayaGtmWorkspace({
      ...INPUT,
      walkthroughVideoUrl: "https://files.convex.test/walkthrough.mp4",
      appDiagnosis: {
        summary: {
          productPromise: "Capture customer bug context in one click.",
          likelyAudience: ["indie SaaS founders", "small support teams"],
          visibleFeatures: ["session replay", "one-click report"],
        },
        walkthrough: {
          userProblem: "Bug reports arrive with no reproduction context.",
          coreWorkflow: "User clicks the widget; a contextful report is filed.",
          strongestDemoMoments: [
            "the one-click capture",
            "the auto-filled repro steps",
          ],
          shortFormFormatCandidates: ["before/after of a messy bug report"],
          facelessScreenRecordingEnough: true,
        },
      },
    });
    const app = files.get("APP.md") ?? "";
    expect(app).toContain("Digested at onboarding");
    expect(app).toContain("Capture customer bug context in one click.");
    expect(app).toContain("Bug reports arrive with no reproduction context.");
    expect(app).toContain("the one-click capture");
    expect(app).toContain("indie SaaS founders");
    // Maya is told to digest the product herself, and given the video.
    expect(app).toContain("See the product yourself");
    expect(app).toContain("https://files.convex.test/walkthrough.mp4");

    // Without a diagnosis APP.md falls back to the bare stub (no leaked
    // "Digested" header), so the agent knows it must research from scratch —
    // but the "see it yourself" instruction is always present.
    const bare = buildMayaGtmWorkspace(INPUT).files.get("APP.md") ?? "";
    expect(bare).not.toContain("Digested at onboarding");
    expect(bare).toContain("Plain-English diagnosis");
    expect(bare).toContain("See the product yourself");
    expect(bare).not.toContain("https://files.convex.test/walkthrough.mp4");
  });

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
        "DREAMS.md",
        "PLATFORM_ALGO.md",
        "jobs.json",
      ])
    );
    expect(files.get("AGENTS.md")).toContain("My constitution");
    expect(files.get("AGENTS.md")).toContain("The database is truth.");
    expect(files.get("APP.md")).toContain("BugBrief");
    expect(files.get("GTM.md")).toContain("Primary: reddit");
    // Sprint A (trust & stability) — BOOT.md is the slim routing file:
    // read MEMORY.md's append-only lifecycle log, send the hello if no
    // `hello_sent_at:` line exists yet, route on foundation, then yield.
    // It deliberately does NOT inline the foundation procedure, subagent
    // management, or cron scheduling — those live in the skills /
    // HEARTBEAT / native tools. "This file is the routing decision and
    // nothing more."
    const boot = files.get("BOOT.md") ?? "";
    expect(boot).toContain("MEMORY.md FIRST");
    expect(boot).toContain("lifecycle log");
    expect(boot).toContain("hello_sent_at:");
    expect(boot).toContain("foundation_started_at");
    expect(boot).toContain("foundation_completed_at:");
    expect(boot).toContain("USER.md");
    expect(boot).toContain("APP.md");
    expect(boot).toContain("maya-foundation-research");
    expect(boot).toContain("sessions_yield");
    // Sprint A append-only contract: BOOT must instruct APPEND, never
    // edit, so the OpenClaw exact-match edit tool cannot fail on marker
    // drift (the "Could not find the exact text in MEMORY.md" bug class).
    expect(boot).toMatch(/APPEND a .*hello_sent_at/);
    expect(boot).toContain("never edit an existing line");
    // Sprint 2.16u-fix8 — voice firewall removed per operator: "I hate
    // hardcoded string blockers. Get rid of all of that and just add
    // it to her prompt where appropriate." Voice contract now lives in
    // SOUL.md "What I never say" section, enforced by Maya's judgment.
    expect(boot).toContain('SOUL.md');
    // Sprint A — MEMORY.md ships an append-only lifecycle log, not the
    // old exact-match placeholder lines (`<set this when…>` / `<updated
    // by … cron>`) that the edit tool would choke on. Assert the old
    // fragile placeholders are gone.
    const memory = files.get("MEMORY.md") ?? "";
    expect(memory).toContain("APPEND-ONLY");
    expect(memory).toContain("lifecycle log");
    expect(memory).not.toContain("<set this when");
    expect(memory).not.toContain("<updated by");
    // Sprint E — shared, monthly-refreshed platform-algorithm intelligence.
    const platformAlgo = files.get("PLATFORM_ALGO.md") ?? "";
    expect(platformAlgo).toContain("what's working on each platform");
    expect(platformAlgo).toContain("Refresh contract");
    expect(platformAlgo).toContain("monthly_reset");
    expect(platformAlgo).toContain("## Reddit");
    expect(platformAlgo).toContain("## YouTube");
    expect(platformAlgo).toContain("Refresh log");
    // SOUL.md's AI self-reference ban was reworded from "never identify as
    // an AI" to the "AI self-references" banned-phrase entry (which spells
    // out "the ban is on self-identification"). Same intent: Maya never
    // identifies herself as an AI.
    expect(files.get("SOUL.md")).toContain("AI self-references");
    expect(files.get("SOUL.md")).toContain("self-identification");
    expect(files.get("USER.md")).toContain("Will manually post Instagram: yes");
    expect(files.get("USER.md")).toContain("TikTok warm-up state: warming");
    expect(files.get("USER.md")).toContain("TikTok account age days: 3");
    expect(files.get("USER.md")).toContain(
      "TikTok Account Check completed: no"
    );
    expect(files.get("USER.md")).toContain("Creator/content budget: $250/month");
    expect(files.get("GTM.md")).toContain("Do not recommend TikTok/Instagram");
  });

  // Sprint B2/B3 — North Star contract + entryMode fork rendered into
  // GTM.md and APP.md (manager-mode existing-account ingestion).
  it("renders North Star + entry-mode posture into GTM.md and APP.md", () => {
    // Default INPUT has no entryMode / northStar → propose-at-synthesis path.
    const baseFiles = buildMayaGtmWorkspace(INPUT).files;
    const base = baseFiles.get("GTM.md") ?? "";
    expect(base).toContain("Mode — UNRESOLVED");
    expect(base).toContain("North Star (propose at synthesis)");
    expect(base).not.toContain("Mode — MANAGER");
    // APP.md mirrors the unresolved fork.
    const baseApp = baseFiles.get("APP.md") ?? "";
    expect(baseApp).toContain("Entry mode — meet them where they are");
    expect(baseApp).toContain("Mode UNRESOLVED");

    // Already-launched manager-mode founder with a set North Star → the
    // launch theater is skipped and the concrete North Star is rendered.
    const managerInput: MayaGtmWorkspaceInput = {
      ...INPUT,
      app: {
        ...INPUT.app,
        entryMode: "manager",
        northStarMetric: "signups/week",
        northStarTarget: 50,
        northStarDeadlineMs: Date.UTC(2026, 5, 30),
      },
    };
    const managerFiles = buildMayaGtmWorkspace(managerInput).files;
    const managerGtm = managerFiles.get("GTM.md") ?? "";
    expect(managerGtm).toContain("Mode — MANAGER (already launched)");
    expect(managerGtm).toContain("Skip the launch arc");
    expect(managerGtm).toContain("North Star (the one tracked outcome)");
    expect(managerGtm).toContain("signups/week");
    expect(managerGtm).toContain("50");
    expect(managerGtm).toContain("2026-06-30");
    expect(managerGtm).not.toContain("Mode — UNRESOLVED");
    // APP.md manager-mode: ingest the founder's OWN accounts first, and the
    // fixture's existing handles are surfaced as the starting point.
    const managerApp = managerFiles.get("APP.md") ?? "";
    expect(managerApp).toContain("MANAGER mode");
    expect(managerApp).toContain("ingest their OWN accounts first");
    expect(managerApp).toContain("tiktok.com/@bugbrief");
    expect(managerApp).not.toContain("Mode UNRESOLVED");
  });

  // Sprint B4 — first-synthesis quality bar (output-critic) + Q&A-readiness
  // contract (AGENTS.md). The make-or-break first reveal + defending the plan.
  it("ships the first-synthesis quality bar + Q&A-readiness contract", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);
    const critic = files.get("skills/maya-output-critic/SKILL.md") ?? "";
    expect(critic).toContain("the FIRST synthesis");
    expect(critic).toContain("Proof I understood THEIR product");
    expect(critic).toContain("A decision, not a menu");
    expect(critic).toContain("One concrete thing to do this week");

    const agents = files.get("AGENTS.md") ?? "";
    expect(agents).toContain("Q&A readiness");
    expect(agents).toContain("Defend with the actual evidence I stored");
    expect(agents).toContain("Adapt when they push back");
    expect(agents).toContain('"I don\'t know / let me check"');
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
        // Sprint H — YouTube as a first-class platform.
        "maya-youtube-researcher",
      ])
    );
    expect(files.get("skills/maya-tiktok-format-researcher/SKILL.md")).toContain(
      "slideshow_photo_mode"
    );
    expect(files.get("skills/maya-ugc-system-advisor/SKILL.md")).toContain(
      "premature"
    );
    // Sprint H — YouTube researcher: transcripts + Brief-only + title=CTR.
    const yt = files.get("skills/maya-youtube-researcher/SKILL.md") ?? "";
    expect(yt).toContain("/video/transcript");
    expect(yt).toContain("Brief-only");
    expect(yt).toContain("title is the CTR lever");
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
    // Reworded "argument" -> "field" (the contract now says "DO NOT pass a
    // `model` field"); same intent — no model alias passed to sessions_spawn.
    expect(agents).toContain("DO NOT pass a `model` field");
    expect(agents).toContain('agentId: "reddit_research"');
    expect(agents).toContain("timeout_minutes");
    expect(agents).toContain("maxScrapeCreatorsCalls");
    expect(agents).toContain("coverageChecklist");
    expect(agents).toContain("failureBehavior");
    expect(agents).toContain("TikTok format research");
    expect(agents).toContain("slideshow/carousel");
  });

  it("HEARTBEAT.md is the recurring polling loop with full task coverage", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);
    const heartbeat = files.get("HEARTBEAT.md") ?? "";

    // HEARTBEAT.md was slimmed in a later sprint to a thin cadence + ping
    // spec. It is still the recurring polling loop, just expressed through
    // its tick framing and an explicit interval cadence rather than the old
    // "recurring polling loop" header and labeled task list. Assert the
    // current wording that proves the same loop: it ticks, defaults silent,
    // and polls on an interval (5 min during research, ~30 min in compound
    // mode). See "possibly-dropped functionality" in the realignment report
    // for the labeled task entries that no longer ship in this file.
    expect(heartbeat).toContain("Tick. Mostly silent.");
    expect(heartbeat).toContain("## Cadence");
    expect(heartbeat).toContain("every 5 min");
    expect(heartbeat).toContain("~30 min between ticks");

    // launch-watchdog is GONE — BOOT.md now routes foundation vs
    // continuous itself; heartbeat doesn't drive launch.
    expect(heartbeat).not.toContain("launch-watchdog");
    expect(heartbeat).not.toContain("state-hello");
    expect(heartbeat).not.toContain("state-channels-picked");

    // Ping-worthy task surface — the labeled slugs (hot-alert,
    // inbound-triage, calendar-due, stuck-worker-sweep) were replaced by
    // plain-English ping triggers under "## When to actually ping". Assert
    // the current wording that proves each trigger still exists.
    // hot-alert -> "5x its 1h baseline"
    expect(heartbeat).toContain("5x its 1h baseline");
    // inbound-triage -> unanswered inbound DM trigger
    expect(heartbeat).toContain("Inbound DM that I haven't responded to");
    // calendar-due -> queued calendar event needing action soon
    expect(heartbeat).toContain("queued calendar event in the next 30 min");
    // stuck-worker-sweep -> worker silent >5 min surfaced + adjusted
    expect(heartbeat).toContain("worker has been silent >5 min");
    // Sprint E — restored recovery/maintenance tasks (dropped when HEARTBEAT
    // was slimmed; flagged in Sprint A, restored here).
    expect(heartbeat).toContain("missed-cadence recovery");
    expect(heartbeat).toContain("published-results-scan");
    // Sprint E — relationship cadence engine + continuous inbound polling.
    expect(heartbeat).toContain("relationship-cadence");
    expect(heartbeat).toContain("inbound-poll");

    // Manager-mode marker the heartbeat still keys off.
    expect(heartbeat).toContain("foundation_completed_at:");

    // Voice contract + primitives.
    expect(heartbeat).toContain("HEARTBEAT_OK");
    expect(heartbeat).toContain("SOUL.md");
  });

  it("jobs.json carries only the deploy-safety-net kickstart; cadence is Maya-scheduled at runtime", () => {
    // Sprint 2.17 Phase E — jobs.json drops gtm_channel_discovery +
    // gtm_weekly_review. Maya self-schedules her own behavioral cadence
    // via `cron action=add` in BOOT step 4 (morning/evening/weekly/
    // monthly) using the operator's timezone. The kickstart cron
    // stays as a safety net so the operator gets the hello at +300s
    // even if the gateway:startup hook misfires.
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
    // Sprint A — idempotency: the kickstart is a SAFETY NET that must
    // read MEMORY.md and no-op if BOOT.md already sent the hello, so a
    // successful gateway:startup hello is never followed by a duplicate.
    expect(kickstart?.payload.message).toContain("IDEMPOTENCY CHECK FIRST");
    expect(kickstart?.payload.message).toMatch(
      /If ANY line begins with .*hello_sent_at/
    );
    expect(kickstart?.payload.message).toContain("STOP");
    // Sprint A — reconciled hello spec: short (1-3 sentences), and the
    // stale "14-day plan" line (contradicts the locked rolling-7-day
    // decision) is gone.
    expect(kickstart?.payload.message).not.toContain("14-day");
    // Explicit non-assertions: kickstart MUST NOT spawn subagents or
    // claim launch_flow here — those are HEARTBEAT.md's job now.
    expect(kickstart?.payload.message).not.toContain("sessions_spawn");
    expect(kickstart?.payload.message).not.toContain("phase_1_announce");
    expect(
      (kickstart?.payload as { lightContext?: boolean }).lightContext,
      "lightContext: true matches creator app pattern for fast agent turn"
    ).toBe(true);

    // Sprint 2.17 Phase E — weekly review and channel discovery are
    // GONE from baked jobs.json. Maya schedules them at runtime via
    // `cron action=add` in BOOT step 4 using operator timezone, with
    // skill prompts (maya-weekly-review on Sunday 18:00,
    // maya-foundation-research monthly reset on the 1st at 06:00).
    expect(
      jobs.jobs.find((j) => j.id === "gtm_weekly_review"),
      "weekly review must NOT be baked into deploy-time jobs.json"
    ).toBeUndefined();
    expect(
      jobs.jobs.find((j) => j.id === "gtm_channel_discovery"),
      "channel discovery must NOT be baked into deploy-time jobs.json"
    ).toBeUndefined();

    // jobs.json now contains exactly one job: the kickstart safety net.
    expect(jobs.jobs).toHaveLength(1);
    expect(jobs.jobs[0].id).toBe("0001_kickstart");
  });

  it("Sprint 2.16u-fix8 — kickstart cron references SOUL.md for voice (firewall removed)", () => {
    // Sibling-file scan: prevent silent regression of the voice
    // contract enforcement. The hardcoded validate_outbound firewall
    // was ripped out in Sprint 2.16u-fix8 — Maya now self-checks
    // against SOUL.md's "What I never say" ban list before send.
    //
    // Sprint 2.17 Phase E — the only deploy-baked user-facing cron
    // is the kickstart safety net. Maya-scheduled crons inherit voice
    // discipline from the skill files (maya-morning-brief etc.) that
    // their cron-add prompts will reference.
    const { files } = buildMayaGtmWorkspace(INPUT);
    const jobs = JSON.parse(files.get("jobs.json") ?? "{}") as {
      jobs: Array<{ id: string; payload: { message: string } }>;
    };
    const kickstart = jobs.jobs.find((j) => j.id === "0001_kickstart");
    expect(kickstart, "kickstart cron must exist").toBeTruthy();
    expect(
      kickstart!.payload.message,
      "kickstart must reference SOUL.md voice contract before sendMessage"
    ).toContain("SOUL.md");
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

  it("documents the proactive out-of-band send path in TOOLS.md", () => {
    // Sprint 2.16j: BOOT.md no longer carries the WhatsApp fallback
    // checklist (BOOT.md is now hello-only). TOOLS.md is where Maya looks
    // when she needs to send a status outside an inbound trigger.
    //
    // The old "Direct gateway/session pings for smoke tests" section (a
    // direct-gateway smoke/pre-pairing ping) no longer ships in TOOLS.md —
    // see "possibly-dropped functionality" in the realignment report. The
    // current file documents the same underlying intent (send a message
    // when there is NO inbound trigger to reply to) via the PROACTIVE
    // delivery path: a curl POST to /lc_gtm/send_update that Convex forwards
    // to Telegram. Assert that proactive out-of-band path is documented.
    const { files } = buildMayaGtmWorkspace(INPUT);
    const tools = files.get("TOOLS.md") ?? "";

    expect(tools).toContain("(PROACTIVE)");
    expect(tools).toContain("/lc_gtm/send_update");
    expect(tools).toContain("without an inbound trigger");
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
