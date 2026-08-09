/**
 * ⭐ The niche screen — what a keyword search returns is not what it promised.
 *
 * ## The measurement that made this necessary
 *
 * On 2026-08-09 the mined hashtag sets for a solo-founder-SaaS account came
 * back led by **`#games`, `#familygames`, `#fungames`, `#gameideas`**. The
 * format library had cards from a video about whether the earth gets heavier as
 * we build buildings, and one that was a prayer over your business.
 *
 * The niche keywords were *right*: "no time for marketing", "building not
 * marketing", "how promote my app". TikTok's keyword search simply returns
 * loose matches, and `scroll` recorded every one of them.
 *
 * ⚠️ **Nothing looked broken.** The rows were real posts with real metrics, the
 * sweeps reported success, and the pollution only became visible two layers
 * downstream when the hashtag miner ranked tags nobody in this niche would use.
 * `trends.ts` already filtered — it holds non-matching results aside as
 * `foreign` — and `scroll.ts`, which produces far more rows, did not.
 *
 * ## Why a judge and not a keyword test
 *
 * `trends.intersectsNiche` requires the whole keyword phrase to appear in the
 * text. That works there because a trending feed is broad and the filter is
 * meant to be brutal. It would be wrong here: almost nothing legitimately about
 * "no time for marketing" contains that exact phrase, so applying it to scroll
 * would trade a polluted niche for an empty one.
 *
 * §2.3 draws the line — *deterministic code watches; the model judges* — and
 * "is this post about the same thing my customers are" is a judgment. A
 * word-overlap heuristic would be a hardcoded rule that gets it wrong in both
 * directions, which is the failure mode this codebase deliberately avoids.
 *
 * ## The cost, which is the reason this is affordable at all
 *
 * One call per scroll, not one per post. Captions are short, the verdict is a
 * single character per item, and the model is the cheap judge tier. A scroll
 * that collects 100 posts screens them in roughly 2k tokens.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";

/** Cheap judge tier. This is a yes/no on short text, not analysis. */
export const SCREEN_MODEL = "google/gemini-3.1-flash-lite";

/**
 * Items per call.
 *
 * Large enough that the overhead of restating the niche is amortised, small
 * enough that a malformed response costs one batch rather than the sweep.
 */
export const SCREEN_BATCH = 40;

/** Captions are truncated — the first line decides the topic. */
export const MAX_CAPTION_CHARS = 200;

export interface ScreenItem {
  /** Stable identity for the verdict to refer back to. */
  key: string;
  text: string;
}

export const SCREEN_SYSTEM = `You are filtering a list of social posts down to the ones that belong to a specific audience's world.

You get the audience description and a numbered list of posts. For each one,
decide whether someone in that audience would recognise it as being about their
situation.

Return STRICT JSON, no prose:
{ "keep": [ <numbers> ] }

Include a number only if the post belongs. Leave everything else out.

Judge the SUBJECT, not the vocabulary. A post can be relevant without using any
of the audience's words, and a post can repeat their words while being about
something else entirely — a keyword search returns both, which is why you are
here.

Be generous about form and strict about subject. A joke, a rant, a screenshot,
or a one-line complaint all count if they are about this audience's world.
Something in an unrelated field does not count no matter how well it performed.

When you genuinely cannot tell from the text, leave it out. A thin post that
survives is worth less than a clean list.`;

/**
 * The prompt, built as a pure function so the batching and truncation are
 * testable without a model.
 */
export function buildScreenPrompt(niche: string[], items: ScreenItem[]): string {
  const list = items
    .map((item, i) => {
      const text = item.text.replace(/\s+/g, " ").trim().slice(0, MAX_CAPTION_CHARS);
      return `${i + 1}. ${text || "(no caption)"}`;
    })
    .join("\n");
  return `AUDIENCE — the people whose world this is:\n${niche
    .map((k) => `- ${k}`)
    .join("\n")}\n\nPOSTS:\n${list}`;
}

/**
 * ⚠️ Unparseable output keeps EVERYTHING.
 *
 * This is a quality filter, not a safety gate, and the two fail in opposite
 * directions on purpose. A safety gate that can't reach its model must block; a
 * quality filter that can't reach its model must not silently empty the
 * niche — "she saw nothing today" is indistinguishable from a dead account, and
 * that is a far worse failure than a few off-topic rows.
 *
 * The same reasoning as the carousel's set critic.
 */
export function parseKeepSet(raw: string, count: number): Set<number> {
  const all = new Set(Array.from({ length: count }, (_, i) => i));
  let parsed: { keep?: unknown };
  try {
    parsed = JSON.parse(
      raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()
    ) as { keep?: unknown };
  } catch {
    return all;
  }
  if (!Array.isArray(parsed.keep)) return all;

  const keep = new Set<number>();
  for (const entry of parsed.keep) {
    const n = typeof entry === "number" ? entry : Number(entry);
    // 1-indexed in the prompt because models are more reliable with it.
    if (Number.isInteger(n) && n >= 1 && n <= count) keep.add(n - 1);
  }
  return keep;
}

/**
 * ⭐ Keep the posts that belong to this niche.
 *
 * Returns the keys to keep. The caller filters its own rows, so this never
 * needs to know the shape of an observation.
 */
export const screenForNiche = internalAction({
  args: {
    customerId: v.id("customers"),
    niche: v.array(v.string()),
    itemsJson: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ keep: string[]; screened: number; dropped: number; ok: boolean }> => {
    let items: ScreenItem[] = [];
    try {
      items = JSON.parse(args.itemsJson) as ScreenItem[];
    } catch {
      return { keep: [], screened: 0, dropped: 0, ok: false };
    }
    if (items.length === 0 || args.niche.length === 0) {
      // No niche means no basis to judge — keep everything rather than guess.
      return { keep: items.map((i) => i.key), screened: 0, dropped: 0, ok: false };
    }

    const { callModel } = await import("./llm");
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    const keep: string[] = [];
    let ok = true;

    for (let start = 0; start < items.length; start += SCREEN_BATCH) {
      const batch = items.slice(start, start + SCREEN_BATCH);
      try {
        const completion = await callModel(ctx, {
          customerId: args.customerId,
          purpose: "niche_screen",
          apiKey,
          model: SCREEN_MODEL,
          temperature: 0,
          maxTokens: 400,
          messages: [
            { role: "system", content: SCREEN_SYSTEM },
            { role: "user", content: buildScreenPrompt(args.niche, batch) },
          ],
        });
        if (!completion.ok) {
          console.error(`[relevance] screen failed: ${completion.reason}`);
          ok = false;
          keep.push(...batch.map((i) => i.key));
          continue;
        }
        const kept = parseKeepSet(completion.content, batch.length);
        for (const [i, item] of batch.entries()) {
          if (kept.has(i)) keep.push(item.key);
        }
      } catch (error) {
        console.error(
          `[relevance] screen threw: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        ok = false;
        keep.push(...batch.map((i) => i.key));
      }
    }

    const dropped = items.length - keep.length;
    if (dropped > 0) {
      console.log(
        `[relevance] kept ${keep.length} of ${items.length} — dropped ${dropped} as off-niche`
      );
    }
    return { keep, screened: items.length, dropped, ok };
  },
});
