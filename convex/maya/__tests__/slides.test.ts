/**
 * ⭐ The fixed frame (§7.5.1) — coherence by construction.
 *
 * > *"Generate five slides independently from text prompts and you get five
 * > images that don't look like a set… the fix isn't a better image model. It's
 * > to stop generating slides and start filling them."*
 *
 * These tests defend the two claims that make the frame worth having:
 * **nothing about it is re-decided per slide**, and **nothing lands where the
 * platform's own UI will cover it.**
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS,
  NEUTRAL,
  SAFE_BOX,
  TYPE,
  esc,
  renderSet,
  renderSlide,
  resolveTheme,
  wrapLines,
  type SlideLayout,
} from "../slides";
import type { BrandKit } from "../brandKit";

const LAYOUTS: SlideLayout[] = ["title", "screenshot", "point", "comparison", "cta"];

/** A kit with a NAMED palette — a declaration, not an inference. */
const NAMED_KIT: BrandKit = {
  palette: { primary: "#1d4ed8", background: "#ffffff", text: "#111827" },
  fonts: { display: "Söhne", body: "Inter" },
  paletteConfidence: "named",
};

function xs(svg: string): number[] {
  return [...svg.matchAll(/<(?:text|rect|image)[^>]*\bx="(\d+)"/g)].map((m) =>
    Number(m[1])
  );
}

describe("NOTHING ABOUT THE FRAME IS RE-DECIDED", () => {
  it("every layout renders the same canvas", () => {
    for (const layout of LAYOUTS) {
      const svg = renderSlide({ layout, content: { headline: "a headline" } });
      expect(svg).toContain(`width="${CANVAS.width}" height="${CANVAS.height}"`);
    }
  });

  it("every layout starts text at the same left margin", () => {
    // Drift in margins is the most visible tell that slides were made
    // separately, and it is exactly what a per-slide model would produce.
    for (const layout of LAYOUTS) {
      const svg = renderSlide({
        layout,
        content: { headline: "a headline", body: "supporting line", left: "a", right: "b" },
      });
      expect(xs(svg)).toContain(SAFE_BOX.x);
    }
  });

  it("the type scale is fixed, not fitted to the content", () => {
    // A scale that adapts to length is drift with extra steps: the same deck
    // ends up with five headline sizes and reads as five decks.
    const short = renderSlide({ layout: "point", content: { headline: "Short" } });
    const long = renderSlide({
      layout: "point",
      content: { headline: "A very much longer headline that has to wrap onto several lines" },
    });
    for (const svg of [short, long]) {
      expect(svg).toContain(`font-size="${TYPE.headline}"`);
    }
  });

  it("a set renders through one frame and carries its position", () => {
    const set = renderSet({
      slides: [
        { layout: "title", content: { headline: "one" } },
        { layout: "point", content: { headline: "two" } },
        { layout: "cta", content: { headline: "three" } },
      ],
    });
    expect(set).toHaveLength(3);
    for (const svg of set) {
      expect(svg).toContain(`width="${CANVAS.width}"`);
      expect(xs(svg)).toContain(SAFE_BOX.x);
    }
  });

  it("a single slide has no progress rule — there is no set to be in", () => {
    const one = renderSet({ slides: [{ layout: "title", content: { headline: "solo" } }] });
    const bars = [...one[0].matchAll(/height="6"/g)];
    expect(bars).toHaveLength(0);
  });
});

