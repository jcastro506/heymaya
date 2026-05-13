/**
 * Wave 5 — OpenClaw 4.12 → 2026.4.23 migration acceptance tests.
 *
 * Locks the migration deltas in place so they don't silently regress in
 * future refactors:
 *
 *   1. Image tag bumped to v2026.4.23 (CalVer).
 *   2. openclawVersion in MayaConfig is "2026.4.23".
 *   3. jobs.json output is deterministic (byte-identical for identical
 *      inputs) — required by the 4.20+ "jobs.json stays stable, runtime
 *      state goes in jobs-state.json" contract.
 *   4. cliClient `unpair` invocation includes `--delete` (REQUIRED in 4.20+).
 *   5. Standing-orders embed inline in AGENTS.md at the production 28K cap
 *      per the OpenClaw 4.23 convention (canonical root files only are
 *      auto-injected at session start).
 *   6. SKILL.md frontmatter spot-check — single-line YAML, no block scalars.
 *   7. Per-tier cron set verified (Starter limited; Pro/Studio full).
 *
 * Five mandatory categories:
 *   1. Cross-tenant isolation: skills + image are repo-wide and don't
 *      leak between creators (covered indirectly by the determinism +
 *      per-tier cron checks; the deeper cross-tenant case lives in
 *      configGeneratorMaya.test.ts and channels.test.ts which run too).
 *   2. Plan-tier × action matrix: per-tier cron set assertions cover this
 *      directly. Starter MUST NOT include any pro+ entries; Pro/Studio
 *      MUST include the full set.
 *   3. Adversarial inputs: the unpair-with-malformed-channel + missing-tag
 *      assertions (channels.test.ts and configGeneratorMaya.test.ts) cover
 *      the core surface; this file's adversarial coverage is the SKILL.md
 *      malformed-frontmatter regex.
 *   4. Sibling-file scan: the image tag MUST appear in deployMaya.ts AND
 *      flyClient.ts AND README.md — we assert all three carry the new tag
 *      via repo-grep. Likewise for openclawVersion: configGeneratorMaya.ts
 *      AND README.md.
 *   5. TODO grep: covered by the repo-wide TODO sweep in tests/ — this
 *      file introduces no new TODOs.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMayaConfig,
  MAYA_BOOTSTRAP_MAX_CHARS,
  type BuildInputs,
} from "../configGeneratorMaya";
import { assembleWorkspaceBundle } from "../workspace/assembleWorkspaceBundle";
import { buildCronJobsJson } from "../workspace/buildCronJobsJson";
import { STANDING_ORDERS } from "../workspace/standingOrders";
import type { Doc, Id } from "../../../../_generated/dataModel";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const NOW = 1_700_000_000_000;
const TZ = "America/Los_Angeles";

function fakeCreator(plan: "coach" | "manager"): Doc<"creators"> {
  return {
    _id: "fake_creator_wave5_id" as unknown as Id<"creators">,
    _creationTime: NOW,
    clerkUserId: "u_wave5",
    email: "wave5@test.com",
    channelPreference: "web",
    timezone: TZ,
    status: "onboarding",
    plan,
    createdAt: NOW,
  };
}

function inputsFor(plan: "coach" | "manager"): BuildInputs {
  return {
    creator: fakeCreator(plan),
    picture: null,
    handles: [],
    connectedAccounts: [],
    decryptedComposioAccounts: new Map(),
  };
}

/* -------------------------------------------------------------------------- */
/* 1. Image pin bumped to OpenClaw 2026.4.23 runtime                            */
/* -------------------------------------------------------------------------- */

