/**
 * The packed plugin bundle.
 *
 * ## Why this doesn't re-pack and diff
 *
 * `npm pack` embeds mtimes, so two packs of byte-identical sources produce
 * different tarballs and different hashes. A test that re-packs and compares
 * base64 would fail on every fresh checkout — a non-deterministic-build false
 * alarm, and the kind of test that gets deleted rather than fixed.
 *
 * What IS deterministic is the tarball's *contents*. Tar stores file bodies
 * verbatim, so gunzipping the bundle and looking for the real source text is a
 * genuine drift check with none of the flakiness — and it's a stronger one,
 * because it proves the shipped bytes contain the code we think they do rather
 * than merely that two hashes agree.
 */

import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUNDLED_MAYA_PLUGIN_ID,
  BUNDLED_MAYA_PLUGIN_TGZ_BASE64,
  BUNDLED_MAYA_PLUGIN_TGZ_NAME,
  BUNDLED_MAYA_PLUGIN_TGZ_SHA256,
  BUNDLED_MAYA_PLUGIN_TOOLS,
} from "../bundledPlugin";

const PLUGIN_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "infra",
  "openclaw-runtime",
  "plugins",
  "maya-tools"
);

const tarballBytes = Buffer.from(BUNDLED_MAYA_PLUGIN_TGZ_BASE64, "base64");
/** Tar stores file bodies uncompressed, so this contains the sources verbatim. */
const tarText = gunzipSync(tarballBytes).toString("utf8");

describe("the bundle is a real, installable tarball", () => {
  it("is valid gzip and decodes to something substantial", () => {
    // A truncated or mangled base64 would install as a corrupt tarball and the
    // machine would boot with NO tools — which reads as an agent that ignores
    // every instruction, not as a broken install.
    expect(tarballBytes.length).toBeGreaterThan(1_000);
    expect(tarText.length).toBeGreaterThan(tarballBytes.length);
  });

  it("is gzip by magic number, not just by extension", () => {
    expect(tarballBytes[0]).toBe(0x1f);
    expect(tarballBytes[1]).toBe(0x8b);
  });

  it("the recorded sha256 matches the recorded base64", () => {
    // Internal consistency: the two exported constants must describe the same
    // bytes, or the integrity check is checking nothing.
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const actual = createHash("sha256").update(tarballBytes).digest("hex");
    expect(actual).toBe(BUNDLED_MAYA_PLUGIN_TGZ_SHA256);
  });

  it("carries the files npm was told to pack, and no node_modules", () => {
    for (const file of ["index.js", "openclaw.plugin.json", "package.json"]) {
      expect(tarText, `${file} missing from the tarball`).toContain(file);
    }
    expect(tarText).not.toContain("node_modules/");
  });
});

describe("THE SHIPPED BYTES MATCH THE SOURCE", () => {
  it("the packed index.js contains the real transport code", () => {
    // The drift that matters: someone edits index.js and forgets to re-run
    // `npm run sync:maya-plugin`, so the machine ships yesterday's tools while
    // the repo shows today's. Distinctive, load-bearing lines — not prose.
    const source = readFileSync(join(PLUGIN_DIR, "index.js"), "utf8");
    const markers = [
      'authorization: `Bearer ${agentToken()}`',
      'if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed;',
      'readEnv("MAYA_AGENT_TOKEN")',
    ];
    for (const marker of markers) {
      expect(source, `marker stale vs source: ${marker}`).toContain(marker);
      expect(tarText, `tarball is stale — re-run npm run sync:maya-plugin`).toContain(
        marker
      );
    }
  });

  it("every registered tool's execute call is in the shipped bytes", () => {
    for (const tool of BUNDLED_MAYA_PLUGIN_TOOLS) {
      expect(tarText).toContain(`call("${tool}", p, ctx.signal)`);
    }
  });

  it("⭐ THE MANIFEST AND index.js REGISTER THE SAME TOOLS", () => {
    /**
     * Sibling-file coherence, and it has already bitten once.
     *
     * `sync-maya-plugin.ts` reads the tool list from `contracts.tools` in the
     * manifest, NOT from the code. So adding `tool({ name: "inbox" })` to
     * index.js and forgetting the manifest packs a tarball that *contains* the
     * tool while every consumer — cold discovery, the workspace prose, this
     * bundle's export — believes it does not exist.
     *
     * It fails the quietest possible way: the plugin loads, the tool works if
     * called, and nothing ever tells her it's there.
     */
    const source = readFileSync(join(PLUGIN_DIR, "index.js"), "utf8");
    const registered = [...source.matchAll(/tool\(\{\s*name:\s*"([a-z_]+)"/g)].map(
      (m) => m[1]
    );
    const manifest = JSON.parse(
      readFileSync(join(PLUGIN_DIR, "openclaw.plugin.json"), "utf8")
    ) as { contracts: { tools: string[] } };

    expect(registered.length).toBeGreaterThan(0);
    expect([...registered].sort()).toEqual([...manifest.contracts.tools].sort());
  });

  it("the packed manifest declares the same tools as the bundle's export", () => {
    const manifest = JSON.parse(
      readFileSync(join(PLUGIN_DIR, "openclaw.plugin.json"), "utf8")
    ) as { id: string; contracts: { tools: string[] } };
    expect([...BUNDLED_MAYA_PLUGIN_TOOLS].sort()).toEqual(
      [...manifest.contracts.tools].sort()
    );
    expect(BUNDLED_MAYA_PLUGIN_ID).toBe(manifest.id);
  });
});

describe("the install contract", () => {
  it("ships exactly the tools this build supports", () => {
    // `checkpoint` joined in Sprint 2.9 — it mirrors MEMORY.md off the machine,
    // which is the one artifact on the volume that isn't reproducible.
    // `inbox` joined in Sprint 5 — `reply` had refused without an `inReplyTo`
    // since Sprint 3 and nothing could produce one, so half the product
    // ("answers everyone who replies") had no input at all.
    expect([...BUNDLED_MAYA_PLUGIN_TOOLS].sort()).toEqual([
      "ask_founder",
      "checkpoint",
      "draft",
      "history",
      "inbox",
      "publish",
      "remember",
      "reply",
      "request_assets",
      "rules",
      "scroll",
      "update",
      "weekly_read",
    ]);
  });

  it("the tgz filename matches the plugin id", () => {
    // The bootstrap writes the blob to this name and installs it by path; a
    // mismatch is a boot that silently comes up with no tools.
    expect(BUNDLED_MAYA_PLUGIN_TGZ_NAME).toBe(`${BUNDLED_MAYA_PLUGIN_ID}.tgz`);
  });

  it("is not the frozen v1 plugin", () => {
    // Separate id, separate credential, separate blast radius. A machine
    // mid-migration can carry both, and installing v1's tools on a v2 machine
    // would point every call at /lc_gtm/*.
    expect(BUNDLED_MAYA_PLUGIN_ID).not.toBe("maya-gtm-tools");
    expect(tarText).not.toContain("lc_gtm");
  });
});
