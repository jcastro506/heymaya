/**
 * ⭐ Sprint 9's storyboard check (§7.5.36) — the pause that costs nothing.
 *
 * The ordering is the contract: everything expensive is decided BEFORE the
 * founder is asked, and the founder is asked BEFORE a credit is spent. Both
 * halves are pure here, so they can be argued with without a vendor key.
 */

import { describe, expect, it } from "vitest";
import {
  buildBrief,
  storyboard,
  storyboardMessage,
  antiSlop,
  MIN_BROLL_SCENES,
  type VideoBrief,
} from "../videoBrief";
import type { Id } from "../../_generated/dataModel";

const IDEA = "idea_1" as Id<"ideas">;
const asset = (n: number) => ({
  assetId: `asset_${n}` as Id<"mediaAssets">,
  url: `https://cdn.example.com/shot-${n}.png`,
});

const base = {
  rung: "avatar" as const,
  ideaId: IDEA,
  script: "You shipped it. Nobody came. Here's the thirty seconds that fixes that.",
  lines: ["You shipped it.", "Nobody came.", "Here's what changes it."],
  assets: [asset(1), asset(2), asset(3)],
  hasProductTruth: true,
};

describe("the brief refuses rather than inventing", () => {
  /**
   * ⚠️ THE case that matters, and the live one. `mediaAssets` was empty on
   * 2026-08-17 while three of four channels need a vertical asset. §2.7's floor
   * covers images: a fabricated UI is the one thing this system may not
   * produce, and "the brief called for a dashboard" is exactly the
   * innocent-sounding reason it would get made.
   */
  it("⭐ will not build a video with no real shot of the product", () => {
    const out = buildBrief({ ...base, assets: [] });
    expect(out.ok).toBe(false);
    expect(out.failure).toBe("no_assets");
    // Says what it needs, in the founder's words — never "asset library empty".
    expect(out.detail).toMatch(/screen recording|screenshots/i);
    expect(out.detail).not.toMatch(/asset|library|rung|render/i);
  });

  it("⚠️ one shot is a slideshow, not a video", () => {
    const out = buildBrief({ ...base, assets: [asset(1)] });
    expect(out.ok).toBe(false);
    expect(out.failure).toBe("too_few_assets");
  });

  it("refuses when it has no product truth to write from", () => {
    const out = buildBrief({ ...base, hasProductTruth: false });
    expect(out.ok).toBe(false);
    expect(out.failure).toBe("no_product_truth");
  });

  it("refuses an empty script rather than shipping a silent cut", () => {
    const out = buildBrief({ ...base, script: "   " });
    expect(out.ok).toBe(false);
    expect(out.failure).toBe("no_script");
  });

  it("builds when it has real shots and words for them", () => {
    const out = buildBrief(base);
    expect(out.ok).toBe(true);
    expect(out.brief?.scenes.length).toBeGreaterThanOrEqual(MIN_BROLL_SCENES);
    // ⭐ Every still is a real library URL — this is what makes the storyboard
    // honest rather than representative.
    for (const s of out.brief!.scenes) {
      expect(s.still).toMatch(/^https:\/\//);
    }
  });

  it("⭐ every image handed to the vendor is one we picked", () => {
    /**
     * §7.6.2: we ALWAYS use `link_with_params` and never let Creatify scrape.
     * So `imageUrls` must be the library's URLs — the approval step and the
     * grounding rule are the same mechanism seen from two ends (§7.5.36).
     */
    const out = buildBrief(base);
    expect(out.brief?.imageUrls).toEqual([
      asset(1).url,
      asset(2).url,
      asset(3).url,
    ]);
  });
});

describe("the storyboard the founder reads", () => {
  it("⭐ shows the exact frame and the exact line, numbered", () => {
    const out = buildBrief(base);
    const frames = storyboard(out.brief!);
    expect(frames[0].index).toBe(1);
    expect(frames.every((f) => f.still.startsWith("https://"))).toBe(true);
    expect(frames.every((f) => f.line.length > 0)).toBe(true);
  });

  it("⚠️ says nothing technical — it asks one question", () => {
    const out = buildBrief(base);
    const msg = storyboardMessage(storyboard(out.brief!));
    // §11 / acceptance item 7. No vendor, no rung, no scene-kind enum.
    expect(msg).not.toMatch(/creatify|persona|broll|b-roll|rung|render queue|credits?/i);
    // And it makes the "nothing spent yet" promise explicit, because that is
    // the whole reason the founder should feel free to reject a frame.
    //
    // ⚠️ "made", not "rendered" — §11. "Rendered" is our word for it, and the
    // founder is being asked a question about their own product, not about our
    // pipeline.
    expect(msg).toMatch(/nothing's been made yet/i);
  });

  it("names the avatar frame in the founder's language", () => {
    const out = buildBrief({
      ...base,
      persona: { id: "p_1", previewImage: "https://cdn.example.com/persona.png" },
    });
    const frames = storyboard(out.brief!);
    expect(frames[0].what).toBe("the presenter");
    expect(frames[1].what).toBe("your screenshot");
  });
});

describe("the pitch leads with why, not with the frames", () => {
  /**
   * ⭐ The operator's own words for what he wanted: *"I just had an idea. I saw
   * something on TikTok that inspired me. I want to make this for you, and it's
   * going to go like this. Here's the idea, and here are some images. What do
   * you think?"*
   *
   * ⚠️ The first version opened on "here's what I'd make, frame by frame" —
   * accurate, and it read like a form. It is also the honest thing to lead
   * with: the whole product is that she borrows shapes that demonstrably
   * travelled in this niche, and a storyboard that hides its source asks for a
   * yes on taste rather than on evidence.
   */
  it("⭐ names what inspired it, and links it", () => {
    const out = buildBrief(base);
    const msg = storyboardMessage(storyboard(out.brief!), {
      shape: "opens on the objection and answers it in one line",
      sourceUrl: "https://www.tiktok.com/@someone/video/123",
      channel: "tiktok",
    });
    expect(msg).toMatch(/had an idea/i);
    expect(msg).toContain("opens on the objection");
    // §6 — a source you can't open isn't a source.
    expect(msg).toContain("https://www.tiktok.com/@someone/video/123");
    expect(msg).toContain("tiktok");
  });

  it("⚠️ invents no inspiration when there is none", () => {
    /**
     * With an empty format library she is building from the idea bank alone.
     * Claiming something "caught her eye" would be a fabricated observation —
     * §2.7, and the exact failure mode the whole storyboard exists to avoid.
     */
    const out = buildBrief(base);
    const msg = storyboardMessage(storyboard(out.brief!), null);
    expect(msg).toMatch(/had an idea/i);
    expect(msg).not.toMatch(/caught my eye|inspired/i);
  });

  it("⚠️ still promises nothing has been made yet", () => {
    // The whole reason the founder should feel free to reject a frame.
    const out = buildBrief(base);
    const msg = storyboardMessage(storyboard(out.brief!), null);
    expect(msg).toMatch(/nothing's been made yet/i);
  });

  it("⚠️ and still leaks nothing technical", () => {
    const out = buildBrief(base);
    const msg = storyboardMessage(storyboard(out.brief!), {
      shape: "a shape",
      sourceUrl: "https://x.com/1",
      channel: "tiktok",
    });
    expect(msg).not.toMatch(/creatify|persona|rung|format card|credits?|render queue/i);
  });
});

describe("anti-slop, as checks rather than vibes", () => {
  const brief = (over: Partial<VideoBrief>): VideoBrief => ({
    rung: "avatar",
    ideaId: IDEA,
    scenes: [
      { kind: "broll", still: "https://a/1.png", line: "one" },
      { kind: "broll", still: "https://a/2.png", line: "two" },
    ],
    script: "s",
    length: 30,
    imageUrls: ["https://a/1.png"],
    ...over,
  });

  it("passes a cut made of distinct real shots", () => {
    expect(antiSlop(brief({}))).toEqual([]);
  });

  it("⭐ flags a video with no real footage", () => {
    const out = antiSlop(
      brief({
        scenes: [
          { kind: "avatar", still: "https://a/p.png", line: "one" },
          { kind: "avatar", still: "https://a/p.png", line: "two" },
        ],
      })
    );
    expect(out.join(" ")).toMatch(/no real footage/i);
  });

  it("⚠️ flags the same shot repeating — the slideshow tell", () => {
    const out = antiSlop(
      brief({
        scenes: [
          { kind: "broll", still: "https://a/1.png", line: "one" },
          { kind: "broll", still: "https://a/1.png", line: "two" },
          { kind: "broll", still: "https://a/1.png", line: "three" },
        ],
      })
    );
    expect(out.join(" ")).toMatch(/same shot repeats/i);
  });

  it("⭐ flags a hook that is explained rather than shown", () => {
    /**
     * §7.5.3: "is the hook shown rather than explained". Opening on a talking
     * head when there is real product footage available is the single most
     * common way an otherwise-fine video reads as an ad.
     */
    const out = antiSlop(
      brief({
        scenes: [
          { kind: "avatar", still: "https://a/p.png", line: "let me tell you" },
          { kind: "broll", still: "https://a/1.png", line: "two" },
        ],
      })
    );
    expect(out.join(" ")).toMatch(/opens on someone explaining/i);
  });

  it("⚠️ reasons are founder-readable, not internal", () => {
    // These strings reach the founder when a render is held, so they follow the
    // same rule as everything else she says.
    const out = antiSlop(
      brief({
        scenes: [
          { kind: "avatar", still: "https://a/p.png", line: "one" },
          { kind: "avatar", still: "https://a/p.png", line: "two" },
        ],
      })
    );
    expect(out.join(" ")).not.toMatch(/scene\.kind|broll|enum|null/i);
  });
});
