/**
 * ⭐ `adapt-crosspost` (§3433, Sprint 7) — one asset, three channels.
 *
 * > **Judgment:** one asset, three channels — hook, caption, hashtags, and
 * > title each shift to that channel's register; **the caption's first line is
 * > a hook, never a description.**
 * >
 * > **Hard rules:** **never carbon-copy across TikTok/Reels/Shorts** —
 * > identical captions are a recognizable tell · **hashtags are selected from
 * > mined sets, never invented** (§7.5.9) · honor per-channel counts (X: 1–2
 * > max).
 *
 * ## Why the hard rules are code
 *
 * They are the three things a prompt reliably fails at under pressure, and all
 * three fail *silently* — a carbon-copied caption looks fine in isolation, an
 * invented hashtag looks like a hashtag, and a fifth tag on X looks like
 * enthusiasm. None of them produces an error anywhere.
 *
 * §2.4: anything promised to the user is enforced by the server. The prompt
 * still carries them, because a model told the rule produces better output than
 * a model corrected afterwards — but the check is what makes them true.
 *
 * ## What comes from where
 *
 * | | Source |
 * |---|---|
 * | register, what decides reach, caption vs title | `PLATFORM_ALGO/{channel}.md` |
 * | which tags exist at all | the mined set (§7.5.9) |
 * | the ceilings below | here, because a ceiling is enforcement |
 *
 * ⚠️ The counts appear in both the markdown and this file, which is a
 * duplication worth being deliberate about. The markdown *teaches* — it says
 * why X tolerates one tag and TikTok wants a few specific ones. This file
 * *enforces*, and enforcement can't live in prose a model may or may not have
 * read. The markdown may drift downward safely; it can never raise the ceiling.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { MAYA_PLATFORM_ALGO } from "../agents/packs/maya/bundledSkills";

/** Form work, not substance. The register shift is the whole job. */
export const CROSSPOST_MODEL = "openai/gpt-5.6-luna-pro";

/**
 * Hard ceilings. §3433 names X's explicitly; the rest come from §7.5.9's table.
 *
 * ⚠️ A ceiling, not a target. Fewer is always allowed and usually better —
 * §7.5.9: *"A few specific ones beat many broad ones."*
 */
export const TAG_CEILING: Record<string, number> = {
  x: 2,
  tiktok: 5,
  instagram: 5,
  youtube: 3,
};

export const DEFAULT_TAG_CEILING = 3;

export interface ChannelVariant {
  channel: string;
  caption: string;
  hashtags: string[];
  /** YouTube only — a title is a promise, not a caption. */
  title?: string;
}

export interface CrosspostResult {
  ok: boolean;
  variants: ChannelVariant[];
  detail: string;
  failure?: "no_channels" | "no_plan" | "carbon_copy";
  /** Tags the model proposed that weren't in the mined set. Dropped, and named. */
  droppedTags?: string[];
}

const SYSTEM = `You are adapting ONE piece of content for several social channels.

The substance is fixed — it is the same post. What changes is the form: the
hook, the caption's register, and (on YouTube) the title.

Return STRICT JSON, no prose:
{ "variants": [ { "channel": string, "caption": string, "title"?: string,
                  "hashtags": string[] } ] }

Rules:
- **Never write the same caption twice.** Identical captions across TikTok and
  Instagram are one of the most recognisable signs of an automated account.
  Different opening, different length, different emphasis — not a reworded
  version of one caption.
- The caption's FIRST LINE is a hook, never a description of the video. Do not
  describe what the viewer can already see.
- YouTube gets a "title" as well. A title is a promise about what the next
  thirty seconds contain. Specific beats clever.
- Hashtags: choose ONLY from the list you are given for that channel. Do not
  invent one, do not adjust the spelling, do not add a general one you think is
  missing. If none of them fit, return an empty list — that is a correct answer.
- Write in the founder's register, not a brand voice.

You are given each channel's norms. Follow them; they are more specific than
these instructions and they win where they disagree.`;

/* -------------------------------------------------------------------------- */

