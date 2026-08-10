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
 **Both tiers are implemented here.** `watchFormats` reads; `watchTopFormats`
 * watches the top few and upgrades those cards in place.
 *
 * ⚠️ `depth` on every card says which it was. A card produced from a transcript
 * cannot claim `visualDevice` — that would be a fabricated observation (§2.7),
 * and it would be indistinguishable from a real one downstream. `beats`,
 * `textOverlay` and `pacing` stay absent on a read card rather than guessed,
 * and `mergeWatch` refuses to promote a card that came back with nothing seen.
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

/* -------------------------------------------------------------------------- */
/* Hashtag mining (§7.5.9)                                                     */
/* -------------------------------------------------------------------------- */

export const HASHTAG_CACHE_KIND = "hashtag_sets";

/** Below this the ranking is one lucky post, not a pattern. */
export const MIN_TAG_USES = 2;

/** Kept per channel. Past this it stops being a set and becomes a dictionary. */
export const MAX_TAGS_PER_CHANNEL = 24;

export interface MinedTag {
  tag: string;
  /** How many top-performing niche posts used it. Evidence, not a guess. */
  uses: number;
  /** Median views of the posts that used it — the ranking signal. */
  medianViews: number;
}

/**
 * ⚠️ Tags that describe the platform, not the topic.
 *
 * `#fyp` and its family are the single most common output of "ask a model for
 * ten hashtags", and they do nothing — they are a tell that the account is
 * trying rather than a lever that works. They also dominate any frequency
 * ranking, so mining without excluding them returns them every time.
 */
const NOISE_TAGS = new Set([
  "fyp",
  "fypage",
  "foryou",
  "foryoupage",
  "viral",
  "viralvideo",
  "trending",
  "explore",
  "explorepage",
  "tiktok",
  "reels",
  "shorts",
  "instagram",
  "youtube",
]);

/**
 * ⭐ Which tags the top-performing posts in THIS niche actually use.
 *
 * §7.5.9: *"Hashtags are a research output, not a generation output."* The
 * default everywhere else is to generate them from the post's own text, which
 * produces generic tag soup that helps nobody.
 *
 * ⚠️ No vendor call. The captions of the niche posts we already collected carry
 * the tags their authors chose, and those rows are paid for. A dedicated
 * hashtag endpoint exists (`/v1/tiktok/hashtags/popular`) and is the wrong
 * tool: it returns what is popular *globally*, which is how you end up
 * recommending `#fyp`.
 *
 * Ranked by the median views of the posts using each tag rather than by
 * frequency. Frequency finds the tags everyone uses; median performance finds
 * the ones that were on the posts that worked, which is a different set and the
 * one worth borrowing.
 */
export function mineHashtags(
  posts: Array<{ text: string; views: number }>
): MinedTag[] {
  const byTag = new Map<string, number[]>();

  for (const post of posts) {
    // One post can't vote twice for the same tag.
    const tags = new Set(
      (post.text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) =>
        t.slice(1).toLowerCase()
      )
    );
    for (const tag of tags) {
      if (!tag || NOISE_TAGS.has(tag)) continue;
      // A single character isn't a topic.
      if (tag.length < 2) continue;
      const list = byTag.get(tag) ?? [];
      list.push(post.views);
      byTag.set(tag, list);
    }
  }

  const out: MinedTag[] = [];
  for (const [tag, views] of byTag) {
    if (views.length < MIN_TAG_USES) continue;
    out.push({ tag, uses: views.length, medianViews: median(views) });
  }

  return out
    .sort((a, b) => b.medianViews - a.medianViews || b.uses - a.uses)
    .slice(0, MAX_TAGS_PER_CHANNEL);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Mine and cache the sets, per channel.
 *
 * Per channel because the tags that work on TikTok are not the tags that work
 * on YouTube, and pooling them produces a set that is wrong everywhere.
 */
