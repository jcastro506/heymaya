/**
 * Three things about the landing page that broke silently, or nearly did, and
 * are not visible in a screenshot.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LANDING = readFileSync(
  join(process.cwd(), "app/clawlaunch/page.tsx"),
  "utf8",
);
const SPEC = readFileSync(
  join(process.cwd(), "docs/CLEAN_SHEET_SPEC.md"),
  "utf8",
);

/** The CSS that ships inside the JSX template literal in `PageStyles`. */
function styleBlock(): string {
  const fn = LANDING.slice(LANDING.indexOf("function PageStyles("));
  return fn.slice(fn.indexOf("{`") + 2, fn.indexOf("`}"));
}

describe("the stylesheet survives being a template literal", () => {
  it("⚠️ contains no backtick — it would terminate the string", () => {
    /**
     * Broke the build TWICE in one sitting, both times from a CSS *comment*
     * that quoted a property name in backticks the way the rest of this
     * codebase does. Inside <style>{`…`}</style> a backtick ends the literal,
     * so the remaining CSS is parsed as TypeScript and the errors point at
     * whatever brace comes next — never at the quote that caused it.
     *
     * Cheap to prevent, expensive to diagnose, and invisible to review.
     */
    expect(styleBlock()).not.toContain("`");
  });
});

describe("one section per screen actually engages", () => {
  it("⭐ snaps mandatory, not proximity", () => {
    /**
     * Shipped as `proximity` and reported as "still not snapping". Every other
     * value was already right — the root element was the scroller and carried
     * scroll-snap-type, and every section carried scroll-snap-align: start —
     * so strictness was the only variable left.
     *
     * Proximity only engages when a scroll happens to come to REST near a snap
     * point, which under trackpad momentum essentially never happens. It is
     * not a gentler snap; it is usually no snap at all.
     */
    const css = styleBlock();
    // The DECLARATIONS, not the prose — the comment above them explains why
    // proximity was wrong, and that explanation is worth keeping.
    const declared = [...css.matchAll(/scroll-snap-type:\s*([^;]+);/g)].map(
      (m) => m[1].trim(),
    );
    // "none" is the reduced-motion override, and belongs here.
    expect(declared).toContain("y mandatory");
    expect(declared.filter((d) => d !== "none")).toEqual(["y mandatory"]);
    expect(css).toContain("scroll-snap-align: start");
  });

  it("⚠️ stays off for anyone who asked for less motion", () => {
    // Snapping moves the page further than the reader asked it to move, which
    // is exactly what prefers-reduced-motion is about.
    expect(styleBlock()).toContain("prefers-reduced-motion");
  });
});

describe("the price on the page is the price in the spec", () => {
  it("⭐ matches the MVP tier, whatever the spec currently says", () => {
    /**
     * ⚠️ The landing page advertised $99 while §17.2.7 had settled on one tier
     * at $149 — and §17.4 argues the low anchor directly: at ~$45 blended COGS
     * a double-digit price lands near 55% margin and "anchors the product as a
     * tool" rather than an employee.
     *
     * Read from the spec rather than hardcoded, so this test tracks a repricing
     * instead of having to be updated by the person doing it.
     */
    const mvp = SPEC.slice(SPEC.indexOf("**MVP — one tier:**"));
    const priceRow = /\|\s*\*\*Price\*\*\s*\|(.+?)\|/.exec(mvp.slice(0, 900));
    expect(priceRow, "spec no longer states an MVP price").not.toBeNull();

    const price = /\$([\d,]+)/.exec(priceRow![1])![1];
    expect(LANDING).toContain(`$${price}`);
  });

  it("⚠️ states no OTHER dollar figure that could be read as the price", () => {
    /**
     * The $300 anchor is a creator's invoice, deliberately kept. Anything else
     * with a dollar sign on this page is a second number a visitor has to
     * reconcile, and the one that got stale last time was a leftover.
     */
    const mvp = SPEC.slice(SPEC.indexOf("**MVP — one tier:**"));
    const price = /\$([\d,]+)/.exec(
      /\|\s*\*\*Price\*\*\s*\|(.+?)\|/.exec(mvp.slice(0, 900))![1],
    )![1];

    const figures = new Set(
      [...LANDING.matchAll(/\$(\d[\d,]*)/g)].map((m) => m[1]),
    );
    expect([...figures].sort()).toEqual([price, "300"].sort());
  });
});

