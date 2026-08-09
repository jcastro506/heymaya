import { NextRequest, NextResponse } from "next/server";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

/**
 * ⭐ SVG → PNG. The step that makes a slide postable (§7.5.1, Sprint 7).
 *
 * Our layout system emits SVG on purpose: §7.5.1 requires headlines be
 * *"composited as real text in the brand font, never generated as pixels —
 * that kills the two worst tells at once: garbled letterforms and drifting
 * typography."* SVG is exactly that.
 *
 * But TikTok, Instagram and YouTube want pixels. Convex has no renderer and no
 * browser, so the flattening lives here — in the Next app we already deploy —
 * rather than in a new service.
 *
 * ⚠️ **This is the load-bearing step for the CHEAP path.** Title, point and CTA
 * slides never touch an image model at all; they are our text on their brand
 * colours, and for those this route is the *only* processing that happens. It
 * is what makes a daily TikTok placement cost approximately nothing.
 */

/** Node, not edge: the WASM binary needs a filesystem-free but full runtime. */
export const runtime = "nodejs";

/**
 * ⚠️ Initialised once per warm instance, never per request.
 *
 * `initWasm` throws if called twice, so a naive per-request init works exactly
 * once and then 500s for the life of the instance — the kind of bug that
 * passes every local test and fails on the second real request.
 */
let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  wasmReady ??= (async () => {
    /**
     * Read the .wasm from disk rather than `import`ing it.
     *
     * ⚠️ The first version of this resolved the binary directly:
     *
     * ```ts
     * resolve("@resvg/resvg-wasm/index_bg.wasm")
     * ```
     *
     * which reads as runtime-only but is not. **Turbopack statically analyses
     * `require.resolve` specifiers**, so it tried to bundle the binary as a
     * WebAssembly module, went looking for wasm-bindgen's `wbg` import
     * namespace — which exists only as a JS shim, never as a resolvable
     * module — and failed the build of the route with `Can't resolve 'wbg'`.
     *
     * Every request 500'd. The route's own tests never caught it because they
     * call the handler directly and no bundler is involved; it only appears
     * when something actually serves the route.
     *
     * Resolving the package's `package.json` instead fails too — the package's
     * `exports` map doesn't expose it. And `require.resolve` is the wrong tool
     * regardless: under a bundler it answers with a *module* path, which need
     * not be a real file on disk.
     *
     * So don't ask the bundler anything. Build the path from the project root,
     * which is where `outputFileTracingIncludes` puts the traced binary too —
     * the config entry and this line have to agree, and both are written
     * against `process.cwd()`.
     */
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const wasmPath = join(
      process.cwd(),
      "node_modules",
      "@resvg",
      "resvg-wasm",
      "index_bg.wasm"
    );
    try {
      await initWasm(await readFile(wasmPath));
    } catch (error) {
      // ⚠️ Named, not swallowed. A missing binary here means the trace config
      // and this path disagree — which looks identical to a broken renderer
      // unless the message says which file it wanted.
      throw new Error(
        `resvg wasm not readable at ${wasmPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  })();
  return wasmReady;
}

/**
 * The faces that ship with the deploy, so text always draws.
 *
 * Geist regular + semibold: the app's own typeface, OFL-licensed, ~73 KB each.
 * Two weights rather than one because the layouts set an eyebrow and a headline
 * at different weights, and resvg synthesises neither — a missing weight falls
 * back to the nearest real one rather than faking it.
 */
const BUNDLED_FONTS = ["Geist-Regular.ttf", "Geist-SemiBold.ttf"];

let bundledFonts: Promise<Buffer[]> | null = null;
function loadBundledFonts(): Promise<Buffer[]> {
  // Read once per warm instance — the same reasoning as `ensureWasm`.
  bundledFonts ??= (async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const out: Buffer[] = [];
    for (const name of BUNDLED_FONTS) {
      const path = join(process.cwd(), "assets", "fonts", name);
      try {
        out.push(await readFile(path));
      } catch (error) {
        // Named, never silent — a missing bundled font means the trace config
        // dropped it, and the symptom downstream is invisible blank text.
        console.error(
          `[render/slide] bundled font missing at ${path}: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }
    return out;
  })();
  return bundledFonts;
}

