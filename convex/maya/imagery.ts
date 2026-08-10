/**
 * ⭐ The generated rung (§7.5.1, Sprint 7) — backgrounds, never UI.
 *
 * §7.5.1's three reinforcements on the fixed frame:
 *
 * > 1. **Pass the previous slide as a style reference.** Slide N sees slide N−1.
 * > 2. **Deterministic text rendering.** Headlines are composited as real text.
 * > 3. **A set-level critic pass.**
 *
 * (2) is `slides.ts` and (3) is `carousel.ts`. This is (1).
 *
 * ## What this is allowed to draw, and what it is not
 *
 * ⚠️ **Never a product interface.** §2.7 — *"never a fabricated UI, an invented
 * metric, or a fake testimonial"* — and a generated screenshot is the single
 * most damaging thing this rung could produce: it looks like evidence, it is
 * indistinguishable from the real thing at a glance, and it would be on the
 * founder's own account making a claim about their own product.
 *
 * So the prompt forbids it and `sanitiseBrief` refuses briefs that ask for it.
 * A model can be talked into a dashboard by an innocent-sounding brief; the
 * check is what makes the rule hold.
 *
 * §7.5.3 is the other half: **an avatar is never a silent default**, and
 * `assetFloor.ASSET_RANK` already places `generated_background` BELOW
 * `product_screenshot`. This rung exists for the slides where there is nothing
 * real to show — not as a substitute for something there is.
 *
 * ## What it costs, and why it is off by default
 *
 * Measured 2026-08-08: **$0.039 per image**, not the $0.03 §7.5.4a assumed —
 * that comparison priced per-image against a per-set figure. At one background
 * per set and a daily cadence that is ~$1.20/customer/month; at four per set it
 * is ~$4.80. The cheap path — real text on brand colours — remains free and
 * remains the default, which is what makes a daily placement cost nothing.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { BrandKit } from "./brandKit";

/**
 * Nano Banana 2 = Gemini 3.1 Flash Image. The frozen `generate_slide_image`
 * already routes here; this reuses the model rather than introducing a second.
 */
export const IMAGE_MODEL =
  process.env.MAYA_SLIDE_MODEL ?? "google/gemini-3.1-flash-image-preview";

/** Measured, not quoted. §7.5.4a's $0.03 compared per-image to per-set. */
export const IMAGE_COST_USD = 0.039;

/**
 * ⚠️ Briefs that would produce something claiming to be the product.
 *
 * Checked as words rather than judged by a model on purpose: this is a hard
 * rule with a closed shape, it must hold when the judge is unreachable, and a
 * false positive costs one plain background — which is the fallback anyway.
 */
export const FORBIDDEN_SUBJECTS = [
  "screenshot",
  "dashboard",
  "user interface",
  "ui mockup",
  "app screen",
  "web app",
  "settings page",
  "chart showing",
  "graph showing",
  "testimonial",
  "review from",
  "logo of",
];

export interface BriefCheck {
  ok: boolean;
  /** Which phrase tripped it, so the caller can say what it won't draw. */
  matched?: string;
}

/**
 * ⭐ Refuse a brief that asks for fabricated evidence.
 *
 * Pure, so the rule is checkable without a vendor — and so the list of things
 * we will not draw is readable in one place rather than buried in a prompt.
 */
export function sanitiseBrief(brief: string): BriefCheck {
  const haystack = brief.toLowerCase();
  for (const subject of FORBIDDEN_SUBJECTS) {
    if (haystack.includes(subject)) return { ok: false, matched: subject };
  }
  return { ok: true };
}

const SYSTEM_RULES = `You are producing a BACKGROUND TREATMENT for one slide of a social carousel.

Hard rules:
- Produce an abstract or photographic background ONLY. Texture, gradient,
  material, light, a real-world object, a scene.
- NEVER draw a user interface, an app screen, a dashboard, a chart with numbers,
  a logo, or anything that could be mistaken for a screenshot of a product. If
  the brief seems to ask for one, draw the mood instead.
- NEVER draw text, letterforms, numbers, or anything resembling writing. The
  headline is composited on top as real type afterwards, and generated
  letterforms are the most recognisable AI tell there is.
- Leave the upper third calm and low-contrast. Type goes there and has to stay
  readable.
- Vertical 9:16, 1080x1920.

Not corporate stock photography. Not a glossy 3D render. Not the same purple
gradient every AI image generator produces.`;

export interface GeneratedImage {
  ok: boolean;
  base64?: string;
  mime?: string;
  reason?: string;
}

/**
 * Generate one background.
 *
 * `styleReferenceUrl` is §7.5.1's chaining: the previous slide is passed as an
 * input image so this one inherits its palette and treatment. That is the
 * capability these models are specifically good at, and it is what keeps a set
 * looking like a set rather than four unrelated pictures.
 */
