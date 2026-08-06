/**
 * ⭐ The fixed frame (§7.5.1) — coherence by construction.
 *
 * > *"The concern is valid: generate five slides independently from text
 * > prompts and you get five images that don't look like a set… **But the fix
 * > isn't a better image model — from either vendor.** It's to stop generating
 * > slides and start filling them."*
 *
 * ```
 * slide = [ fixed brand frame ] + [ real screenshot ] + [ headline in brand font ]
 *              identical              the only thing              from the
 *           across the set              that varies               brand kit
 * ```
 *
 * **Nothing can drift because nothing about the frame is being re-decided.**
 * Margins, type scale, logo placement and palette are constants in this file,
 * not decisions a model makes five times.
 *
 * ## Why SVG
 *
 * §7.5.1 asks for *"deterministic text rendering — headlines composited as real
 * text in the brand font, never generated as pixels. That kills the two worst
 * tells at once: garbled letterforms and drifting typography."*
 *
 * SVG **is** that. It is text, it renders real glyphs in a named font, it
 * embeds a screenshot by reference, and it is generated here with no
 * dependency, no vendor and no model call. Rasterising it to PNG is a separate
 * step that can change without touching any of this — which is the point:
 * *"the layout system is ours either way, which is exactly why the vendor
 * choice is reversible."*
 *
 * ## ⚠️ The safe area, which the spec does not mention and which decides
 * whether this looks amateur
 *
 * A 1080×1920 canvas is **not** 1080×1920 of usable space. TikTok puts the
 * caption, handle and sound over the bottom, and the like/comment/share rail
 * over the right. Reels and Shorts do the same in slightly different places.
 * Text placed by canvas centre lands underneath the UI on the one channel it
 * was made for — and it looks like nobody checked, because nobody did.
 *
 * Everything here composes inside {@link SAFE}, which is the intersection of
 * all three.
 */

import type { BrandKit } from "./brandKit";

/* -------------------------------------------------------------------------- */
/* The frame — constants, so no two slides can disagree                        */
/* -------------------------------------------------------------------------- */

/** One 9:16 asset feeds TikTok, Reels and Shorts (§1). */
export const CANVAS = { width: 1080, height: 1920 } as const;

/**
 * Where platform UI does NOT cover the frame.
 *
 * Deliberately the intersection of all three vertical feeds rather than the
 * best case for one. The whole argument for 9:16 is that one asset ships to
 * three channels; a safe area tuned to TikTok alone breaks that.
 */
export const SAFE = {
  top: 250,
  bottom: 400,
  left: 72,
  /** Wider: the action rail lives here on every vertical feed. */
  right: 220,
} as const;

export const SAFE_BOX = {
  x: SAFE.left,
  y: SAFE.top,
  width: CANVAS.width - SAFE.left - SAFE.right,
  height: CANVAS.height - SAFE.top - SAFE.bottom,
} as const;

/**
 * A fixed type scale. Sizes are chosen, never computed per slide.
 *
 * §7.5.1's failure mode is drift, and a scale that adapts to content length is
 * drift with extra steps — the same deck ends up with five different headline
 * sizes and reads as five different decks.
 */
export const TYPE = {
  eyebrow: 34,
  headline: 84,
  body: 44,
  caption: 30,
} as const;

/** Used when the brand kit couldn't see. Neutral, never a plausible guess. */
export const NEUTRAL = {
  background: "#0f0f10",
  text: "#fafafa",
  muted: "#a1a1aa",
  accent: "#fafafa",
  font: "Inter, system-ui, sans-serif",
} as const;

export type SlideLayout =
  | "title"
  | "screenshot"
  | "point"
  | "comparison"
  | "cta";

export interface SlideContent {
  /** The one line that carries the slide. Required for every layout. */
  headline: string;
  /** Small line above the headline — a step number, a label. */
  eyebrow?: string;
  /** Supporting sentence. Layouts that don't use it ignore it. */
  body?: string;
  /** A REAL screenshot from the media library. Never a generated UI (§2.7). */
  imageUrl?: string;
  /** `comparison` only — the two sides. */
  left?: string;
  right?: string;
}

/* -------------------------------------------------------------------------- */
/* Resolving the kit — with gaps, not guesses                                  */
/* -------------------------------------------------------------------------- */

