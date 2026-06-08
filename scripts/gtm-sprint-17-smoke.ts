#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 17 — L4 smoke (real skill installation + ClawHub pinning).
 *
 * Asserts:
 *   - 7 ClawHub skills pinned with version + source URLs
 *   - Every SKILL.md ships in the workspace at `clawhub-skills/<slug>/SKILL.md`
 *   - Sanitized: no Pokémon-TCG hardcoded preset, no clawhub-install footer,
 *     no emoji-heavy in-depth-research format
 *   - required env aggregator surfaces XAI_API_KEY only (search-x)
 *   - 6 install commands buildable (instagram is self-contained)
 *   - workspace bundle still ships when search-x has its required env
 *
 * `--live --confirm` adds L6 operator follow-ups.
 */

import { buildMayaGtmWorkspace } from "../convex/agents/packs/maya_gtm/generators";
import {
  PINNED_CLAWHUB_SKILLS,
  buildSkillInstallCommands,
  pinnedClawhubRequiredEnv,
} from "../convex/agents/packs/maya_gtm/pinnedClawhubSkills";
import { BUNDLED_LOCAL_SKILLS } from "../convex/agents/packs/maya_gtm/bundledLocalSkills";

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}

const checks: Check[] = [];
function pass(name: string, detail: string): void {
  checks.push({ name, status: "passed", detail });
}
function fail(name: string, detail: string): void {
  checks.push({ name, status: "failed", detail });
}

function fixture() {
  return {
    accountEmail: "rwtc@heymaya.test",
    timezone: "America/New_York",
    bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    app: {
      name: "S17 fixture",
      url: "https://s17-fixture.test/",
      stage: "live-beta" as const,
      weekGoal: "signups" as const,
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [] as string[],
    },
  };
}

function checkPinnedCount(): void {
  if (PINNED_CLAWHUB_SKILLS.length !== 7) {
    fail(
      "pinned-count",
      `expected 7 pinned skills, got ${PINNED_CLAWHUB_SKILLS.length}`
    );
    return;
  }
  pass("pinned-count", `7 ClawHub skills pinned`);
}

function checkVersionsAndSources(): void {
  for (const s of PINNED_CLAWHUB_SKILLS) {
    if (!/^\d+\.\d+\.\d+$/.test(s.version)) {
      fail("skill-version-shape", `${s.slug} has invalid version: ${s.version}`);
      return;
    }
    if (!s.source.startsWith("https://")) {
      fail("skill-source-shape", `${s.slug} source not https: ${s.source}`);
      return;
    }
    if (s.body.length < 500) {
      fail(
        "skill-body-substantive",
        `${s.slug} SKILL.md body only ${s.body.length} chars (need >500)`
      );
      return;
    }
  }
  pass(
    "skill-pin-shape",
    `all 7 skills: semver version + https source + body >500 chars`
  );
}

function checkSkillsShipInWorkspace(): void {
  const { files } = buildMayaGtmWorkspace(fixture());
  const missing: string[] = [];
  for (const s of PINNED_CLAWHUB_SKILLS) {
    const path = `clawhub-skills/${s.slug}/SKILL.md`;
    if (!files.has(path) || files.get(path) !== s.body) {
      missing.push(path);
    }
  }
  if (missing.length > 0) {
    fail(
      "skills-in-workspace",
      `missing or corrupted: ${missing.join(", ")}`
    );
    return;
  }
  pass(
    "skills-in-workspace",
    `all 7 SKILL.md bodies ship at clawhub-skills/<slug>/SKILL.md byte-identical`
  );
}

