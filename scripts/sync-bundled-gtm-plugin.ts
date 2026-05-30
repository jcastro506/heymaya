#!/usr/bin/env tsx
/**
 * Sync the `maya-gtm-tools` OpenClaw tool plugin into a TS module the Convex
 * deploy ships in every Maya GTM machine.
 *
 * Convex actions can't read the filesystem at runtime, so the plugin's packed
 * npm tarball is base64-inlined here. At deploy time `deployMayaGtm.ts` decodes
 * it, stores it as a Convex storage blob, and passes the URL to the Fly machine;
 * the bootstrap shell downloads it and runs
 * `openclaw plugins install npm-pack:<tgz>` before starting the gateway.
 *
 * Run: `npm run sync:bundled-gtm-plugin`
 *
 * Then commit BOTH the plugin source under
 * `infra/openclaw-runtime/plugins/maya-gtm-tools/` and the regenerated
 * `convex/agents/packs/maya_gtm/bundledGtmPlugin.ts`.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = join(
  REPO_ROOT,
  "infra",
  "openclaw-runtime",
  "plugins",
  "maya-gtm-tools"
);
const OUTPUT_PATH = join(
  REPO_ROOT,
  "convex",
  "agents",
  "packs",
  "maya_gtm",
  "bundledGtmPlugin.ts"
);

function packPlugin(): { tgzPath: string; bytes: Buffer } {
  // Clean any stale tarballs so we always read the freshly packed one.
  for (const name of readdirSync(PLUGIN_DIR)) {
    if (name.endsWith(".tgz")) rmSync(join(PLUGIN_DIR, name));
  }
  // `npm pack` honors the package.json `files` allowlist (index.js,
  // openclaw.plugin.json, README.md, package.json) — no node_modules.
  const out = execFileSync("npm", ["pack", "--silent"], {
    cwd: PLUGIN_DIR,
    encoding: "utf8",
  }).trim();
  const tgzName = out.split("\n").filter(Boolean).pop()!;
  const tgzPath = join(PLUGIN_DIR, tgzName);
  return { tgzPath, bytes: readFileSync(tgzPath) };
}

function toolNames(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(PLUGIN_DIR, "openclaw.plugin.json"), "utf8")
  );
  return manifest.contracts?.tools ?? [];
}

function renderModule(b64: string, sha: string, tools: string[]): string {
  return `/**
 * AUTO-GENERATED. DO NOT EDIT BY HAND.
 *
 * Run \`npm run sync:bundled-gtm-plugin\` to regenerate from
 * \`infra/openclaw-runtime/plugins/maya-gtm-tools/\`.
 *
 * The base64 below is the packed \`maya-gtm-tools\` OpenClaw tool plugin
 * (npm pack tarball). \`deployMayaGtm.ts\` decodes it, stores it as a Convex
 * storage blob, and the Fly bootstrap installs it via
 * \`openclaw plugins install npm-pack:<tgz>\`. Activates onStartup; subagents
 * inherit its ${tools.length} typed tools.
 */

/** Plugin id — must match \`plugins.allow\` in the gateway config. */
export const BUNDLED_GTM_PLUGIN_ID = "maya-gtm-tools";

/** Filename used when the bootstrap writes the tarball to disk. */
export const BUNDLED_GTM_PLUGIN_TGZ_NAME = "maya-gtm-tools.tgz";

/** sha256 of the packed tarball (sync-time integrity check). */
export const BUNDLED_GTM_PLUGIN_TGZ_SHA256 = ${JSON.stringify(sha)};

/** Tool names the plugin registers (cold-discovery contract). */
export const BUNDLED_GTM_PLUGIN_TOOLS: readonly string[] = ${JSON.stringify(
    tools,
    null,
    2
  )};

/** base64 of the packed npm tarball. */
export const BUNDLED_GTM_PLUGIN_TGZ_BASE64 =
${JSON.stringify(b64)};
`;
}

function main(): void {
  const { tgzPath, bytes } = packPlugin();
  const b64 = bytes.toString("base64");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const tools = toolNames();
  writeFileSync(OUTPUT_PATH, renderModule(b64, sha, tools), "utf8");
  rmSync(tgzPath, { force: true });
  console.log(
    `Wrote GTM plugin bundle (${tools.length} tools, ${bytes.length} bytes tgz, sha256 ${sha.slice(
      0,
      12
    )}) → ${OUTPUT_PATH}`
  );
}

main();