export interface ResolvedTheme {
  background: string;
  text: string;
  muted: string;
  accent: string;
  displayFont: string;
  bodyFont: string;
  logoUrl?: string;
  /** True when the kit supplied nothing and the neutral frame is in use. */
  neutral: boolean;
}

/**
 * Turn a brand kit into the handful of values the frame needs.
 *
 * ⚠️ `observedColors` is NOT read here, deliberately. §6.2's extraction returns
 * those with `paletteConfidence: "observed"` precisely because we cannot say
 * which is the primary — and a frame that picks one anyway would launder an
 * inference into a decision, applied to every asset for months. Observed
 * colours become usable the moment a founder confirms them; until then the
 * neutral frame is the honest output.
 */
export function resolveTheme(kit: BrandKit | null | undefined): ResolvedTheme {
  const palette = kit?.palette;
  const named = Boolean(
    palette && Object.values(palette).some((v) => typeof v === "string" && v)
  );
  return {
    background: palette?.background ?? NEUTRAL.background,
    text: palette?.text ?? NEUTRAL.text,
    muted: NEUTRAL.muted,
    accent: palette?.primary ?? palette?.accent ?? NEUTRAL.accent,
    displayFont: kit?.fonts?.display
      ? `${quoteFont(kit.fonts.display)}, ${NEUTRAL.font}`
      : NEUTRAL.font,
    bodyFont: kit?.fonts?.body
      ? `${quoteFont(kit.fonts.body)}, ${NEUTRAL.font}`
      : NEUTRAL.font,
    logoUrl: kit?.logo?.primary,
    neutral: !named,
  };
}