describe("Wave 5 — image pin (OpenClaw 4.12 → 2026.4.23)", () => {
  it("deployMaya.ts default OPENCLAW_IMAGE references the Fly OpenClaw image by immutable digest", () => {
    const path = join(REPO_ROOT, "convex/onboarding/maya/deployMaya.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain('"registry.fly.io/heymaya-openclaw@sha256:');
    expect(src).not.toContain('"registry.fly.io/heymaya-openclaw:v4.12.0"');
  });

  it("flyClient.ts header comment references the new CalVer tag", () => {
    const path = join(REPO_ROOT, "convex/lib/flyClient.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("v2026.4.23");
    expect(src).not.toContain("v4.12.0");
  });

  it("deploy README documents the new image tag and operator-build requirement", () => {
    const path = join(REPO_ROOT, "convex/onboarding/maya/README.md");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("v2026.4.23");
    expect(src).toContain("Operator must build");
  });

  it("MayaConfig.openclawVersion is the literal '2026.4.23' (CalVer)", () => {
    const { config } = buildMayaConfig(inputsFor("manager"), NOW);
    expect(config.openclawVersion).toBe("2026.4.23");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. jobs.json determinism (4.20+: jobs.json static, jobs-state.json runtime) */
/* -------------------------------------------------------------------------- */

describe("Wave 5 — jobs.json determinism (jobs.json must stay stable for git)", () => {
  it("identical inputs → byte-identical jobs.json (canonical JSON)", () => {
    // Per https://docs.openclaw.ai/automation/cron-jobs (verified 2026.4.23
    // in Wave 5): "If you track cron definitions in git, track jobs.json and
    // gitignore jobs-state.json." Our generator must not mutate jobs.json on
    // re-runs — only OpenClaw's runtime touches jobs-state.json.
    for (const plan of ["coach", "manager"] as const) {
      const a = buildCronJobsJson({ creator: fakeCreator(plan) });
      const b = buildCronJobsJson({ creator: fakeCreator(plan) });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("jobs.json cron entries are identical across two builds (no Date.now drift in cron set)", () => {
    const a = buildMayaConfig(inputsFor("manager"), NOW);
    const b = buildMayaConfig(inputsFor("manager"), NOW + 9_999_999); // different now
    // The cron set (entries with schedule.kind="cron") must not embed `now`
    // — generator is pure on (creator, catalog).
    //
    // EXCEPTION (Sprint 9.5, 2026-05-06): the first-boot kickstart entry
    // legitimately embeds an absolute `at` timestamp derived from `now`
    // because OpenClaw's `kind: "at"` schedule needs an absolute moment to
    // arm against, and we want it in the past at deploy time so the
    // scheduler arms with zero delay. The kickstart is filtered out of
    // this stability assertion; cron entries are checked verbatim.
    const cronOnly = (j: ReturnType<typeof buildCronJobsJson>) => ({
      jobs: j.jobs.filter((entry) => entry.schedule.kind === "cron"),
    });
    expect(JSON.stringify(cronOnly(a.config.jobsJson))).toBe(
      JSON.stringify(cronOnly(b.config.jobsJson))
    );
  });

  it("jobs.json kickstart entry is gated on creator.firstBootCompletedAt", () => {
    // Booted creator (firstBootCompletedAt set) → no kickstart at all,
    // jobs.json is fully `now`-independent again.
    const bootedInputs = (): BuildInputs => ({
      ...inputsFor("manager"),
      creator: {
        ...inputsFor("manager").creator,
        firstBootCompletedAt: NOW - 86_400_000,
      },
    });
    const a = buildMayaConfig(bootedInputs(), NOW);
    const b = buildMayaConfig(bootedInputs(), NOW + 9_999_999);
    // Whole jobs.json must be byte-identical when the kickstart is gated off.
    expect(JSON.stringify(a.config.jobsJson)).toBe(
      JSON.stringify(b.config.jobsJson)
    );
    // …and the kickstart entry must not be present.
    expect(
      a.config.jobsJson.jobs.find((j) => j.id === "0001_first_boot_kickstart")
    ).toBeUndefined();
  });

  it("every jobs.json entry has the normalized 4.23 field set", () => {
    // This tests the cron-only set; the first-boot kickstart entry is
    // covered by `__tests__/buildCronJobsJson.test.ts § Sprint 9.5`. Default
    // call below (no `firstBootKickstart` arg) returns the cron-only set.
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("manager") });
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(typeof j.id).toBe("string");
      expect(j.id.length).toBeGreaterThan(0);
      expect(typeof j.name).toBe("string");
      expect(j.name.length).toBeGreaterThan(0);
      expect(j.enabled).toBe(true);
      expect(j.schedule.kind).toBe("cron");
      // Type narrow for the .expr / .tz reads below.
      if (j.schedule.kind !== "cron") throw new Error("type-narrow guard");
      expect(j.schedule.expr).toMatch(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/); // 5-field POSIX
      expect(j.schedule.tz).toBe(TZ);
      expect(["isolated", "main"]).toContain(j.sessionTarget);
      expect(j.wakeMode).toBe("now");
      expect(["agentTurn", "systemEvent"]).toContain(j.payload.kind);
      const message =
        j.payload.kind === "agentTurn" ? j.payload.message : j.payload.text;
      expect(message.length).toBeGreaterThan(0);
      expect("cron" in j).toBe(false);
      expect("session" in j).toBe(false);
      expect("message" in j).toBe(false);
      expect("entryId" in j).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3. cliClient unpair → channels remove --delete                              */
/* -------------------------------------------------------------------------- */

describe("Wave 5 — cliClient surface (verified against OpenClaw 2026.4.23)", () => {
  it("channels.ts unpairChannel passes --delete to the unpair command (required in 4.20+)", () => {
    const path = join(REPO_ROOT, "convex/integrations/openclaw/channels.ts");
    const src = readFileSync(path, "utf8");
    // The unpair invocation must include `--delete` in its argv.
    // We grep for the literal CLI flag inside the unpair-handler block.
    const unpairBlockStart = src.indexOf("command: \"unpair\"");
    expect(unpairBlockStart).toBeGreaterThan(0);
    // Look ahead until the closing `});` of the call.
    const unpairBlockEnd = src.indexOf("});", unpairBlockStart);
    expect(unpairBlockEnd).toBeGreaterThan(unpairBlockStart);
    const unpairBlock = src.slice(unpairBlockStart, unpairBlockEnd);
    expect(unpairBlock).toContain('"--delete"');
  });

  it("cliClient.ts COMMAND_PATH still maps pair → channels add, confirm → pairing approve, unpair → channels remove", () => {
    const path = join(REPO_ROOT, "convex/integrations/openclaw/cliClient.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain('pair: ["channels", "add"]');
    expect(src).toContain('confirm: ["pairing", "approve"]');
    expect(src).toContain('unpair: ["channels", "remove"]');
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Standing orders embed in AGENTS.md per OpenClaw 4.23 convention          */
/* -------------------------------------------------------------------------- */

describe("Wave 5 — standing orders embed inline in AGENTS.md (OpenClaw 4.23 convention)", () => {
  it("at production 28K cap, every plan's bundle has standing orders EMBEDDED, no separate file", () => {
    // Per https://docs.openclaw.ai/automation/standing-orders (verified
    // against 2026.4.23 in Wave 5): "Put standing orders in AGENTS.md to
    // guarantee they're loaded every session." Only canonical root files
    // (AGENTS / SOUL / USER / HEARTBEAT / TOOLS / MEMORY / BOOTSTRAP /
    // IDENTITY) are auto-injected; arbitrary .md files in the workspace
    // root are NOT guaranteed to load.
    for (const plan of ["coach", "manager"] as const) {
      const { config } = buildMayaConfig(inputsFor(plan), NOW);
      const cap = config.gatewayConfig.agents.defaults.bootstrapMaxChars;
      const bundle = assembleWorkspaceBundle(
        {
          creator: fakeCreator(plan),
          picture: null,
          handles: [],
          connectedAccounts: [],
          plan,
          now: NOW,
        },
        { bootstrapMaxChars: cap }
      );
      expect(
        bundle.standingOrdersSplit,
        `${plan}: standing orders MUST embed inline at the prod ${cap} cap`
      ).toBe(false);
      expect(bundle.files.has("standing-orders.md")).toBe(false);

      const agentsMd = bundle.files.get("AGENTS.md")!;
      // Verify a few canonical program titles are inline.
      expect(agentsMd).toContain("### Morning brief");
      expect(agentsMd).toContain("### Weekly review");
      expect(agentsMd).toContain("### Evening signal check (silent unless something real surfaced)");
    }
  });

  it("MAYA_BOOTSTRAP_MAX_CHARS is 105K (Sprint C.3 bump: calendar-event nudge section + morning_brief calendar-weave pushed merged AGENTS.md past 100K; bumped to 105K so the inline embed stays coherent)", () => {
    expect(MAYA_BOOTSTRAP_MAX_CHARS).toBe(115_000);
  });

  it("AGENTS.md actually fits under the 28K cap for every plan (defense-in-depth)", () => {
    for (const plan of ["coach", "manager"] as const) {
      const { config } = buildMayaConfig(inputsFor(plan), NOW);
      const cap = config.gatewayConfig.agents.defaults.bootstrapMaxChars;
      const bundle = assembleWorkspaceBundle(
        {
          creator: fakeCreator(plan),
          picture: null,
          handles: [],
          connectedAccounts: [],
          plan,
          now: NOW,
        },
        { bootstrapMaxChars: cap }
      );
      const agentsMd = bundle.files.get("AGENTS.md")!;
      expect(
        agentsMd.length,
        `${plan}: AGENTS.md = ${agentsMd.length} chars (cap ${cap})`
      ).toBeLessThanOrEqual(cap);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 5. SKILL.md frontmatter spot-check — single-line YAML required              */
/* -------------------------------------------------------------------------- */

describe("Wave 5 — SKILL.md frontmatter is single-line YAML (per OpenClaw spec)", () => {
  // Per `https://docs.openclaw.ai/skills` (verified Wave 5):
  // "The parser used by the embedded agent supports single-line frontmatter
  // keys only; metadata should be a single-line JSON object."
  const SPOT_CHECK = [
    "maya-brand-deal-triager",
    "maya-brand-outreach",
    "maya-opportunity-scout",
    "maya-pitch-strategy",
    "maya-voice-applier",
  ];

  it.each(SPOT_CHECK)(
    "%s — frontmatter has no multi-line YAML block scalars (`: |`)",
    (skill) => {
      const path = join(REPO_ROOT, "agents/skills", skill, "SKILL.md");
      const src = readFileSync(path, "utf8");
      // Extract frontmatter between the first two `---` lines.
      const lines = src.split("\n");
      expect(lines[0]).toBe("---");
      const closeIdx = lines.indexOf("---", 1);
      expect(closeIdx).toBeGreaterThan(0);
      const frontmatter = lines.slice(1, closeIdx);
      // No line in the frontmatter ends with `: |` (block-scalar indicator).
      // Also reject `: >` (folded-scalar). Both are multi-line YAML scalars.
      for (const line of frontmatter) {
        expect(
          /:\s*[|>][+-]?\s*$/.test(line),
          `${skill}: frontmatter line uses block-scalar syntax: ${line}`
        ).toBe(false);
      }
      // Reject nested-mapping syntax (`: ` followed by indented sub-keys).
      // We test for the classic snake_case multi-key forms we cleaned up:
      // plan_tier:\n  starter: ..., calls:\n  - ..., delegates_to:\n  - ...
      const fmText = frontmatter.join("\n");
      expect(fmText).not.toMatch(/^plan_tier:\s*$/m);
      expect(fmText).not.toMatch(/^calls:\s*$/m);
      expect(fmText).not.toMatch(/^delegates_to:\s*$/m);
      expect(fmText).not.toMatch(/^persists_to:\s*$/m);
    }
  );

  it("every spot-checked SKILL.md has at minimum: name (single-line) + description (single-line)", () => {
    for (const skill of SPOT_CHECK) {
      const path = join(REPO_ROOT, "agents/skills", skill, "SKILL.md");
      const src = readFileSync(path, "utf8");
      const lines = src.split("\n");
      const closeIdx = lines.indexOf("---", 1);
      const fm = lines.slice(1, closeIdx);
      const nameLine = fm.find((l) => l.startsWith("name:"));
      const descLine = fm.find((l) => l.startsWith("description:"));
      expect(nameLine, `${skill}: missing name field`).toBeDefined();
      expect(descLine, `${skill}: missing description field`).toBeDefined();
      // Single-line: the description value must NOT be empty (which would
      // mean the value follows on the next line as a block scalar).
      expect(descLine!.replace(/^description:\s*/, "").length).toBeGreaterThan(
        0
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Per-tier cron set verification (W1-A revised plan-tier matrix)           */
/* -------------------------------------------------------------------------- */

describe("Wave 5 — per-tier cron set (Starter limited / Pro+ full)", () => {
  // Source-of-truth list per the W1-A matrix (proactiveCronAll false ⇒
  // pro+-tier programs SKIPPED for Starter). Catalog entries explicitly
  // marked `tier: "all"` ALWAYS run for Starter.
  const ALL_TIER_IDS = STANDING_ORDERS.filter(
    (p) => p.tier === "all" && p.kind === "cron"
  ).map((p) => p.cronEntryId!);
  const PRO_PLUS_IDS = STANDING_ORDERS.filter(
    (p) => p.tier === "manager" && p.kind === "cron"
  ).map((p) => p.cronEntryId!);

  it("Starter cron set — includes every all-tier program", () => {
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("coach") });
    const ids = new Set(jobs.map((j) => j.id));
    for (const id of ALL_TIER_IDS) {
      expect(ids.has(id), `Starter: missing all-tier program '${id}'`).toBe(true);
    }
  });

  it("Starter cron set — EXCLUDES every pro+ program (proactiveCronAll false)", () => {
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("coach") });
    const ids = new Set(jobs.map((j) => j.id));
    for (const id of PRO_PLUS_IDS) {
      expect(ids.has(id), `Starter: must NOT include pro+ program '${id}'`).toBe(
        false
      );
    }
  });

  it("Pro cron set — includes every program (all-tier + pro+)", () => {
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("manager") });
    const ids = new Set(jobs.map((j) => j.id));
    for (const id of ALL_TIER_IDS) {
      expect(ids.has(id), `Pro: missing all-tier '${id}'`).toBe(true);
    }
    for (const id of PRO_PLUS_IDS) {
      expect(ids.has(id), `Pro: missing pro+ '${id}'`).toBe(true);
    }
  });

  it("Studio cron set — identical to Pro for v0 (Studio differentiation lives in skill behavior, not cron presence)", () => {
    const pro = buildCronJobsJson({ creator: fakeCreator("manager") });
    const studio = buildCronJobsJson({ creator: fakeCreator("manager") });
    expect(JSON.stringify(studio)).toBe(JSON.stringify(pro));
  });

  it("Starter MUST run morning_brief, evening_recap, weekly_review (the three creator-facing baselines)", () => {
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("coach") });
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain("morning_brief");
    expect(ids).toContain("evening_recap");
    expect(ids).toContain("weekly_review");
  });

  it("Coach MUST run revenue_snapshot — the only advisory cron remaining after Sprint 3 Slice 1's collapse", () => {
    // Sprint 3 Slice 1: cron set collapsed from 21 → 6. The former advisory
    // crons (industry_intel_daily, competitor_watch, calendar_lookahead) all
    // became kind="heartbeat" — they retain their AGENTS.md prose but
    // generateHeartbeatMd.ts (Slice 2) drives them off the heartbeat tick.
    // manager_readiness_packet_quarterly was deleted entirely for MVP.
    // revenue_snapshot stays as cron because Mon 9am pairs with Stripe's
    // weekly close — precise timing matters here.
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("coach") });
    const ids = new Set(jobs.map((j) => j.id));
    expect(ids.has("revenue_snapshot"), "Coach: must run advisory 'revenue_snapshot'").toBe(true);
    // The other 4 must NOT be in cron after Slice 1. They live in
    // generateHeartbeatMd.ts and AGENTS.md prose.
    for (const movedOrDeleted of [
      "industry_intel_daily",
      "competitor_watch",
      "calendar_lookahead",
      "manager_readiness_packet_quarterly",
    ]) {
      expect(
        ids.has(movedOrDeleted),
        `'${movedOrDeleted}' moved/deleted in Slice 1 — must NOT be in jobsJson`
      ).toBe(false);
    }
  });
});
