/**
 * ⭐ TikTok's rendered-preview consent.
 *
 * ⚠️ Nothing in this codebase has ever set `contentPreviewConfirmed` or
 * `expressConsentGiven` — the only occurrences were inside a vendor contract
 * test. TikTok requires a human to see what will be posted and confirm it
 * before an API-published post goes out.
 *
 * The tempting fix is to hardcode both flags true. That is worse than the bug:
 * it is a compliance statement about a human action that never happened, made
 * by a machine, on the founder's account.
 *
 * What's asserted here is the property that makes the record mean anything —
 * consent covers *the thing they looked at*, and stops covering it the moment
 * that thing changes.
 */

import { describe, expect, it } from "vitest";
import { previewFingerprint, tiktokSettingsFor } from "../tiktokConsent";

const base = {
  assetUrls: ["https://cdn/a.png", "https://cdn/b.png"],
  caption: "the feature nobody asked for",
};

describe("previewFingerprint", () => {
  it("is stable for the same preview", () => {
    expect(previewFingerprint(base)).toBe(previewFingerprint({ ...base }));
  });

  /**
   * ⭐ The failure this exists to prevent: a caption edited after approval.
   *
   * A boolean "founder said yes" would authorise the NEXT post rather than the
   * one they saw — so a post-approval tweak ships words nobody confirmed.
   */
  it("changes when a single character of the caption changes", () => {
    expect(previewFingerprint({ ...base, caption: base.caption + "." })).not.toBe(
      previewFingerprint(base)
    );
  });

  it("changes when an asset is swapped, added, or removed", () => {
    expect(
      previewFingerprint({ ...base, assetUrls: ["https://cdn/a.png", "https://cdn/c.png"] })
    ).not.toBe(previewFingerprint(base));
    expect(previewFingerprint({ ...base, assetUrls: ["https://cdn/a.png"] })).not.toBe(
      previewFingerprint(base)
    );
  });

  /**
   * ⚠️ Order matters. A carousel is a sequence — slide 1 decides whether anyone
   * swipes, so a reordered set is a different post and must not inherit
   * consent. Sorting the urls would have let a reshuffle through.
   */
  it("changes when the same slides are reordered", () => {
    expect(
      previewFingerprint({ ...base, assetUrls: [...base.assetUrls].reverse() })
    ).not.toBe(previewFingerprint(base));
  });

  it("ignores only surrounding whitespace on the caption", () => {
    // Trailing whitespace isn't a content change, and treating it as one would
    // make consent fail for a reason no founder could understand.
    expect(previewFingerprint({ ...base, caption: `  ${base.caption}  ` })).toBe(
      previewFingerprint(base)
    );
  });

  it("distinguishes a text-only post from an identical caption with slides", () => {
    expect(previewFingerprint({ assetUrls: [], caption: base.caption })).not.toBe(
      previewFingerprint(base)
    );
  });
});

describe("tiktokSettingsFor", () => {
  it("returns both flags together when consent matched", () => {
    // Sending one without the other asserts one form of consent while lacking
    // the other, which is a shape TikTok has no reading for.
    expect(tiktokSettingsFor({ confirmed: true })).toEqual({
      contentPreviewConfirmed: true,
      expressConsentGiven: true,
    });
  });

  it("returns null — never a partial or a false — when it didn't", () => {
    // Null is what makes the publish path fail closed. A `{confirmed: false}`
    // object would be forwarded to the vendor as an explicit denial of consent
    // rather than an absence of it.
    expect(tiktokSettingsFor({ confirmed: false })).toBeNull();
  });
});
