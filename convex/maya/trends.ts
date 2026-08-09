/**
 * The trend sweep (§5.2 sweep 3) — what shape is working right now.
 *
 * Feeds the half of the loop §14.2.2 just closed: at **L1** the diagnosis is a
 * *format* problem, and idea scoring then prefers evidence of things that
 * demonstrably travelled. This is where that evidence comes from.
 *
 * ## ⭐ TWO things come out of a trending feed, and they are not the same
 *
 * The first version of this file kept only in-niche trends and dropped
 * everything else. That was wrong, and it threw away the case a real manager
 * uses most.
 *
 * | what | why it's useful | banked as |
 * |---|---|---|
 * | **in-niche** | someone in our world is talking about this **topic** | `observation` — topic evidence |
 * | **out-of-niche** | the topic is useless, but the **SHAPE** might travel | `format_card` — a proven shape looking for content |
 *
 * A live pull had `#AEWDynamite` at rank 1. Nobody should post about
 * wrestling. But if that clip works because of a three-beat "everyone thinks
 * X / actually Y / here's proof" structure, **that structure works for a
 * dashboard too** — which is exactly §5.3's `reusableAs`: *"the shape,
 * described so it can be applied to a different product."*
 *
 * So popularity alone still banks nothing. In-niche is decided by vocabulary;
 * out-of-niche has to earn its place by having a shape worth stealing, and a
 * model decides that because "is this adaptable" is judgment, not a regex.
 *
 * ⚠️ The old failure is still guarded: what gets banked from an out-of-niche
 * trend is **the shape and never the subject**. `learn-business` already hit
 * this once, where "engagement" surfaced wedding photographers.
 *
 * ## What actually exists, checked 2026-08-05
 *
 * | source | state |
 * |---|---|
 * | TikTok `get-trending-feed` | ✅ 16 posts with `statistics` |
 * | YouTube `shorts/trending` | ✅ 77 shorts with view/like/comment counts |
 * | X `trends` | ✅ names + rank, **no engagement** |
 * | TikTok `hashtags/popular` | ⛔ **dead** — *"TikTok took this page down"* |
 * | TikTok `songs/popular` | ⛔ **dead** — *"this endpoint is unavailable"* |
 *
 * §5.2 lists all five. Two are gone upstream, and the vendor says so in plain
 * words rather than failing — recorded here so nobody spends an afternoon
 * re-discovering it.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Observation } from "./scroll";
import { velocity, toMillis } from "./learnBusiness";


/**
 * ⭐ Cheap on purpose. This judges shapes, not prose — and it runs over a
 * couple of dozen captions once a week, not per post.
 */
export const SHAPE_MODEL = "openai/gpt-oss-120b";

/** How many out-of-niche trends to put in front of the judge. */
export const SHAPES_JUDGED = 12;

const SHAPE_SYSTEM = `You are looking at posts that are trending RIGHT NOW, in a niche that has nothing to do with the business you work for.

The subject is irrelevant. You are only asking one thing: **is the SHAPE worth stealing?**

A shape is the structure underneath the content — "everyone thinks X, actually Y, here's proof", "three things I got wrong in my first year", "before/after with the reveal held to the last second", "answering a comment as the whole video".

Return STRICT JSON, no prose:
{ "keep": boolean, "shape": string, "why": string }

- "keep": true ONLY if the structure would still work for a completely different product. A shape that depends on the subject — a celebrity, a sport, a meme nobody outside that world knows — is FALSE.
- "shape": the structure in one sentence, with NO reference to the original subject. If you cannot describe it without naming what the post was about, it is not reusable and "keep" is false.

⚠️ THESE ARE REAL ANSWERS YOU HAVE GIVEN, AND ALL FOUR ARE WRONG:

  "Ranking the best X moments"
  "Showcase a signature feature of a known entity"
  "A lesser-known individual repeats a surprising action against a famous figure"
  "Showcase a personal talent while using a trending hashtag"

Each one is the SUBJECT WEARING A DISGUISE. Told not to name what the post was
about, you substituted a placeholder — "X", "a known entity", "a famous figure"
— instead of answering false. A structure that needs a celebrity, a fandom, or
a blank to stand in for the subject cannot carry a dashboard.

If your shape contains a placeholder, the honest answer was "keep": false.
Saying false is the common, correct answer.
- "why": what makes it work, in one short clause.

Most trending posts are not reusable. Saying false is the common, correct answer.`;

/**
 * Ask whether an out-of-niche trend has a shape worth borrowing.
 *
 * The instruction to describe the shape WITHOUT naming the subject is the
 * whole guard: a shape you cannot state without saying "wrestling" is not a
 * shape, it's the topic wearing a disguise.
 */
