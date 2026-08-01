#!/usr/bin/env tsx
/**
 * Pack the `maya-tools` OpenClaw plugin into a TS module the Convex deploy can
 * ship to a machine.
 *
 * Convex functions can't read the filesystem at runtime, so the packed tarball
 * is base64-inlined here. At deploy time the action decodes it, stores it as a
 * Convex storage blob, and the Fly bootstrap downloads it and runs
 * `openclaw plugins install npm-pack:<tgz>` before starting the gateway.
 *
 * Run: `npm run sync:maya-plugin`
 * Then commit BOTH `infra/openclaw-runtime/plugins/maya-tools/` and the
 * regenerated `convex/agents/packs/maya/bundledPlugin.ts`.
 *
 * ## On why there's no "regenerate and diff" test
 *
 * `npm pack` embeds mtimes, so two packs of byte-identical sources produce
 * different tarballs and different hashes. A test that re-packs and compares
 * base64 would fail on every checkout — the classic non-deterministic-build
 * false alarm.
 *
 * What IS deterministic is the tarball's *contents*. Tar stores file bodies
 * verbatim, so gunzipping the bundle and looking for the real source text is a
 * genuine drift check with none of the flakiness. That's what the test does.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = join(
  REPO_ROOT,
  "infra",
  "openclaw-runtime",
  "plugins",
  "maya-tools"
);
const OUTPUT_PATH = join(
  REPO_ROOT,
  "convex",
  "agents",
  "packs",
  "maya",
  "bundledPlugin.ts"
);

function packPlugin(): { tgzPath: string; bytes: Buffer } {
  // Clear stale tarballs so we always read the one we just built.
  for (const name of readdirSync(PLUGIN_DIR)) {
    if (name.endsWith(".tgz")) rmSync(join(PLUGIN_DIR, name));
  }
  // Honors the package.json `files` allowlist — index.js, the manifest,
  // package.json, README. No node_modules.
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
  ) as { contracts?: { tools?: string[] } };
  return manifest.contracts?.tools ?? [];
}

function renderModule(b64: string, sha: string, tools: string[]): string {
  return `/**
 * AUTO-GENERATED. DO NOT EDIT BY HAND.
 *
 * Run \`npm run sync:maya-plugin\` to regenerate from
 * \`infra/openclaw-runtime/plugins/maya-tools/\`.
 *
 * The base64 below is the packed \`maya-tools\` OpenClaw tool plugin (an npm
 * pack tarball). The deploy action decodes it, stores it as a Convex storage
 * blob, and the Fly bootstrap installs it with
 * \`openclaw plugins install npm-pack:<tgz>\` before the gateway serves a turn.
 *
 * The hash below changes on every pack even when nothing changed — npm embeds
 * mtimes. It's a sync-time integrity check, not a content fingerprint; the
 * drift test reads the tarball's contents instead.
 */

/** Plugin id — must match \`plugins.allow\` in the gateway config. */
export const BUNDLED_MAYA_PLUGIN_ID = "maya-tools";

/** Filename the bootstrap writes the tarball to. */
export const BUNDLED_MAYA_PLUGIN_TGZ_NAME = "maya-tools.tgz";

/** sha256 of this particular packed tarball. */
export const BUNDLED_MAYA_PLUGIN_TGZ_SHA256 = ${JSON.stringify(sha)};

/** Tool names the plugin registers — the cold-discovery contract. */
export const BUNDLED_MAYA_PLUGIN_TOOLS: readonly string[] = ${JSON.stringify(
    tools,
    null,
    2
  )};

/** base64 of the packed npm tarball. */
export const BUNDLED_MAYA_PLUGIN_TGZ_BASE64 =
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
    `Wrote maya plugin bundle (${tools.length} tools, ${bytes.length} bytes tgz, sha256 ${sha.slice(0, 12)}) → ${OUTPUT_PATH}`
  );
}

if (process.argv[1] && process.argv[1].endsWith("sync-maya-plugin.ts")) {
  main();
}
