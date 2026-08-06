/**
 * ⭐ The brand kit (§6.2) — extracted, never invented.
 *
 * Operator asked whether Creatify, Higgsfield or Arcads should do this. They
 * can't: Creatify's Link scrape returns a logo and images and **no palette, no
 * fonts** (verified live), and the other two are video generators. More
 * importantly a vendor-held kit only themes that vendor's output, while the
 * kit's biggest consumer — TikTok photo mode, §7.5.1's *"real product
 * screenshots plus the brand kit"* — isn't video at all.
 *
 * The parts that matter are simply **declared in the page**, so these tests are
 * pure and run against real markup shapes.
 *
 * ⚠️ The rule most of these defend: **unknown stays unknown.** A wrong accent
 * colour applied to every asset for a month is a slow, invisible way to make a
 * feed look off-brand, and unlike a bad sentence nobody reports it.
 */
import { describe, expect, it } from "vitest";
import {
  extractFonts,
  extractFromHtml,
  extractLogos,
  extractPalette,
  findGaps,
  normalizeHex,
  extractStylesheets,
  observedColors,
  parseRegister,
} from "../brandKit";

const PAGE = "https://widgetly.com/";

describe("logos, best candidate first", () => {
  it("prefers og:image over a 32px favicon", () => {
    // A favicon is a cropped mark; the OG image is what the brand chose to
    // show when shared — the closest thing on a page to "our logo, at size".
    const html = `
      <link rel="icon" href="/favicon.ico">
      <meta property="og:image" content="https://cdn.widgetly.com/card.png">
    `;
    expect(extractLogos(html, PAGE)[0]).toBe("https://cdn.widgetly.com/card.png");
  });

  it("resolves relative paths against the page they came from", () => {
    const html = `<img src="/assets/logo-dark.svg">`;
    expect(extractLogos(html, PAGE)).toContain("https://widgetly.com/assets/logo-dark.svg");
  });

  it("finds nothing rather than something, on a page with no images", () => {
    expect(extractLogos("<p>hello</p>", PAGE)).toEqual([]);
  });
});

describe("palette from what the stylesheet DECLARES", () => {
  it("reads named brand variables", () => {
    // Design systems name these honestly, which is a statement of intent —
    // unlike sampling pixels, where the most common colour is usually white.
    const html = `<style>:root{--brand:#1D4ED8;--accent:#F59E0B;--background:#FFF}</style>`;
    const palette = extractPalette(html);
    expect(palette?.primary).toBe("#1d4ed8");
    expect(palette?.accent).toBe("#f59e0b");
    expect(palette?.background).toBe("#ffffff");
  });

  it("prefers an exact name over a longer one that merely contains it", () => {
    // `--primary-foreground` is the text ON the primary colour, not the brand.
    const html = `<style>:root{--primary-foreground:#ffffff;--primary:#111827}</style>`;
    expect(extractPalette(html)?.primary).toBe("#111827");
  });

  it("returns nothing at all when no colour is named", () => {
    expect(extractPalette("<style>.a{margin:0}</style>")).toBeUndefined();
  });

  it("ignores variables that aren't colours", () => {
    const html = `<style>:root{--radius:8px;--brand:#0F172A}</style>`;
    const palette = extractPalette(html);
    expect(palette?.primary).toBe("#0f172a");
  });
});

describe("normalizeHex", () => {
  it("expands shorthand and lowercases", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#1D4ED8")).toBe("#1d4ed8");
  });

  it("refuses anything that isn't a hex colour", () => {
    // rgb()/hsl()/named colours are left for a later pass rather than
    // half-parsed into a wrong value.
    for (const v of ["rgb(1,2,3)", "var(--x)", "tomato", "#12345", ""]) {
      expect(normalizeHex(v)).toBeNull();
    }
  });
});

describe("fonts", () => {
  it("takes the first real family a page names as its display face", () => {
    const html = `<style>h1{font-family:"Söhne",system-ui,sans-serif}body{font-family:Inter,Arial}</style>`;
    const fonts = extractFonts(html);
    expect(fonts?.display).toBe("Söhne");
    expect(fonts?.body).toBe("Inter");
  });

  it("skips system stacks — they say nothing about a brand", () => {
    const html = `<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif}</style>`;
    expect(extractFonts(html)).toBeUndefined();
  });

  it("only claims a separate body font when a second one is actually named", () => {
    const html = `<style>body{font-family:Inter,sans-serif}</style>`;
    const fonts = extractFonts(html);
    expect(fonts?.display).toBe("Inter");
    expect(fonts?.body).toBe("Inter");
  });
});

