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
     * Read from disk rather than `import`ing the .wasm.
     *
     * A bare wasm import needs bundler support and a type declaration, and
     * whether it resolves depends on the build target — which is a bad thing
     * to discover in production. On the Node runtime the file is simply there
     * in `node_modules`, and `require.resolve` finds it wherever the install
     * put it.
     */
    const { readFile } = await import("node:fs/promises");
    const { createRequire } = await import("node:module");
    const resolve = createRequire(import.meta.url).resolve;
    const wasmPath = resolve("@resvg/resvg-wasm/index_bg.wasm");
    await initWasm(await readFile(wasmPath));
  })();
  return wasmReady;
}

/** Cap: six faces is a display and a body in Latin. See `extractFontUrls`. */
const MAX_FONTS = 6;
const FONT_TIMEOUT_MS = 5_000;

/**
 * Fetch the brand's own font files.
 *
 * ⚠️ Measured 2026-08-08: without these, `Geist`, `Instrument Serif` and
 * `sans-serif` render **byte-identically** — the renderer falls back to a
 * generic face and reports nothing. Every slide would be quietly off-brand,
 * which is worse than a wrong colour because type is on all of them.
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
    const fontBuffers = await loadFonts(fontUrls);

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
