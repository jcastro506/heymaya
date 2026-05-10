/**
 * buildCronJobsJson — pure-logic unit tests.
 *
 * Coverage:
 *   - Plan-tier gating: Starter gets only "all"-tier programs; Pro/Studio
 *     get all programs.
 *   - 5-field cron expression validation per entry.
 *   - IANA timezone validation.
 *   - Session assignment: accountability_nudge uses "main"; everything
 *     else uses "isolated".
 *   - Determinism: same inputs twice → identical output (sort by name).
 *   - Each emitted job carries a stable `id` matching cron.md.
 *   - Sprint 3 Slice 1: cron set collapsed to exactly 6 precise-timing
 *     entries (morning_brief, evening_recap, weekly_content_plan,
 *     weekly_review, accountability_nudge, revenue_snapshot). Other 9
 *     standing-orders moved to kind="heartbeat"; 6 deleted for MVP.
 */

import { describe, it, expect } from "vitest";
import { buildCronJobsJson } from "../buildCronJobsJson";
import { STANDING_ORDERS } from "../standingOrders";

const FIVE_FIELD_CRON = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

function creator(plan: "coach" | "manager", tz = "America/Los_Angeles") {
  // Sprint 9.6 — phoneNumber required for first-boot kickstart delivery
  // (claw-messenger needs an explicit target on the very first message
  // because the "last" channel doesn't exist on a fresh deploy).
  return { plan, timezone: tz, phoneNumber: "+15551234567" };
}