describe("the page sells three channels, not four", () => {
  /**
   * ⚠️ Eight X references survived the pivot and the OPERATOR found them in a
   * browser, not a test: a tweet card captioned "found on X", an X row in the
   * "real observations" feed, an X chip in the channel list, an X row in the
   * answering matrix, X named in two body-copy sentences, and a `Mark` fallback
   * that rendered an "X" wordmark for ANY unrecognised channel string.
   *
   * The page's whole promise is UGC video on TikTok, Instagram and YouTube.
   * Naming X makes a buyer ask whether they need an X account to get value, and
   * the answer is no — so this is a positioning defect, not a typo.
   *
   * ⚠️ She still READS X. It is the richest perception channel (the only
   * non-TikTok one returning both likes and reply counts), and this test does
   * not forbid that — it forbids SELLING it.
   */
  const CHANNEL_WORDS = /\b(twitter|tweet|tweets|tweeted)\b/i;

  it("⭐ never names Twitter or a tweet", () => {
    const offending = LANDING.split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => CHANNEL_WORDS.test(line));
    expect(
      offending.map(([n, l]) => `${n}: ${l.trim()}`),
      "the page sells TikTok, Instagram and YouTube"
    ).toEqual([]);
  });

  it("⭐ never offers X as a channel a founder connects", () => {
    // The chip list and the answering matrix are the two places it appeared as
    // a first-class channel. Both are `"x"` string literals in data arrays.
    const asChannel = /\[\s*"x"\s*,|\[\s*"X"\s*,\s*"x"\s*\]/g;
    expect(LANDING.match(asChannel) ?? []).toEqual([]);
  });

  it("⚠️ has no fallback glyph that could draw a channel we do not sell", () => {
    /**
     * `Mark` ended with an unconditional X wordmark, so a typo'd or unknown
     * channel string rendered a competitor's logo. The fallback must be null:
     * a missing icon is a papercut, the wrong icon is a claim.
     */
    const mark = /function Mark\([\s\S]*?\n\}/.exec(LANDING);
    expect(mark, "Mark component not found — renamed?").toBeTruthy();
    expect(mark![0]).toContain("return null");
  });

  it("⚠️ the observation feed stays REAL — no invented Instagram row", () => {
    /**
     * Staging has 50 TikTok, 34 X, 2 YouTube and ZERO Instagram observations.
     * The operator asked for more Instagram logos; adding one here would
     * fabricate provenance on a panel whose own comment says these are real
     * (§2.7, grounded or silent). The honest fix was to drop X and leave the
     * gap visible — it is a defect in the Instagram sweep, not in this file.
     *
     * This pins the REASON, so the next person to "just add Instagram" reads it
     * first. Delete this test the day the sweep produces a real one.
     */
    const feed = /const FEED[\s\S]*?\n\];/.exec(LANDING);
    expect(feed).toBeTruthy();
    expect(feed![0]).not.toContain('"instagram"');
    expect(feed![0]).not.toContain('"x"');
  });
});

describe("onboarding's last screen can actually be completed", () => {
  /**
   * ⚠️ THE QR WAS SPEC'D, QUOTED IN A COMMENT, AND NEVER RENDERED. §18.9.25
   * says "③ Pair Telegram — One QR, one button, one line". `/start` carried a
   * comment repeating that sentence verbatim and shipped with only the button.
   * The frozen v1 flow had a working QR the whole time, which is how the
   * operator noticed: they remembered it from the flow that still has it.
   *
   * It is not decoration. On DESKTOP the button opens Telegram Desktop, which
   * most founders do not have — so without a QR, pairing fails for them and
   * onboarding dead-ends on its final screen with no way forward. A signup that
   * cannot be finished is worth the same as no signup.
   */
  const START = readFileSync(join(process.cwd(), "app/start/page.tsx"), "utf8");

  it("⭐ offers a QR as well as the button", () => {
    expect(START).toMatch(/create-qr-code/);
  });

  it("⚠️ the QR encodes the real pairing link, not a placeholder", () => {
    // A QR pointing at anything but `phase.link` sends them somewhere that
    // cannot pair them, and looks completely correct while doing it.
    expect(START).toMatch(/create-qr-code[^`]*encodeURIComponent\(phase\.link\)/);
  });

  it("⚠️ both routes appear together — desktop and phone", () => {
    // The button alone strands desktop users; the QR alone strands anyone
    // already reading on their phone.
    expect(START).toContain("Open Telegram");
    expect(START).toMatch(/Scan this instead/i);
  });
});
