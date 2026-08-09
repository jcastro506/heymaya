/**
 * ⭐ `watch-formats` (§5.3, Sprint 7) — the format library.
 *
 * > *"This is the single most differentiated capability in the product."*
 *
 * The pitch is not that she posts. It's that she does the homework — and this
 * is the homework: watch what is actually working in the niche, work out *why*,
 * and describe the shape so it can be filled with a different product.
 *
 * ## Two tiers, because watching is expensive and reading isn't
 *
 * §5.3: *"Reading is where the volume is; watching is where the format really
 * lives."*
 *
 * | Tier | Volume | Extracts |
 * |---|---|---|
 * | **Read** — transcripts + metrics | ~50/week | spoken hook, script shape, claim structure, length |
 * | **Watch** — multimodal on the video | top 5–10/week | visual hook, cuts, overlay style, pacing |
 *
 * ⛔ **This file implements the Read tier only.** The Watch tier needs video
 * bytes reaching a multimodal model (§5.3.1) — the path exists in
 * `gtmMaya/walkthrough.ts`, which is frozen, and porting it is its own piece of
 * work with its own cost profile. A card produced from a transcript says so in
 * `depth`, so nothing downstream can mistake a read for a watch. Claiming the
 * visual fields without having looked at the video would be worse than not
 * having them.
 *
 * ## Why the cards are shared, not per-customer
 *
 * They live in `nicheCache`, keyed by a **niche fingerprint** rather than a
 * customer id. §17.35.3: this is what makes the perception layer affordable —
 * twenty founders in "solo founder SaaS" read one library instead of paying for
 * twenty identical sweeps.
 *
 * ⚠️ `nicheCache` was defined in Sprint 1 and had **no writers and no
 * readers** — §573 says it *"must exist from Sprint 1 because retrofitting it
 * onto per-tenant rows is painful"*, and then nothing used it. This is its
 * first real consumer.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

/** Judgment about *why* something worked. Not a volume job. */
export const FORMAT_MODEL = "openai/gpt-5.6-luna-pro";

/** §5.3's "~50/week". The read tier's whole point is that this is affordable. */
export const READ_BUDGET = 50;

/** Cards worth keeping per sweep. Beyond this it's a list, not a library. */
export const MAX_CARDS = 12;

/** A week. The library is a weekly job (§3283), so the cache outlives one run. */
export const CARD_TTL_SEC = 7 * 24 * 60 * 60;

export const CACHE_KIND = "format_cards";

/**
 * §742's card, minus the fields only a multimodal watch can honestly fill.
 *
 * ⚠️ `depth` is not decoration. §5.3 splits these deliberately, and a card that
 * claims `visualDevice` from a transcript is a fabricated observation — §2.7,
 * grounded or silent. `beats`, `textOverlay` and `pacing` stay absent on a read
 * card rather than being guessed.
 */
export interface FormatCard {
  /** Deterministic — derived from the source URL, so a re-sweep updates rather than duplicates. */
  cardId: string;
  sourceUrl: string;
  channel: string;
  depth: "read" | "watch";
  metrics: { views: number; likes: number; comments: number };
  hook: {
    /** The opening line, as spoken. From the transcript, verbatim. */
    spokenLine: string;
    /** ⛔ Watch tier only. */
    visualDevice?: string;
    onScreenText?: string;
  };
  /** ⛔ Watch tier only — what happens when. */
  beats?: Array<{ atSec: number; whatHappens: string }>;
  textOverlay?: { style: string; placement: string; timing: string };
  sound?: { trendingAudio?: string; originalVoice?: boolean; musicBed?: string };
  pacing?: { cutsPerSecond?: number; totalLength?: number };
  /** Why this worked, grounded in the metrics we actually have. */
  hypothesis: string;
  /** ⭐ The shape, described so it applies to a DIFFERENT product. */
  reusableAs: string;
  observedAt: number;
}

/**
 * The sharing key.
 *
 * ⚠️ Deliberately NOT a customer id, and a test asserts `nicheCache` carries no
 * customer identity at all. Two founders with the same keywords must land on
 * the same fingerprint or the cache saves nothing.
 *
 * Sorted and lowercased so keyword order and casing can't fork the cache into
 * near-duplicates — the failure there is silent and only shows up as a bill.
 */
