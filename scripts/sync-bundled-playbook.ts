#!/usr/bin/env tsx
/**
 * Sprint 2.5 — sync `playbook/*.md` files into a TS module that the Convex
 * workspace generator can ship in every Maya GTM bundle.
 *
 * Convex actions cannot read the filesystem at runtime, so playbook content
 * must be inlined as TypeScript string constants. This script reads the
 * canonical `playbook/` directory and regenerates
 * `convex/agents/packs/maya_gtm/bundledPlaybook.ts`.
 *
 * Run: `npm run sync:bundled-playbook`
 *
 * Then commit BOTH the source `playbook/*.md` and the regenerated
 * `bundledPlaybook.ts`. The byte-sync test in maya_gtm/__tests__ asserts
 * they stay in sync.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAYBOOK_DIR = join(REPO_ROOT, "playbook");
const OUTPUT_PATH = join(
  REPO_ROOT,
  "convex",
  "agents",
  "packs",
  "maya_gtm",
  "bundledPlaybook.ts"
);

interface PlaybookEntry {
  /** File-system filename, e.g. "PLAYBOOK.md" or "reddit.md". */
  fileName: string;
  /** Workspace-relative path, e.g. "playbook/PLAYBOOK.md". */
  workspacePath: string;
  /** Full file body. */
  body: string;
}

function escapeBackticks(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function readPlaybookEntries(): PlaybookEntry[] {
  const entries: PlaybookEntry[] = [];
  const names = readdirSync(PLAYBOOK_DIR).sort((a, b) => {
    // PLAYBOOK.md (master) first, then per-platform alphabetical.
    if (a === "PLAYBOOK.md") return -1;
    if (b === "PLAYBOOK.md") return 1;
    return a.localeCompare(b);
  });
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const fullPath = join(PLAYBOOK_DIR, name);
    const body = readFileSync(fullPath, "utf8");
    const workspacePath = name === "PLAYBOOK.md" ? "PLAYBOOK.md" : `playbook/${name}`;
    entries.push({ fileName: name, workspacePath, body });
  }
  return entries;
}

function renderModule(entries: PlaybookEntry[]): string {
  const header = `/**
 * AUTO-GENERATED. DO NOT EDIT BY HAND.
 *
 * Run \`npm run sync:bundled-playbook\` to regenerate from \`playbook/*.md\`.
 *
 * Sprint 2.5 — Maya's launch expertise is grounded in evidence-cited
 * playbooks studied from real indie launches. The master \`PLAYBOOK.md\`
 * codifies the launch doctrine; per-platform sub-playbooks live under
 * \`playbook/\`. Every Maya GTM workspace ships these files so Maya reads
 * them on every research turn before choosing channels or drafting work.
 */

export interface BundledPlaybookEntry {
  /** Path the file lands at inside the workspace tarball. */
  workspacePath: string;
  /** File body. */
  body: string;
}

`;
  const consts = entries.map((entry, i) => {
    const slug = entry.fileName.replace(/\.md$/, "").replace(/[^a-zA-Z0-9]/g, "_");
    return `// Source: playbook/${entry.fileName}\nconst ENTRY_${i}_${slug} = \`${escapeBackticks(entry.body)}\`;`;
  });
  const arr = entries
    .map(
      (entry, i) =>
        `  { workspacePath: ${JSON.stringify(entry.workspacePath)}, body: ENTRY_${i}_${entry.fileName.replace(/\.md$/, "").replace(/[^a-zA-Z0-9]/g, "_")} },`
    )
    .join("\n");
  const footer = `
export const BUNDLED_PLAYBOOK_ENTRIES: readonly BundledPlaybookEntry[] = [
${arr}
];
`;
  return header + consts.join("\n\n") + "\n" + footer;
}

function main(): void {
  const entries = readPlaybookEntries();
  if (entries.length === 0) {
    console.error("[sync] no playbook/*.md files found in", PLAYBOOK_DIR);
    process.exit(1);
  }
  const out = renderModule(entries);
  writeFileSync(OUTPUT_PATH, out, "utf8");
  console.log(
    `Wrote ${entries.length} playbook entries (${entries
      .map((e) => e.fileName)
      .join(", ")}) → ${OUTPUT_PATH}`
  );
}

if (process.argv[1]?.endsWith("sync-bundled-playbook.ts")) {
  main();
}
