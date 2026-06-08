#!/usr/bin/env tsx
/**
 * Sprint 17 part B — sync `agents/skills/maya-gtm/<slug>/SKILL.md` files
 * into a TS module that the Convex workspace generator ships in every
 * Maya GTM bundle.
 *
 * Same pattern as scripts/sync-bundled-playbook.ts: Convex actions can't
 * read the filesystem at runtime, so SKILL.md content must be inlined as
 * TypeScript string constants.
 *
 * Run: `npm run sync:bundled-local-skills`
 *
 * Then commit BOTH the source SKILL.md files and the regenerated
 * `convex/agents/packs/maya_gtm/bundledLocalSkills.ts`. The byte-sync
 * test asserts they stay aligned.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(REPO_ROOT, "agents", "skills", "maya-gtm");
const OUTPUT_PATH = join(
  REPO_ROOT,
  "convex",
  "agents",
  "packs",
  "maya_gtm",
  "bundledLocalSkills.ts"
);

interface LocalSkillEntry {
  slug: string;
  body: string;
}

function escapeBackticks(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function readSkills(): LocalSkillEntry[] {
  const entries: LocalSkillEntry[] = [];
  const slugs = readdirSync(SKILLS_DIR)
    .filter((name) => {
      const full = join(SKILLS_DIR, name);
      return statSync(full).isDirectory();
    })
    .sort();
  for (const slug of slugs) {
    const skillMd = join(SKILLS_DIR, slug, "SKILL.md");
    try {
      const body = readFileSync(skillMd, "utf8");
      entries.push({ slug, body });
    } catch {
      console.warn(`[sync] no SKILL.md for ${slug}; skipping`);
    }
  }
  return entries;
}

function renderModule(entries: LocalSkillEntry[]): string {
  const header = `/**
 * AUTO-GENERATED. DO NOT EDIT BY HAND.
 *
 * Run \`npm run sync:bundled-local-skills\` to regenerate from
 * \`agents/skills/maya-gtm/<slug>/SKILL.md\`.
 *
 * Sprint 17 part B — Maya GTM's 17 locally-authored skill bodies.
 * Every workspace bundle ships these so Maya has real per-skill SOPs
 * (vs the 7-line stubs the generator used to emit).
 */

export interface BundledLocalSkill {
  slug: string;
  /** Workspace-relative path the SKILL.md lands at. */
  workspacePath: string;
  body: string;
}

`;
  const consts = entries.map((entry, i) => {
    const constName = `ENTRY_${i}_${entry.slug.replace(/-/g, "_").replace(/[^a-zA-Z0-9_]/g, "")}`;
    // Use string concatenation to embed the opening/closing template-literal
    // backticks; embedding them via `\\\`` in this JS template literal
    // produces a literal `\\` + ``` ` ```` in the output (= invalid TS source).
    return (
      `// Source: agents/skills/maya-gtm/${entry.slug}/SKILL.md\nconst ${constName} = ` +
      "`" +
      escapeBackticks(entry.body) +
      "`;"
    );
  });
  const arr = entries
    .map((entry, i) => {
      const constName = `ENTRY_${i}_${entry.slug.replace(/-/g, "_").replace(/[^a-zA-Z0-9_]/g, "")}`;
      return `  { slug: ${JSON.stringify(entry.slug)}, workspacePath: ${JSON.stringify(`skills/${entry.slug}/SKILL.md`)}, body: ${constName} },`;
    })
    .join("\n");
  const footer = `
export const BUNDLED_LOCAL_SKILLS: readonly BundledLocalSkill[] = [
${arr}
];
`;
  return header + consts.join("\n\n") + "\n" + footer;
}

function main(): void {
  const entries = readSkills();
  if (entries.length === 0) {
    console.error("[sync] no skill SKILL.md files found in", SKILLS_DIR);
    process.exit(1);
  }
  const out = renderModule(entries);
  writeFileSync(OUTPUT_PATH, out, "utf8");
  console.log(
    `Wrote ${entries.length} skill entries (${entries
      .map((e) => e.slug)
      .join(", ")}) → ${OUTPUT_PATH}`
  );
}

if (process.argv[1]?.endsWith("sync-bundled-local-skills.ts")) {
  main();
}