export function nicheFingerprint(keywords: string[]): string {
  const normalised = [...new Set(keywords.map((k) => k.trim().toLowerCase()))]
    .filter(Boolean)
    .sort()
    .join("|");
  let hash = 0;
  for (let i = 0; i < normalised.length; i += 1) {
    hash = (hash * 31 + normalised.charCodeAt(i)) >>> 0;
  }
  return `niche_${hash.toString(36)}`;
}

/** Stable per source video, so a re-sweep replaces a card instead of stacking one. */
export function cardIdFor(sourceUrl: string): string {
  let hash = 0;
  for (let i = 0; i < sourceUrl.length; i += 1) {
    hash = (hash * 31 + sourceUrl.charCodeAt(i)) >>> 0;
  }
  return `fc_${hash.toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Storage — shared, never per-tenant                                          */
/* -------------------------------------------------------------------------- */

export const storeCards = internalMutation({
  args: {
    fingerprint: v.string(),
    cardsJson: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ stored: number }> => {
    const now = args.now ?? Date.now();
    const existing = (await ctx.db
      .query("nicheCache")
      .withIndex("by_fingerprint_and_kind", (q) =>
        q.eq("nicheFingerprint", args.fingerprint).eq("kind", CACHE_KIND)
      )
      .unique()
      .catch(() => null)) as Doc<"nicheCache"> | null;

    const row = {
      nicheFingerprint: args.fingerprint,
      kind: CACHE_KIND,
      payloadJson: args.cardsJson,
      fetchedAt: now,
      ttlSec: CARD_TTL_SEC,
      sourceKind: "scrapecreators_transcripts",
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("nicheCache", row);

    let stored = 0;
    try {
      stored = (JSON.parse(args.cardsJson) as unknown[]).length;
    } catch {
      stored = 0;
    }
    return { stored };
  },
});

/**
 * The library for this customer's niche.
 *
 * ⚠️ Expired cards are returned with `stale: true` rather than withheld. A
 * two-week-old shape is still a better basis than nothing, and §12's rule is
 * that borrowed data carries its freshness — the caller decides, and the recap
 * can say "these are from last week" instead of silently implying they're new.
 */
export const formatCardsFor = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ cards: FormatCard[]; stale: boolean; fetchedAt: number | null }> => {
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) {
      return { cards: [], stale: false, fetchedAt: null };
    }

    const row = (await ctx.db
      .query("nicheCache")
      .withIndex("by_fingerprint_and_kind", (q) =>
        q
          .eq("nicheFingerprint", nicheFingerprint(targets.keywords))
          .eq("kind", CACHE_KIND)
      )
      .unique()
      .catch(() => null)) as Doc<"nicheCache"> | null;
    if (!row) return { cards: [], stale: false, fetchedAt: null };

    const now = args.now ?? Date.now();
    let cards: FormatCard[] = [];
    try {
      cards = JSON.parse(row.payloadJson) as FormatCard[];
    } catch {
      cards = [];
    }
    return {
      cards,
      stale: now - row.fetchedAt > row.ttlSec * 1000,
      fetchedAt: row.fetchedAt,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* The read tier                                                               */
/* -------------------------------------------------------------------------- */

const CARD_SYSTEM = `You are working out WHY a short video performed, from its transcript and its numbers.

Return STRICT JSON, no prose:
{ "hypothesis": string, "reusableAs": string, "spokenHook": string }

- "spokenHook": the opening line, quoted from the transcript. Not paraphrased.
- "hypothesis": why this worked, grounded in what you were actually given. If
  the numbers are the only evidence, say that. Never invent a reason the
  transcript doesn't support.
- "reusableAs": THE SHAPE, described so someone selling a completely different
  product could follow it. This is the whole point of the card.

  Good:  "opens on the failure state before naming the tool, states the cost in
          time, then shows the fix in one unbroken take"
  Bad:   "a video about project management software"

  A shape someone else can't apply is a summary, not a shape.

If the transcript is too thin to say anything real, set "reusableAs" to "" and
say so in the hypothesis. An empty card is honest; a generic one is noise.`;

interface Candidate {
  sourceUrl: string;
  channel: string;
  handle?: string;
  videoId?: string;
  metrics: { views: number; likes: number; comments: number };
}

/**
 * ⭐ Watch the niche, once a week, and write down the shapes.
 *
 * Runs off the observations the watchers already collect rather than starting a
 * new sweep — those rows are collected daily and paid for once. Reading them
 * again costs nothing, and a second independent search would drift from what
 * `scroll` and `trends` believe the niche is.
 */
export const watchFormats = internalAction({
  args: {
    customerId: v.id("customers"),
    now: v.optional(v.number()),
    /** Cap transcripts fetched. Defaults to §5.3's ~50/week. */
    budget: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    cards: number;
    transcriptsRead: number;
    detail: string;
  }> => {
    const now = args.now ?? Date.now();
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) {
      return {
        ok: false,
        cards: 0,
        transcriptsRead: 0,
        detail: "I don't know what to watch yet — the niche keywords aren't worked out.",
      };
    }

    const candidates = await gatherCandidates(ctx, args.customerId);
    if (candidates.length === 0) {
      return {
        ok: false,
        cards: 0,
        transcriptsRead: 0,
        detail: "nothing in the niche had enough behind it to be worth reading this week",
      };
    }

    /**
     * Best-performing first, then cut to budget.
     *
     * ⚠️ Sorting by views rather than velocity is deliberate here and differs
     * from `trends`. Trends wants what is *moving*; a format library wants what
     * *worked*, and a shape is proven by its ceiling rather than its slope.
     */
    const budget = Math.min(args.budget ?? READ_BUDGET, candidates.length);
    const ranked = [...candidates]
      .sort((a, b) => b.metrics.views - a.metrics.views)
      .slice(0, budget);

    const { callModel } = await import("./llm");
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    const cards: FormatCard[] = [];
    let transcriptsRead = 0;

    for (const candidate of ranked) {
      if (cards.length >= MAX_CARDS) break;

      const transcript = await transcriptFor(candidate);
      if (!transcript || transcript.trim().length < 80) continue;
      transcriptsRead += 1;

      try {
        const completion = await callModel(ctx, {
          customerId: args.customerId,
          purpose: "format_card",
          apiKey,
          model: FORMAT_MODEL,
          temperature: 0.3,
          maxTokens: 600,
          messages: [
            { role: "system", content: CARD_SYSTEM },
            {
              role: "user",
              content:
                `CHANNEL: ${candidate.channel}\n` +
                `VIEWS: ${candidate.metrics.views}  LIKES: ${candidate.metrics.likes}  COMMENTS: ${candidate.metrics.comments}\n\n` +
                `TRANSCRIPT:\n${transcript.slice(0, 6000)}`,
            },
          ],
        });
        if (!completion.ok) {
          console.error(`[formats] card call failed: ${completion.reason}`);
          continue;
        }
        const card = parseCard(completion.content, candidate, now);
        if (card) cards.push(card);
      } catch (error) {
        console.error(
          `[formats] card for ${candidate.sourceUrl} threw: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (cards.length === 0) {
      return {
        ok: false,
        cards: 0,
        transcriptsRead,
        detail:
          transcriptsRead === 0
            ? "none of this week's niche videos had a transcript worth reading"
            : "I read this week's niche videos and none of them had a shape worth writing down",
      };
    }

    const { stored } = await ctx.runMutation(internal.maya.formats.storeCards, {
      fingerprint: nicheFingerprint(targets.keywords),
      cardsJson: JSON.stringify(cards),
      now,
    });

    return {
      ok: true,
      cards: stored,
      transcriptsRead,
      detail: `${stored} shapes worth borrowing, from ${transcriptsRead} videos in your niche.`,
    };
  },
});

