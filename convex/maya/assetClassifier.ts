/**
 * Asset extraction and quality classification (§6.4.6, §7.6.9).
 *
 * ## The failure this exists to catch
 *
 * > The failure mode to measure isn't "nothing came back." It's "something
 * > came back and it's a stock photo."
 *
 * A gradient hero with a headline passes every presence check, satisfies
 * Creatify's minimum, and produces generic content nobody flags. Counting
 * images tells you nothing; the only useful question is **what KIND of image
 * is this** — an actual screenshot of a software product, or a stock photo,
 * illustration, logo, or person.
 *
 * ## Two jobs, one classifier
 *
 * The spike that decides whether we need a headless browser and the production
 * trigger that decides whether to ASK the founder for screenshots are the same
 * measurement. §6.4.6 is explicit about that, and it's why this is a module
 * rather than a throwaway script: zero real product screenshots means we know
 * we're degraded, and that's exactly when Maya asks — so only those customers
 * are ever bothered.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";

/* -------------------------------------------------------------------------- */
/* Extraction — pure, so it's testable without the network                     */
/* -------------------------------------------------------------------------- */

/** Skip anything that is obviously furniture rather than content. */
const JUNK_PATTERNS = [
  /favicon/i,
  /sprite/i,
  /\/icons?\//i,
  /badge/i,
  /app-?store/i,
  /google-?play/i,
  /\.svg(\?|$)/i,
  /1x1|pixel|spacer|tracking/i,
  /avatar/i,
];

function isJunk(url: string): boolean {
  return JUNK_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Decode the HTML entities that appear in attribute values.
 *
 * This is not cosmetic. HTML encodes `&` as `&amp;` inside attributes, so a
 * perfectly good CDN URL arrives as
 * `.../image?url=x&amp;w=3840&amp;q=100` and fetching it fails. Measured on
 * the §6.4.6 spike before this existed: **46 of 109 images failed to fetch**,
 * essentially all of them URLs carrying query parameters — Next.js image
 * optimizer and Framer CDN links in particular. The spike read that as
 * "these sites have no product screenshots", which was our bug wearing the
 * costume of a finding.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absolutize(src: string, baseUrl: string): string | null {
  try {
    return new URL(decodeEntities(src), baseUrl).toString();
  } catch {
    return null;
  }
}

export interface CandidateImage {
  url: string;
  /** `og`/`twitter` cards are the publisher's own pick — usually the best one. */
  source: "og" | "twitter" | "img";
}

/**
 * Pull candidate images out of a marketing page.
 *
 * Order matters: social-card images first, because they're what the publisher
 * chose to represent the product, then inline images in document order. A bare
 * landing page often has nothing BUT an og:image — §6.4.6 estimates ~80% have
 * one and ~5% have three real screenshots, which is precisely the cohort this
 * ordering serves.
 */
export function extractCandidateImages(
  html: string,
  baseUrl: string,
  limit = 12
): CandidateImage[] {
  const found: CandidateImage[] = [];
  const seen = new Set<string>();

  const push = (raw: string | undefined, source: CandidateImage["source"]) => {
    if (!raw) return;
    const url = absolutize(raw.trim(), baseUrl);
    if (!url || seen.has(url) || isJunk(url)) return;
    seen.add(url);
    found.push({ url, source });
  };

  // Meta tags: property= and name= both appear in the wild, in either order.
  const metaPattern =
    /<meta[^>]+(?:property|name)=["'](og:image(?::url)?|twitter:image(?::src)?)["'][^>]*>/gi;
  for (const tag of html.match(metaPattern) ?? []) {
    const content = /content=["']([^"']+)["']/i.exec(tag)?.[1];
    push(content, /twitter/i.test(tag) ? "twitter" : "og");
  }

  const imgPattern = /<img[^>]+>/gi;
  for (const tag of html.match(imgPattern) ?? []) {
    // `srcset` first: it usually carries the highest-resolution variant, and a
    // downscaled hero is much harder to classify than a full-size one.
    const srcset = /srcset=["']([^"']+)["']/i.exec(tag)?.[1];
    if (srcset) {
      const largest = srcset
        .split(",")
        .map((entry) => entry.trim().split(/\s+/)[0])
        .filter(Boolean)
        .pop();
      push(largest, "img");
    }
    push(/(?:^|\s)src=["']([^"']+)["']/i.exec(tag)?.[1], "img");
    // Lazy-loaded images keep the real URL in a data attribute.
    push(/data-src=["']([^"']+)["']/i.exec(tag)?.[1], "img");
  }

  return found.slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

export const ASSET_KINDS = [
  "product_screenshot",
  "stock_photo",
  "illustration",
  "logo",
  "person",
  "other",
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

/** Only this counts as real product imagery. Everything else is decoration. */
export function isUsableProductImage(kind: AssetKind): boolean {
  return kind === "product_screenshot";
}

export interface LibraryVerdict {
  realScreenshots: number;
  total: number;
  /** Zero real screenshots = degraded, and the moment to ask (§6.4.2). */
  degraded: boolean;
  /** Below this we can still work, but video quality suffers. */
  thin: boolean;
  breakdown: Record<AssetKind, number>;
}

/** §7.1: a TikTok photo slideshow wants several real screenshots, not one. */
export const HEALTHY_SCREENSHOT_FLOOR = 3;

/**
 * The production trigger.
 *
 * `degraded` is the one that changes behavior — it means we have NO real
 * product imagery, so anything we generate would be decoration around a claim.
 * That's when Maya asks the founder for screenshots, and only then.
 */
export function assessLibrary(
  kinds: ReadonlyArray<AssetKind>
): LibraryVerdict {
  const breakdown = Object.fromEntries(
    ASSET_KINDS.map((k) => [k, 0])
  ) as Record<AssetKind, number>;
  for (const kind of kinds) breakdown[kind] += 1;

  const realScreenshots = breakdown.product_screenshot;
  return {
    realScreenshots,
    total: kinds.length,
    degraded: realScreenshots === 0,
    thin: realScreenshots > 0 && realScreenshots < HEALTHY_SCREENSHOT_FLOOR,
    breakdown,
  };
}

/**
 * The prompt. Kept as a constant because it IS the measurement — the spike's
 * numbers and production's trigger both depend on it meaning the same thing
 * every time.
 *
 * Deliberately forces a choice with no hedging option beyond `other`: a
 * classifier allowed to say "possibly a screenshot" produces a number nobody
 * can act on.
 */
export const CLASSIFIER_PROMPT = `You are classifying an image taken from a software product's marketing page.

Answer with EXACTLY ONE of these words and nothing else:

product_screenshot - a real screenshot of actual software: a UI, dashboard, app screen, code editor, terminal, or a device mockup whose SCREEN shows real product UI
stock_photo - a photograph not of this product: office scenes, hands on laptops, abstract photography
illustration - drawings, 3D renders, abstract gradients, decorative graphics, hero art with no real UI
logo - a logo, wordmark, or icon
person - a photo whose subject is a person or people (headshots, team photos, testimonials)
other - anything else, or you cannot tell

A gradient background with a headline is illustration, NOT product_screenshot.
A device mockup is product_screenshot ONLY if the screen shows real UI.`;

async function fetchAsBase64(
  url: string
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; HeyMayaBot/1.0)" },
    });
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!mimeType.startsWith("image/")) return null;
    const buffer = await response.arrayBuffer();
    // Gemini's inline limit is ~20MB; anything near it is a bad candidate
    // anyway, and paying to upload it teaches us nothing.
    if (buffer.byteLength > 4_000_000) return null;
    return {
      data: Buffer.from(buffer).toString("base64"),
      mimeType,
    };
  } catch {
    return null;
  }
}