/**
 * ⭐ Only tags that were actually mined survive.
 *
 * §7.5.9: *"hashtags are selected from mined sets, never invented."* A model
 * asked for tags will always produce plausible ones, and a plausible tag with
 * no audience behind it is indistinguishable from a good one until it reaches
 * nobody.
 *
 * Compared case-insensitively and without the `#`, because that is presentation
 * — rejecting `#SoloFounder` when `solofounder` was mined would drop a correct
 * tag on a technicality.
 */
export function keepMinedTags(
  proposed: string[],
  mined: string[]
): { kept: string[]; dropped: string[] } {
  const allowed = new Map(mined.map((t) => [normaliseTag(t), t]));
  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();

  for (const raw of proposed) {
    const key = normaliseTag(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const match = allowed.get(key);
    if (match) kept.push(match);
    else dropped.push(raw);
  }
  return { kept, dropped };
}

export function normaliseTag(tag: string): string {
  return tag.trim().replace(/^#/, "").toLowerCase();
}

/** A ceiling, applied after filtering so a dropped tag doesn't cost a slot. */
export function capTags(channel: string, tags: string[]): string[] {
  return tags.slice(0, TAG_CEILING[channel] ?? DEFAULT_TAG_CEILING);
}

/**
 * ⭐ Are any two of these effectively the same caption?
 *
 * ⚠️ Compared on normalised text, because the tell survives cosmetic edits. A
 * caption reposted with different capitalisation, an added emoji, or a swapped
 * hashtag is still the same caption to anyone who follows the account on two
 * platforms — and that is who notices.
 *
 * Deliberately does NOT do fuzzy similarity. A threshold would need tuning,
 * would fail differently per language, and would eventually reject two captions
 * that genuinely differ. Exact-after-normalisation catches the actual failure —
 * a model returning one caption for every channel — without guessing.
 */
export function carbonCopies(variants: ChannelVariant[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const variant of variants) {
    const key = normaliseCaption(variant.caption);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), variant.channel]);
  }
  return [...groups.values()].filter((channels) => channels.length > 1);
}