export const mineHashtagSets = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; perChannel: Record<string, number>; detail: string }> => {
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) {
      return { ok: false, perChannel: {}, detail: "no niche keywords yet" };
    }

    const observations = await ctx.runQuery(
      internal.maya.scroll.recentObservations,
      { customerId: args.customerId, limit: 400 }
    );

    const byChannel = new Map<string, Array<{ text: string; views: number }>>();
    for (const row of observations) {
      const metrics = parseMetrics(row.metricsJson);
      if (metrics.views <= 0) continue;
      const list = byChannel.get(row.channel) ?? [];
      list.push({ text: row.text ?? "", views: metrics.views });
      byChannel.set(row.channel, list);
    }

    const sets: Record<string, MinedTag[]> = {};
    const perChannel: Record<string, number> = {};
    for (const [channel, posts] of byChannel) {
      const mined = mineHashtags(posts);
      if (mined.length === 0) continue;
      sets[channel] = mined;
      perChannel[channel] = mined.length;
    }

    if (Object.keys(sets).length === 0) {
      return {
        ok: false,
        perChannel: {},
        detail: "nothing in the niche used tags worth borrowing yet",
      };
    }

    await ctx.runMutation(internal.maya.formats.storeHashtagSets, {
      fingerprint: nicheFingerprint(targets.keywords),
      setsJson: JSON.stringify(sets),
      now: args.now,
    });

    return {
      ok: true,
      perChannel,
      detail: Object.entries(perChannel)
        .map(([c, n]) => `${c}: ${n}`)
        .join(", "),
    };
  },
});

export const storeHashtagSets = internalMutation({
  args: {
    fingerprint: v.string(),
    setsJson: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const now = args.now ?? Date.now();
    const existing = (await ctx.db
      .query("nicheCache")
      .withIndex("by_fingerprint_and_kind", (q) =>
        q.eq("nicheFingerprint", args.fingerprint).eq("kind", HASHTAG_CACHE_KIND)
      )
      .unique()
      .catch(() => null)) as Doc<"nicheCache"> | null;

    const row = {
      nicheFingerprint: args.fingerprint,
      kind: HASHTAG_CACHE_KIND,
      payloadJson: args.setsJson,
      fetchedAt: now,
      /**
       * ⚠️ Weekly, deliberately. §7.5.9: *"a tag that worked in March is dead by
       * July and a stale set is a slow, invisible leak of reach."*
       */
      ttlSec: CARD_TTL_SEC,
      sourceKind: "mined_from_observations",
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("nicheCache", row);
    return { ok: true };
  },
});

/**
 * The mined set for one channel.
 *
 * ⚠️ Returns `[]` when nothing has been mined. The caller must then post with
 * NO hashtags — §7.5.9's rule is that tags are *selected from mined sets, never
 * invented*, and an empty set is a real answer. Falling back to generated tags
 * here would quietly undo the whole point.
 */
export const hashtagsFor = internalQuery({
  args: { customerId: v.id("customers"), channel: v.string() },
  handler: async (ctx, args): Promise<MinedTag[]> => {
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) return [];

    const row = (await ctx.db
      .query("nicheCache")
      .withIndex("by_fingerprint_and_kind", (q) =>
        q
          .eq("nicheFingerprint", nicheFingerprint(targets.keywords))
          .eq("kind", HASHTAG_CACHE_KIND)
      )
      .unique()
      .catch(() => null)) as Doc<"nicheCache"> | null;
    if (!row) return [];

    try {
      const sets = JSON.parse(row.payloadJson) as Record<string, MinedTag[]>;
      return sets[args.channel] ?? [];
    } catch {
      return [];
    }
  },
});

/* -------------------------------------------------------------------------- */
/* The watch tier (§5.3.1)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ §5.3: *"Reading is where the volume is; watching is where the format
 * really lives."*
 *
 * A transcript gives the spoken hook and the script shape. It cannot see the
 * visual hook, the cut rhythm, or when text appears on screen — and those are
 * most of what makes a short video work. This is the second tier: the top few
 * cards a week, watched properly.
 *
 * ⚠️ **Uses the direct Gemini API, not OpenRouter.** Every other model call in
 * `convex/maya` goes through `callModel` deliberately, and `mediaAssets.ts`
 * says why: one key, one telemetry profile. This one deviates because the
 * request carries **video bytes as `inlineData`**, which is a Gemini-native
 * shape — the proven path in `gtmMaya/walkthrough.ts` uses it, and routing
 * video through a text-completions API is not something to discover is broken
 * in production. `GEMINI_API_KEY` is already set. Cost is still recorded, under
 * vendor `gemini` rather than `openrouter`, so the ledger stays complete.
 */