/**
 * ⭐ The evasion WORDLIST is gone — the prompt shows the model its own
 * failures instead.
 *
 * It listed the placeholders the judge reached for ("best X", "a known
 * entity", "a famous figure") and rejected them in code. That worked, and it
 * was the wrong shape: a lookup table deciding whether language is evasive,
 * when the model that produced the evasion can recognise it perfectly well if
 * it is shown what it did.
 *
 * So the four real failures are quoted verbatim in `SHAPE_SYSTEM`, named as
 * its own answers. Per the standing rule: trust the model where the question
 * is judgment, and spend the words on a better prompt rather than a filter.
 */

/** A shape too short to be a structure is a label. */
const MIN_SHAPE_WORDS = 6;

export function parseShape(
  raw: string
): { keep: boolean; shape: string; why: string } | null {
  const fenced = raw.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(fenced) as Record<string, unknown>;
    if (typeof parsed.keep !== "boolean") return null;
    if (!parsed.keep) return { keep: false, shape: "", why: "" };
    const shape = typeof parsed.shape === "string" ? parsed.shape.trim() : "";
    const why = typeof parsed.why === "string" ? parsed.why.trim() : "";
    // A "keep" with no shape is the model agreeing rather than answering.
    if (!shape) return null;
    /**
     * The length floor stays. It is not judging language — it is asking
     * whether a sentence describing a structure is even present. "funny dog
     * video" is a label, and no amount of model intelligence makes three words
     * into a structure.
     */
    if (shape.split(/\s+/).filter(Boolean).length < MIN_SHAPE_WORDS) {
      return { keep: false, shape: "", why: "" };
    }
    return { keep: true, shape, why };
  } catch {
    return null;
  }
}

/** How many trending items to consider per source before filtering. */
export const TREND_SAMPLE = 40;

/**
 * ⭐ Does this trend belong to our niche at all?
 *
 * A word-boundary match against the niche's own vocabulary. Deliberately
 * strict: the cost of a false positive is her posting about wrestling, and the
 * cost of a false negative is one missed format among dozens.
 */
export function intersectsNiche(text: string, keywords: string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((k) => {
    const term = k.toLowerCase().trim();
    if (term.length < 3) return false;
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(
      haystack
    );
  });
}

/**
 * Read what's trending, keep only what's ours.
 *
 * Returns observations in `scroll`'s shape so the idea bank can consume them
 * with no special case — a trending post IS an observation, it just arrived
 * from a different door.
 */
