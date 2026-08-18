import { describe, expect, it } from "vitest";
import {
  assessLibrary,
  extractCandidateImages,
  HEALTHY_SCREENSHOT_FLOOR,
  isUsableProductImage,
  parseKind,
  type AssetKind,
} from "../assetClassifier";

const BASE = "https://example.com/";

describe("extractCandidateImages", () => {
  it("DECODES HTML ENTITIES — the bug that voided the first spike run", () => {
    // HTML encodes `&` as `&amp;` inside attributes, so a good CDN URL arrives
    // as `?url=x&amp;w=3840` and fetching it fails. Before this fix, 46 of 109
    // spike images failed to fetch and the spike read that as "these sites
    // have no product screenshots" — our bug wearing the costume of a finding.
    const html = `<img src="https://cdn.example.com/i?url=%2Fhero.jpg&amp;w=3840&amp;q=100">`;
    const [image] = extractCandidateImages(html, BASE);
    expect(image.url).toBe("https://cdn.example.com/i?url=%2Fhero.jpg&w=3840&q=100");
    expect(image.url).not.toContain("&amp;");
  });

  it("takes og and twitter card images first — the publisher's own pick", () => {
    const html = `
      <img src="/inline.png">
      <meta property="og:image" content="/card.png">
    `;
    const images = extractCandidateImages(html, BASE);
    expect(images[0].source).toBe("og");
    expect(images[0].url).toBe("https://example.com/card.png");
  });

  it("handles name= as well as property= on meta tags", () => {
    const html = `<meta name="twitter:image" content="/t.png">`;
    expect(extractCandidateImages(html, BASE)[0].source).toBe("twitter");
  });

  it("prefers the largest srcset entry — a downscaled hero is hard to classify", () => {
    const html = `<img srcset="/s.png 400w, /m.png 800w, /l.png 1600w" src="/s.png">`;
    expect(extractCandidateImages(html, BASE)[0].url).toBe("https://example.com/l.png");
  });

  it("picks up lazy-loaded images from data-src", () => {
    const html = `<img data-src="/lazy.png">`;
    expect(extractCandidateImages(html, BASE)[0].url).toBe(
      "https://example.com/lazy.png"
    );
  });

  it("resolves relative and protocol-relative URLs", () => {
    const html = `<img src="../up.png"><img src="//cdn.test/x.png">`;
    const urls = extractCandidateImages(html, "https://example.com/a/b/").map(
      (i) => i.url
    );
    expect(urls).toContain("https://example.com/a/up.png");
    expect(urls).toContain("https://cdn.test/x.png");
  });

  it("drops furniture — favicons, sprites, store badges, tracking pixels", () => {
    const html = `
      <img src="/favicon.png"><img src="/sprite.png"><img src="/icons/x.png">
      <img src="/app-store-badge.png"><img src="/1x1.gif"><img src="/logo.svg">
      <img src="/real-hero.png">
    `;
    const urls = extractCandidateImages(html, BASE).map((i) => i.url);
    expect(urls).toEqual(["https://example.com/real-hero.png"]);
  });

  it("dedupes the same URL reached two ways", () => {
    const html = `<img srcset="/a.png 400w" src="/a.png" data-src="/a.png">`;
    expect(extractCandidateImages(html, BASE)).toHaveLength(1);
  });

  it("respects the limit", () => {
    const html = Array.from({ length: 30 }, (_, i) => `<img src="/i${i}.png">`).join("");
    expect(extractCandidateImages(html, BASE, 5)).toHaveLength(5);
  });

  it("a page with no images is empty, not an error", () => {
    expect(extractCandidateImages("<html><body>hi</body></html>", BASE)).toEqual([]);
  });

  it("malformed src doesn't throw", () => {
    expect(() =>
      extractCandidateImages(`<img src="ht tp://bad url">`, BASE)
    ).not.toThrow();
  });
});