/** Coerce a model reply to a known kind. Anything unrecognized is `other`. */
export function parseKind(reply: string): AssetKind {
  const normalized = reply.trim().toLowerCase().replace(/[^a-z_]/g, "");
  return (ASSET_KINDS as ReadonlyArray<string>).includes(normalized)
    ? (normalized as AssetKind)
    : "other";
}

/**
 * Classify images with Gemini vision.
 *
 * An image that can't be fetched or classified is reported as a failure rather
 * than defaulted to a kind. Defaulting to `other` would understate quality;
 * defaulting to `product_screenshot` would overstate it. Both corrupt the one
 * number this exists to produce.
 */
export const classifyImages = internalAction({
  args: { urls: v.array(v.string()), model: v.optional(v.string()) },
  handler: async (
    _ctx,
    args
  ): Promise<{
    results: Array<{ url: string; kind: AssetKind }>;
    failed: string[];
  }> => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.error("[maya.assetClassifier] GEMINI_API_KEY missing");
      return { results: [], failed: [...args.urls] };
    }
    const model = args.model ?? "gemini-3-flash-preview";

    const results: Array<{ url: string; kind: AssetKind }> = [];
    const failed: string[] = [];

    for (const url of args.urls) {
      const image = await fetchAsBase64(url);
      if (!image) {
        failed.push(url);
        continue;
      }
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: CLASSIFIER_PROMPT },
                    { inline_data: { mime_type: image.mimeType, data: image.data } },
                  ],
                },
              ],
              generationConfig: { temperature: 0, maxOutputTokens: 2000 },
            }),
          }
        );
        if (!response.ok) {
          failed.push(url);
          continue;
        }
        const body = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = body.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("");
        if (!text) {
          failed.push(url);
          continue;
        }
        results.push({ url, kind: parseKind(text) });
      } catch {
        failed.push(url);
      }
    }

    return { results, failed };
  },
});

/** Fetch a page and pull its candidate images. Separate so the spike can reuse it. */
export const extractFromUrl = internalAction({
  args: { url: v.string(), limit: v.optional(v.number()) },
  handler: async (
    _ctx,
    args
  ): Promise<{ images: CandidateImage[]; ok: boolean; status?: number }> => {
    try {
      const response = await fetch(args.url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; HeyMayaBot/1.0)" },
      });
      if (!response.ok) return { images: [], ok: false, status: response.status };
      const html = await response.text();
      return {
        images: extractCandidateImages(html, args.url, args.limit ?? 12),
        ok: true,
        status: response.status,
      };
    } catch {
      return { images: [], ok: false };
    }
  },
});