/** Font names with spaces need quoting in a CSS font stack. */
function quoteFont(name: string): string {
  return /[\s]/.test(name) ? `'${name.replace(/'/g, "")}'` : name;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/** XML-escape. A headline containing `&` or `<` would otherwise break the SVG. */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wrap text to a line budget by character estimate.
 *
 * ⚠️ Approximate on purpose. Real measurement needs font metrics we don't have
 * server-side, and being roughly right here is cheap while being exactly right
 * is a font-loading pipeline. The cap matters more than the precision: a
 * headline that overflows is a broken slide, so `maxLines` truncates rather
 * than letting text run off the frame.
 */
export function wrapLines(
  text: string,
  charsPerLine: number,
  maxLines: number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= charsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

function textBlock(input: {
  lines: string[];
  x: number;
  y: number;
  size: number;
  font: string;
  fill: string;
  weight?: number;
}): string {
  const lineHeight = Math.round(input.size * 1.15);
  return input.lines
    .map(
      (line, i) =>
        `<text x="${input.x}" y="${input.y + i * lineHeight}" font-family="${esc(
          input.font
        )}" font-size="${input.size}" font-weight="${input.weight ?? 600}" fill="${
          input.fill
        }" xml:space="preserve">${esc(line)}</text>`
    )
    .join("\n  ");
}

/**
 * ⭐ Render one slide.
 *
 * Pure and deterministic: same inputs, same bytes. That is what makes a set
 * cohere — and it also makes the whole system testable without a renderer, a
 * vendor, or a network.
 */
export function renderSlide(input: {
  layout: SlideLayout;
  content: SlideContent;
  kit?: BrandKit | null;
  /** Slide n of m, drawn as a progress rule. Omitted for a single image. */
  index?: number;
  total?: number;
}): string {
  const theme = resolveTheme(input.kit);
  const { content, layout } = input;
  const parts: string[] = [];

  parts.push(
    `<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="${theme.background}"/>`
  );

  // The image sits UNDER the safe area, bleeding to the canvas edges, because
  // a screenshot cropped by platform UI is still legible while text is not.
  if (content.imageUrl && (layout === "screenshot" || layout === "title")) {
    parts.push(
      `<image href="${esc(content.imageUrl)}" x="0" y="${SAFE.top}" width="${
        CANVAS.width
      }" height="${CANVAS.height - SAFE.top - SAFE.bottom}" preserveAspectRatio="xMidYMid slice"/>`
    );
    // A scrim, so text over any screenshot stays readable — the alternative is
    // a headline that vanishes on light UIs and nobody notices until it ships.
    parts.push(
      `<rect x="0" y="${SAFE.top}" width="${CANVAS.width}" height="${
        CANVAS.height - SAFE.top - SAFE.bottom
      }" fill="${theme.background}" opacity="0.55"/>`
    );
  }

  let cursorY = SAFE_BOX.y + 40;

  if (content.eyebrow) {
    parts.push(
      textBlock({
        lines: [content.eyebrow.toUpperCase()],
        x: SAFE_BOX.x,
        y: cursorY,
        size: TYPE.eyebrow,
        font: theme.bodyFont,
        fill: theme.accent,
        weight: 700,
      })
    );
    cursorY += TYPE.eyebrow + 36;
  }

  const headlineLines = wrapLines(content.headline, 22, layout === "title" ? 4 : 3);
  parts.push(
    textBlock({
      lines: headlineLines,
      x: SAFE_BOX.x,
      y: cursorY + TYPE.headline,
      size: TYPE.headline,
      font: theme.displayFont,
      fill: theme.text,
      weight: 700,
    })
  );
  cursorY += TYPE.headline * 1.15 * headlineLines.length + 40;

  if (layout === "comparison" && (content.left || content.right)) {
    const colWidth = Math.floor((SAFE_BOX.width - 48) / 2);
    const cols: Array<[string, number]> = [
      [content.left ?? "", SAFE_BOX.x],
      [content.right ?? "", SAFE_BOX.x + colWidth + 48],
    ];
    for (const [text, x] of cols) {
      if (!text) continue;
      parts.push(
        `<rect x="${x}" y="${cursorY}" width="${colWidth}" height="4" fill="${theme.accent}"/>`
      );
      parts.push(
        textBlock({
          lines: wrapLines(text, 18, 5),
          x,
          y: cursorY + 40 + TYPE.body,
          size: TYPE.body,
          font: theme.bodyFont,
          fill: theme.muted,
          weight: 500,
        })
      );
    }
  } else if (content.body && layout !== "screenshot") {
    parts.push(
      textBlock({
        lines: wrapLines(content.body, 34, 4),
        x: SAFE_BOX.x,
        y: cursorY + TYPE.body,
        size: TYPE.body,
        font: theme.bodyFont,
        fill: theme.muted,
        weight: 400,
      })
    );
  }

  if (layout === "cta") {
    // A rule rather than a button: a fake button invites a tap that does
    // nothing, which is a small lie told in pixels.
    const y = SAFE_BOX.y + SAFE_BOX.height - 120;
    parts.push(
      `<rect x="${SAFE_BOX.x}" y="${y}" width="${Math.min(
        420,
        SAFE_BOX.width
      )}" height="6" fill="${theme.accent}"/>`
    );
  }

  if (theme.logoUrl) {
    parts.push(
      `<image href="${esc(theme.logoUrl)}" x="${SAFE_BOX.x}" y="${
        SAFE_BOX.y + SAFE_BOX.height - 56
      }" width="56" height="56" preserveAspectRatio="xMidYMid meet"/>`
    );
  }

  if (input.index && input.total && input.total > 1) {
    const barWidth = Math.floor(SAFE_BOX.width / input.total) - 8;
    for (let i = 0; i < input.total; i += 1) {
      parts.push(
        `<rect x="${SAFE_BOX.x + i * (barWidth + 8)}" y="${
          SAFE_BOX.y + SAFE_BOX.height + 24
        }" width="${barWidth}" height="6" fill="${theme.accent}" opacity="${
          i < input.index ? 1 : 0.25
        }"/>`
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}">`,
    `  ${parts.join("\n  ")}`,
    `</svg>`,
  ].join("\n");
}

/**
 * Render a whole set through one frame.
 *
 * The set is what coheres, so this is the entry point — rendering slides one at
 * a time from different call sites is how a deck drifts even with fixed
 * constants.
 */
export function renderSet(input: {
  slides: Array<{ layout: SlideLayout; content: SlideContent }>;
  kit?: BrandKit | null;
}): string[] {
  return input.slides.map((slide, i) =>
    renderSlide({
      layout: slide.layout,
      content: slide.content,
      kit: input.kit,
      index: i + 1,
      total: input.slides.length,
    })
  );
}
