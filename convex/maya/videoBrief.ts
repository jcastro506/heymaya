/**
 * ⭐ The video brief and the storyboard check (§7.5.4, §7.5.36 — Sprint 9).
 *
 * > *"before any render, send the founder the exact stills and wait. **Zero
 * > credits either way.** A wrong screenshot caught here costs nothing; caught
 * > after the render it costs the render."*
 *
 * ## Why this is not Creatify's preview endpoint
 *
 * `preview_list_async` → `render_single_preview` already exists in
 * `convex/integrations/creatify/`, and it answers a different question. Checked
 * against the published OpenAPI (§7.5.36): each preview carries `media_job`,
 * `visual_style`, an embeddable *player* URL and an aspect ratio — **no image,
 * thumbnail, scene or frame field anywhere**, and `video_thumbnail` stays null
 * until the final render. It asks *"which look?"*, not *"is this scene right?"*,
 * and it bills 1 credit per preview.
 *
 * ## What we do instead, for free
 *
 * Because §7.6.2 makes us **always** use `link_with_params` and never let
 * Creatify scrape, every image in the render is one WE picked from the media
 * library. So the storyboard is assemblable from things already in hand:
 *
 * | Scene | The still we already hold | The words |
 * |---|---|---|
 * | avatar | persona `preview_image_9_16` — a free GET | that scene's line |
 * | b-roll | **the actual media-library asset** | its voiceover line |
 *
 * Strictly better than the vendor preview on three axes: it costs **zero**, it
 * shows the *exact* frames rather than a representative style, and it rides the
 * approval loop that already exists — the founder answers in Telegram.
 *
 * ## ⚠️ It never invents a shot
 *
 * §2.7's floor covers images: a fabricated UI is the one thing this system may
 * not produce, and *"the brief called for a dashboard"* is precisely the
 * innocent-sounding reason it would get made. A scene with no real asset is a
 * **named failure**, never a generated placeholder — which is why
 * `buildBrief` returns a reason instead of a brief when the library is short.
 */

import type { Id } from "../_generated/dataModel";
import type { Rung } from "./preSpendGate";

/**
 * Creatify's own vocabulary, kept verbatim so the request body is the doc.
 * §3.2 of `docs/CREATIFY_API_REFERENCE.md`.
 */
export const ASPECT_RATIO = "9x16";
export const TARGET_PLATFORM = "tiktok";

/** §3.2: `video_length` ∈ {15,30,45,60}. Anything else is rejected upstream. */
export const VIDEO_LENGTHS = [15, 30, 45, 60] as const;
export type VideoLength = (typeof VIDEO_LENGTHS)[number];

/**
 * ⚠️ The floor that makes a storyboard worth showing.
 *
 * One asset is a slideshow, not a video. Below this the honest answer is to ask
 * the founder for footage (§7.5.3's authenticity ladder puts founder footage
 * first and the avatar last) rather than to pad the cut with the same
 * screenshot three times.
 */
export const MIN_BROLL_SCENES = 2;

export type SceneKind = "avatar" | "broll";

export interface Scene {
  kind: SceneKind;
  /**
   * ⭐ The exact frame the founder will see, and the whole point of §7.5.36.
   * For b-roll this is a real media-library asset's public URL; for an avatar
   * it is the persona's `preview_image_9_16`. Never a placeholder.
   */
  still: string;
  /** What is said over it. This is the script, scene by scene. */
  line: string;
  /** Present for b-roll — so a rejected still can be swapped by id. */
  assetId?: Id<"mediaAssets">;
  /** Present for an avatar scene — Creatify's `persona id`. */
  personaId?: string;
}

export interface VideoBrief {
  rung: Rung;
  /** The idea this traces back to. §6: every post traces to a real person. */
  ideaId: Id<"ideas">;
  scenes: Scene[];
  /**
   * ⭐ The grounded script — HYBRID mode, per §3.2. We pass `override_script`
   * rather than letting Creatify write it, because the script is the half we
   * are actually good at and the half that can make an unsupported claim.
   */
  script: string;
  length: VideoLength;
  /** Real product images, for `link_with_params`. Never Creatify's scrape. */
  imageUrls: string[];
  /**
   * ⭐ Only on the `ad_clone` rung — the proven video whose SHAPE we recreate.
   * ⚠️ Structure only. A clone that reproduces someone else's claims is a
   * defect, not a feature (§7.5.3).
   */
  referenceVideoUrl?: string;
  /**
   * ⭐ What this video is actually being built from, in the founder's words —
   * `assetFloor.planAssets().detail`. §7.5.3 requires that an avatar is never
   * a silent default, and the only way that rule is real is if the sentence
   * reaches him BEFORE he says yes.
   */
  assetNote?: string;
  /** The rung that actually built this — see `mediaAssets.builtFrom`. */
  builtFrom?: string;
  /**
   * ⚠️ True when nothing better than a generated presenter was available.
   * Carried as a FLAG as well as prose so a gate can act on it — prose can be
   * rewritten by a prompt change, a boolean cannot.
   */
  usesAvatar?: boolean;
}

