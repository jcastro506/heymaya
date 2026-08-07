/**
 * ⭐ The brand kit (§6.2) — extracted, never invented.
 *
 * *Operator asked 2026-08-06 whether Creatify, Higgsfield or Arcads should do
 * this. The answer is no, and the spec had already settled it twice.*
 *
 * ## Why we own this rather than buy it
 *
 * 1. **The vendors don't sell it.** Creatify's Link scrape returns `logo_url`,
 *    `image_urls`, `title` and `description` — verified live — which is the
 *    logo and some images. **No palette, no fonts, no caption style.**
 *    Higgsfield and Arcads are video generators with no brand-extraction
 *    product at all.
 *
 * 2. **A vendor-held kit only themes that vendor's output**, and §7.5.35 is an
 *    open spike on replacing Creatify. Worse, the kit's biggest consumer isn't
 *    video: §7.5.1 says TikTok photo mode is *"built entirely from real product
 *    screenshots plus the brand kit"* — the cheap daily format the whole
 *    cadence depends on. A kit living inside a video vendor cannot theme it.
 *
 * 3. §7.5.1 already concluded it: *"Custom Templates give consistency across
 *    renders of one template — not per-customer brand theming. **Our own layout
 *    system (fixed frame + brand kit) is the only path that themes per
 *    customer.**"* And §6.2: the gap is *"the same gap regardless of vendor."*
 *
 * ## Why it's nearly free
 *
 * `productTruth.fetchProductPage` already pulls this exact HTML for the product
 * read. Fonts and palette are *declared in it* — `font-family`, and CSS custom
 * properties that are usually named literally (`--brand`, `--primary`). No new
 * fetch, no new vendor, no model call for the parts that are simply written
 * down.
 *
 * ## ⚠️ Unknown stays unknown
 *
 * A kit that GUESSES is worse than one with gaps. A wrong accent colour applied
 * to every asset for a month is a slow, invisible way to make a feed look
 * off-brand — and unlike a bad sentence, nobody reports it. So every field is
 * optional, absence is a real answer, and §7.5.1's fixed frame falls back to
 * neutral rather than to a plausible hex.
 *
 * That is the same rule as grounded-or-silent (§2.7), applied to colour.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* The shape (§6.2)                                                            */
/* -------------------------------------------------------------------------- */

export interface BrandKit {
  logo?: { primary?: string; mark?: string; inverse?: string };
  palette?: {
    primary?: string;
    secondary?: string;
    background?: string;
    text?: string;
    accent?: string;
  };
  fonts?: { display?: string; body?: string };
  /**
   * The colours the site uses most, in order — OBSERVED, not assigned.
   *
   * Present when no named palette could be read. Downstream must treat these
   * as a proposal for the founder to confirm, never as roles: see
   * `observedColors` for why picking a "primary" from them is a guess.
   */
  observedColors?: string[];
  /** `named` is a declaration of intent; `observed` is an inference. */
  paletteConfidence?: "named" | "observed";
  /** How it should feel — judgement, so the model supplies it. */
  visualRegister?: string;
  /** Where the extraction couldn't see, said plainly rather than filled in. */
  gaps?: string[];
  sourceUrl?: string;
  extractedAt?: number;
}

/* -------------------------------------------------------------------------- */
/* Deterministic extraction — it is all written down in the page               */
/* -------------------------------------------------------------------------- */

/** Absolute-ise a possibly-relative asset path against the page it came from. */
export function absoluteUrl(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Logo candidates, best first.
 *
 * `og:image` outranks a favicon deliberately: a favicon is 32px and usually a
 * cropped mark, while the OG image is what the brand chose to show when shared
 * — the closest thing on a page to "here is our logo, at size".
 */
export function extractLogos(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  const push = (href: string | undefined) => {
    if (!href) return;
    const abs = absoluteUrl(href.trim(), pageUrl);
    if (abs && !found.includes(abs)) found.push(abs);
  };

  const ogImage = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  );
  push(ogImage?.[1]);

  // A file literally called "logo" is a stronger signal than any heuristic.
  for (const m of html.matchAll(
    /<img[^>]+src=["']([^"']*logo[^"']*)["']/gi
  )) {
    push(m[1]);
  }

  const appleTouch = html.match(
    /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i
  );
  push(appleTouch?.[1]);

  const icon = html.match(
    /<link[^>]+rel=["'][^"']*\bicon\b[^"']*["'][^>]+href=["']([^"']+)["']/i
  );
  push(icon?.[1]);

  return found;
}

