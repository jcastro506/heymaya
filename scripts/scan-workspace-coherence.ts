#!/usr/bin/env tsx
/**
 * Sprint 13 — Mandatory Five #4: sibling-file workspace coherence scan.
 *
 * Generates a representative Maya GTM workspace bundle and asserts that the
 * cross-references between the .md files, jobs.json, and the skill registry
 * are consistent. Catches the class of bug where AGENTS.md mentions a skill
 * that jobs.json never schedules and the workspace doesn't ship a SKILL.md
 * for — the kind of drift that doesn't break tests but does break Maya.
 *
 * Run via `npm run scan:workspace-coherence`.
 *
 * Exit codes:
 *   0  — coherent
 *   1  — divergence found (printed in detail)
 *   2  — usage / fixture error
 */

import { buildMayaGtmWorkspace, mayaGtmSkillSlugs } from "../convex/agents/packs/maya_gtm/generators";

interface CoherenceIssue {
  severity: "error" | "warn";
  rule: string;
  message: string;
}

function fixtureInput() {
  return {
    accountEmail: "rwtc@heymaya.test",
    timezone: "America/New_York",
    bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    app: {
      name: "Maya RWTC Fixture",
      url: "https://maya-rwtc.vercel.app/",
      stage: "live-beta" as const,
      weekGoal: "signups" as const,
      founderWhy: "fixture for sibling-file coherence scan",
      canRecordScreen: true,
      canShowFace: false,
      canRecordVoice: false,
      canProvideScreenshots: true,
      canPostTikTokManually: true,
      canPostInstagramManually: false,
      tiktokWarmupState: "ready" as const,
      tiktokAccountAgeDays: 90,
      tiktokAccountStatusChecked: true,
      openToUgcCreators: false,
      excludedAudiences: [],
    },
  };
}

function fileKeys(files: Map<string, string>): Set<string> {
  return new Set(files.keys());
}

function parseJobs(files: Map<string, string>): { ids: Set<string>; names: Set<string>; raw: unknown } {
  const jobsJson = files.get("jobs.json");
  if (!jobsJson) {
    throw new Error("jobs.json missing from workspace bundle");
  }
  const raw = JSON.parse(jobsJson) as {
    jobs?: Array<{ id?: string; name?: string }>;
  };
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const job of raw.jobs ?? []) {
    if (typeof job.id === "string") ids.add(job.id);
    if (typeof job.name === "string") names.add(job.name);
  }
  return { ids, names, raw };
}

function bootRequiredFiles(boot: string): string[] {
  // BOOT.md line: "Confirm workspace files exist: AGENTS.md, SOUL.md, ... DREAMING.md."
  // The trailing terminator is end-of-line — `[^.]` would clip inside .md filenames.
  const match = boot.match(/Confirm workspace files exist:\s*([^\n]+)/);
  if (!match) return [];
  return match[1]
    .replace(/\.$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /\.(md|json)$/i.test(s));
}

function skillsReferencedInAgents(agents: string): Set<string> {
  // Find skill slugs referenced in AGENTS.md prose. Must avoid matching URL
  // substrings (e.g. https://maya-x.vercel.app contains "maya-x") and email
  // hostnames. We require the slug appear in backticks or as a standalone
  // word at the start of a bullet/numbered-list item.
  const referenced = new Set<string>();
  const slugPattern = /(?:`(maya-[a-z-]+|scrapecreators-api)`|(?:^|\s)(maya-[a-z-]+|scrapecreators-api)(?=:|\s|$))/gm;
  for (const m of agents.matchAll(slugPattern)) {
    const slug = m[1] ?? m[2];
    if (slug) referenced.add(slug);
  }
  return referenced;
}