export async function generateBackground(
  ctx: ActionCtx,
  input: {
    customerId: Id<"customers">;
    brief: string;
    kit?: BrandKit | null;
    styleReferenceUrl?: string;
  }
): Promise<GeneratedImage> {
  const check = sanitiseBrief(input.brief);
  if (!check.ok) {
    // Named, not silently softened — the caller should be able to say what it
    // refused and why, in the founder's language.
    return {
      ok: false,
      reason: `that brief asks for a "${check.matched}", and I won't draw something that looks like real evidence`,
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) return { ok: false, reason: "image generation isn't configured" };

  const palette = input.kit?.palette;
  const paletteLine = palette
    ? `Work in these colours: ${[palette.background, palette.primary, palette.accent]
        .filter(Boolean)
        .join(", ")}.`
    : "";

  const parts: Array<Record<string, unknown>> = [];
  if (input.styleReferenceUrl) {
    parts.push({
      type: "image_url",
      image_url: { url: input.styleReferenceUrl },
    });
  }
  parts.push({
    type: "text",
    text: [
      SYSTEM_RULES,
      paletteLine,
      input.styleReferenceUrl
        ? "The attached image is the previous slide in this set. Match its palette, texture and mood so the two read as one set — do NOT copy its composition."
        : "",
      `THIS SLIDE: ${input.brief}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: parts }],
      }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: `couldn't reach the image model: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (!res.ok) return { ok: false, reason: `image model returned ${res.status}` };

  const payload = (await res.json()) as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
  };

  const image = parseDataUrl(payload.choices?.[0]?.message?.images ?? []);

  /**
   * ⚠️ Cost is recorded whether or not an image came back.
   *
   * A refused or empty generation is still billed by the vendor, and a ledger
   * that only counts successes understates spend exactly when something is
   * going wrong repeatedly — which is when the number matters most.
   */
  try {
    await ctx.runMutation(internal.maya.cogs.record, {
      customerId: input.customerId,
      vendor: "openrouter",
      resource: IMAGE_MODEL,
      purpose: "slide_background",
      costUsd: IMAGE_COST_USD,
    });
  } catch (error) {
    console.error(`[imagery] cost recording failed: ${String(error)}`);
  }

  if (!image) return { ok: false, reason: "the image model returned no image" };
  return { ok: true, base64: image.data, mime: image.mime };
}

/** The generated image arrives as a base64 data URL on `message.images[]`. */
export function parseDataUrl(
  images: Array<{ image_url?: { url?: string } }>
): { mime: string; data: string } | null {
  for (const image of images) {
    const url = image.image_url?.url;
    if (!url) continue;
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) return { mime: match[1], data: match[2] };
  }
  return null;
}

/**
 * ⭐ Generate a background and store it, so a slide can reference it by URL.
 *
 * Marked `generated_background` rather than `image`, because §7.5.3's ordering
 * only works if an asset says what it is — an unlabelled generated asset would
 * rank alongside a real screenshot and get chosen over one.
 */
export const backgroundFor = internalAction({
  args: {
    customerId: v.id("customers"),
    brief: v.string(),
    /** The previous slide's URL — §7.5.1's style reference. */
    styleReferenceUrl: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; url?: string; assetId?: Id<"mediaAssets">; reason?: string }> => {
    const kit = await ctx.runQuery(internal.maya.brandKit.brandKitFor, {
      customerId: args.customerId,
    });

    const generated = await generateBackground(ctx, {
      customerId: args.customerId,
      brief: args.brief,
      kit,
      styleReferenceUrl: args.styleReferenceUrl,
    });
    if (!generated.ok || !generated.base64) {
      return { ok: false, reason: generated.reason };
    }

    const stored = await ctx.runAction(internal.maya.media.storeRendered, {
      customerId: args.customerId,
      pngBase64: generated.base64,
      caption: `background — ${args.brief.slice(0, 80)}`,
      now: args.now,
    });
    if (!stored.ok) return { ok: false, reason: stored.error };

    /**
     * ⚠️ Labelled, or §7.5.3's ordering silently breaks.
     *
     * `assetFloor.ASSET_RANK` puts `generated_background` below
     * `product_screenshot`. An unlabelled generated asset would rank alongside
     * a real screenshot and get chosen over one — which is the exact inversion
     * the authenticity floor exists to prevent.
     */
    await ctx.runMutation(internal.maya.media.applyTags, {
      assetId: stored.assetId,
      caption: `background — ${args.brief.slice(0, 80)}`,
      classifiedAs: "generated_background",
      tagsJson: JSON.stringify(["generated", "background"]),
    });

    return { ok: true, url: stored.url, assetId: stored.assetId };
  },
});