/**
 * ⭐ External stylesheet URLs.
 *
 * ⚠️ Measured 2026-08-06: extracting from inline `<style>` alone found nothing
 * on the live site, because every modern framework ships CSS as a separate
 * file. `hey-maya.ai` declares exactly one `<link rel="stylesheet">` and every
 * colour it uses lives in there. Without following it, palette extraction
 * works on roughly the sites nobody builds any more.
 *
 * Capped at two: the first stylesheet is the app's, and anything past the
 * second is vendor CSS whose colours are not the brand's.
 */
export function extractStylesheets(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(
    /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi
  )) {
    const abs = absoluteUrl(m[1], pageUrl);
    if (abs && !found.includes(abs)) found.push(abs);
  }
  for (const m of html.matchAll(
    /<link[^>]+href=["']([^"']+\.css[^"']*)["'][^>]*rel=["']stylesheet["']/gi
  )) {
    const abs = absoluteUrl(m[1], pageUrl);
    if (abs && !found.includes(abs)) found.push(abs);
  }
  return found.slice(0, 2);
}

/** Normalise a CSS colour to lowercase 6-digit hex, or null if it isn't one. */
export function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const full = v.match(/^#([0-9a-f]{6})$/);
  return full ? `#${full[1]}` : null;
}

/**
 * Palette from CSS custom properties.
 *
 * ⭐ Design systems name these honestly — `--brand`, `--primary`, `--accent`,
 * `--background`. That is a *declaration* of intent, not an inference from
 * pixels, which is why this is preferred over sampling the rendered page:
 * the most common colour on a page is usually white.
 *
 * Anything not matched by name is left out. See the unknown-stays-unknown rule.
 */
export function extractPalette(html: string): BrandKit["palette"] {
  const vars = new Map<string, string>();
  for (const m of html.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi)) {
    const hex = normalizeHex(m[2]);
    if (hex) vars.set(m[1].toLowerCase(), hex);
  }
  if (vars.size === 0) return undefined;

  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      for (const [key, value] of vars) {
        // Exact first, then contains — `--color-primary` should match
        // "primary" without `--primary-foreground` winning by being shorter.
        if (key === name) return value;
      }
    }
    for (const name of names) {
      for (const [key, value] of vars) {
        if (key.includes(name)) return value;
      }
    }
    return undefined;
  };

  const palette = {
    primary: pick("brand", "primary", "brand-primary", "color-primary"),
    secondary: pick("secondary", "brand-secondary"),
    background: pick("background", "bg", "surface"),
    text: pick("foreground", "text", "body-text"),
    accent: pick("accent", "highlight"),
  };
  return Object.values(palette).some(Boolean) ? palette : undefined;
}

/**
 * ⭐ THE COLOURS THE SITE ACTUALLY USES, ranked by how often.
 *
 * ⚠️ This exists because the obvious approaches were measured and failed:
 *
 * | approach | result on the live site |
 * |---|---|
 * | named custom properties (`--brand`) | ⛔ nothing — Tailwind declares `--tw-gradient-from`, `--color-white`, and no brand name at all |
 * | most-frequent SATURATED colour | ⛔ picked `#16a34a`, a green success state |
 * | most-frequent colour overall | ✅ `#0a0a0a`, `#fbfaf6`, `#d8d0c3` — which IS the palette |
 *
 * The lesson is that a brand is often **neutral**. Excluding greys to "find the
 * brand colour" throws away the dark near-black and warm cream that *are* the
 * brand, and promotes a state colour that appears four times.
 *
 * ⚠️ So these are returned as **observed**, never as assigned roles. We can say
 * "your site mostly uses these"; we cannot say which one is the primary without
 * guessing, and a wrong primary gets applied to every asset for months.
 */