function run(): CoherenceIssue[] {
  const issues: CoherenceIssue[] = [];
  const { files } = buildMayaGtmWorkspace(fixtureInput());
  const keys = fileKeys(files);
  const skills = mayaGtmSkillSlugs();

  // Rule 1 — every file BOOT.md says must exist actually ships.
  const boot = files.get("BOOT.md") ?? "";
  const required = bootRequiredFiles(boot);
  if (required.length === 0) {
    issues.push({
      severity: "error",
      rule: "boot-required-files-listed",
      message:
        "BOOT.md did not list any workspace files in its 'Confirm workspace files exist' clause; cannot verify coherence",
    });
  }
  for (const f of required) {
    if (!keys.has(f)) {
      issues.push({
        severity: "error",
        rule: "boot-file-shipped",
        message: `BOOT.md requires '${f}' but the workspace bundle does not ship it`,
      });
    }
  }

  // Rule 2 — every skill in SKILLS const has a SKILL.md generator.
  for (const slug of skills) {
    const path = `skills/${slug}/SKILL.md`;
    if (!keys.has(path)) {
      issues.push({
        severity: "error",
        rule: "skill-has-skill-md",
        message: `Skill '${slug}' is declared in SKILLS but no '${path}' is generated`,
      });
    }
  }

  // Rule 3 — every skill referenced in AGENTS.md prose is in SKILLS.
  const agents = files.get("AGENTS.md") ?? "";
  const referenced = skillsReferencedInAgents(agents);
  for (const slug of referenced) {
    if (!skills.includes(slug as (typeof skills)[number])) {
      issues.push({
        severity: "warn",
        rule: "agents-reference-known-skill",
        message: `AGENTS.md references skill '${slug}' which is not in the SKILLS registry`,
      });
    }
  }

  // Rule 4 — jobs.json has at least the documented foundational crons.
  let jobs;
  try {
    jobs = parseJobs(files);
  } catch (err) {
    issues.push({
      severity: "error",
      rule: "jobs-json-parses",
      message: (err as Error).message,
    });
    return issues;
  }
  const requiredJobIds = ["0001_gtm_boot_kickoff", "gtm_heartbeat", "gtm_weekly_review"];
  for (const id of requiredJobIds) {
    if (!jobs.ids.has(id)) {
      issues.push({
        severity: "error",
        rule: "jobs-required-id",
        message: `jobs.json is missing required cron id '${id}'`,
      });
    }
  }

  // Rule 5 — required workspace files exist regardless of BOOT.md text.
  const corpusFiles = [
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
    // Sprint 2.5 — launch-doctrine playbook.
    "PLAYBOOK.md",
    "playbook/reddit.md",
    "playbook/x.md",
    "playbook/tiktok.md",
    "playbook/instagram.md",
    "playbook/linkedin.md",
    // Sprint 17 — pinned ClawHub skill bodies (prompt-reference doctrine).
    "clawhub-skills/reddit-readonly/SKILL.md",
    "clawhub-skills/search-x/SKILL.md",
    "clawhub-skills/tiktok/SKILL.md",
    "clawhub-skills/jk-archivist-tiktok-packager/SKILL.md",
    "clawhub-skills/instagram/SKILL.md",
    "clawhub-skills/market-research/SKILL.md",
    "clawhub-skills/in-depth-research/SKILL.md",
  ];
  for (const f of corpusFiles) {
    if (!keys.has(f)) {
      issues.push({
        severity: "error",
        rule: "corpus-file-present",
        message: `Required workspace file '${f}' is missing`,
      });
    }
  }

  // Rule 6 — no empty/near-empty body for any shipped file.
  for (const [path, body] of files.entries()) {
    if (body.trim().length < 16) {
      issues.push({
        severity: "error",
        rule: "no-empty-file",
        message: `Workspace file '${path}' is empty or near-empty (${body.length} chars)`,
      });
    }
  }

  return issues;
}

function main(): void {
  const issues = run();
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warn");

  for (const issue of issues) {
    const tag = issue.severity === "error" ? "[ERROR]" : "[ WARN]";
    console.log(`${tag} ${issue.rule}: ${issue.message}`);
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log("Workspace coherence: ok — no issues found.");
  } else {
    console.log(
      `Workspace coherence: ${errors.length} error(s), ${warnings.length} warning(s).`
    );
  }

  process.exit(errors.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main();
}

export { run as scanWorkspaceCoherence };
