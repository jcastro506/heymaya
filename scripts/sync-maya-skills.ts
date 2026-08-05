#!/usr/bin/env tsx
/**
 * Inline the `agents/skills/maya/` pack into a TS module the Convex deploy can
 * ship into a machine's workspace.
 *
 * Convex functions can't read the filesystem at runtime, so the skill bodies
 * have to be baked in. The alternative — pasting them into a generator by hand
 * — is how the frozen pack ended up with skills that drifted from their source
 * files, so this is generated and a test asserts it still matches.
 *
 * Run: `npm run sync:maya-skills`
 * Then commit BOTH `agents/skills/maya/**` and the regenerated
 * `convex/agents/packs/maya/bundledSkills.ts`.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACK_DIR = join(REPO_ROOT, "agents", "skills", "maya");
const OUTPUT_PATH = join(
  REPO_ROOT,
  "convex",
  "agents",
  "packs",
  "maya",
  "bundledSkills.ts"
);

export interface BundledSkill {
  slug: string;
  body: string;
}

/** Read the pack from disk. Exported so the drift test reads it the same way. */
export function readMayaSkills(packDir: string = PACK_DIR): {
  conventions: string;
  skills: BundledSkill[];
} {
  const conventions = readFileSync(join(packDir, "CONVENTIONS.md"), "utf8");
  const skills = readdirSync(packDir)
    .filter((name) => statSync(join(packDir, name)).isDirectory())
    .sort()
    .map((slug) => ({
      slug,
      body: readFileSync(join(packDir, slug, "SKILL.md"), "utf8"),
    }));
  return { conventions, skills };
}

function render(conventions: string, skills: BundledSkill[]): string {
  const entries = skills
    .map((s) => `  {\n    slug: ${JSON.stringify(s.slug)},\n    body: ${JSON.stringify(s.body)},\n  },`)
    .join("\n");

  return `/**
 * GENERATED — do not edit by hand.
 *
 * Run \`npm run sync:maya-skills\` to regenerate from \`agents/skills/maya/\`.
 * A test asserts this file still matches those sources, so an edit here without
 * a matching edit there fails CI rather than silently shipping a skill that
 * disagrees with the one in the repo.
 */

export interface BundledMayaSkill {
  slug: string;
  body: string;
}

/** Shared rules every skill inherits. Written to the workspace root. */
export const MAYA_CONVENTIONS: string = ${JSON.stringify(conventions)};

export const BUNDLED_MAYA_SKILLS: readonly BundledMayaSkill[] = [
${entries}
] as const;

export function mayaSkillSlugs(): readonly string[] {
  return BUNDLED_MAYA_SKILLS.map((s) => s.slug);
}
`;
}

function main(): void {
  const { conventions, skills } = readMayaSkills();
  writeFileSync(OUTPUT_PATH, render(conventions, skills), "utf8");
  const bytes = conventions.length + skills.reduce((n, s) => n + s.body.length, 0);
  console.log(
    `Wrote ${skills.length} skills + CONVENTIONS (${bytes} chars) → ${OUTPUT_PATH}`
  );
}

// Only run when invoked directly, so the test can import `readMayaSkills`.
if (process.argv[1] && process.argv[1].endsWith("sync-maya-skills.ts")) {
  main();
}
