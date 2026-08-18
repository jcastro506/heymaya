/**
 * ⭐ The video authenticity floor (§7.5.3, Sprint 7) — ordering enforced in code.
 *
 * §7.5.2's anti-slop system is *entirely about text*, and three of our four
 * channels are video-first. §7.5.3 was added to close that, and it names the
 * tells that matter here:
 *
 * > **Visual** — AI avatars, the single most instantly-recognisable one · stock
 * > footage · generic gradient motion backgrounds · perfectly even cut rhythm
 * >
 * > **Register** — *too produced.* Real short-form is handheld, badly lit,
 * > jump-cut mid-word, and starts before the speaker is ready.
 *
 * ## The ordering, and why it is code rather than a prompt line
 *
 * 1. **Founder footage beats everything.** §6.0.1: *"that's the
 *    best-performing content there is."*
 * 2. **Real product screen recordings** next — an actual UI doing an actual
 *    thing is unfakeable, and we already collect it.
 * 3. **Avatar last, and disclosed**, never a silent default.
 *
 * ⚠️ §7.6.5a records the exact failure this prevents: `startUgcVideoJob`
 * computed `useV2 = wantsScenes && Boolean(overrideAvatar)`, so **no avatar
 * picked quietly became a single-scene video** with a provider default. The
 * founder got an AI talking head they never agreed to, and nothing said so.
 *
 * That is why this returns a *stated* plan rather than a boolean. §7.5.3: *"an
 * avatar in a plan is stated, so the founder can veto it."* A silent choice is
 * the defect; the avatar itself is only the last resort.
 *
 * ## The contradiction this file sits on top of
 *
 * §7.6.6 pins *one avatar + one voice + one music bed per customer, forever* —
 * chosen purely as a COGS optimisation. §7.5.3 points out that this is the most
 * reliably AI-flagged artifact on TikTok: **the cost tiering treated avatars as
 * cheap and never priced them as an authenticity risk.** This file does not
 * resolve that; it makes the choice visible every time it is made.
 */

/** In the order §7.5.3 requires. Index IS the rank — lower wins. */
export const ASSET_RANK = [
  "founder_footage",
  "screen_recording",
  "product_screenshot",
  "generated_background",
  "avatar",
] as const;

export type AssetKind = (typeof ASSET_RANK)[number];

export interface AvailableAsset {
  kind: AssetKind;
  /** Where it lives. An asset with no URL cannot be used, whatever its rank. */
  url?: string;
  /** For a caveat the founder should see — "shot in portrait", "no audio". */
  note?: string;
}

export interface AssetPlan {
  /** What we'll actually build from, best available first. */
  using: AvailableAsset[];
  /** The best rung we could NOT reach, and why — never silent. */
  missing: Array<{ kind: AssetKind; why: string }>;
  /**
   * ⚠️ True when the plan reaches the avatar rung. §7.5.3: stated, so the
   * founder can veto it.
   */
  usesAvatar: boolean;
  /** Plain language, relayed to the founder unchanged. */
  detail: string;
}

const WHY_MISSING: Record<AssetKind, string> = {
  founder_footage:
    "no clips of you yet — a few seconds of you talking beats everything else here",
  screen_recording: "no screen recording of the product yet",
  product_screenshot: "no real screenshots yet",
  generated_background: "nothing to build a background from",
  avatar: "no avatar available",
};

/**
 * Rank what we have and say what we're missing.
 *
 * Pure: the ordering is the product decision, and it should be checkable
 * without a vendor, a render, or a database.
 */
/**
 * ⭐ THE BRIDGE THAT WAS MISSING — and the reason this whole file had zero
 * callers while four production comments claimed it was enforcing the ladder.
 *
 * `mediaAssets.kind` and `ASSET_RANK` are DIFFERENT VOCABULARIES. The table
 * stores what a file IS (screenshot · screen_recording · image · slide · video
 * · logo); the ladder ranks what a file is WORTH for authenticity
 * (founder_footage → screen_recording → product_screenshot →
 * generated_background → avatar). Nobody wrote the translation, so nobody
 * could call `planAssets`, so §7.5.3's central rule — an avatar is never a
 * silent default — was enforced nowhere.
 *
 * ⚠️ `source` is load-bearing, not decoration. The same `image` row is a
 * product screenshot when the founder sent it and a generated background when
 * we made it, and treating those alike is how a stock illustration outranks
 * real footage. Founder-sent beats found beats generated, always.
 *
 * Returns null for rows that are not ladder inputs at all — a logo is brand
 * furniture, and our own rendered `video` is an OUTPUT. Feeding a previous
 * render back in as source footage is a copy of a copy.
 */