export const WATCH_MODEL = process.env.MAYA_WATCH_MODEL ?? "gemini-2.5-flash";

/** §5.3's "top 5–10 a week". Watching is the expensive half; this is the cap. */
export const WATCH_LIMIT = 5;

/**
 * ⚠️ Video bytes are base64'd into the request, inflating ~1.33×. A long video
 * would blow the action's memory before it ever reached the model, so the cap
 * is on the download rather than on the model's own limit.
 */
export const MAX_VIDEO_BYTES = 12 * 1024 * 1024;

const WATCH_SYSTEM = `You are watching a short video to describe HOW it is made, not what it is about.

Return STRICT JSON, no prose:
{ "visualDevice": string,
  "onScreenText": string,
  "beats": [ { "atSec": number, "whatHappens": string } ],
  "textOverlay": { "style": string, "placement": string, "timing": string },
  "pacing": { "cutsPerSecond": number, "totalLength": number } }

- "visualDevice": what the FIRST TWO SECONDS show, and why it stops a scroll.
  The thing on screen, not the topic.
- "beats": what happens when. Six at most. This is the shape someone else would
  follow.
- "textOverlay": how on-screen text looks, where it sits, when it appears.
- "pacing": cuts per second and total length, as numbers.

Describe only what you can actually see. If the video has no on-screen text,
say so with an empty string rather than inventing a style.`;

/**
 * ⭐ Upgrade the top cards from read to watch.
 *
 * Only cards already in the library, and only ones still at `depth: "read"` —
 * re-watching a card we already watched spends the expensive tier on a question
 * that is already answered.
 */
