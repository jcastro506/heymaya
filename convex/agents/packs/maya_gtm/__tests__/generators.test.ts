import { describe, expect, it } from "vitest";
import {
  buildMayaGtmWorkspace,
  localCronToUtc,
  mayaGtmSkillSlugs,
  type MayaGtmWorkspaceInput,
} from "../generators";
import { BUNDLED_GTM_PLUGIN_TOOLS } from "../bundledGtmPlugin";

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
    // #15 (durable loop fix) — BOOT.md is the slim routing file: it reads the
    // DURABLE lifecycle from Convex via `get_agent_lifecycle` (NOT MEMORY.md,
    // which is wiped on every Fly restart and caused the re-doing loop), sends
    // the hello if `helloSent` is false, acquires the foundation lease before
    // running onboarding, and marks completion via `mark_lifecycle`. It
    // deliberately does NOT inline the foundation procedure, subagent
    // management, or cron scheduling — those live in the skills / HEARTBEAT /
    // native tools.
    const boot = files.get("BOOT.md") ?? "";
    expect(boot).toContain("get_agent_lifecycle");
    expect(boot).toContain("foundationComplete");
    expect(boot).toContain("acquire_foundation_lease");
    expect(boot).toContain('mark_lifecycle');
    // The lifecycle is durable in Convex; MEMORY.md is explicitly NOT the
    // source of truth (it's wiped on restart). BOOT must say so.
    expect(boot).toMatch(/MEMORY\.md.*(wiped|not.*source|ephemeral)/i);
    expect(boot).toContain("USER.md");
    expect(boot).toContain("APP.md");
    expect(boot).toContain("maya-foundation-research");
    expect(boot).toContain("sessions_yield");
    // After sending the hello, mark it durably (idempotent) so a restart can't
    // make Maya re-introduce herself like a stranger.
    expect(boot).toMatch(/mark_lifecycle\(\{ marker: "hello_sent" \}\)/);
    // Sprint 2.16u-fix8 — voice firewall removed per operator: "I hate
    // hardcoded string blockers. Get rid of all of that and just add
    // it to her prompt where appropriate." Voice contract now lives in
    // SOUL.md "What I never say" section, enforced by Maya's judgment.
    expect(boot).toContain('SOUL.md');
    // #15 — MEMORY.md is now an EPHEMERAL scratchpad, NOT an append-only
    // lifecycle log. It must tell Maya the lifecycle lives in Convex
    // (get_agent_lifecycle), and must not carry the old fragile placeholders.
    const memory = files.get("MEMORY.md") ?? "";
    expect(memory).toMatch(/EPHEMERAL|wiped/);
    expect(memory).toContain("get_agent_lifecycle");
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
    // Sprint J — DREAMS.md is the per-tenant self-improvement nursery (Layer 1)
    // and points to the governed Layer-2 propose path; core contracts are
    // explicitly never self-editable.
    const dreams = files.get("DREAMS.md") ?? "";
    expect(dreams).toContain("Self-improvement");
    expect(dreams).toContain("propose_skill_improvement");
    expect(dreams).toContain("NEVER self-editable");
    // SOUL.md's AI self-reference ban was reworded from "never identify as
    // an AI" to the "AI self-references" banned-phrase entry (which spells
    // out "the ban is on self-identification"). Same intent: Maya never
    // identifies herself as an AI.
    expect(files.get("SOUL.md")).toContain("AI self-references");
    expect(files.get("SOUL.md")).toContain("self-identification");
    expect(files.get("USER.md")).toContain("Will manually post Instagram: yes");
    // Warmup generalized to per-channel (pillar 4): USER.md now renders one
    // line per connected channel from channelWarmthJson, not a TikTok-only line.
    expect(files.get("USER.md")).toMatch(/\*\*tiktok:\*\*\s*warming/i);
    expect(files.get("USER.md")).toContain("3d old");
    expect(files.get("USER.md")).toContain(
      "TikTok Account Check completed: no"
    );
    expect(files.get("USER.md")).toContain("Creator/content budget: $250/month");
    expect(files.get("GTM.md")).toContain("Do not recommend TikTok/Instagram");
  });

  it("makes Hacker News the one paste-delivery channel — deep-link + record_published, never send_confirm_card", () => {
    // HN has no write API and its reply form can't be URL-prefilled, so Maya
    // must NOT claim to auto-post it. The contract: hand the founder a one-tap
    // deep link to the reply box + a copy block, then close the loop via
    // record_published when they say "posted". send_confirm_card publishes via
    // Zernio (which can't reach HN), so it must NEVER be used for HN.
    const { files } = buildMayaGtmWorkspace(INPUT);
    const tools = files.get("TOOLS.md") ?? "";

    // The reply-box deep link is the easiest-possible paste target.
    expect(tools).toContain("news.ycombinator.com/reply?id=");
    // The loop closes via record_published with the hn platform.
    expect(tools).toContain('record_published({ platform: "hn"');
    // And the Zernio confirm card is explicitly forbidden for HN.
    expect(tools).toMatch(/NEVER use `send_confirm_card` for HN/);
    // Honesty: the old "HN can't be posted (research-only)" flat claim is gone,
    // replaced by the paste-delivery flow.
    expect(tools).not.toContain("HN can't be posted (research-only)");
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

  // Verification deploy flag — test-only all-platform coverage override.
  it("renders the verify-all-platforms directive only when the flag is set", () => {
    expect(
      buildMayaGtmWorkspace(INPUT).files.get("GTM.md") ?? ""
    ).not.toContain("VERIFICATION RUN");

    const verifyGtm =
      buildMayaGtmWorkspace({ ...INPUT, verifyAllPlatforms: true }).files.get(
        "GTM.md"
      ) ?? "";
    expect(verifyGtm).toContain("VERIFICATION RUN — exercise ALL platforms");
    // Names every platform we want exercised, incl. YouTube + the video-watch.
    for (const p of ["Reddit", "X", "LinkedIn", "TikTok", "Instagram", "YouTube"]) {
      expect(verifyGtm).toContain(p);
    }
    expect(verifyGtm).toContain("watch");
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

  // Sprint 2.5 — the demand-intel & open-web JUDGMENT layer: the search tools
  // ship with a thinking model, not just bullets. Both skills bundle, are in
  // the active slug list, and the reasoning renders in TOOLS.md.
  it("ships the demand-intel + open-web judgment layer (skills + reasoning)", () => {
    const { files } = buildMayaGtmWorkspace(INPUT);

    // Both judgment skills are bundled and grounded (real SOPs, not stubs).
    const demand = files.get("skills/maya-demand-intelligence/SKILL.md") ?? "";
    const web = files.get("skills/maya-open-web-read/SKILL.md") ?? "";
    expect(demand.length).toBeGreaterThan(800);
    expect(web.length).toBeGreaterThan(800);
    expect(mayaGtmSkillSlugs()).toEqual(
      expect.arrayContaining([
        "maya-demand-intelligence",
        "maya-open-web-read",
      ])
    );

    // The load-bearing judgment is actually IN the skills (not just named).
    expect(demand).toContain("ADVERTISER density"); // competition ≠ SEO difficulty
    expect(demand).toMatch(/0 \/ null volume|volume.*≠.*demand|0 volume/i); // the reframe
    expect(web).toContain("5-second test"); // the clicks-no-signups diagnostic
    expect(web).toMatch(/verbatim quote \+ (the )?URL/i); // the output contract

    // The reasoning is wired into BOOT context (TOOLS.md) — Maya doesn't read
    // the raw keyword numbers without the judgment, and the skills are cited.
    const tools = files.get("TOOLS.md") ?? "";
    expect(tools).toContain("maya-demand-intelligence");
    expect(tools).toContain("maya-open-web-read");
    expect(tools).toContain("NOT SEO difficulty"); // the demand rubric, inline (terse)
    expect(tools).toContain("alternative-to"); // organic-target framing, not an ads plan
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

  it("FLAT TIER FLAGS: creative skills ship on EVERY tier (no deploy-time gate)", () => {
    // The former videoEnabled/imageEnabled bundling gates are gone. All creative
    // skills bundle unconditionally on every Maya; capability is enforced solely
    // by the LIVE server gate (creatifyVideo.startVideoJob/startAssetJob check
    // canVideo/canImage), so a tier upgrade needs no machine redeploy.
    const files = buildMayaGtmWorkspace(INPUT).files;
    for (const slug of [
      "maya-video-producer",
      "maya-static-asset-producer",
      "maya-inspiration-scout",
    ]) {
      expect(
        files.get(`skills/${slug}/SKILL.md`),
        `${slug} must ship flat on every tier`
      ).toBeTruthy();
    }
    const body = files.get("skills/maya-video-producer/SKILL.md");
    expect(body!).toContain("clone_winning_ad");
    expect(body!).toContain("make_ad_from_url");
    // The skill names CAPABILITIES, never the vendor (per CLAUDE.md isolation).
    expect(body!).not.toContain("Creatify");
  });

  it("ships the nightly dreaming cron always, and the discovery_pulse cron only when pulseEnabled", () => {
    // Dreaming (0015) is always shipped — cheap, silent, safe nightly learning.
    const base = JSON.parse(buildMayaGtmWorkspace(INPUT).files.get("jobs.json") ?? "{}");
    const baseIds = base.jobs.map((j: { id: string }) => j.id);
    expect(baseIds).toContain("0015_dreaming");
    // Pulse (0016) is GATED: off by default (proven batch cadence).
    expect(baseIds).not.toContain("0016_discovery_pulse");

    // With pulseEnabled: the hourly discovery pulse ships, lean + budget-gated.
    const pulsed = JSON.parse(
      buildMayaGtmWorkspace({ ...INPUT, pulseEnabled: true }).files.get("jobs.json") ?? "{}"
    );
    const pulseJob = pulsed.jobs.find(
      (j: { id: string }) => j.id === "0016_discovery_pulse"
    );
    expect(pulseJob).toBeTruthy();
    // Default cadence is every 3h (8/day) — ~3x cheaper than hourly, the token
    // lever; env-tunable via MAYA_GTM_PULSE_CRON_EXPR. Must be an interval/step
    // expr so it stays timezone-invariant (localCronToUtc no-ops it).
    expect(pulseJob.schedule.expr).toBe("0 */3 * * *");
    expect(pulseJob.schedule.expr).not.toMatch(/^0 \d+ /); // not a fixed hour
    expect(pulseJob.payload.lightContext).toBe(true); // lean tick = cheap
    expect(pulseJob.payload.thinking).toBe("low");
    // The pulse MUST consult the budget gate (the runaway-stop).
    expect(pulseJob.payload.message).toContain("check_discovery_budget");
    expect(pulseJob.payload.message).toContain("next_watch_lane");
    // Dreaming is silent (never messages the founder).
    const dreamJob = base.jobs.find((j: { id: string }) => j.id === "0015_dreaming");
    expect(dreamJob.payload.message).toContain("SILENT");
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
    // calendar-due -> the go-time reminder: an action due now or soon.
    // (Reworded from the old "queued calendar event in the next 30 min"
    // slug into the richer energizing one-tap go-time nudge — same trigger.)
    expect(heartbeat).toContain("Calendar go-time reminder");
    expect(heartbeat).toContain("next ~30 min");
    // stuck-worker-sweep -> worker silent >5 min surfaced + adjusted
    expect(heartbeat).toContain("worker has been silent >5 min");
    // 2026-06-03 — the buggy "missed-cadence recovery" rule is REMOVED. It made
    // a fresh-boot agent fabricate an overnight ("14 threads came in overnight")
    // and run a morning brief it never missed. The 7am cron owns the brief; the
    // heartbeat never runs cadence messages inline.
    expect(heartbeat).not.toContain("missed-cadence recovery");
    expect(heartbeat).toContain("is the crons' job"); // cadence + pulse owned by crons, not the heartbeat
    expect(heartbeat).toContain("published-results-scan");
    // Sprint E — relationship cadence engine + continuous inbound polling.
    expect(heartbeat).toContain("relationship-cadence");
    expect(heartbeat).toContain("inbound-poll");

    // #15 — the watchdog now gates on the DURABLE lifecycle (get_agent_lifecycle
    // + acquire_foundation_lease), not a MEMORY.md `foundation_completed_at:`
    // marker. If foundationComplete is true it ticks silent (never re-runs
    // onboarding); it only resumes the pass when it actually acquires the lease.
    expect(heartbeat).toContain("get_agent_lifecycle");
    expect(heartbeat).toContain("foundationComplete");
    expect(heartbeat).toContain("acquire_foundation_lease");

    // Voice contract + primitives.
    expect(heartbeat).toContain("HEARTBEAT_OK");
    expect(heartbeat).toContain("SOUL.md");
  });

  it("jobs.json ships the kickstart PLUS the recurring cadence deterministically (stable ids, operator tz)", () => {
    // #15 deploy-harness hardening — the recurring behavioral cadence
    // (morning/midday/evening/weekly/monthly) is now shipped DETERMINISTICALLY
    // in jobs.json with stable ids, instead of Maya calling `cron action=add`
    // at runtime. OpenClaw's cron store IS /data/cron/jobs.json
    // (resolveDefaultCronStorePath with OPENCLAW_STATE_DIR=/data), so these
    // register at boot and fire in the operator's timezone. The runtime-add path
    // was both unsupported AND the source of the invented `morning_brief_
    // recovery` cron that timed out + spammed failures.
    const { files } = buildMayaGtmWorkspace(INPUT);
    const jobs = JSON.parse(files.get("jobs.json") ?? "{}") as {
      version?: number;
      jobs: Array<{
        id: string;
        sessionTarget: string;
        schedule?: { kind: string; expr?: string; tz?: string; at?: string };
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

    // The 5 recurring crons ship with stable ids + cron schedules in the
    // operator's timezone. Maya never adds these at runtime.
    const recurring = [
      { id: "0010_morning_brief", expr: "0 7 * * *" },
      { id: "0011_midday_pulse", expr: "0 13 * * *" },
      { id: "0012_evening_recap", expr: "0 20 * * *" },
      { id: "0013_weekly_review", expr: "0 19 * * 0" },
      { id: "0014_monthly_reset", expr: "0 6 1 * *" },
    ];
    for (const r of recurring) {
      const job = jobs.jobs.find((j) => j.id === r.id);
      expect(job, `recurring cron ${r.id} must ship in jobs.json`).toBeTruthy();
      expect(job?.schedule?.kind).toBe("cron");
      // OpenClaw fires cron exprs in UTC + ignores tz, so the shipped expr is the
      // operator-local expr converted to UTC (DST-correct for the deploy instant);
      // the tz field is preserved too. Compare against the same converter.
      expect(job?.schedule?.expr).toBe(localCronToUtc(r.expr, INPUT.timezone, Date.now()));
      expect(job?.schedule?.tz).toBe(INPUT.timezone);
      // Each guards on the durable lifecycle before doing work.
      expect(job?.payload.message).toContain("get_agent_lifecycle");
    }
    // Morning brief stamps its durable marker; never invents a recovery cron.
    const morning = jobs.jobs.find((j) => j.id === "0010_morning_brief");
    expect(morning?.payload.message).toContain(
      'mark_lifecycle({ marker: "morning_brief" })'
    );

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
    expect(kickstart?.payload.message).toContain("message tool");
    // #15 — idempotency via the DURABLE lifecycle, not MEMORY.md. The kickstart
    // is a SAFETY NET that must check `get_agent_lifecycle` and no-op if the
    // hello already went out, then mark it durably — so a successful
    // gateway:startup hello is never followed by a duplicate, even across a
    // restart that wipes MEMORY.md.
    expect(kickstart?.payload.message).toContain("IDEMPOTENCY CHECK FIRST");
    expect(kickstart?.payload.message).toContain("get_agent_lifecycle");
    expect(kickstart?.payload.message).toMatch(
      /mark_lifecycle\(\{ marker: "hello_sent" \}\)/
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

    // jobs.json contains the kickstart + the 3 one-shot cold-boot foundation-
    // resume safety-nets (+8/+16/+24m) + the 5 deterministic recurring crons +
    // the always-on nightly dreaming cron (Phase 3). The discovery_pulse cron is
    // GATED (pulseEnabled) and absent here. No old heavy boot crons.
    expect(jobs.jobs).toHaveLength(10);
    expect(jobs.jobs[0].id).toBe("0001_kickstart");
    expect(jobs.jobs.map((j) => j.id).sort()).toEqual([
      "0001_kickstart",
      "0002_foundation_resume_8m",
      "0003_foundation_resume_16m",
      "0004_foundation_resume_24m",
      "0010_morning_brief",
      "0011_midday_pulse",
      "0012_evening_recap",
      "0013_weekly_review",
      "0014_monthly_reset",
      "0015_dreaming",
    ]);
    // The hourly discovery pulse is OFF by default (proven batch cadence).
    expect(jobs.jobs.find((j) => j.id === "0016_discovery_pulse")).toBeUndefined();
    // The resume ladder is one-shot + self-deleting + idempotent. Cast: the
    // jobs array is a heterogeneous union (only one-shots carry deleteAfterRun
    // and schedule is optional across the union), so read these loosely.
    const resume = jobs.jobs.find(
      (j) => j.id === "0002_foundation_resume_8m"
    ) as unknown as {
      deleteAfterRun?: boolean;
      schedule?: { kind?: string };
      payload?: { message?: string };
    };
    expect(resume.deleteAfterRun).toBe(true);
    expect(resume.schedule?.kind).toBe("at");
    expect(resume.payload?.message).toContain("acquire_foundation_lease");
    expect(resume.payload?.message).toContain("foundationComplete");
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

    // These guard the ACTUAL OpenClaw bootstrap budgets in deployMayaGtm.ts:
    // - bootstrapTotalMaxChars (110_000) — total injected context; over this and
    //   files get SILENTLY DROPPED (a live deploy proved BOOT.md got skipped → the
    //   agent stalled with no instructions). Headroom kept below the cap.
    // - bootstrapMaxChars (30_000) — PER FILE; over this a single file is
    //   truncated. TOOLS.md is the historical offender — keep it terse.
    // 108_900 ceiling: plan-awareness + flat-flags + all-day-operator reframe +
    // non-technical-tone block + two SOUL voice rules from the correctness pass
    // (cron-completion-narration ban folded into Pipeline narration; "calendar" →
    // "the Plan tab"). Trimmed elsewhere first (jargon list condensed, cron ban
    // folded not added). ~1.1K under the real 110K bootstrapTotalMaxChars cap.
    // ⚠️ HEADROOM IS THIN — the next prose addition must TRIM, not bump; if it must
    // grow, new platform/tactic detail belongs in a skill (skills/* excluded here).
    expect(promptContextChars).toBeLessThan(108_900); // under the 110K total cap
    expect(files.get("PLAN.md")?.length).toBeLessThan(2_000); // plan snapshot stays terse
    expect(files.get("TOOLS.md")?.length).toBeLessThan(28_000); // under the 30K per-file cap
    expect(files.get("BOOT.md")?.length).toBeLessThan(28_000);
    // 25_500: AGENTS.md holds THE ONE RULE + THE COMPLEMENT (the single
    // send-discipline rule that REPLACED ~4 scattered per-cron "don't narrate"
    // notes — net fewer rules, ~1.5K trimmed elsewhere in the file). Still well
    // under the 28K its siblings use and the 30K per-file injection cap.
    expect(files.get("AGENTS.md")?.length).toBeLessThan(25_500);
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

    // 2026-06-03 — TOOLS.md is now a terse index; send_update is the TYPED TOOL
    // (not a curl to /lc_gtm/send_update). Assert the current contract: ALL
    // operator messages (replies + proactive) go through send_update, and the
    // broken native paths (message / sessions_send) are explicitly flagged.
    expect(tools).toContain("send_update");
    expect(tools).toMatch(/Operator messages/i);
    expect(tools).toContain("sessions_send"); // the broken path, flagged
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

describe("Maya GTM workspace pack — PLAN.md plan awareness", () => {
  it("renders PLAN.md containing the deploy-time planSummary verbatim", () => {
    const summary =
      "Growth plan ($149/mo) — active.\nUp to 6 active channels.\nVideo: not on this tier (Studio only).\nStudio unlocks video.";
    const { files } = buildMayaGtmWorkspace({ ...INPUT, planSummary: summary });
    const plan = files.get("PLAN.md") ?? "";
    expect(plan).toContain("# PLAN.md");
    // The tier summary is rendered into the file.
    expect(plan).toContain("Growth plan ($149/mo)");
    expect(plan).toContain("Up to 6 active channels");
    expect(plan).toContain("Studio unlocks video");
    // The live-truth tool pointer is present in PLAN.md; the full conduct rules
    // live in SOUL.md (asserted separately below).
    expect(plan).toContain("get_my_plan");
  });

  it("SOUL.md carries the plan-awareness conduct rules (never over-promise / surface a lapsed plan / nudge honestly)", () => {
    const soul = buildMayaGtmWorkspace(INPUT).files.get("SOUL.md") ?? "";
    expect(soul).toContain("Know my plan");
    expect(soul).toContain("Never promise a capability I don't have");
    expect(soul).toContain("get_my_plan");
    expect(soul.toLowerCase()).toContain("not active");
    expect(soul).toContain("Growth");
    expect(soul).toContain("Studio");
  });

  it("falls back to a get_my_plan pointer when no planSummary is supplied", () => {
    const plan = buildMayaGtmWorkspace(INPUT).files.get("PLAN.md") ?? "";
    expect(plan).toContain("get_my_plan");
    expect(plan).toContain("Plan summary not rendered at deploy");
  });

  it("the get_my_plan tool is registered in the bundled plugin (live-truth tool)", () => {
    // Sibling-file coherence: PLAN.md points Maya at get_my_plan, so the plugin
    // bundle must actually register it.
    expect(BUNDLED_GTM_PLUGIN_TOOLS).toContain("get_my_plan");
  });

  // ── All-day real-time operator: approval-kickoff + hourly pulse ─────────────
  describe("all-day real-time operator framing", () => {
    const files = buildMayaGtmWorkspace(INPUT).files;
    const boot = files.get("BOOT.md") ?? "";
    const gtm = files.get("GTM.md") ?? "";
    const agents = files.get("AGENTS.md") ?? "";
    const heartbeat = files.get("HEARTBEAT.md") ?? "";

    it("BOOT/GTM/AGENTS describe the approval-kickoff (start on approval, not next morning)", () => {
      expect(boot).toContain("APPROVAL KICKOFF");
      // The first move posts the same day on approval + a connected channel.
      expect(boot.toLowerCase()).toContain("that same day");
      expect(gtm.toLowerCase()).toContain("same day");
      expect(agents.toLowerCase()).toContain("connected");
    });

    it("SIBLING-FILE COHERENCE: no prompt still says start-tomorrow / no-posting-today", () => {
      // The exact failure framing that contradicts the approval-kickoff. If any
      // file regresses to it, the agent gets contradictory instructions.
      for (const [name, body] of [
        ["BOOT.md", boot],
        ["GTM.md", gtm],
        ["AGENTS.md", agents],
        ["HEARTBEAT.md", heartbeat],
      ] as const) {
        expect(body, `${name} must not promise no-posting-today`).not.toContain(
          "there is no posting today"
        );
        expect(body, `${name} must not promise start-tomorrow`).not.toContain(
          "start posting tomorrow"
        );
      }
    });

    it("the hourly discovery_pulse is framed as a continuous discovery layer (not 7am-only)", () => {
      expect(gtm.toLowerCase()).toContain("hourly");
      expect(gtm).toContain("discovery_pulse");
      expect(heartbeat).toContain("discovery_pulse");
    });

    it("HEARTBEAT still asserts monitoring-only (it never gained inline discovery)", () => {
      // The pulse is a cron; the heartbeat must NOT discover, or we'd burn budget
      // + duplicate the pulse.
      expect(heartbeat).toContain("not the heartbeat's");
      expect(heartbeat).toContain("I do NOT re-sweep");
    });

    it("the foundation skill grounds the synthesis in the persisted bet channels", () => {
      // The Cal AI fix: synthesis must read the scorecard + name only real bets,
      // never default to a favorite.
      const skill =
        files.get("skills/maya-foundation-research/SKILL.md") ?? "";
      expect(skill).toContain("bet=true");
      expect(skill.toLowerCase()).toContain("never name a channel that isn't a persisted bet".toLowerCase());
      expect(skill).toContain("approval kickoff"); // the start-on-approval behavior is in the skill
    });
  });

  // Timezone — OpenClaw fires crons in UTC + ignores tz, so we rewrite local→UTC.
  describe("localCronToUtc (cron timezone conversion)", () => {
    const t = Date.UTC(2026, 0, 15); // mid-Jan, a stable instant (no-DST tz used below)

    it("no-ops on the hourly pulse (wildcard hour is timezone-invariant)", () => {
      expect(localCronToUtc("0 * * * *", "America/New_York", t)).toBe("0 * * * *");
      expect(localCronToUtc("0 * * * *", "Asia/Tokyo", t)).toBe("0 * * * *");
    });

    it("converts a fixed local hour to UTC for a no-DST tz (Asia/Tokyo, UTC+9)", () => {
      // 1pm Tokyo = 04:00 UTC.
      expect(localCronToUtc("0 13 * * *", "Asia/Tokyo", t)).toBe("0 4 * * *");
      // 7am Tokyo = 22:00 UTC the previous day (daily — no day field to shift).
      expect(localCronToUtc("0 7 * * *", "Asia/Tokyo", t)).toBe("0 22 * * *");
    });

    it("no-ops when tz is missing or UTC", () => {
      expect(localCronToUtc("0 7 * * *", undefined, t)).toBe("0 7 * * *");
      expect(localCronToUtc("0 7 * * *", "UTC", t)).toBe("0 7 * * *");
    });

    it("shifts day-of-week on a midnight-crossing weekly cron", () => {
      // Sun 11pm Tokyo (23:00) = 14:00 UTC Sun (no cross) — stays Sun(0).
      expect(localCronToUtc("0 23 * * 0", "Asia/Tokyo", t)).toBe("0 14 * * 0");
      // Sun 7am Tokyo = 22:00 UTC Sat → dow shifts 0→6.
      expect(localCronToUtc("0 7 * * 0", "Asia/Tokyo", t)).toBe("0 22 * * 6");
    });
  });
});
