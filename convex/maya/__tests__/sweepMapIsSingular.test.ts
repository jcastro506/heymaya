/**
 * ⚠️ There must be exactly ONE map from sweep name to function reference.
 *
 * `watchers.ts` carried two: `sweepRefs()`, which `sweepOne` actually
 * dispatches through, and an inline `const refs` inside the scheduling loop
 * that was declared and never read. They had diverged — 13 entries against 6 —
 * and the missing one was `fillFromProductPage`, whose absence left
 * `mediaAssets` empty and sent 14 of 16 placements to X because the other
 * three channels cannot take a text-only post.
 *
 * The failure mode is what makes this worth a test rather than a comment: a
 * second map does not break anything visibly. Someone adds a sweep to the map
 * they can see, it typechecks, it reads correctly in review, and it never runs.
 * The file's header already claimed this defect was fixed once.
 *
 * Reads source rather than importing, because the thing under test is the
 * SHAPE OF THE FILE, not a runtime value — a duplicate map is invisible at
 * runtime by definition.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(__dirname, "../watchers.ts"), "utf8");

describe("one sweep map, not two", () => {
  it("⭐ exactly one object literal maps sweep names to internal refs", () => {
    /**
     * A sweep map is recognisable by two or more `name: internal.maya.*.fn`
     * entries in one object literal. Counting those is a proxy, but it is the
     * proxy that catches the real defect: a copied map.
     */
    const mapLike = [
      ...SOURCE.matchAll(/\{[^{}]*?internal\.maya\.[a-zA-Z]+\.[a-zA-Z]+[\s\S]*?\}/g),
    ].filter((m) => (m[0].match(/internal\.maya\./g) ?? []).length >= 3);
    expect(
      mapLike.length,
      `found ${mapLike.length} sweep-map-shaped literals; there must be exactly one (sweepRefs)`
    ).toBe(1);
  });

  it("⭐ the one map is the one the dispatcher reads", () => {
    // If these ever drift apart, the map is decorative again.
    expect(SOURCE).toContain("export function sweepRefs()");
    expect(SOURCE).toContain("sweepRefs()[args.sweep]");
  });

  it("⚠️ the media-library sweep is IN it — the entry whose absence cost 14 of 16 placements", () => {
    const block = /export function sweepRefs\(\)[\s\S]*?\n\}/.exec(SOURCE);
    expect(block).toBeTruthy();
    expect(block![0]).toContain("fillFromProductPage");
  });
});
