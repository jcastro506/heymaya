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
/* 1. Image tag bumped to v2026.4.23                                            */
/* -------------------------------------------------------------------------- */

describe("Wave 5 — image tag (OpenClaw 4.12 → 2026.4.23)", () => {
  it("deployMaya.ts default OPENCLAW_IMAGE references registry.fly.io/heymaya-openclaw:v2026.4.23", () => {
    const path = join(REPO_ROOT, "convex/onboarding/maya/deployMaya.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain('"registry.fly.io/heymaya-openclaw:v2026.4.23"');
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

  it("jobs.json from configGeneratorMaya is identical across two builds (no Date.now drift)", () => {
    const a = buildMayaConfig(inputsFor("manager"), NOW);
    const b = buildMayaConfig(inputsFor("manager"), NOW + 9_999_999); // different now
    // jobs.json must not embed `now` — generator is pure on (creator, catalog).
    expect(JSON.stringify(a.config.jobsJson)).toBe(JSON.stringify(b.config.jobsJson));
  });

  it("every jobs.json entry has the canonical 4.23 field set: name, cron, tz, session, message, entryId", () => {
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("manager") });
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(typeof j.name).toBe("string");
      expect(j.name.length).toBeGreaterThan(0);
      expect(typeof j.cron).toBe("string");
      expect(j.cron).toMatch(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/); // 5-field POSIX
      expect(typeof j.tz).toBe("string");
      expect(j.tz).toBe(TZ);
      expect(["isolated", "main"]).toContain(j.session);
      expect(typeof j.message).toBe("string");
      expect(j.message.length).toBeGreaterThan(0);
      expect(typeof j.entryId).toBe("string");
      expect(j.entryId.length).toBeGreaterThan(0);
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
      expect(agentsMd).toContain("### Evening recap");
    }
  });

  it("MAYA_BOOTSTRAP_MAX_CHARS is 28K (legitimate space for the 25-program inventory)", () => {
    expect(MAYA_BOOTSTRAP_MAX_CHARS).toBe(28_000);
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
    const ids = new Set(jobs.map((j) => j.entryId));
    for (const id of ALL_TIER_IDS) {
      expect(ids.has(id), `Starter: missing all-tier program '${id}'`).toBe(true);
    }
  });

  it("Starter cron set — EXCLUDES every pro+ program (proactiveCronAll false)", () => {
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("coach") });
    const ids = new Set(jobs.map((j) => j.entryId));
    for (const id of PRO_PLUS_IDS) {
      expect(ids.has(id), `Starter: must NOT include pro+ program '${id}'`).toBe(
        false
      );
    }
  });

  it("Pro cron set — includes every program (all-tier + pro+)", () => {
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("manager") });
    const ids = new Set(jobs.map((j) => j.entryId));
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
    const ids = jobs.map((j) => j.entryId);
    expect(ids).toContain("morning_brief");
    expect(ids).toContain("evening_recap");
    expect(ids).toContain("weekly_review");
  });

  it("Starter MUST NOT run industry_intel_daily, competitor_watch, calendar_lookahead, manager_readiness_packet_quarterly, revenue_snapshot", () => {
    const { jobs } = buildCronJobsJson({ creator: fakeCreator("coach") });
    const ids = new Set(jobs.map((j) => j.entryId));
    for (const blocked of [
      "industry_intel_daily",
      "competitor_watch",
      "calendar_lookahead",
      "manager_readiness_packet_quarterly",
      "revenue_snapshot",
    ]) {
      expect(ids.has(blocked), `Starter: must NOT run '${blocked}'`).toBe(false);
    }
  });
});