export const watchTopFormats = internalAction({
  args: {
    customerId: v.id("customers"),
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; watched: number; failed: number; detail: string }> => {
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) {
      return { ok: false, watched: 0, failed: 0, detail: "no niche keywords yet" };
    }

    const library = await ctx.runQuery(internal.maya.formats.formatCardsFor, {
      customerId: args.customerId,
      now: args.now,
    });
    const unwatched = library.cards
      .filter((c: FormatCard) => c.depth === "read" && c.channel === "tiktok")
      .sort((a: FormatCard, b: FormatCard) => b.metrics.views - a.metrics.views)
      .slice(0, args.limit ?? WATCH_LIMIT);

    if (unwatched.length === 0) {
      return {
        ok: true,
        watched: 0,
        failed: 0,
        detail: "nothing new worth watching — the top cards are already watched",
      };
    }

    const apiKey =
      process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
    if (!apiKey) {
      return { ok: false, watched: 0, failed: 0, detail: "watching isn't configured" };
    }

    const upgraded = new Map<string, FormatCard>();
    let failed = 0;

    for (const card of unwatched) {
      try {
        const seen = await watchOne(ctx, { card, apiKey, customerId: args.customerId });
        if (seen) upgraded.set(card.cardId, seen);
        else failed += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[formats] watch ${card.sourceUrl} threw: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (upgraded.size === 0) {
      return {
        ok: false,
        watched: 0,
        failed,
        detail: "couldn't watch any of this week's top videos",
      };
    }

    // Merge back, preserving every card the watch tier didn't touch.
    const merged = library.cards.map((c: FormatCard) => upgraded.get(c.cardId) ?? c);
    await ctx.runMutation(internal.maya.formats.storeCards, {
      fingerprint: nicheFingerprint(targets.keywords),
      cardsJson: JSON.stringify(merged),
      now: args.now,
    });

    return {
      ok: true,
      watched: upgraded.size,
      failed,
      detail: `watched ${upgraded.size} of this week's top videos properly${
        failed > 0 ? `, ${failed} couldn't be fetched` : ""
      }`,
    };
  },
});

async function watchOne(
  ctx: ActionCtx,
  input: { card: FormatCard; apiKey: string; customerId: Doc<"customers">["_id"] }
): Promise<FormatCard | null> {
  const handle = handleFrom(input.card.sourceUrl);
  const videoId = videoIdFrom(input.card.sourceUrl, "tiktok");
  if (!handle || !videoId) return null;

  const { tiktok } = await import(
    "../integrations/scrapeCreators/platforms/tiktok"
  );
  const post = await tiktok.post(handle, videoId);
  const videoUrl = post?.videoUrl;
  if (!videoUrl) {
    // ⚠️ §5.3.1's whole problem: a TikTok page URL returns HTML, not an mp4.
    console.warn(`[formats] no playable url for ${input.card.sourceUrl}`);
    return null;
  }

  const res = await fetch(videoUrl);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    console.warn(
      `[formats] ${input.card.sourceUrl} is ${Math.round(bytes.byteLength / 1e6)}MB — over the cap`
    );
    return null;
  }

  const gem = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${WATCH_MODEL}:generateContent?key=${input.apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "video/mp4", data: toBase64(bytes) } },
              { text: WATCH_SYSTEM },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  /**
   * Recorded whether or not it parsed. The video was uploaded and processed by
   * then, so the spend happened — a ledger counting only usable answers
   * understates cost exactly when something is failing repeatedly.
   */
  try {
    await ctx.runMutation(internal.maya.cogs.record, {
      customerId: input.customerId,
      vendor: "gemini",
      resource: WATCH_MODEL,
      purpose: "format_watch",
    });
  } catch {
    // Never let ledger trouble cost the observation.
  }

  if (!gem.ok) {
    console.error(`[formats] watch model returned ${gem.status}`);
    return null;
  }

  const payload = (await gem.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return mergeWatch(input.card, text);
}

/**
 * Fold what was seen into the card.
 *
 * ⚠️ Only promotes to `depth: "watch"` when something was actually seen. A card
 * stamped "watched" with no visual fields is worse than a read card — it claims
 * a stronger observation than was made, and §2.7 forbids exactly that.
 */
export function mergeWatch(card: FormatCard, raw: string): FormatCard | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(
      raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()
    ) as Record<string, unknown>;
  } catch {
    return null;
  }

  const visualDevice =
    typeof parsed.visualDevice === "string" ? parsed.visualDevice.trim() : "";
  if (!visualDevice) return null;

  const beats = Array.isArray(parsed.beats)
    ? parsed.beats
        .filter((b): b is { atSec: number; whatHappens: string } => {
          if (!b || typeof b !== "object") return false;
          const e = b as Record<string, unknown>;
          return typeof e.atSec === "number" && typeof e.whatHappens === "string";
        })
        .slice(0, 6)
    : undefined;

  const overlay = parsed.textOverlay as Record<string, unknown> | undefined;
  const pacing = parsed.pacing as Record<string, unknown> | undefined;

  return {
    ...card,
    depth: "watch",
    hook: {
      ...card.hook,
      visualDevice,
      onScreenText:
        typeof parsed.onScreenText === "string" ? parsed.onScreenText.trim() : "",
    },
    beats: beats && beats.length > 0 ? beats : undefined,
    textOverlay:
      overlay && typeof overlay.style === "string"
        ? {
            style: String(overlay.style),
            placement: String(overlay.placement ?? ""),
            timing: String(overlay.timing ?? ""),
          }
        : undefined,
    pacing:
      pacing && typeof pacing.totalLength === "number"
        ? {
            cutsPerSecond:
              typeof pacing.cutsPerSecond === "number" ? pacing.cutsPerSecond : undefined,
            totalLength: pacing.totalLength,
          }
        : undefined,
  };
}

export function handleFrom(url: string): string | undefined {
  return url.match(/@([\w.-]+)/)?.[1];
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