export function observedColors(css: string, limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
    const hex = normalizeHex(m[0]);
    if (!hex) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([hex]) => hex);
}

/** Fonts, in declaration order — the first family a page names is its display. */
export function extractFonts(html: string): BrandKit["fonts"] {
  const families: string[] = [];
  for (const m of html.matchAll(/font-family\s*:\s*([^;}\n]+)/gi)) {
    const first = m[1]
      .split(",")[0]
      .replace(/["']/g, "")
      .trim();
    // System stacks tell us nothing about a brand.
    if (!first || /^(inherit|initial|unset|var\()/i.test(first)) continue;
    if (
      /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|ui-serif|sans-serif|serif|monospace)$/i.test(
        first
      )
    ) {
      continue;
    }
    /**
     * ⚠️ Framework fallback faces are not a second font.
     *
     * Measured on the live site: this returned `display: "Geist"` and
     * `body: "Geist Fallback"`. The second is a generated metric-override
     * face Next.js emits so text doesn't reflow while the real font loads —
     * reporting it as the body font would put a font that does not exist into
     * every rendered asset.
     */
    if (/\bfallback\b/i.test(first)) continue;
    if (!families.includes(first)) families.push(first);
  }
  if (families.length === 0) return undefined;
  return {
    display: families[0],
    // Only claim a separate body font when the page actually names a second.
    body: families[1] ?? families[0],
  };
}

/** What the extraction could NOT see. Reported, never filled in. */
export function findGaps(kit: BrandKit): string[] {
  const gaps: string[] = [];
  if (!kit.logo?.primary) gaps.push("no logo found on the page");
  if (!kit.palette) {
    gaps.push(
      (kit.observedColors?.length ?? 0) > 0
        ? "colours read from the site's own CSS, but not labelled — worth confirming which is the main one"
        : "no brand colours found on the site"
    );
  }
  if (!kit.fonts) gaps.push("no custom fonts — the site uses a system stack");
  return gaps;
}

/**
 * Everything that is simply written down in the page.
 *
 * Pure, so the whole extraction is testable against a fixture without a fetch,
 * a model, or a database.
 */
export function extractFromHtml(
  html: string,
  pageUrl: string,
  /** Concatenated external stylesheets, where the colours and fonts live. */
  css = ""
): BrandKit {
  const logos = extractLogos(html, pageUrl);
  // The page first — an inline `:root` block is the site's own declaration and
  // outranks anything found in a bundled framework stylesheet.
  const named = extractPalette(html) ?? extractPalette(css);
  const all = `${html}\n${css}`;

  const kit: BrandKit = {
    logo: logos.length > 0 ? { primary: logos[0], mark: logos[1] } : undefined,
    palette: named,
    // Only when nothing was NAMED. Observed colours are a proposal, and
    // offering them alongside a real palette would invite treating them as one.
    observedColors: named ? undefined : observedColors(all),
    paletteConfidence: named ? "named" : undefined,
    fonts: extractFonts(html) ?? extractFonts(css),
    sourceUrl: pageUrl,
  };
  if (!named && (kit.observedColors?.length ?? 0) > 0) {
    kit.paletteConfidence = "observed";
  }
  return { ...kit, gaps: findGaps(kit) };
}

/* -------------------------------------------------------------------------- */
/* The one judgement call                                                      */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ Was `google/gemini-2.5-flash` for a few hours on 2026-08-06, which is the
 * most expensive model in the stack — **$2.50/M output, 14.7× `gpt-oss-120b`**
 * — for a task that reads one page and returns one short phrase.
 *
 * It was also drift: nothing else in `convex/maya` uses 2.5-flash. The house
 * tiers are gpt-oss-120b for volume work and a Flash for judges, and this is
 * volume work that runs once per brand extraction.
 *
 * Prices read from `/api/v1/models`, which is the only truth — a comment
 * naming a price rots, and one in this repo already claimed $0.075 for a model
 * that cost $0.25.
 */
export const REGISTER_MODEL = "openai/gpt-oss-120b";

export const REGISTER_SYSTEM = `You are given the visible text of a product's homepage. Say how its visuals should FEEL, in one short phrase a designer could act on.

Return STRICT JSON, no prose: { "visualRegister": string }

Examples of the right shape: "clean and technical, lots of whitespace" · "loud and playful, high contrast" · "warm and handmade, muted tones".

Judge only from what is actually there. If the page gives you nothing to go on, return an empty string — that is a real answer, and a confident guess here gets applied to every asset for months.`;

export function parseRegister(content: string): string | undefined {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    const parsed = JSON.parse(match[0]) as { visualRegister?: unknown };
    const value =
      typeof parsed.visualRegister === "string" ? parsed.visualRegister.trim() : "";
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Convex                                                                      */
/* -------------------------------------------------------------------------- */

export const storeBrandKit = internalMutation({
  args: { customerId: v.id("customers"), kitJson: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;
    await ctx.db.patch(args.customerId, {
      brandKitJson: args.kitJson,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const brandKitFor = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<BrandKit | null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer?.brandKitJson) return null;
    try {
      return JSON.parse(customer.brandKitJson) as BrandKit;
    } catch {
      return null;
    }
  },
});

/**
 * Extract the kit from the product's own site.
 *
 * ⚠️ The fetched page is DATA, never instruction — same rule as the product
 * read. Only the stripped text reaches the model, and nothing in it can change
 * what the model is asked to do.
 */
export const extractBrandKit = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<
    | { ok: true; kit: BrandKit; gaps: string[] }
    | { ok: false; error: string }
  > => {
    const now = args.now ?? Date.now();
    const truth = await ctx.runQuery(internal.maya.productTruth.forCustomer, {
      customerId: args.customerId,
    });
    const url = truth?.url;
    if (!url) {
      return { ok: false, error: "no product URL — the product read hasn't run" };
    }

    const { fetchProductPage, stripHtml } = await import("./productTruth");
    const page = await fetchProductPage(url);
    if (!page.ok) {
      return { ok: false, error: page.reason };
    }

    /**
     * ⚠️ The stylesheets, because the page alone has nothing.
     *
     * Measured: extracting from inline `<style>` only returned an empty
     * palette and no fonts on the live site, since every modern framework
     * ships CSS as a separate file. One or two extra GETs is the difference
     * between working on the sites nobody builds and the sites everybody does.
     *
     * A stylesheet that fails to fetch is skipped, not fatal — the logo and
     * the register are still worth having.
     */
    let css = "";
    for (const href of extractStylesheets(page.html, page.finalUrl)) {
      try {
        const res = await fetch(href, {
          headers: { "User-Agent": "HeyMaya/1.0 (+https://hey-maya.ai)" },
        });
        if (res.ok) css += `\n${(await res.text()).slice(0, 400_000)}`;
      } catch (error) {
        console.warn(`[brand] stylesheet skipped ${href}: ${String(error)}`);
      }
    }

    const kit = extractFromHtml(page.html, url, css);

    // The one thing not written down in the markup.
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey) {
      const { callModel } = await import("./llm");
      const completion = await callModel(ctx, {
        customerId: args.customerId,
        purpose: "brand_register",
        apiKey,
        model: REGISTER_MODEL,
        temperature: 0.2,
        maxTokens: 300,
        messages: [
          { role: "system", content: REGISTER_SYSTEM },
          { role: "user", content: stripHtml(page.html).slice(0, 4_000) },
        ],
      });
      if (completion.ok) {
        kit.visualRegister = parseRegister(completion.content);
      }
    }
    if (!kit.visualRegister) {
      kit.gaps = [...(kit.gaps ?? []), "couldn't read a visual register"];
    }

    kit.extractedAt = now;
    await ctx.runMutation(internal.maya.brandKit.storeBrandKit, {
      customerId: args.customerId,
      kitJson: JSON.stringify(kit),
    });

    return { ok: true, kit, gaps: kit.gaps ?? [] };
  },
});