describe("⚠️ NOTHING LANDS UNDER THE PLATFORM'S OWN UI", () => {
  /**
   * A 1080×1920 canvas is not 1080×1920 of usable space. TikTok puts the
   * caption and sound over the bottom and the like/share rail over the right;
   * Reels and Shorts do the same in slightly different places. Text placed by
   * canvas centre lands underneath the UI on the one channel it was made for,
   * and it looks like nobody checked — because nobody did.
   */
  /**
   * ⚠️ These bounds are LITERALS, and that is the point.
   *
   * The first version asserted against `SAFE_BOX.x + SAFE_BOX.width` — so when
   * the safe box was deliberately widened to include the action rail, the
   * assertion widened with it and the test still passed. A test that derives
   * its expectation from the code under test measures nothing.
   *
   * These numbers describe TIKTOK, not our layout. They only change when a
   * platform changes its UI, and then someone should have to come here and say
   * so.
   */
  const RAIL_STARTS_AT = 860; // 1080 canvas − 220 action rail
  const CONTENT_TOP = 250;
  const CONTENT_BOTTOM = 1520; // 1920 − 400 caption block

  it("no text starts inside the right-hand action rail", () => {
    const railStart = RAIL_STARTS_AT;
    for (const layout of LAYOUTS) {
      const svg = renderSlide({
        layout,
        content: {
          headline: "a headline long enough to wrap a couple of times over",
          body: "and a supporting sentence underneath it",
          left: "left column",
          right: "right column",
        },
      });
      for (const m of svg.matchAll(/<text[^>]*\bx="(\d+)"/g)) {
        expect(Number(m[1]), `${layout} text at x=${m[1]}`).toBeLessThan(railStart);
      }
    }
  });

  it("no text sits above the safe top or below the safe bottom", () => {
    const bottom = CONTENT_BOTTOM + 40;
    for (const layout of LAYOUTS) {
      const svg = renderSlide({
        layout,
        content: { headline: "wrap me over several lines to push the block down", body: "and more" },
      });
      for (const m of svg.matchAll(/<text[^>]*\by="(\d+)"/g)) {
        const y = Number(m[1]);
        expect(y, `${layout} text at y=${y}`).toBeGreaterThanOrEqual(CONTENT_TOP);
        expect(y, `${layout} text at y=${y}`).toBeLessThanOrEqual(bottom);
      }
    }
  });

  it("the screenshot bleeds wider than the text, on purpose", () => {
    // A screenshot clipped by platform UI is still legible; a headline is not.
    const svg = renderSlide({
      layout: "screenshot",
      content: { headline: "look at this", imageUrl: "https://cdn.test/shot.png" },
    });
    expect(svg).toMatch(/<image[^>]*x="0"[^>]*width="1080"/);
  });
});

describe("the kit is used, and its GAPS are respected", () => {
  it("a named palette and fonts reach the slide", () => {
    const svg = renderSlide({
      layout: "title",
      content: { headline: "branded" },
      kit: NAMED_KIT,
    });
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("#111827");
    expect(svg).toContain("Söhne");
  });

  it("⭐ OBSERVED colours are never used as a palette", () => {
    // §6.2 returns these with paletteConfidence "observed" precisely because we
    // cannot say which is primary. A frame that picked one anyway would launder
    // an inference into a decision applied to every asset for months.
    const observed: BrandKit = {
      observedColors: ["#0a0a0a", "#fbfaf6", "#ff4500"],
      paletteConfidence: "observed",
    };
    const svg = renderSlide({
      layout: "title",
      content: { headline: "unconfirmed" },
      kit: observed,
    });
    for (const hex of observed.observedColors ?? []) {
      expect(svg).not.toContain(hex);
    }
    expect(svg).toContain(NEUTRAL.background);
    expect(resolveTheme(observed).neutral).toBe(true);
  });

  it("no kit at all still renders — neutral, never broken", () => {
    const svg = renderSlide({ layout: "point", content: { headline: "no kit" } });
    expect(svg).toContain(NEUTRAL.background);
    expect(svg).not.toContain("undefined");
    expect(resolveTheme(null).neutral).toBe(true);
  });

  it("a font name with a space is quoted for the CSS stack", () => {
    const theme = resolveTheme({ fonts: { display: "Instrument Serif" } });
    expect(theme.displayFont).toContain("'Instrument Serif'");
  });
});

describe("text that would break the SVG, or the layout", () => {
  it("escapes markup rather than emitting invalid XML", () => {
    const svg = renderSlide({
      layout: "point",
      content: { headline: `Ship <fast> & "well"` },
    });
    expect(svg).toContain("&lt;fast&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).not.toMatch(/<text[^>]*>[^<]*<fast>/);
  });

  it("esc handles every character that matters", () => {
    expect(esc(`<a href="x" id='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; id=&apos;y&apos;&gt;&amp;"
    );
  });

  it("truncates rather than letting a headline run off the frame", () => {
    // An overflowing headline is a broken slide. The cap matters more than the
    // wrapping precision.
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    expect(wrapLines(long, 22, 3)).toHaveLength(3);
  });

  it("never splits a word across lines", () => {
    const lines = wrapLines("supercalifragilistic and some shorter words here", 12, 4);
    expect(lines[0]).toBe("supercalifragilistic");
  });

  it("empty text yields no lines rather than one empty line", () => {
    expect(wrapLines("   ", 20, 3)).toEqual([]);
  });
});
