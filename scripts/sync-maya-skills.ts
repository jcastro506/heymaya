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

/**
 * ⭐ `PLATFORM_ALGO/` is channel expertise, not a skill.
 *
 * `CONVENTIONS.md` says platform knowledge lives *"in `PLATFORM_ALGO/{channel}.md`,
 * as prose. Never as a branch in a skill, and never hardcoded into a tool."*
 * `write-post` cites it by name. Neither the directory nor the files existed —
 * every skill referred to a file the workspace never received.
 *
 * ⚠️ It is excluded from the skill scan rather than merely handled: the scan
 * treats every directory as a skill and reads `SKILL.md` from it, so leaving it
 * in makes `npm run sync:maya-skills` throw ENOENT.
 */
export const PLATFORM_ALGO_DIR = "PLATFORM_ALGO";

/** Read the pack from disk. Exported so the drift test reads it the same way. */
export function readMayaSkills(packDir: string = PACK_DIR): {
  conventions: string;
  skills: BundledSkill[];
  platformAlgo: BundledSkill[];
} {
  const conventions = readFileSync(join(packDir, "CONVENTIONS.md"), "utf8");
  const skills = readdirSync(packDir)
    .filter(
      (name) =>
        name !== PLATFORM_ALGO_DIR && statSync(join(packDir, name)).isDirectory()
    )
    .sort()
    .map((slug) => ({
      slug,
      body: readFileSync(join(packDir, slug, "SKILL.md"), "utf8"),
    }));

  const algoDir = join(packDir, PLATFORM_ALGO_DIR);
  const platformAlgo = readdirSync(algoDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((file) => ({
      slug: file.replace(/\.md$/, ""),
      body: readFileSync(join(algoDir, file), "utf8"),
    }));

  return { conventions, skills, platformAlgo };
}

function render(
  conventions: string,
  skills: BundledSkill[],
  platformAlgo: BundledSkill[]
): string {
  const algoEntries = platformAlgo
    .map((a) => `  ${JSON.stringify(a.slug)}: ${JSON.stringify(a.body)},`)
    .join("\n");
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

/**
 * Per-channel expertise, keyed by channel.
 *
 * Prose on purpose. \`CONVENTIONS.md\`: *"Each channel rewards a different shape
 * and those shapes drift; prose can be edited when they do, a conditional
 * can't."* Anything reading this must tolerate a channel being absent rather
 * than assuming all four.
 */
export const MAYA_PLATFORM_ALGO: Readonly<Record<string, string>> = {
${algoEntries}
};
`;
}

function main(): void {
  const { conventions, skills, platformAlgo } = readMayaSkills();
  writeFileSync(OUTPUT_PATH, render(conventions, skills, platformAlgo), "utf8");
  const bytes =
    conventions.length +
    skills.reduce((n, s) => n + s.body.length, 0) +
    platformAlgo.reduce((n, a) => n + a.body.length, 0);
  console.log(
    `Wrote ${skills.length} skills + ${platformAlgo.length} PLATFORM_ALGO + CONVENTIONS (${bytes} chars) → ${OUTPUT_PATH}`
  );
}

// Only run when invoked directly, so the test can import `readMayaSkills`.
if (process.argv[1] && process.argv[1].endsWith("sync-maya-skills.ts")) {
  main();
}