export function normaliseCaption(caption: string): string {
  return caption
    .toLowerCase()
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/* -------------------------------------------------------------------------- */

export const adaptCrosspost = internalAction({
  args: {
    customerId: v.id("customers"),
    /** The post, as written for its primary channel. */
    text: v.string(),
    channels: v.array(v.string()),
    /** What the asset shows, so a caption doesn't describe it back. */
    assetSummary: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CrosspostResult> => {
    const channels = [...new Set(args.channels.map((c) => c.trim().toLowerCase()))]
      .filter(Boolean);
    if (channels.length === 0) {
      return {
        ok: false,
        variants: [],
        failure: "no_channels",
        detail: "no channels to adapt this for",
      };
    }

    // Mined sets, per channel. Empty is a real answer and stays empty.
    const minedByChannel: Record<string, string[]> = {};
    for (const channel of channels) {
      const mined = await ctx.runQuery(internal.maya.formats.hashtagsFor, {
        customerId: args.customerId,
        channel,
      });
      minedByChannel[channel] = mined.map((m: { tag: string }) => m.tag);
    }

    const prompt = [
      `THE POST:\n${args.text}`,
      args.assetSummary ? `THE ASSET SHOWS: ${args.assetSummary}` : "",
      `CHANNELS: ${channels.join(", ")}`,
      ...channels.map((channel) => {
        const norms = MAYA_PLATFORM_ALGO[channel];
        const tags = minedByChannel[channel];
        return (
          `--- ${channel.toUpperCase()} ---\n` +
          (norms ? `${norms}\n` : "") +
          (tags.length > 0
            ? `HASHTAGS YOU MAY USE (choose from these ONLY, at most ${
                TAG_CEILING[channel] ?? DEFAULT_TAG_CEILING
              }):\n${tags.map((t) => `#${t}`).join(" ")}`
            : `HASHTAGS: none available for this channel. Return an empty list — do not invent any.`)
        );
      }),
    ]
      .filter(Boolean)
      .join("\n\n");

    const { callModel } = await import("./llm");
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";

    let variants: ChannelVariant[] = [];
    const dropped: string[] = [];

    /**
     * One retry, and only for a carbon copy.
     *
     * ⚠️ The retry is told which channels collided. A bare "try again" gets the
     * same output — the model didn't know it had repeated itself, because from
     * inside one generation it hadn't.
     */
    let collisionNote = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages = [
        { role: "system" as const, content: SYSTEM },
        { role: "user" as const, content: prompt },
      ];
      if (collisionNote) {
        messages.push({ role: "user" as const, content: collisionNote });
      }

      let raw = "";
      try {
        const completion = await callModel(ctx, {
          customerId: args.customerId,
          purpose: "adapt_crosspost",
          apiKey,
          model: CROSSPOST_MODEL,
          temperature: 0.8,
          maxTokens: 1200,
          messages,
        });
        if (!completion.ok) {
          console.error(`[crosspost] call failed: ${completion.reason}`);
          break;
        }
        raw = completion.content;
      } catch (error) {
        console.error(
          `[crosspost] threw: ${error instanceof Error ? error.message : String(error)}`
        );
        break;
      }

      const parsed = parseVariants(raw, channels);
      variants = parsed.map((variant) => {
        const { kept, dropped: bad } = keepMinedTags(
          variant.hashtags,
          minedByChannel[variant.channel] ?? []
        );
        dropped.push(...bad);
        return { ...variant, hashtags: capTags(variant.channel, kept) };
      });

      const collisions = carbonCopies(variants);
      if (collisions.length === 0) break;

      collisionNote =
        `These channels got the SAME caption: ${collisions
          .map((group) => group.join(" and "))
          .join("; ")}. ` +
        `Rewrite so each one is genuinely different — a different opening and a ` +
        `different length, not a reworded version of the same sentence.`;
      console.warn(`[crosspost] attempt ${attempt + 1}: ${collisionNote}`);
    }

    if (variants.length === 0) {
      return {
        ok: false,
        variants: [],
        failure: "no_plan",
        detail: "I couldn't get versions of this that suited each channel.",
      };
    }

    /**
     * ⚠️ A surviving carbon copy FAILS. It does not ship with a warning.
     *
     * §3433 calls identical captions "a recognizable tell", and the whole
     * product claim is that this doesn't read as automated. Posting the same
     * caption to TikTok and Reels is the single most legible sign that it does.
     */
    const collisions = carbonCopies(variants);
    if (collisions.length > 0) {
      return {
        ok: false,
        variants,
        failure: "carbon_copy",
        detail: `I couldn't get ${collisions[0].join(" and ")} to read differently enough — posting the same words to both is the thing that makes an account look automated. Leaving it for now.`,
        droppedTags: dropped.length > 0 ? [...new Set(dropped)] : undefined,
      };
    }

    return {
      ok: true,
      variants,
      detail: `${variants.length} versions, one per channel.`,
      droppedTags: dropped.length > 0 ? [...new Set(dropped)] : undefined,
    };
  },
});

/* -------------------------------------------------------------------------- */

/**
 * ⚠️ Only channels that were ASKED for.
 *
 * A model returning a helpful fourth channel would otherwise produce a variant
 * for an account the founder hasn't connected — and the publish path would then
 * either fail confusingly or, worse, post somewhere unexpected.
 */
export function parseVariants(raw: string, channels: string[]): ChannelVariant[] {
  let parsed: { variants?: unknown };
  try {
    parsed = JSON.parse(
      raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()
    ) as { variants?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.variants)) return [];

  const wanted = new Set(channels);
  const seen = new Set<string>();
  const out: ChannelVariant[] = [];

  for (const entry of parsed.variants) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const channel =
      typeof e.channel === "string" ? e.channel.trim().toLowerCase() : "";
    if (!wanted.has(channel) || seen.has(channel)) continue;

    const caption = typeof e.caption === "string" ? e.caption.trim() : "";
    if (!caption) continue;

    seen.add(channel);
    const variant: ChannelVariant = {
      channel,
      caption,
      hashtags: Array.isArray(e.hashtags)
        ? e.hashtags.filter((t): t is string => typeof t === "string")
        : [],
    };
    // A title is YouTube's, and meaningless elsewhere.
    if (channel === "youtube" && typeof e.title === "string" && e.title.trim()) {
      variant.title = e.title.trim();
    }
    out.push(variant);
  }
  return out;
}
