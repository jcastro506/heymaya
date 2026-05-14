#!/usr/bin/env tsx
/**
 * sync-bundled-skills — regenerate
 * `convex/agents/packs/maya/workspace/skillsRegistry.ts` from the on-disk
 * SKILL.md files under `agents/skills/<slug>/`.
 *
 * Why a sync step instead of a runtime fs.readFileSync? The Maya workspace
 * bundle is assembled inside a Convex action (`generateMayaConfig`) running
 * in Convex's V8 runtime, where Node's `fs` module isn't available. The
 * SKILL.md content has to ship as a module-level constant inlined into the
 * bundle. This script does that inlining deterministically — read the file,
 * JSON-escape it, write the registry module.
 *
 * Add new bundled skills below as the SKILLS array grows.
 *
 * Usage (from repo root):
 *   npx tsx scripts/sync-bundled-skills.ts
 *
 * The companion test
 * `convex/agents/packs/maya/workspace/__tests__/assembleWorkspaceBundle.test.ts`
 * verifies the in-bundle bytes match the on-disk SKILL.md byte-for-byte, so a
 * skipped sync surfaces loudly in CI.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface SkillSource {
  slug: string;
  /** Header comment block describing why this skill is bundled. */
  header: string;
}

const SKILLS: ReadonlyArray<SkillSource> = [
  {
    slug: "scrapecreators-api",
    header: [
      "/* -------------------------------------------------------------------------- */",
      "/* scrapecreators-api — official ScrapeCreators agent skill                   */",
      "/*                                                                             */",
      "/* Source: github.com/scrapecreators/agent-skills/skills/scrapecreators-api    */",
      "/* Documents 110 endpoints across 27+ social platforms. Wired for OpenClaw    */",
      "/* via the `metadata.openclaw` frontmatter (env requirement                  */",
      "/* `SCRAPE_CREATORS_API_KEY`). This replaces the hand-rolled wrapper that    */",
      "/* shipped only the 5 platforms Maya read in v0.                              */",
      "/* -------------------------------------------------------------------------- */",
    ].join("\n"),
  },

  /* ------------------------------------------------------------------------ */
  /* Custom maya-* skills — Sprint 2 Slice C (2026-05-06) bundles all 23      */
  /* creator-side maya-* skills into the workspace tarball. Each ships with   */
  /* `metadata.openclaw` frontmatter so the OpenClaw skill loader            */
  /* auto-discovers them under skills/<slug>/SKILL.md. None of them require   */
  /* external env vars — they call into Convex via the gateway, not          */
  /* directly into third-party APIs (that's scrapecreators-api's job).        */
  /*                                                                          */
  /* Order: alphabetical by slug for stable diff output.                      */
  /* ------------------------------------------------------------------------ */
  ...([
    "maya-brand-deal-triager",
    "maya-brand-outreach",
    "maya-calendar-classifier",
    "maya-calendar-read",
    "maya-calendar-write",
    "maya-calendar-planner",
    "maya-caption-generator",
    "maya-citation-firewall",
    "maya-clip-editor",
    "maya-collab-matchmaker",
    "maya-content-arc-planner",
    "maya-content-cross-poster",
    "maya-contract-redflag",
    "maya-gmail-draft",
    "maya-gmail-read",
    "maya-growth-coach",
    "maya-hook-extractor",
    "maya-idea-generator",
    "maya-industry-intel",
    "maya-monetization-diversifier",
    "maya-opportunity-scout",
    "maya-packet-generator",
    "maya-picture-verifier",
    "maya-pitch-strategy",
    "maya-platform",
    "maya-platform-algo-researcher",
    "maya-platform-best-practice",
    "maya-pre-post-scorer",
    "maya-rate-calculator",
    "maya-skill-installer",
    "maya-thumbnail-maker",
    "maya-tiktok-director",
    "maya-transcribe",
    "maya-trend-watcher",
    "maya-underperformance-diagnoser",
    "maya-voice-applier",
  ].map((slug) => ({
    slug,
    header: [
      "/* -------------------------------------------------------------------------- */",
      `/* ${slug.padEnd(72)} */`,
      "/*                                                                             */",
      `/* Custom Maya skill (creator-side). Source: agents/skills/${slug}/SKILL.md`,
      "/* Bundled by Sprint 2 Slice C — see scripts/sync-bundled-skills.ts.           */",
      "/* -------------------------------------------------------------------------- */",
    ].join("\n"),
  }))),
];

function constName(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_") + "_SKILL_MD";
}

function buildModuleSource(): string {
  const lines: string[] = [];
  // NOTE: avoid `*/` inside the JSDoc block (it closes the comment). We refer
  // to OpenClaw's skill path as "skills/<slug>/SKILL.md under workspace-default"
  // rather than the literal glob pattern.
  lines.push("/**");
  lines.push(" * Bundled agent skills shipped to every Maya workspace.");
  lines.push(" *");
  lines.push(" * Each entry materializes at deploy as skills/<slug>/SKILL.md inside the");
  lines.push(" * workspace tarball. OpenClaw's skill loader auto-discovers them from");
  lines.push(" * the workspace's skills/ directory (under ~/.openclaw/workspace-default).");
  lines.push(" *");
  lines.push(" * The SKILL.md content is inlined as a TS string constant so it ships");
  lines.push(" * through Convex's V8 runtime (no fs.readFileSync available there). The");
  lines.push(" * source of truth is the on-disk file under agents/skills/<slug>/SKILL.md;");
  lines.push(" * the scripts/sync-bundled-skills.ts helper keeps this file in sync. A test");
  lines.push(" * in __tests__/assembleWorkspaceBundle.test.ts verifies the in-bundle bytes");
  lines.push(" * match the on-disk file byte-for-byte.");
  lines.push(" *");
  lines.push(" * Regenerate (from repo root):");
  lines.push(" *   npx tsx scripts/sync-bundled-skills.ts");
  lines.push(" *");
  lines.push(" * DO NOT EDIT BY HAND — re-run the sync script instead.");
  lines.push(" */");
  lines.push("");
  lines.push("export interface BundledSkill {");
  lines.push("  /** Skill directory name under `agents/skills/<slug>/`. */");
  lines.push("  slug: string;");
  lines.push("  /** Raw markdown content of `SKILL.md`. */");
  lines.push("  content: string;");
  lines.push("}");
  lines.push("");

  const constLines: string[] = [];
  for (const skill of SKILLS) {
    const path = resolve(REPO_ROOT, "agents", "skills", skill.slug, "SKILL.md");
    const content = readFileSync(path, "utf8");
    const json = JSON.stringify(content);
    lines.push(skill.header);
    lines.push("");
    lines.push(`const ${constName(skill.slug)} = ${json};`);
    lines.push("");
    constLines.push(`  { slug: ${JSON.stringify(skill.slug)}, content: ${constName(skill.slug)} },`);
  }

  lines.push("export const BUNDLED_SKILLS: ReadonlyArray<BundledSkill> = [");
  for (const cl of constLines) lines.push(cl);
  lines.push("];");
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const source = buildModuleSource();
  const outPath = resolve(
    REPO_ROOT,
    "convex/agents/packs/maya/workspace/skillsRegistry.ts"
  );
  writeFileSync(outPath, source, "utf8");
  console.log(`wrote ${outPath} (${source.length} chars, ${SKILLS.length} skills)`);
}

main();