describe("parseKind", () => {
  it("accepts the known kinds", () => {
    expect(parseKind("product_screenshot")).toBe("product_screenshot");
    expect(parseKind("  ILLUSTRATION\n")).toBe("illustration");
  });

  it("anything unrecognized is `other`, never a guess", () => {
    // Defaulting an unparseable reply to a real kind would corrupt the one
    // number this module exists to produce.
    expect(parseKind("maybe a screenshot?")).toBe("other");
    expect(parseKind("")).toBe("other");
  });
});

describe("assessLibrary — the production trigger", () => {
  const kinds = (n: number, kind: AssetKind = "product_screenshot") =>
    Array.from({ length: n }, () => kind);

  it("zero real screenshots is DEGRADED — the moment Maya asks", () => {
    // §6.4.2: only those customers ever get asked; everyone else is never
    // bothered. A gradient hero satisfies every presence check and produces
    // generic content nobody flags, so presence is not the signal.
    const verdict = assessLibrary([
      "illustration",
      "illustration",
      "logo",
      "person",
    ]);
    expect(verdict.degraded).toBe(true);
    expect(verdict.realScreenshots).toBe(0);
  });

  it("one or two screenshots is thin, not degraded", () => {
    const verdict = assessLibrary([...kinds(2), "illustration"]);
    expect(verdict.degraded).toBe(false);
    expect(verdict.thin).toBe(true);
  });

  it("three or more is healthy — enough for a photo slideshow", () => {
    const verdict = assessLibrary(kinds(HEALTHY_SCREENSHOT_FLOOR));
    expect(verdict.degraded).toBe(false);
    expect(verdict.thin).toBe(false);
  });

  it("an empty library is degraded", () => {
    expect(assessLibrary([]).degraded).toBe(true);
  });

  it("reports the full breakdown, so 'why' is answerable", () => {
    const verdict = assessLibrary(["illustration", "logo", "product_screenshot"]);
    expect(verdict.breakdown.illustration).toBe(1);
    expect(verdict.breakdown.logo).toBe(1);
    expect(verdict.breakdown.product_screenshot).toBe(1);
    expect(verdict.breakdown.stock_photo).toBe(0);
  });

  it("only a product screenshot counts as usable", () => {
    expect(isUsableProductImage("product_screenshot")).toBe(true);
    for (const kind of [
      "stock_photo",
      "illustration",
      "logo",
      "person",
      "other",
    ] as AssetKind[]) {
      expect(isUsableProductImage(kind), kind).toBe(false);
    }
  });
});

describe("a page with no <img> is not an empty page", () => {
  /**
   * ⚠️ MEASURED AGAINST OUR OWN SITE, 2026-08-18. `extractFromUrl` returned
   * `{images: [], ok: true, status: 200}` for hey-maya.ai and that was CORRECT
   * — the page has no <img> tag, no og:image and no twitter:image. It is
   * <video> elements and inline SVG.
   *
   * It also has three `poster` attributes pointing at real images, and the
   * parser could not see one of them. Any page built the modern way reads as
   * empty to an <img>-only extractor, and the caller then reports "nothing
   * usable on the page" — which sounds like a verdict about the page rather
   * than a limit of the reader.
   */
  it("⭐ reads a video poster frame", () => {
    const html = `<video src="/a.mp4" poster="/demos/tiktok.jpg"></video>`;
    const out = extractCandidateImages(html, "https://example.com");
    expect(out.map((i) => i.url)).toContain("https://example.com/demos/tiktok.jpg");
  });

  it("⭐ reads several, in page order", () => {
    const html = `
      <video poster="/demos/tiktok.jpg"></video>
      <video poster="/demos/instagram.jpg"></video>
      <video poster="/demos/youtube.jpg"></video>`;
    const out = extractCandidateImages(html, "https://example.com");
    expect(out).toHaveLength(3);
  });

  it("⚠️ still prefers a real <img> — posters are an addition, not a replacement", () => {
    const html = `
      <img src="/screenshot.png">
      <video poster="/poster.jpg"></video>`;
    const out = extractCandidateImages(html, "https://example.com");
    expect(out[0].url).toBe("https://example.com/screenshot.png");
  });
});