/* -------------------------------------------------------------------------- */

/**
 * Candidates from rows the watchers already paid for.
 *
 * ⚠️ Only rows with a real URL and non-zero views. A candidate with no URL
 * can't have its transcript fetched and can't be cited later — §6's evidence
 * rule is that a source you can't open isn't a source.
 */
async function gatherCandidates(
  ctx: ActionCtx,
  customerId: Doc<"customers">["_id"]
): Promise<Candidate[]> {
  const observations = await ctx.runQuery(
    internal.maya.scroll.recentObservations,
    { customerId, limit: 200 }
  );

  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const row of observations) {
    const url = row.sourceUrl ?? "";
    if (!url) continue;
    // Video channels only — a transcript of a tweet is the tweet.
    if (row.channel !== "tiktok" && row.channel !== "youtube") continue;

    /**
     * ⚠️ Dedupe on the VIDEO, not the URL.
     *
     * Measured 2026-08-09: the same TikTok arrived three times as three
     * distinct `sourceUrl`s, differing only in share-tracking query
     * parameters — `?_r=1&u_code=…&share_item_id=…`. Deduping on the raw
     * string let all three through and we paid for the same transcript three
     * times.
     *
     * `observations.sourceUrl` is documented as *"the dedupe key. One row per
     * post per customer, forever"* — and it isn't one, because the vendor
     * hands back a different string for the same post depending on where the
     * link was picked up. Fixing that table's key is a migration; this is the
     * read-side guard, and the id is the only stable identity available.
     */
    const key = videoIdFrom(url, row.channel) ?? url;
    if (seen.has(key)) continue;

    // Metrics live as a JSON string on the row, not as an object.
    const metrics = parseMetrics(row.metricsJson);
    /**
     * ⚠️ Zero views is a skip, not a low rank.
     *
     * §14.3 is explicit that own data can't answer format questions at this
     * volume — the whole value of a card is that the numbers behind it are
     * real. A video with no view count has no evidence, and a card built on it
     * would look identical to one built on a million views.
     */
    if (metrics.views <= 0) continue;

    seen.add(key);
    out.push({
      sourceUrl: url,
      channel: row.channel,
      handle: row.authorHandle ?? undefined,
      videoId: videoIdFrom(url, row.channel),
      metrics,
    });
  }
  return out;
}

