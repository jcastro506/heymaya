/**
 * `adapt-crosspost` — the three hard rules, checked without a model.
 *
 * §3433 names them: never carbon-copy across channels, hashtags come from mined
 * sets and are never invented, honour per-channel counts.
 *
 * All three fail *silently* if only a prompt carries them. A carbon-copied
 * caption looks fine in isolation, an invented hashtag looks like a hashtag,
 * and a fifth tag on X looks like enthusiasm. Nothing errors — which is exactly
 * why the enforcement is code and why it's tested here.
 */

import { describe, expect, it } from "vitest";
import {
  TAG_CEILING,
  capTags,
  carbonCopies,
  keepMinedTags,
  normaliseCaption,
  normaliseTag,
  parseVariants,
  type ChannelVariant,
} from "../crosspost";

const variant = (channel: string, caption: string): ChannelVariant => ({
  channel,
  caption,
  hashtags: [],
});

describe("keepMinedTags", () => {
  /**
   * ⭐ §7.5.9: "hashtags are selected from mined sets, never invented."
   *
   * A model asked for tags always produces plausible ones, and a plausible tag
   * with no audience behind it is indistinguishable from a good one until it
   * reaches nobody.
   */
  it("drops anything that wasn't mined", () => {
    const { kept, dropped } = keepMinedTags(
      ["#solofounder", "#buildinpublic", "#saas"],
      ["solofounder", "saas"]
    );
    expect(kept).toEqual(["solofounder", "saas"]);
    expect(dropped).toEqual(["#buildinpublic"]);
  });

  it("matches regardless of case or a leading hash", () => {
    // That's presentation. Rejecting #SoloFounder when solofounder was mined
    // would drop a correct tag on a technicality.
    const { kept } = keepMinedTags(["#SoloFounder", "SAAS"], ["solofounder", "saas"]);
    expect(kept).toEqual(["solofounder", "saas"]);
  });

  it("returns the mined spelling, not the model's", () => {
    // The mined form is the one that was observed working.
    const { kept } = keepMinedTags(["#BuildInPublic"], ["buildinpublic"]);
    expect(kept).toEqual(["buildinpublic"]);
  });

  it("keeps a repeat only once", () => {
    const { kept } = keepMinedTags(["#saas", "#SaaS", "saas"], ["saas"]);
    expect(kept).toEqual(["saas"]);
  });

  it("keeps nothing when nothing was mined", () => {
    // An empty set is a real answer. The caller posts with no hashtags.
    const { kept, dropped } = keepMinedTags(["#anything"], []);
    expect(kept).toEqual([]);
    expect(dropped).toEqual(["#anything"]);
  });
});

describe("capTags", () => {
  it("holds X to two, which §3433 names explicitly", () => {
    // More than that reads as spam and marks the account as automated.
    expect(capTags("x", ["a", "b", "c", "d"])).toHaveLength(2);
    expect(TAG_CEILING.x).toBe(2);
  });

  it("gives the video channels more room than X", () => {
    expect(capTags("tiktok", ["a", "b", "c", "d", "e", "f"])).toHaveLength(5);
    expect(capTags("youtube", ["a", "b", "c", "d"])).toHaveLength(3);
  });

  it("caps an unknown channel rather than letting it through uncapped", () => {
    // Fail toward the conservative number — an uncapped new channel is how a
    // thirty-tag caption ships.
    expect(capTags("threads", ["a", "b", "c", "d", "e"]).length).toBeLessThanOrEqual(3);
  });

  it("leaves a short list alone", () => {
    expect(capTags("tiktok", ["a"])).toEqual(["a"]);
  });
});

describe("carbonCopies", () => {
  /**
   * ⭐ §3433: identical captions across TikTok/Reels/Shorts are "a recognizable
   * tell". This is the check that makes the rule true rather than requested.
   */
  it("catches the same caption on two channels", () => {
    const groups = carbonCopies([
      variant("tiktok", "shipped the thing nobody asked for"),
      variant("instagram", "shipped the thing nobody asked for"),
      variant("x", "three days, one email, whole roadmap changed"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual(["instagram", "tiktok"]);
  });

  /**
   * ⚠️ The tell survives cosmetic edits. Someone who follows the account on two
   * platforms sees the same caption whether or not the emoji matches — and that
   * is exactly who notices.
   */
  it("still catches it through casing, emoji and swapped hashtags", () => {
    const groups = carbonCopies([
      variant("tiktok", "shipped the thing nobody asked for #buildinpublic"),
      variant("instagram", "Shipped the thing nobody asked for! 🚀 #saas"),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("passes captions that genuinely differ", () => {
    expect(
      carbonCopies([
        variant("tiktok", "nobody asked for it. one person needed it."),
        variant("instagram", "three days of work, one email, and the roadmap changed"),
      ])
    ).toEqual([]);
  });

  it("groups all three when every channel got the same words", () => {
    const groups = carbonCopies([
      variant("tiktok", "same"),
      variant("instagram", "same"),
      variant("youtube", "same"),
    ]);
    expect(groups[0]).toHaveLength(3);
  });
});

describe("normalisers", () => {
  it("strips hashtags and punctuation from a caption comparison", () => {
    expect(normaliseCaption("Hello, world! #tag")).toBe("hello world");
  });

  it("strips the hash and case from a tag", () => {
    expect(normaliseTag("#SoloFounder")).toBe("solofounder");
    expect(normaliseTag("  saas ")).toBe("saas");
  });
});

describe("parseVariants", () => {
  const json = (variants: unknown) => JSON.stringify({ variants });

  /**
   * ⚠️ A helpful extra channel would produce a variant for an account the
   * founder hasn't connected — and publish would then fail confusingly, or post
   * somewhere unexpected.
   */
  it("ignores a channel that wasn't asked for", () => {
    const out = parseVariants(
      json([
        { channel: "tiktok", caption: "a" },
        { channel: "linkedin", caption: "b" },
      ]),
      ["tiktok"]
    );
    expect(out.map((v) => v.channel)).toEqual(["tiktok"]);
  });

  it("keeps a title only for YouTube", () => {
    // A title is YouTube's and meaningless elsewhere — §7.5.9: title and
    // thumbnail dominate there and nowhere else.
    const out = parseVariants(
      json([
        { channel: "youtube", caption: "c", title: "the title" },
        { channel: "tiktok", caption: "d", title: "not a thing here" },
      ]),
      ["youtube", "tiktok"]
    );
    expect(out.find((v) => v.channel === "youtube")?.title).toBe("the title");
    expect(out.find((v) => v.channel === "tiktok")?.title).toBeUndefined();
  });

  it("drops a variant with no caption", () => {
    expect(parseVariants(json([{ channel: "tiktok", caption: "  " }]), ["tiktok"])).toEqual([]);
  });

  it("takes the first when a channel appears twice", () => {
    const out = parseVariants(
      json([
        { channel: "x", caption: "first" },
        { channel: "x", caption: "second" },
      ]),
      ["x"]
    );
    expect(out).toHaveLength(1);
    expect(out[0].caption).toBe("first");
  });

  it("returns nothing for output that isn't a plan", () => {
    expect(parseVariants("sorry, I can't", ["x"])).toEqual([]);
    expect(parseVariants(json("nope"), ["x"])).toEqual([]);
  });
});