export const sweepTrends = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    considered: number;
    kept: number;
    shapes: number;
    observations: Observation[];
    detail: string;
  }> => {
    const now = args.now ?? Date.now();
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) {
      return {
        ok: false,
        considered: 0,
        kept: 0,
        shapes: 0,
        observations: [],
        detail: "I don't know what to watch yet",
      };
    }

    const keywords = targets.keywords;
    const kept: Observation[] = [];
    /** Out-of-niche trends, held for the shape judge rather than discarded. */
    const foreign: Array<{ text: string; sourceUrl: string; channel: string }> = [];
    let considered = 0;

    const { tiktok } = await import(
      "../integrations/scrapeCreators/platforms/tiktok"
    );
    const { youtube } = await import(
      "../integrations/scrapeCreators/platforms/youtube"
    );

    /**
     * TikTok's trending feed.
     *
     * ⚠️ `trendingFeed` NORMALISES for us — it returns `{ posts:
     * NormalizedPost[] }`, not the raw `aweme_list`. I wrote the raw parse
     * first out of habit; reading the wrapper saved re-deriving `create_time`
     * handling that `toMillis` already gets right.
     *
     * `region` is required, not optional.
     */
    try {
      const result = await tiktok.trendingFeed("US");
      for (const post of result.posts.slice(0, TREND_SAMPLE)) {
        considered += 1;
        const desc = post.caption ?? "";
        if (!intersectsNiche(desc, keywords)) {
          if (desc.trim())
            foreign.push({
              text: desc,
              sourceUrl:
                post.url ??
                (post.authorHandle
                  ? `https://www.tiktok.com/@${post.authorHandle}/video/${post.postId}`
                  : ""),
              channel: "tiktok",
            });
          continue;
        }

        const ms = toMillis(post.postedAt);
        const metrics = {
          likes: post.metrics.likeCount ?? 0,
          comments: post.metrics.commentCount ?? 0,
          views: post.metrics.viewCount ?? 0,
        };
        kept.push({
          channel: "tiktok",
          sourceUrl:
            post.url ??
            (post.authorHandle
              ? `https://www.tiktok.com/@${post.authorHandle}/video/${post.postId}`
              : ""),
          authorHandle: post.authorHandle ?? null,
          text: desc,
          postedAt: ms,
          metrics,
          velocity: velocity(post.metrics, post.postedAt, now),
          keyword: "trending",
        });
      }
    } catch (error) {
      console.error(`[trends] tiktok feed failed: ${String(error)}`);
    }

    // YouTube trending shorts — the 9:16 format library, with engagement.
    try {
      const raw = (await youtube.shortsTrending()) as unknown as {
        raw?: { shorts?: unknown[] };
      };
      for (const item of (raw.raw?.shorts ?? []).slice(0, TREND_SAMPLE)) {
        const short = item as Record<string, unknown>;
        considered += 1;
        const text = `${String(short.title ?? "")} ${String(short.description ?? "")}`;
        if (!intersectsNiche(text, keywords)) {
          const title = String(short.title ?? "").trim();
          if (title)
            foreign.push({
              text: title,
              sourceUrl:
                typeof short.url === "string"
                  ? short.url
                  : `https://www.youtube.com/watch?v=${String(short.id ?? "")}`,
              channel: "youtube",
            });
          continue;
        }

        const channel = (short.channel ?? {}) as { handle?: string };
        const metrics = {
          likes: numberOf(short.likeCountInt),
          comments: numberOf(short.commentCountInt),
          views: numberOf(short.viewCountInt),
        };
        /**
         * ⚠️ No usable date — `publishDateText` is prose ("3 days ago"). So
         * velocity cannot be computed, and it is left at 0 rather than
         * invented. Trending is itself the recency signal here; pretending to
         * a number would put junk at the top of what she reads first.
         */
        kept.push({
          channel: "youtube",
          sourceUrl:
            typeof short.url === "string"
              ? short.url
              : `https://www.youtube.com/watch?v=${String(short.id ?? "")}`,
          authorHandle: channel.handle ?? null,
          text: String(short.title ?? ""),
          postedAt: null,
          metrics,
          velocity: 0,
          keyword: "trending",
        });
      }
    } catch (error) {
      console.error(`[trends] youtube shorts failed: ${String(error)}`);
    }

    if (kept.length > 0) {
      await ctx.runMutation(internal.maya.scroll.recordObservations, {
        customerId: args.customerId,
        observationsJson: JSON.stringify(kept),
        now,
      });
    }

    /**
     * ⭐ THE OTHER HALF — shapes worth stealing from trends that aren't ours.
     *
     * One model call over a couple of dozen captions, once a week. Judged
     * rather than matched, because "would this structure work for a different
     * product" is exactly the kind of question a regex answers badly.
     *
     * What lands in the bank is the SHAPE, never the subject — and the prompt
     * enforces that by refusing any shape that can't be described without
     * naming what the post was about.
     */
    let shapes = 0;
    if (foreign.length > 0 && process.env.OPENROUTER_API_KEY) {
      const sample = foreign.slice(0, SHAPES_JUDGED);
      const { callModel } = await import("./llm");
      for (const item of sample) {
        try {
          const completion = await callModel(ctx, {
            customerId: args.customerId,
            purpose: "trend_shape",
            apiKey: process.env.OPENROUTER_API_KEY,
            model: SHAPE_MODEL,
            temperature: 0,
            maxTokens: 400,
            messages: [
              { role: "system", content: SHAPE_SYSTEM },
              { role: "user", content: `TRENDING POST:\n${item.text.slice(0, 600)}` },
            ],
          });
          if (!completion.ok) continue;
          const verdict = parseShape(completion.content);
          if (!verdict?.keep) continue;

          await ctx.runMutation(internal.maya.ideas.bankIdeas, {
            customerId: args.customerId,
            ideasJson: JSON.stringify([
              {
                angle: verdict.shape,
                source: "format_card",
                evidence: {
                  // The trending post is the evidence that the shape travels.
                  quote: verdict.why || verdict.shape,
                  sourceUrls: [item.sourceUrl],
                  frequency: 1,
                  observedAt: now,
                },
              },
            ]),
            now,
          });
          shapes += 1;
        } catch (error) {
          console.error(`[trends] shape judge failed: ${String(error)}`);
        }
      }
    }

    return {
      ok: true,
      considered,
      kept: kept.length,
      shapes,
      observations: kept,
      /**
       * A zero here is a real finding, not a failure: it means nothing
       * trending right now belongs to this niche, which is the normal case and
       * far better than banking wrestling hashtags.
       */
      /**
       * Both halves reported. A sweep that found no in-niche trend but three
       * borrowable shapes did real work, and a detail that only counted the
       * first half would call that a blank week.
       */
      detail: [
        kept.length > 0
          ? `${kept.length} of ${considered} trending posts are in our niche`
          : `nothing in ${considered} trending posts is in our niche`,
        shapes > 0 ? `${shapes} shapes worth borrowing` : "no shapes worth borrowing",
      ].join(", "),
    };
  },
});

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