/** Cap: six faces is a display and a body in Latin. See `extractFontUrls`. */
const MAX_FONTS = 6;
const FONT_TIMEOUT_MS = 5_000;

/**
 * Fetch the brand's own font files.
 *
 * ⚠️ Measured 2026-08-08: without these, `Geist`, `Instrument Serif` and
 * `sans-serif` render **byte-identically**. Read at the time as "falls back to
 * a generic face"; **corrected 2026-08-09 — it drew no text at all.** They
 * matched because all three were blank. See `loadBundledFonts`, which is why
 * the floor is now a real typeface rather than nothing.
 *
 * These are still the upgrade: the bundled face is *a* font, not *their* font,
 * and type is on every slide.
 *
 * A font that fails to fetch is skipped rather than fatal, and the count is
 * returned so the caller can tell "rendered in your fonts" from "rendered in
 * something". §2.7, applied to typography: say which one it was.
 */
async function loadFonts(urls: string[]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const url of urls.slice(0, MAX_FONTS)) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "HeyMaya/1.0 (+https://hey-maya.ai)" },
        signal: AbortSignal.timeout(FONT_TIMEOUT_MS),
      });
      if (res.ok) out.push(new Uint8Array(await res.arrayBuffer()));
    } catch {
      // Skipped, not fatal — five of six faces still beats a generic render.
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  const secret = process.env.RENDER_SHARED_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    // Rendering arbitrary SVG fetches arbitrary URLs; this is not open.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { svg?: unknown; fontUrls?: unknown; width?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected JSON" }, { status: 400 });
  }

  const svg = typeof body.svg === "string" ? body.svg : "";
  if (!svg.trim().startsWith("<svg")) {
    return NextResponse.json({ error: "expected an svg" }, { status: 400 });
  }

  const fontUrls = Array.isArray(body.fontUrls)
    ? body.fontUrls.filter((u): u is string => typeof u === "string")
    : [];
  const width = typeof body.width === "number" ? body.width : 1080;

  try {
    await ensureWasm();
    /**
     * ⭐ The bundled face goes in FIRST, and is not optional.
     *
     * ⚠️ With `loadSystemFonts: false` and no buffers, resvg does not fail —
     * **it renders the slide with every glyph missing.** The first real render
     * through this route came back HTTP 200, valid PNG, correct 1080×1920, 12
     * KB, and completely blank apart from the progress rule. Byte count, status
     * code and content type all said success.
     *
     * Nothing in the response could have told the caller. `X-Fonts-Embedded: 0`
     * was already there and is exactly the signal, but it was reporting a
     * condition the route was willing to ship.
     *
     * A brand font is a nice-to-have — it's fetched over the network from a
     * third party and may well fail. A font *at all* is not, so one travels
     * with the deploy. Brand faces are layered on top and win when present,
     * because resvg matches by family name and only falls back to this when
     * the requested family isn't loaded.
     */
    const fontBuffers = [...(await loadBundledFonts()), ...(await loadFonts(fontUrls))];

    // Principle 5. A blank image is a failure that looks like a success, so it
    // must never leave this route as a 200.
    if (fontBuffers.length === 0) {
      console.error("[render/slide] no fonts available — refusing to render blank");
      return NextResponse.json(
        { error: "no fonts available to render text" },
        { status: 500 }
      );
    }

    const png = new Resvg(svg, {
      fitTo: { mode: "width", value: width },
      font: {
        fontBuffers,
        // ⚠️ No system fonts. On a serverless instance there are none worth
        // having, and allowing them makes the output depend on which host you
        // landed on — the same slide rendering differently between requests.
        loadSystemFonts: false,
      },
    })
      .render()
      .asPng();

    return new NextResponse(Buffer.from(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // The caller needs to know whether this is really their typeface.
        "X-Fonts-Embedded": String(fontBuffers.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[render/slide] ${error instanceof Error ? error.message : error}`);
    return NextResponse.json({ error: "could not render that" }, { status: 500 });
  }
}