function checkSanitization(): void {
  for (const s of PINNED_CLAWHUB_SKILLS) {
    if (
      s.slug === "jk-archivist-tiktok-packager" &&
      s.body.includes("TCG prices look certain")
    ) {
      fail(
        "sanitize-pokemon-preset",
        "jk-archivist still contains Pokémon TCG hardcoded preset"
      );
      return;
    }
    if (
      s.slug === "market-research" &&
      s.body.includes("Install with `clawhub install")
    ) {
      fail(
        "sanitize-clawhub-install-footer",
        "market-research still recommends clawhub installs"
      );
      return;
    }
    if (
      s.slug === "in-depth-research" &&
      s.body.includes("🔬 DEEP RESEARCH:")
    ) {
      fail(
        "sanitize-emoji-default",
        "in-depth-research default output still uses heavy emoji"
      );
      return;
    }
  }
  pass(
    "sanitization",
    "no Pokémon preset / no clawhub-install footer / no emoji-heavy default output"
  );
}

function checkRequiredEnv(): void {
  const env = pinnedClawhubRequiredEnv();
  if (env.length !== 1 || env[0] !== "XAI_API_KEY") {
    fail(
      "required-env-aggregator",
      `expected exactly XAI_API_KEY, got ${JSON.stringify(env)}`
    );
    return;
  }
  pass(
    "required-env-aggregator",
    "only XAI_API_KEY required (search-x); operator must set this on Convex env"
  );
}

function checkBundledLocalSkills(): void {
  if (BUNDLED_LOCAL_SKILLS.length !== 17) {
    fail(
      "local-skills-count",
      `expected 17 bundled local Maya skills, got ${BUNDLED_LOCAL_SKILLS.length}`
    );
    return;
  }
  for (const s of BUNDLED_LOCAL_SKILLS) {
    if (s.body.length < 800) {
      fail(
        "local-skill-substantive",
        `${s.slug} body is ${s.body.length} chars; expected >800 (real SOP, not stub)`
      );
      return;
    }
    if (!s.body.includes("PLAYBOOK.md") && !s.body.includes("ScrapeCreators")) {
      fail(
        "local-skill-grounded",
        `${s.slug} does not reference PLAYBOOK.md or ScrapeCreators`
      );
      return;
    }
  }
  // Slop-critic should explicitly enumerate banned phrases.
  const slop = BUNDLED_LOCAL_SKILLS.find((s) => s.slug === "maya-slop-critic");
  if (!slop?.body.includes("Excited to announce") || !slop?.body.includes("supercharge")) {
    fail(
      "slop-critic-bans-shipped",
      "maya-slop-critic doesn't ship the banned-phrase list"
    );
    return;
  }
  pass(
    "bundled-local-skills",
    `17 local Maya skills ship as real SOPs (>800 chars each, grounded in PLAYBOOK or ScrapeCreators); slop-critic ships banned-phrase list`
  );
}

function checkInstallCommands(): void {
  const cmds = buildSkillInstallCommands();
  if (cmds.length !== 6) {
    fail(
      "install-cmd-count",
      `expected 6 install commands (one per multi-file skill), got ${cmds.length}`
    );
    return;
  }
  for (const cmd of cmds) {
    if (!/^openclaw skills install [a-z0-9-]+@\d+\.\d+\.\d+ --global$/.test(cmd)) {
      fail(
        "install-cmd-shape",
        `command does not match expected shape: ${cmd}`
      );
      return;
    }
  }
  pass(
    "install-cmd-shape",
    `6 install commands buildable; all match 'openclaw skills install <slug>@<semver> --global'`
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkPinnedCount();
  checkVersionsAndSources();
  checkSkillsShipInWorkspace();
  checkSanitization();
  checkRequiredEnv();
  checkInstallCommands();
  checkBundledLocalSkills();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 17 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. Set XAI_API_KEY on the Convex deployment (search-x requires it). Otherwise search-x will be available as prompt-reference only.\n" +
        "  2. Deploy RWTC. SSH in, run the 6 install commands from buildSkillInstallCommands(). Confirm `openclaw skills list` shows all 7 (instagram is bundled-only).\n" +
        "  3. Run a research turn that needs Reddit demand. Confirm Maya invokes reddit-readonly via the installed script, not the prompt-reference body.\n" +
        "  4. Probe search-x with a 1-result query. Confirm xAI returns real tweets.\n" +
        "  5. Spot-check 1 skill's GitHub repo to confirm it still matches the pinned version + canonical body."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