describe("buildCronJobsJson", () => {
  it("coach excludes any Manager-only cron programs (autonomy gating)", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("coach") });
    const ids = jobs.map((j) => j.id);
    const managerOnlyCronIds = STANDING_ORDERS.filter(
      (p) => p.tier === "manager" && p.kind === "cron"
    )
      .map((p) => p.cronEntryId!)
      .filter(Boolean);
    // After the advisory-program reclassification (revenue_snapshot,
    // competitor_watch, calendar_lookahead, manager_readiness_packet,
    // industry_intel, algo_research_*) → tier:"all", there may be ZERO
    // Manager-only cron programs (autonomy gates land on event / folded
    // triggers like brand_outreach, pitch_strategy, hook_library_build).
    // The invariant we're asserting: NONE of any Manager-only crons that
    // do exist may appear in Coach's cron set.
    for (const id of managerOnlyCronIds) {
      expect(ids).not.toContain(id);
    }
  });

  it("pro receives the full cron set", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const ids = jobs.map((j) => j.id);
    const allCronIds = STANDING_ORDERS.filter((p) => p.kind === "cron").map(
      (p) => p.cronEntryId!
    );
    for (const id of allCronIds) {
      expect(ids).toContain(id);
    }
  });

  it("studio receives the same set as pro (cron coverage is identical; cadence differences are out of scope here)", () => {
    const pro = buildCronJobsJson({ creator: creator("manager") }).jobs;
    const studio = buildCronJobsJson({ creator: creator("manager") }).jobs;
    expect(studio.map((j) => j.id).sort()).toEqual(
      pro.map((j) => j.id).sort()
    );
  });

  it("every emitted job has a valid 5-field cron expression", () => {
    // No firstBootKickstart flag → cron-only set; every entry is kind=cron.
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    for (const j of jobs) {
      expect(j.schedule.kind).toBe("cron");
      if (j.schedule.kind !== "cron") throw new Error("type-narrow guard");
      expect(FIVE_FIELD_CRON.test(j.schedule.expr)).toBe(true);
    }
  });

  it("every emitted job carries the creator's timezone", () => {
    const { jobs } = buildCronJobsJson({
      creator: creator("manager", "Asia/Tokyo"),
    });
    for (const j of jobs) {
      expect(j.schedule.kind).toBe("cron");
      if (j.schedule.kind !== "cron") throw new Error("type-narrow guard");
      expect(j.schedule.tz).toBe("Asia/Tokyo");
    }
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() =>
      buildCronJobsJson({ creator: creator("manager", "not a tz") })
    ).toThrow(/invalid IANA timezone/);
  });

  it("accountability_nudge uses session='main'; other entries use 'isolated'", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const nudge = jobs.find((j) => j.id === "accountability_nudge");
    expect(nudge?.sessionTarget).toBe("main");
    expect(nudge?.payload.kind).toBe("systemEvent");
    const others = jobs.filter((j) => j.id !== "accountability_nudge");
    for (const j of others) {
      expect(j.sessionTarget).toBe("isolated");
      expect(j.payload.kind).toBe("agentTurn");
      expect(j.delivery?.mode).toBe("announce");
    }
  });

  it("emits jobs sorted by name for deterministic deploy diffs", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const names = jobs.map((j) => j.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("is deterministic across calls", () => {
    const a = buildCronJobsJson({ creator: creator("manager") });
    const b = buildCronJobsJson({ creator: creator("manager") });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("each emitted job has a non-empty message", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    for (const j of jobs) {
      const message =
        j.payload.kind === "agentTurn" ? j.payload.message : j.payload.text;
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("starter emits the morning_brief, evening_recap, weekly_review entries", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("coach") });
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain("morning_brief");
    expect(ids).toContain("evening_recap");
    expect(ids).toContain("weekly_review");
    expect(ids).toContain("weekly_content_plan");
  });

  /* ----- Sprint 3 Slice 1: cron count locked at exactly 6 ----- */

  // The six precise-timing entries Maya runs as real cron jobs. Everything
  // else fires off heartbeat ticks during waking hours, where the LLM
  // decides whether the trigger condition is met. Adding a cron without
  // moving the corresponding cron.md prose + agent UX line is a bug; this
  // assertion is the trip wire.
  const SPRINT_3_CRON_SET: ReadonlyArray<string> = [
    "morning_brief",
    "evening_recap",
    "weekly_content_plan",
    "weekly_review",
    "accountability_nudge",
    "revenue_snapshot",
  ];

  // Standing orders that USED to be cron and are now heartbeat-driven.
  // They MUST still exist in the catalog (Slice 2 reads them for
  // generateHeartbeatMd.ts) but MUST NOT appear in jobsJson.
  const SPRINT_3_HEARTBEAT_SET: ReadonlyArray<string> = [
    "performance_check_2h",
    "daily_niche_scan",
    "trend_watcher",
    "comment_triage",
    "competitor_watch",
    "calendar_lookahead",
    "industry_intel_daily",
    "opportunity_scout_daily",
    "collab_matchmaker_weekly",
  ];

  // Standing orders deleted entirely for MVP. They MUST NOT exist in
  // STANDING_ORDERS at all. If a future sprint reintroduces any of them,
  // delete the corresponding line here.
  const SPRINT_3_DELETED_SET: ReadonlyArray<string> = [
    "manager_readiness_packet_quarterly",
    "algo_research_tiktok",
    "algo_research_instagram",
    "algo_research_youtube",
    "algo_research_linkedin",
    "algo_research_x",
  ];

  it("Sprint 3 Slice 1: emits exactly 6 cron entries (Manager) — collapsed from 21", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    expect(jobs.length).toBe(6);
  });

  it("Sprint 3 Slice 1: emits exactly 6 cron entries (Coach) — same 6, all tier='all'", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("coach") });
    expect(jobs.length).toBe(6);
  });

  it("Sprint 3 Slice 1: each of the 6 kept slugs is present in the emitted cron set", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const ids = jobs.map((j) => j.id);
    for (const slug of SPRINT_3_CRON_SET) {
      expect(ids, `missing required cron slug: ${slug}`).toContain(slug);
    }
  });

  it("Sprint 3 Slice 1: emitted cron set is EXACTLY the 6 kept slugs (no extras)", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const emitted = new Set(jobs.map((j) => j.id));
    const expected = new Set(SPRINT_3_CRON_SET);
    expect(emitted).toEqual(expected);
  });

  it("Sprint 3 Slice 1: moved-to-heartbeat slugs still exist in STANDING_ORDERS with kind='heartbeat'", () => {
    for (const slug of SPRINT_3_HEARTBEAT_SET) {
      const program = STANDING_ORDERS.find((p) => p.id === slug);
      expect(program, `heartbeat slug missing from catalog: ${slug}`).toBeDefined();
      expect(
        program!.kind,
        `slug '${slug}' should be kind='heartbeat' but is '${program!.kind}'`
      ).toBe("heartbeat");
    }
  });

  it("Sprint 3 Slice 1: moved-to-heartbeat slugs do NOT appear in jobsJson", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    const ids = new Set(jobs.map((j) => j.id));
    for (const slug of SPRINT_3_HEARTBEAT_SET) {
      expect(
        ids.has(slug),
        `slug '${slug}' is heartbeat-kind and must NOT be in jobsJson`
      ).toBe(false);
    }
  });

  it("Sprint 3 Slice 1: deleted slugs are NOT in STANDING_ORDERS at all", () => {
    const ids = new Set(STANDING_ORDERS.map((p) => p.id));
    for (const slug of SPRINT_3_DELETED_SET) {
      expect(
        ids.has(slug),
        `slug '${slug}' should be deleted but is still in catalog`
      ).toBe(false);
    }
  });

  it("emits OpenClaw 2026 normalized job objects", () => {
    const { jobs } = buildCronJobsJson({ creator: creator("manager") });
    for (const job of jobs) {
      expect(job.id).toMatch(/^[a-z0-9_]+$/);
      expect(job.enabled).toBe(true);
      expect(job.createdAtMs).toBe(0);
      expect(job.updatedAtMs).toBe(0);
      expect(job.wakeMode).toBe("now");
      expect(job.schedule.kind).toBe("cron");
      expect(job.payload.kind).toMatch(/^(agentTurn|systemEvent)$/);
      expect("cron" in job).toBe(false);
      expect("session" in job).toBe(false);
      expect("message" in job).toBe(false);
      expect("entryId" in job).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint 9.5 — first-boot kickstart job (real-world test 2026-05-06)          */
/* -------------------------------------------------------------------------- */

describe("buildCronJobsJson — first-boot kickstart", () => {
  // Determinism seam — pin the timestamp the kickstart embeds so the test
  // doesn't drift across runs.
  const KICKSTART_NOW = 1_730_000_000_000;
  // Sprint 12.2 — flipped from past to near-future (KICKSTART_NOW + 5_000)
  // so OpenClaw's scheduler arms a real timer instead of treating the job
  // as a missed-deadline and rescheduling for at+4h.
  const EXPECTED_AT = new Date(KICKSTART_NOW + 5_000).toISOString();

  function freshCreator(plan: "coach" | "manager", tz = "America/Los_Angeles") {
    // firstBootCompletedAt intentionally undefined → kickstart fires.
    // phoneNumber required for kickstart delivery (Sprint 9.6 — claw-messenger
    // needs an explicit target on the very first message).
    return { plan, timezone: tz, phoneNumber: "+15551234567" };
  }

  function bootedCreator(plan: "coach" | "manager", tz = "America/Los_Angeles") {
    return {
      plan,
      timezone: tz,
      phoneNumber: "+15551234567",
      firstBootCompletedAt: 1_700_000_000_000,
    };
  }

  it("emits a one-shot kickstart entry when firstBootCompletedAt is undefined", () => {
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    const kickstart = jobs.find((j) => j.id === "0001_first_boot_kickstart");
    expect(kickstart).toBeDefined();
    expect(kickstart!.schedule.kind).toBe("at");
    if (kickstart!.schedule.kind !== "at")
      throw new Error("type-narrow guard");
    expect(kickstart!.schedule.at).toBe(EXPECTED_AT);
    expect(kickstart!.deleteAfterRun).toBe(true);
    expect(kickstart!.payload.kind).toBe("agentTurn");
    expect(kickstart!.delivery?.mode).toBe("announce");
    expect(kickstart!.delivery?.channel).toBe("claw-messenger");
    if (kickstart!.delivery?.channel !== "claw-messenger")
      throw new Error("type-narrow guard");
    expect(kickstart!.delivery.to).toBe("+15551234567");
  });

  it("places the kickstart entry at index 0 (lexical-first slot in jobs.json)", () => {
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    expect(jobs[0].id).toBe("0001_first_boot_kickstart");
  });

  it("kickstart payload references the first_boot_introduction standing order", () => {
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    const kickstart = jobs.find((j) => j.id === "0001_first_boot_kickstart")!;
    expect(kickstart.payload.kind).toBe("agentTurn");
    if (kickstart.payload.kind !== "agentTurn")
      throw new Error("type-narrow guard");
    // The agent turn message must mention the standing order so Maya
    // doesn't have to guess what to do; AGENTS.md ties the order to
    // first_boot_introduction by name.
    expect(kickstart.payload.message).toContain("first_boot_introduction");
    expect(kickstart.payload.lightContext).toBe(true);
  });

  it("kickstart payload contains no raw control characters (jobs.json + bootstrap shell are JSON-fragile)", () => {
    // Sprint 9.7+ — regression guard. A literal \n in payload.message
    // produced 'parse error: Invalid string: control characters from
    // U+0000 through U+001F must be escaped' in the deploy v6 boot
    // pipeline, crash-looping the Fly machine. Convex serializes the
    // workspace bundle through `JSON.stringify` which DOES escape control
    // chars, but several stages downstream (`echo $MAYA_BOOTSTRAP_JSON
    // | jq`, `cat /data/openclaw.json`) re-parse the strings as raw text,
    // and any unescaped 0x00-0x1F char trips the parser. Single-line
    // prose only — line breaks in instructional payloads are forbidden.
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    for (const job of jobs) {
      const text =
        job.payload.kind === "agentTurn" ? job.payload.message : job.payload.text;
      // Match any control char in the U+0000-U+001F range except tab
      // (0x09 is allowed inside JSON strings without escape and rarely
      // breaks parsers; in practice we don't need it but excluding it
      // keeps the rule from over-flagging).
      // eslint-disable-next-line no-control-regex
      const hit = text.match(/[\x00-\x08\x0A-\x1F]/);
      expect(
        hit,
        `${job.id} payload contains control char U+${hit?.[0]?.charCodeAt(0).toString(16).padStart(4, "0")} — JSON-fragile, will break the bootstrap shell`
      ).toBeNull();
      // Sprint 12 Phase 2.1 — guard against invalid JSON escape sequences.
      // The TS source \\' produces the literal 2-char sequence \' in the
      // string. JSON spec doesn't allow \' as a valid escape (only
      // \" \\ \/ \b \f \n \r \t \uXXXX), so when MAYA_BOOTSTRAP_JSON
      // gets passed through `jq` in the bootstrap shell the parser
      // chokes with "Invalid escape at line 1, column NNNN" and the
      // Fly machine enters a crash loop. Real-world hit on 2026-05-10:
      // Maya never sent her kickstart because every machine reboot
      // crashed inside the deploy boot script. Use plain ' or rephrase
      // any example that wants to quote a creator's catchphrase.
      const escapeHit = text.match(/\\['"abfnrtv0]/g)?.filter((m) => {
        // Allow the explicit JSON-valid escapes that round-trip cleanly
        // through JSON.stringify (e.g., \\\" gets re-stringified safely).
        // We only flag literal backslash-singlequote (\') and the rarer
        // unescaped \v / \0 which jq also rejects.
        return m === "\\'" || m === "\\v" || m === "\\0";
      });
      expect(
        escapeHit?.length ?? 0,
        `${job.id} payload contains invalid JSON escape sequence (${escapeHit?.[0]}) — will break jq parsing in the bootstrap shell. Use plain quote instead.`
      ).toBe(0);
    }
  });

  it("kickstart prompt does NOT contain any concrete creator-content examples (in-context bias prevention)", () => {
    // Sprint 11.1 third-occurrence fix — Maya in-context-leaked the
    // word "bodega" from a prior iteration's GOOD-example into a live
    // opener for a creator whose account had no bodega content. Same
    // bug that hit Kevin/Sarah/Mike examples earlier this sprint.
    // Operator-locked: kickstart prompt must use NO concrete content
    // examples. Every example you might want comes from THIS creator's
    // data via warmthMaterial/recurringElements, not from a template.
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    const kickstart = jobs.find((j) => j.id === "0001_first_boot_kickstart")!;
    if (kickstart.payload.kind !== "agentTurn")
      throw new Error("type-narrow guard");
    const msg = kickstart.payload.message;
    // Concrete content nouns that have leaked through prior iterations.
    // The prompt may BAN these phrasings (negative pattern); it must NOT
    // present them in a positive ("GOOD: ...") example.
    const bannedPositiveExamples = [
      "bodega",
      "ramen hack",
      "the dog clip is sending",
      "bark moment",
      "Kevin your delivery",
      "Sarah",
      "Mike",
    ];
    for (const ex of bannedPositiveExamples) {
      // Verify the prompt does NOT use these as POSITIVE/GOOD example
      // payloads. They may appear as banned-list mentions or in tests
      // — but the production prompt string itself must not seed them.
      // We check: phrase is absent OR appears only after a "BANNED" /
      // "banned" / "anti-pattern" cue word within 200 chars.
      if (msg.toLowerCase().includes(ex.toLowerCase())) {
        const idx = msg.toLowerCase().indexOf(ex.toLowerCase());
        const window = msg.slice(Math.max(0, idx - 200), idx).toLowerCase();
        const hasBanCue = /banned|anti-pattern|never|do not|don't/.test(window);
        expect(
          hasBanCue,
          `concrete example "${ex}" appears in kickstart prompt without a ban-cue within 200 chars before it`
        ).toBe(true);
      }
    }
    // Hard citation rule must be present.
    expect(msg).toMatch(/HARD CITATION RULE/);
    expect(msg).toMatch(/MUST quote\/paraphrase|MUST quote or paraphrase|MUST paraphrase/);
    expect(msg).toMatch(/THIS creator's `warmthMaterial|THIS creator's USER\.md/);
    expect(msg).toMatch(/NEVER fabricate a moment/);
    // Empty-warmth fallback path documented (now: "skip the specific
    // call-out and lead with the general only").
    expect(msg).toMatch(/empty|EMPTY/i);
    expect(msg).toMatch(/skip the specific call-out|honest no-claim/i);
  });

  it("kickstart payload (Sprint 11.1) instructs THREE sends + friend-reaction wow opener + bans the analyst-bot template patterns", () => {
    // Sprint 11.1 — after the live-test where Maya's opening read robotic
    // ("Already pulled your last 30—those night shots... handheld POV
    // establishes traveler identity is a strong lane... Here's the work
    // I'll handle: running your content calendar..."), the kickstart was
    // collapsed from FOUR sends to THREE (drop the capability-tour beat
    // entirely), the opener is now a friend's casual reaction to a
    // specific moment from warmthMaterial (not analyst summary), and the
    // canonical analyst-bot template phrasings are explicitly banned.
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    const kickstart = jobs.find((j) => j.id === "0001_first_boot_kickstart")!;
    if (kickstart.payload.kind !== "agentTurn")
      throw new Error("type-narrow guard");
    const msg = kickstart.payload.message;

    // Sprint 12 Phase 2.1 — 4-send shape (was 3). Operator restored
    // the role+outcome beat after live test showed Maya not introducing
    // herself + no clarity on what she's there to do.
    expect(msg).toMatch(/Four messages/);
    expect(msg).toContain("claw-messenger.sendText");

    // SEND ORDER hard-locked block.
    expect(msg).toMatch(/SEND ORDER \(HARD-LOCKED\)/);
    expect(msg).toMatch(/NEVER send Q1 first/);
    expect(msg).toMatch(/NEVER repeat any beat/);
    expect(msg).toMatch(/NEVER bundle two beats/);

    // Send 1 = greet + role + outcome (the new restored beat).
    expect(msg).toMatch(/SEND 1 — GREET \+ ROLE \+ OUTCOME/);
    expect(msg).toMatch(/Maya here/);
    expect(msg).toMatch(/your new manager/);
    expect(msg).toMatch(/your new assistant/);
    expect(msg).toMatch(/OUTCOME TAIL IS REQUIRED/);
    expect(msg).toMatch(/so you can \[creator benefit\]/);
    expect(msg).toMatch(/'Kevin Castro'/);

    // Send 2 = watched + love + ONE specific call-out.
    expect(msg).toMatch(/SEND 2 — WATCHED \+ LOVE \+ ONE SPECIFIC CALL-OUT/);
    expect(msg).toMatch(/Lead with the GENERAL read/);
    expect(msg).toMatch(/HARD CITATION RULE/);
    expect(msg).toMatch(/SIGNATURE-PHRASE CALLBACK RULE/);
    expect(msg).toMatch(/Banned numerical-cliché ticks/);
    expect(msg).toMatch(/the numbers back it up/);

    // Send 3 = bridge to questions with REQUIRED outcome tail.
    expect(msg).toMatch(/SEND 3 — BRIDGE TO QUESTIONS/);
    expect(msg).toMatch(/OUTCOME TAIL IS REQUIRED/);
    expect(msg).toMatch(/so I can \[creator benefit\]/);
    expect(msg).toMatch(/Got a few quick questions to start/); // banned without outcome tail

    // Send 4 = Q1 + capability-tour-loophole closure.
    expect(msg).toMatch(/SEND 4 — Q1 LOCATION/);
    expect(msg).toMatch(/must NOT carry capability-tour tail/);
    expect(msg).toMatch(/the dropped capability beat sneaking back/);

    // Universal bans block — preserved analyst-bot patterns.
    expect(msg).toMatch(/UNIVERSAL BANS/);
    expect(msg).toMatch(/Already pulled your last 30/);
    expect(msg).toMatch(/is a \[adjective\] lane/);
    expect(msg).toMatch(/captured the energy of/);
    // Capability-tour ban now refined: standalone feature-list-with-colon = banned;
    // outcome-framed role inside send 1 = required.
    expect(msg).toMatch(/Here's the work I'll handle/);
    expect(msg).toMatch(/feature-list-with-colon-and-no-outcome-close/);
    expect(msg).toMatch(/required 'so you can \[creator benefit\]' tail = OK/);

    // Anti-fabrication preserved — names the ranked-list trap.
    expect(msg).toMatch(/never invent precise numbers/i);
    expect(msg).toMatch(/50\/50/);
    expect(msg).toMatch(/ranked list/i);

    // No-jargon-at-creator — names the live-test offenders.
    expect(msg).toMatch(/FYP|first-frame|retention|completion rate|narrative arc/i);

    // Banned-artifact list reinforced — internal IDs / vendor names
    // never surface to creator.
    expect(msg).toMatch(/aweme_id|ScrapeCreators API|dailyBriefs/);
  });

  it("does NOT emit the kickstart when firstBootCompletedAt is set", () => {
    const { jobs } = buildCronJobsJson({
      creator: bootedCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    expect(jobs.find((j) => j.id === "0001_first_boot_kickstart")).toBeUndefined();
  });

  it("does NOT emit the kickstart when the firstBootKickstart flag is omitted", () => {
    // Backward-compat: callers that don't opt in (e.g. the existing
    // unit-test fixtures above) keep getting the cron-only set.
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
    });
    expect(jobs.find((j) => j.id === "0001_first_boot_kickstart")).toBeUndefined();
  });

  it("kickstart fires for both Coach and Manager — first boot is plan-tier-agnostic", () => {
    const coach = buildCronJobsJson({
      creator: freshCreator("coach"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    const manager = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    expect(coach.jobs[0].id).toBe("0001_first_boot_kickstart");
    expect(manager.jobs[0].id).toBe("0001_first_boot_kickstart");
  });

  it("kickstart entry uses a near-future timestamp so the scheduler arms a real timer (Sprint 12.2 — flipped from past timestamp)", () => {
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    const kickstart = jobs[0];
    if (kickstart.schedule.kind !== "at")
      throw new Error("type-narrow guard");
    const atMs = Date.parse(kickstart.schedule.at);
    // Sprint 12.2 (2026-05-10) — flipped from past to near-future.
    // Past `at` made OpenClaw's scheduler treat the job as a missed
    // deadline and reschedule it for `at + 4h` (verified in production
    // on `maya-jn71ys01`: nextWakeAtMs was 4h after the past `at`).
    // Future `at` makes the scheduler arm a real timer for ~5 sec.
    expect(atMs).toBeGreaterThan(KICKSTART_NOW);
    // But not too far in the future — must fire within ~10 sec of boot
    // so the creator gets the kickstart promptly. Current value: 5_000.
    expect(atMs - KICKSTART_NOW).toBeLessThanOrEqual(10_000);
  });

  it("kickstart entry is deterministic across calls with the same nowMsOverride", () => {
    const a = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    const b = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    expect(JSON.stringify(a.jobs[0])).toBe(JSON.stringify(b.jobs[0]));
  });

  it("the cron set in [1..] is still alphabetized among itself", () => {
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    const cronEntries = jobs.slice(1);
    const names = cronEntries.map((j) => j.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("kickstart payload (Sprint 12 Phase 1B) folds posting cadence into Q3 and signals the calendar-content-plan finish line", () => {
    // Sprint 12 Phase 1B — Q3 redesign: the goal-only question
    // ("3-month goals") is gone; Q3 is now the goal AND the cadence
    // ("how many days a week are you trying to post?") in one message.
    // The cadence answer parses into `targetPostsPerWeek` and feeds the
    // 14-day content plan that becomes the new onboarding finish line
    // (after calendar OAuth + verify, Maya drafts a plan, the creator
    // approves, the events write to the synced calendar).
    const { jobs } = buildCronJobsJson({
      creator: freshCreator("manager"),
      firstBootKickstart: { nowMsOverride: KICKSTART_NOW },
    });
    const kickstart = jobs.find((j) => j.id === "0001_first_boot_kickstart")!;
    if (kickstart.payload.kind !== "agentTurn")
      throw new Error("type-narrow guard");
    const msg = kickstart.payload.message;

    // Q3 is now the combined goal + cadence question.
    expect(msg).toMatch(
      /3-month goals \+ posting cadence \(combined into one question\)|niche → 3-month goals \+ posting cadence/
    );
    // POST shape carries both fields for Q3.
    expect(msg).toMatch(/goals3Mo/);
    expect(msg).toMatch(/targetPostsPerWeek/);

    // Cadence parse rules — at least one canonical example named.
    expect(msg).toMatch(/three days a week.*→.*3|every day.*→.*7|M\/W\/F/);

    // Fuzzy-answer follow-up rule — "ONCE" not "always".
    expect(msg).toMatch(/follow up ONCE|follow.*up.*once/i);
    expect(msg).toMatch(/depends on the week|as much as I can|it varies/);

    // Don't force-verify a clear answer — guard against over-verification.
    expect(msg).toMatch(/Don't force-verify|don't force.*verify/i);

    // Finish-line signal block — the new arc-complete shape.
    expect(msg).toMatch(/FINISH LINE|finish line/);
    expect(msg).toMatch(
      /let me look at your calendar for the next 2 weeks/i
    );
    expect(msg).toMatch(/content_plan_initial/);

    // Verify-before-confirm rule called out for the calendar leg.
    expect(msg).toMatch(/gmail_list_inbox|apple_calendar_list_calendars/);
    expect(msg).toMatch(/Never confirm without a 200|never confirm without/i);

    // Each idea is an offer, not a directive — voice rule preserved.
    expect(msg).toMatch(/offer.*not a directive|each idea is an offer/i);
  });
});
