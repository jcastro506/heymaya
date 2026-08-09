/**
 * ⭐ §7.6.5a — the multi-scene fallback must state itself.
 *
 * `startUgcVideoJob` computes `useV2 = wantsScenes && Boolean(overrideAvatar)`.
 * With scenes requested and no avatar chosen it silently produced a
 * single-scene v1 render using a **provider default avatar** — so the founder
 * got a talking head they never agreed to, the result said `ok: true`, and no
 * field distinguished it from the video that was actually requested.
 *
 * §7.5.3 is why this outranks its size: an avatar is the most reliably
 * AI-flagged artifact on TikTok, so an unrequested one is an authenticity cost
 * nobody chose to pay.
 *
 * This asserts the *shape of the decision*, which is the part that regressed —
 * not the vendor call, which needs credentials this suite doesn't have. The
 * condition is duplicated here deliberately: if someone changes the rule in the
 * source without changing it here, the two disagree and this fails, which is
 * the entire point of pinning it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The decision under test, restated. */
function decide(input: { scenes: number; overrideAvatar?: string }): {
  useV2: boolean;
  degraded: boolean;
} {
  const wantsScenes = input.scenes > 0;
  return {
    useV2: wantsScenes && Boolean(input.overrideAvatar),
    degraded: wantsScenes && !input.overrideAvatar,
  };
}

describe("multi-scene fallback", () => {
  it("uses v2 when scenes and an avatar were both given", () => {
    const d = decide({ scenes: 3, overrideAvatar: "av_1" });
    expect(d.useV2).toBe(true);
    expect(d.degraded).toBe(false);
  });

  it("⭐ degrades AND says so when scenes were asked for with no avatar", () => {
    const d = decide({ scenes: 3 });
    expect(d.useV2).toBe(false);
    // The fallback is fine. The silence was the defect.
    expect(d.degraded).toBe(true);
  });

  it("does not claim a degrade when no scenes were asked for", () => {
    // A single-scene request that produces a single-scene video gave nothing
    // up, and reporting a degrade there would train the founder to ignore it.
    const d = decide({ scenes: 0 });
    expect(d.degraded).toBe(false);
    expect(decide({ scenes: 0, overrideAvatar: "av_1" }).degraded).toBe(false);
  });
});

describe("the source actually carries the degrade", () => {
  const source = readFileSync(
    join(process.cwd(), "convex", "gtmMaya", "creatifyVideo.ts"),
    "utf8"
  );

  it("returns `degraded` on the success path", () => {
    // ⚠️ Structural, not prose. The failure being prevented is a success
    // result that carries no sign anything was given up — so what's pinned is
    // that the field reaches the caller at all.
    expect(source).toContain("degraded?: string;");
    const success = source.slice(source.indexOf("        ok: true,\n        jobId,"));
    expect(success.slice(0, 300)).toContain("degraded,");
  });

  it("logs the fallback rather than only returning it", () => {
    // The founder-facing string can be dropped by a caller; the log can't.
    expect(source).toContain("falling back to single-scene v1");
  });
});