async function transcriptFor(candidate: Candidate): Promise<string | null> {
  try {
    if (candidate.channel === "tiktok") {
      if (!candidate.handle || !candidate.videoId) return null;
      const { tiktok } = await import(
        "../integrations/scrapeCreators/platforms/tiktok"
      );
      const res = await tiktok.transcript(candidate.handle, candidate.videoId);
      return res.transcript;
    }
    if (candidate.channel === "youtube") {
      const { youtube } = await import(
        "../integrations/scrapeCreators/platforms/youtube"
      );
      const res = (await youtube.videoTranscript(candidate.sourceUrl)) as {
        raw?: unknown;
      };
      return extractYoutubeTranscript(res.raw);
    }
  } catch (error) {
    console.error(
      `[formats] transcript ${candidate.sourceUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return null;
}

/**
 * YouTube's transcript payload isn't normalised by the wrapper — it returns the
 * raw result — so the shape is walked here rather than assumed.
 */
export function extractYoutubeTranscript(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    transcript?: unknown;
    transcript_only_text?: unknown;
    segments?: unknown;
  };
  if (typeof r.transcript_only_text === "string") return r.transcript_only_text;
  if (typeof r.transcript === "string") return r.transcript;
  if (Array.isArray(r.transcript)) {
    return r.transcript
      .map((s) => (s && typeof s === "object" ? String((s as { text?: unknown }).text ?? "") : ""))
      .join(" ")
      .trim();
  }
  if (Array.isArray(r.segments)) {
    return r.segments
      .map((s) => (s && typeof s === "object" ? String((s as { text?: unknown }).text ?? "") : ""))
      .join(" ")
      .trim();
  }
  return null;
}

/** Tolerant on purpose — vendors disagree about which of these keys they use. */
export function parseMetrics(json: string | undefined): {
  views: number;
  likes: number;
  comments: number;
} {
  if (!json) return { views: 0, likes: 0, comments: 0 };
  try {
    const m = JSON.parse(json) as Record<string, unknown>;
    const num = (...keys: string[]): number => {
      for (const k of keys) {
        const value = m[k];
        if (typeof value === "number" && Number.isFinite(value)) return value;
      }
      return 0;
    };
    return {
      views: num("views", "viewCount", "playCount"),
      likes: num("likes", "likeCount", "diggCount"),
      comments: num("comments", "commentCount"),
    };
  } catch {
    return { views: 0, likes: 0, comments: 0 };
  }
}

export function videoIdFrom(url: string, channel: string): string | undefined {
  if (channel === "tiktok") {
    const m = url.match(/\/video\/(\d+)/);
    return m?.[1];
  }
  const m = url.match(/[?&]v=([\w-]+)/) ?? url.match(/shorts\/([\w-]+)/);
  return m?.[1];
}

/**
 * ⚠️ A card with an empty `reusableAs` is DROPPED.
 *
 * That field is the entire product of this sweep — §5.3 calls the library *"a
 * stock of proven shapes"*, and a card that can't say the shape is a row that
 * makes the library look fuller than it is. The prompt is told to return "" on
 * purpose, precisely so this can throw it away rather than keep a generic one.
 */
export function parseCard(
  raw: string,
  candidate: Candidate,
  now: number
): FormatCard | null {
  let parsed: { hypothesis?: unknown; reusableAs?: unknown; spokenHook?: unknown };
  try {
    parsed = JSON.parse(
      raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()
    ) as typeof parsed;
  } catch {
    return null;
  }

  const reusableAs =
    typeof parsed.reusableAs === "string" ? parsed.reusableAs.trim() : "";
  if (!reusableAs) return null;

  return {
    cardId: cardIdFor(candidate.sourceUrl),
    sourceUrl: candidate.sourceUrl,
    channel: candidate.channel,
    // Read tier. Nothing here has looked at a single frame, and the card says so.
    depth: "read",
    metrics: candidate.metrics,
    hook: {
      spokenLine:
        typeof parsed.spokenHook === "string" ? parsed.spokenHook.trim() : "",
    },
    hypothesis:
      typeof parsed.hypothesis === "string" ? parsed.hypothesis.trim() : "",
    reusableAs,
    observedAt: now,
  };
}

/* -------------------------------------------------------------------------- */
/* Card → brief                                                                */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ The chain that turns watching into making (§18, Sprint 7).
 *
 * > *"Without it she picks a template because it looks fun rather than because
 * > three top posts in this niche were that shape."*
 *
 * Deterministic, not a model call. Which shape to borrow is a ranking question
 * and the ranking is already in the metrics — spending a judgment call here
 * would add cost and a failure mode to a decision that arithmetic answers.
 *
 * ⚠️ Returns `null` rather than a default when the library is empty. A fallback
 * card would mean every post carries a `formatCardId` and none of them means
 * anything, which is worse than the honest gap: `traceability` can then say
 * "this one wasn't based on a shape we'd seen work".
 */
export function pickCard(
  cards: FormatCard[],
  options?: { channel?: string; exclude?: string[] }
): FormatCard | null {
  const exclude = new Set(options?.exclude ?? []);
  const usable = cards.filter(
    (c) => c.reusableAs.trim().length > 0 && !exclude.has(c.cardId)
  );
  if (usable.length === 0) return null;

  /**
   * Same-channel first, then by reach.
   *
   * A shape that worked on TikTok is evidence for TikTok. It is weaker evidence
   * for YouTube and much weaker for X, so a same-channel card outranks a
   * bigger cross-channel one rather than competing on views with it.
   */
  const preferred = options?.channel
    ? usable.filter((c) => c.channel === options.channel)
    : [];
  const pool = preferred.length > 0 ? preferred : usable;
  return [...pool].sort((a, b) => b.metrics.views - a.metrics.views)[0];
}

/** One card by id, for rendering provenance back to the founder. */
export const cardById = internalQuery({
  args: { customerId: v.id("customers"), cardId: v.string() },
  handler: async (ctx, args): Promise<FormatCard | null> => {
    const lib = await ctx.runQuery(internal.maya.formats.formatCardsFor, {
      customerId: args.customerId,
    });
    return lib.cards.find((c: FormatCard) => c.cardId === args.cardId) ?? null;
  },
});
