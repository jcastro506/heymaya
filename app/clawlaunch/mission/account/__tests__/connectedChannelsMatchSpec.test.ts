/**
 * The connect panel is a product boundary, not a menu.
 *
 * A channel offered there is a channel a founder can connect, and a connected
 * channel is one Maya will eventually post to under their name. So the offered
 * set has to match the channels the spec actually ships — and it has to keep
 * matching, which is what this test is for.
 *
 * ⭐ Three, not four, since 2026-08-18. X was dropped: it is the one channel
 * that is not UGC video, and removing it makes the 3x multiplier clean — one
 * 9:16 asset, three placements, no text-only special case.
 *
 * Reads the component source rather than importing it: the file is a React
 * client component with Convex hooks, and standing up that environment to read
 * one constant would be a lot of machinery for a list of three strings.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  join(__dirname, "../_ConnectedAccounts.tsx"),
  "utf8"
);

/** The `key: "..."` values inside the OFFERED array. */
function offeredChannels(): string[] {
  const block = /const OFFERED[\s\S]*?\n\];/.exec(SOURCE);
  expect(block, "OFFERED array not found — did the constant get renamed?").toBeTruthy();
  return [...block![0].matchAll(/key:\s*"([a-z]+)"/g)].map((m) => m[1]);
}

describe("the connect panel offers exactly the three shipped channels", () => {
  it("offers Instagram, YouTube and TikTok", () => {
    expect(offeredChannels().sort()).toEqual([
      "instagram",
      "tiktok",
      "youtube",
    ]);
  });

  it("⭐ NEVER offers X — dropped as the one non-UGC-video channel", () => {
    /**
     * ⚠️ Asserted as an ABSENCE, deliberately, so re-adding it is a decision
     * someone has to make here rather than a card someone quietly adds. The
     * schema and live `channels` rows still carry "x" — narrowing those needs
     * a migration on both deployments and must wait until video is publishing
     * (14 of 16 recent placements went to X, so removing it early would drive
     * the cadence gate toward zero). This pins the OFFER, which is the half
     * that is safe to remove now.
     */
    expect(offeredChannels()).not.toContain("x");
  });

  it("NEVER offers Reddit — dropped on ban risk, not capability", () => {
    // Replying on Reddit does work; it was live-proven 2026-07-25. That's the
    // trap. It works right up until the account is gone, and the account is
    // the founder's own name. Reddit has been tightening on API and
    // AI-assisted posting, so a working integration is not evidence of a safe
    // one.
    expect(offeredChannels()).not.toContain("reddit");
  });

  it("NEVER offers LinkedIn — wrong modality", () => {
    // The only non-vertical-video channel. Dropping it turns one 9:16 asset
    // into three placements instead of two plus a bespoke one.
    expect(offeredChannels()).not.toContain("linkedin");
  });

  it("TikTok is one-tap, not auto — its preview consent is a platform rule", () => {
    const block = /const OFFERED[\s\S]*?\n\];/.exec(SOURCE)![0];
    const tiktokLine = block
      .split("\n")
      .find((l) => l.includes('key: "tiktok"'));
    expect(tiktokLine).toContain("auto: false");
  });

  it("the other two auto-post once connected", () => {
    const block = /const OFFERED[\s\S]*?\n\];/.exec(SOURCE)![0];
    for (const channel of ["instagram", "youtube"]) {
      const line = block
        .split("\n")
        .find((l) => l.includes(`key: "${channel}"`));
      expect(line, channel).toContain("auto: true");
    }
  });
});