describe("UNKNOWN STAYS UNKNOWN", () => {
  it("names every gap instead of filling it with a plausible value", () => {
    const kit = extractFromHtml("<p>a bare page</p>", PAGE);
    expect(kit.palette).toBeUndefined();
    expect(kit.fonts).toBeUndefined();
    expect(kit.logo).toBeUndefined();
    expect(kit.gaps).toHaveLength(3);
    // Plain language — these reach the founder if she's asked why assets look
    // generic.
    for (const gap of kit.gaps ?? []) {
      expect(gap).not.toMatch(/undefined|null|regex|parse/i);
    }
  });

  it("reports no gaps when the page declares everything", () => {
    const html = `
      <meta property="og:image" content="https://cdn.widgetly.com/card.png">
      <style>:root{--brand:#1D4ED8}h1{font-family:Söhne,sans-serif}</style>
    `;
    expect(findGaps(extractFromHtml(html, PAGE))).toEqual([]);
  });

  it("an empty visual register is a real answer, not a value", () => {
    // The model is told to return "" when the page gives it nothing. That must
    // not become the string "" in the kit and get rendered as a register.
    expect(parseRegister('{"visualRegister":""}')).toBeUndefined();
    expect(parseRegister('{"visualRegister":"  "}')).toBeUndefined();
    expect(parseRegister("the model rambled")).toBeUndefined();
    expect(parseRegister('{"visualRegister":"clean and technical"}')).toBe(
      "clean and technical"
    );
  });

  it("survives the JSON arriving wrapped in prose", () => {
    expect(parseRegister('Here you go:\n```json\n{"visualRegister":"loud"}\n```')).toBe(
      "loud"
    );
  });
});

/**
 * ⭐ MEASURED AGAINST THE LIVE SITE, 2026-08-06.
 *
 * The first version read inline `<style>` only and returned an empty palette
 * and no fonts — because every modern framework ships CSS as a separate file.
 * Following the stylesheet changed the result completely.
 */
describe("the stylesheet is where everything actually lives", () => {
  it("finds the linked stylesheet, in either attribute order", () => {
    const a = `<link rel="stylesheet" href="/_next/static/x.css?dpl=1"/>`;
    const b = `<link href="/app.css" rel="stylesheet"/>`;
    expect(extractStylesheets(a, PAGE)[0]).toContain("/_next/static/x.css");
    expect(extractStylesheets(b, PAGE)[0]).toBe("https://widgetly.com/app.css");
  });

  it("caps at two — past that it's vendor CSS, not the brand", () => {
    const html = [1, 2, 3, 4]
      .map((i) => `<link rel="stylesheet" href="/${i}.css">`)
      .join("");
    expect(extractStylesheets(html, PAGE)).toHaveLength(2);
  });

  it("a framework fallback face is not a second font", () => {
    // Live result was display "Geist", body "Geist Fallback" — a generated
    // metric-override face Next.js emits so text doesn't reflow. Reporting it
    // would put a nonexistent font into every rendered asset.
    const css = `@font-face{font-family:Geist}@font-face{font-family:"Geist Fallback"}h1{font-family:Geist}`;
    expect(extractFonts(css)?.body).toBe("Geist");
  });
});

describe("OBSERVED colours — because every clever approach failed", () => {
  /**
   * Measured on the live stylesheet:
   *
   *   named custom properties  ⛔ Tailwind declares --tw-gradient-from, no brand
   *   most-frequent SATURATED  ⛔ picked #16a34a, a green success state
   *   most-frequent overall    ✅ #0a0a0a, #fbfaf6 — which IS the palette
   *
   * A brand is often NEUTRAL. Excluding greys throws away the dark near-black
   * and warm cream that ARE the brand, and promotes a state colour.
   */
  it("ranks by frequency, including the neutrals", () => {
    const css = "#0A0A0A #0a0a0a #0a0a0a #FBFAF6 #fbfaf6 #16a34a";
    expect(observedColors(css, 3)).toEqual(["#0a0a0a", "#fbfaf6", "#16a34a"]);
  });

  it("expands shorthand so #FFF and #ffffff are one colour, not two", () => {
    expect(observedColors("#FFF #ffffff #fff")[0]).toBe("#ffffff");
  });

  it("is offered ONLY when nothing was named — never alongside a real palette", () => {
    // Offering both invites treating an inference as a declaration.
    const named = extractFromHtml("<style>:root{--brand:#1D4ED8}</style>", PAGE, "#aabbcc #aabbcc");
    expect(named.palette?.primary).toBe("#1d4ed8");
    expect(named.observedColors).toBeUndefined();
    expect(named.paletteConfidence).toBe("named");
  });

  it("marks the difference between a declaration and an inference", () => {
    const inferred = extractFromHtml("<p>x</p>", PAGE, "#0a0a0a #0a0a0a");
    expect(inferred.paletteConfidence).toBe("observed");
    // And says so in words the founder would read.
    expect(inferred.gaps?.join(" ")).toMatch(/worth confirming/);
  });
});