export type BriefFailure =
  | "no_assets"
  | "too_few_assets"
  | "no_script"
  | "no_product_truth";

export interface BriefResult {
  ok: boolean;
  brief?: VideoBrief;
  failure?: BriefFailure;
  /** Plain language for the founder — never a vendor or a model name (§11). */
  detail: string;
}

export interface AvailableAssetRef {
  assetId: Id<"mediaAssets">;
  url: string;
  /** What it actually shows, so a line can be written to the right frame. */
  caption?: string;
}

/**
 * ⭐ Build the brief, or say precisely why not.
 *
 * Pure, so the ordering is testable without a vendor. §7.5.7's whole argument
 * is that everything expensive is decided **before** the founder is asked, and a
 * decision that depends on a live API is one nobody can reason about later.
 */
export function buildBrief(input: {
  rung: Rung;
  ideaId: Id<"ideas">;
  script: string;
  lines: string[];
  assets: AvailableAssetRef[];
  length?: VideoLength;
  persona?: { id: string; previewImage: string } | null;
  referenceVideoUrl?: string;
  hasProductTruth: boolean;
  /** From `assetFloor.planAssets` — see `VideoBrief.assetNote`. */
  assetNote?: string;
  builtFrom?: string;
  usesAvatar?: boolean;
}): BriefResult {
  if (!input.hasProductTruth) {
    return {
      ok: false,
      failure: "no_product_truth",
      detail:
        "I don't know enough about what you've built yet to write a video about it — tell me what it does and who it's for",
    };
  }

  const script = input.script.trim();
  if (!script) {
    return {
      ok: false,
      failure: "no_script",
      detail: "I couldn't write a script I'd stand behind for this one",
    };
  }

  /**
   * ⚠️ Real assets only. An empty library is the case that matters: three of
   * four channels need a vertical asset, and the honest move is to ask for one
   * rather than to generate a picture of a product we have never seen.
   */
  const usable = input.assets.filter((a) => a.url.trim().length > 0);
  if (usable.length === 0) {
    return {
      ok: false,
      failure: "no_assets",
      detail:
        "I don't have a single real shot of your product, and I won't invent one — send me a screen recording or a few screenshots and I'll make this",
    };
  }
  if (usable.length < MIN_BROLL_SCENES) {
    return {
      ok: false,
      failure: "too_few_assets",
      detail: `I've only got ${usable.length} real shot of your product — one more and I can cut this properly instead of showing the same frame twice`,
    };
  }

  /**
   * One line per scene, in order. Extra lines are dropped rather than crammed
   * onto a frame they were not written for — a mismatched line over a
   * screenshot is the thing a founder notices first.
   */
  const scenes: Scene[] = [];

  if (input.persona) {
    scenes.push({
      kind: "avatar",
      // A free GET from `/api/personas_v2/` — costs nothing to show.
      still: input.persona.previewImage,
      line: input.lines[0] ?? script.split(/(?<=[.!?])\s+/)[0] ?? script,
      personaId: input.persona.id,
    });
  }

  const brollLines = input.persona ? input.lines.slice(1) : input.lines;
  usable.forEach((asset, i) => {
    const line = brollLines[i];
    if (!line) return;
    scenes.push({
      kind: "broll",
      still: asset.url,
      line,
      assetId: asset.assetId,
    });
  });

  if (scenes.filter((s) => s.kind === "broll").length < MIN_BROLL_SCENES) {
    return {
      ok: false,
      failure: "too_few_assets",
      detail:
        "I've got the shots but not enough written to go over them — let me take another run at the script",
    };
  }

  return {
    ok: true,
    detail: `${scenes.length} scenes, every one of them a real shot`,
    brief: {
      rung: input.rung,
      ideaId: input.ideaId,
      scenes,
      script,
      length: input.length ?? 30,
      imageUrls: usable.map((a) => a.url),
      referenceVideoUrl: input.referenceVideoUrl,
      assetNote: input.assetNote,
      builtFrom: input.builtFrom,
      usesAvatar: input.usesAvatar,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The storyboard the founder actually reads                                   */
/* -------------------------------------------------------------------------- */

export interface StoryboardFrame {
  index: number;
  still: string;
  line: string;
  /** "your screenshot" vs "the presenter" — their words, not our schema's. */
  what: string;
}

/**
 * ⭐ What we send, and then WAIT.
 *
 * ⚠️ The waiting is the feature. §7.5.36: *"A wrong screenshot caught here costs
 * nothing; caught after the render it costs the render."* Sending this and
 * proceeding anyway would be a more expensive version of not asking.
 */
export function storyboard(brief: VideoBrief): StoryboardFrame[] {
  return brief.scenes.map((scene, index) => ({
    index: index + 1,
    still: scene.still,
    line: scene.line,
    what: scene.kind === "avatar" ? "the presenter" : "your screenshot",
  }));
}

/**
 * The message body, in plain language.
 *
 * ⚠️ No vendor name, no rung, no scene-kind enum — §11 and acceptance item 7.
 * The founder is being asked one question: are these the right frames?
 */
export interface Inspiration {
  /** The shape she's borrowing, in her words. A format card's `reusableAs`. */
  shape: string;
  /** Where she saw it work. §6 — a source you can't open isn't a source. */
  sourceUrl?: string;
  channel?: string;
}

export function storyboardMessage(
  frames: StoryboardFrame[],
  inspiration?: Inspiration | null
): string {
  const lines: string[] = [];

  /**
   * ⭐ LEAD WITH WHY, not with the frames.
   *
   * ⚠️ The first version opened on "here's what I'd make, frame by frame" —
   * accurate, and it read like a form. A colleague pitching an idea says what
   * gave them the idea first, and the founder's own words for what they wanted
   * were: *"I just had an idea. I saw something on TikTok that inspired me. I
   * want to make this for you, and it's going to go like this."*
   *
   * It is also the honest thing to lead with. The whole product is that she
   * does the homework and borrows shapes that demonstrably travelled in this
   * niche — a storyboard that hides its source is asking for a yes on taste
   * rather than on evidence.
   */
  if (inspiration?.shape) {
    const where = inspiration.channel ? ` on ${inspiration.channel}` : "";
    lines.push(
      `Had an idea. Something${where} caught my eye and I think the shape works for you — ${inspiration.shape}.`
    );
    if (inspiration.sourceUrl) lines.push(`That's the one: ${inspiration.sourceUrl}`);
    lines.push("");
    lines.push("Here's how yours would go:");
  } else {
    // ⚠️ No invented inspiration. When she's building from the idea bank alone,
    // claiming something "caught her eye" would be a fabricated observation.
    lines.push("Had an idea. Here's how it would go:");
  }
  lines.push("");

  for (const f of frames) {
    lines.push(`${f.index}. ${f.what} — "${f.line}"`);
    lines.push(`   ${f.still}`);
  }

  lines.push("");
  lines.push(
    "Nothing's been made yet — say go and I'll build it, or tell me which shot is wrong."
  );
  return lines.join("\n");
}

/**
 * ⭐ §7.5.3's anti-slop half, as checks rather than vibes.
 *
 * > *"is there real footage · is the cut rhythm varied · is the hook shown
 * > rather than explained."*
 *
 * Returns the reasons it would be slop. Empty means it passes. Deliberately
 * returns reasons rather than a boolean so the founder-facing message can name
 * what is wrong — §2.5, a named failure rather than a silent hold.
 */
export function antiSlop(brief: VideoBrief): string[] {
  const reasons: string[] = [];

  const broll = brief.scenes.filter((s) => s.kind === "broll");
  if (broll.length === 0) {
    // The authenticity floor: an all-avatar video is a talking head reading ad
    // copy, which is the exact thing §7.5.3 exists to prevent.
    reasons.push("there's no real footage of the product in it");
  }

  /**
   * Cut rhythm. Every scene the same length is the signature of a template
   * filled in by a machine — the eye reads the metronome before it reads the
   * content.
   */
  const distinctStills = new Set(brief.scenes.map((s) => s.still)).size;
  if (brief.scenes.length > 2 && distinctStills < brief.scenes.length) {
    reasons.push("the same shot repeats, so it plays like a slideshow");
  }

  /**
   * ⭐ The hook has to be SHOWN. A first scene that is the avatar talking is
   * explaining; a first scene that is the product doing the thing is showing.
   */
  if (brief.scenes[0]?.kind === "avatar" && broll.length > 0) {
    reasons.push("it opens on someone explaining instead of on the thing itself");
  }

  return reasons;
}
