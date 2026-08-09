/**
 * ⭐ The renderer must always have a font, because without one it succeeds.
 *
 * Measured 2026-08-09, first real render through this route: HTTP 200, valid
 * PNG, correct 1080×1920, 12 KB — and every glyph missing. resvg with
 * `loadSystemFonts: false` and no font buffers does not error; it draws the
 * background and the rules and simply omits all text.
 *
 * Nothing in the response distinguished that from a good render. Status code,
 * content type and a plausible byte count were all correct, which is why this
 * has to be checked against the files on disk rather than against a response.
 *
 * ⚠️ These faces are also named in `next.config.ts` under
 * `outputFileTracingIncludes`. Both have to agree or the deploy renders blank
 * while local renders fine — the config entry and the route's read path are
 * written against `process.cwd()` for exactly that reason.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FONT_DIR = join(process.cwd(), "assets", "fonts");
const REQUIRED = ["Geist-Regular.ttf", "Geist-SemiBold.ttf"];

describe("bundled render fonts", () => {
  it("ships every required face", () => {
    for (const name of REQUIRED) {
      const path = join(FONT_DIR, name);
      expect(() => statSync(path), `${name} missing from ${FONT_DIR}`).not.toThrow();
      // A zero-byte or LFS-pointer file would pass an existence check and then
      // render blank, which is the failure this whole test exists to prevent.
      expect(statSync(path).size, `${name} is implausibly small`).toBeGreaterThan(
        10_000
      );
    }
  });

  it("ships real TrueType, not an error page or a pointer", () => {
    for (const name of REQUIRED) {
      const head = readFileSync(join(FONT_DIR, name)).subarray(0, 4);
      // TrueType is 0x00010000; OpenType/CFF is "OTTO". Anything else — an HTML
      // error body saved by a failed download, a git-lfs stub — is not a font.
      const isTrueType =
        head[0] === 0x00 && head[1] === 0x01 && head[2] === 0x00 && head[3] === 0x00;
      const isOpenType = head.toString("ascii") === "OTTO";
      expect(isTrueType || isOpenType, `${name} is not a font file`).toBe(true);
    }
  });

  it("is named identically in the trace config", () => {
    // If the deploy doesn't carry these, the route renders blank in production
    // and passes everywhere else.
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain("assets/fonts");
    expect(config).toContain("@resvg/resvg-wasm/index_bg.wasm");
  });
});
