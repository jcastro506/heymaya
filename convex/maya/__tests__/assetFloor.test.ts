/**
 * ⭐ The video authenticity floor (§7.5.3) — ordering enforced in code.
 *
 * §7.5.2's anti-slop system is entirely about TEXT, and three of four channels
 * are video-first. §7.5.3 names the video tells, and the worst of them is the
 * one we were most likely to ship by accident:
 *
 * > **AI avatars — the single most instantly-recognisable one.**
 *
 * ⚠️ §7.6.5a records the failure this prevents: `startUgcVideoJob` computed
 * `useV2 = wantsScenes && Boolean(overrideAvatar)`, so **no avatar picked
 * quietly became a single-scene video** with a provider default. The founder
 * got an AI talking head they never agreed to, and nothing said so.
 *
 * The avatar is not the defect. The SILENCE is.
 */
import { describe, expect, it } from "vitest";
import { ASSET_RANK, needsStating, planAssets } from "../assetFloor";

const url = (n: string) => `https://cdn.test/${n}`;

describe("the ordering §7.5.3 requires", () => {
  it("founder footage beats everything", () => {
    // §6.0.1: "that's the best-performing content there is."
    const plan = planAssets([
      { kind: "avatar", url: url("avatar") },
      { kind: "product_screenshot", url: url("shot") },
      { kind: "founder_footage", url: url("clip") },
      { kind: "screen_recording", url: url("rec") },
    ]);
    expect(plan.using[0].kind).toBe("founder_footage");
    expect(plan.usesAvatar).toBe(false);
  });

  it("a real screen recording beats a screenshot, which beats a background", () => {
    const plan = planAssets([
      { kind: "generated_background", url: url("bg") },
      { kind: "product_screenshot", url: url("shot") },
      { kind: "screen_recording", url: url("rec") },
    ]);
    expect(plan.using.map((a) => a.kind)).toEqual([
      "screen_recording",
      "product_screenshot",
      "generated_background",
    ]);
  });

  it("the avatar is genuinely last in the rank", () => {
    expect(ASSET_RANK[ASSET_RANK.length - 1]).toBe("avatar");
  });

  it("an asset with no URL is a claim, not an asset", () => {
    const plan = planAssets([
      { kind: "founder_footage" },
      { kind: "product_screenshot", url: url("shot") },
    ]);
    expect(plan.using.map((a) => a.kind)).toEqual(["product_screenshot"]);
    // And the missing footage is reported, since it would have been better.
    expect(plan.missing.map((m) => m.kind)).toContain("founder_footage");
  });
});

describe("⚠️ AN AVATAR IS NEVER A SILENT DEFAULT", () => {
  it("reaching the avatar rung is stated, in the founder's language", () => {
    const plan = planAssets([{ kind: "avatar", url: url("avatar") }]);
    expect(plan.usesAvatar).toBe(true);
    expect(needsStating(plan)).toBe(true);
    // Their words, not ours — they have to be able to veto it.
    expect(plan.detail).toMatch(/generated presenter/);
    expect(plan.detail).not.toMatch(/avatar|lipsync|rank|asset/i);
  });

  it("and it names what would have been better", () => {
    // "Send me one and I'll use that instead" is actionable; "no footage
    // available" is a status.
    const plan = planAssets([{ kind: "avatar", url: url("avatar") }]);
    expect(plan.detail).toMatch(/send me one/i);
  });

  it("anything above the avatar needs no stating", () => {
    // A plan that needs approval for a screenshot is a plan that never ships,
    // and §9.1 keeps the closed set of reasons a post may be held.
    for (const kind of ["founder_footage", "screen_recording", "product_screenshot"] as const) {
      const plan = planAssets([{ kind, url: url(kind) }]);
      expect(needsStating(plan), `${kind} should not need stating`).toBe(false);
    }
  });
});

describe("what it reports missing", () => {
  it("only rungs BETTER than what it's using", () => {
    // Listing every absent kind buries the one that matters: with founder
    // footage in hand, "no avatar available" is noise.
    const plan = planAssets([{ kind: "founder_footage", url: url("clip") }]);
    expect(plan.missing).toEqual([]);
  });

  it("names the best missing rung first", () => {
    const plan = planAssets([{ kind: "product_screenshot", url: url("shot") }]);
    expect(plan.missing[0].kind).toBe("founder_footage");
    expect(plan.missing[0].why).toMatch(/few seconds of you/);
  });

  it("nothing at all is a real answer, not a crash", () => {
    const plan = planAssets([]);
    expect(plan.using).toEqual([]);
    expect(plan.usesAvatar).toBe(false);
    expect(plan.detail).toBe("nothing to build this from yet");
  });
});