export function ladderKindFor(
  kind: string,
  source: string
): AssetKind | null {
  const founderSent = source === "telegram" || source === "onboarding";
  switch (kind) {
    case "screen_recording":
      return "screen_recording";
    case "video":
      // Founder-sent video is the top rung. Our own render is not an input.
      return founderSent ? "founder_footage" : null;
    case "screenshot":
      return "product_screenshot";
    case "image":
      return founderSent ? "product_screenshot" : "generated_background";
    case "slide":
      return "generated_background";
    case "logo":
    default:
      return null;
  }
}

/**
 * ⭐ Turn library rows into a ranked plan.
 *
 * ⚠️ An `avatar` entry is ALWAYS appended. Creatify can always generate a
 * presenter, so the avatar rung is never actually unavailable — and if it were
 * absent from the list, `planAssets` would report "nothing to build this from
 * yet" instead of "this one would use a generated presenter". The second
 * sentence is the one §7.5.3 exists to force the founder to hear. Its rank
 * puts it last, so it only ever wins when nothing real exists.
 */
export function availableFrom(
  rows: ReadonlyArray<{ kind: string; source: string; publicUrl?: string; caption?: string }>
): AvailableAsset[] {
  const mapped: AvailableAsset[] = [];
  for (const row of rows) {
    const kind = ladderKindFor(row.kind, row.source);
    if (!kind) continue;
    mapped.push({ kind, url: row.publicUrl, note: row.caption });
  }
  mapped.push({ kind: "avatar", url: "creatify:avatar" });
  return mapped;
}

export function planAssets(available: AvailableAsset[]): AssetPlan {
  // An asset with no URL is a claim, not an asset.
  const usable = available.filter((a) => a.url && a.url.trim().length > 0);

  const rank = (a: AvailableAsset) => ASSET_RANK.indexOf(a.kind);
  const using = [...usable].sort((a, b) => rank(a) - rank(b));

  const have = new Set(using.map((a) => a.kind));
  const best = using[0] ? rank(using[0]) : ASSET_RANK.length;

  /**
   * Only rungs BETTER than what we're using are reported missing.
   *
   * Listing every absent kind would bury the one that matters: if she has
   * founder footage, "no avatar available" is noise. The founder should hear
   * about the rung that would have improved this video, not an inventory.
   */
  const missing = ASSET_RANK.slice(0, best)
    .filter((kind) => !have.has(kind))
    .map((kind) => ({ kind, why: WHY_MISSING[kind] }));

  const usesAvatar = using.length > 0 && using[0].kind === "avatar";

  let detail: string;
  if (using.length === 0) {
    detail = "nothing to build this from yet";
  } else if (usesAvatar) {
    // ⚠️ Stated, always. This is the sentence §7.5.3 exists to force.
    detail =
      "this one would use a generated presenter — the least convincing option. " +
      (missing.length > 0
        ? `${missing[0].why}. Send me one and I'll use that instead.`
        : "say the word if you'd rather I didn't.");
  } else if (missing.length > 0) {
    detail = `building from ${labelOf(using[0].kind)} — ${missing[0].why}`;
  } else {
    detail = `building from ${labelOf(using[0].kind)}`;
  }

  return { using, missing, usesAvatar, detail };
}

function labelOf(kind: AssetKind): string {
  switch (kind) {
    case "founder_footage":
      return "your own footage";
    case "screen_recording":
      return "a screen recording of the product";
    case "product_screenshot":
      return "real screenshots";
    case "generated_background":
      return "a plain background";
    case "avatar":
      return "a generated presenter";
  }
}

/**
 * ⭐ May this plan be built without asking first?
 *
 * The one hard rule: **an avatar is never a silent default.** Everything else
 * proceeds — a plan that needs approval for a screenshot is a plan that never
 * ships, and §9.1 keeps the closed set of reasons a post may be held.
 *
 * This does NOT hold the post. It says the founder has to have been told, which
 * `publishDecision` already enforces separately on `show_me_first`. Two gates
 * that can each hold a post is how the old system grew ten of them.
 */
export function needsStating(plan: AssetPlan): boolean {
  return plan.usesAvatar;
}
