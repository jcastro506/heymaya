/**
 * The morning scroll (§5.1 sweeps 2 and 3, §13.5's 07:00).
 *
 * What a good social manager does before saying anything: read what's actually
 * moving in this niche today. Not what's big — what's **moving**.
 *
 * ## Why this exists as a tool rather than a job
 *
 * Her 07:00 cron says "scroll". Without a tool behind it she either says she
 * can't — which is correct and useless — or improvises, which is worse. The
 * whole daily loop in §13.5 rests on this returning something real.
 *
 * ## Velocity, not volume
 *
 * §5.1: *"a 6-hour-old post with rising engagement is worth more than a
 * week-old post with more of it. Rank every sweep by engagement ÷ age."* That
 * ranking is the difference between noticing what's happening and reciting
 * what already happened.
 *
 * ## No LLM in collection
 *
 * §5.2. This fetches, ranks and returns structured rows. Deciding which of them
 * is worth a post is her job, on the main model, with product truth in hand —
 * and doing it here would mean paying to judge 200 posts instead of reading a
 * ranked 20.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { velocity, toMillis } from "./learnBusiness";
import type { Doc } from "../_generated/dataModel";

/** One thing she saw. Deliberately close to §5.2's observation shape. */
export interface Observation {
  channel: string;
  sourceUrl: string;
  authorHandle: string | null;
  text: string;
  postedAt: number | null;
  metrics: { likes: number; comments: number; views: number };
  /** engagement ÷ age — what's actually hot. */
  velocity: number;
  /** Which of her watched terms surfaced it. */
  keyword: string;
}

/** How many keywords to sweep per morning, per channel. Each is one credit. */
export const KEYWORDS_PER_SCROLL = 4;

/**
 * ⭐ Hard ceiling on searches in one scroll.
 *
 * keywords × channels multiplies, and this runs every morning for every
 * customer forever. The cap is what keeps a third connected channel from
 * silently tripling the daily bill.
 */
export const MAX_SEARCHES_PER_SCROLL = 9;

/**
 * ⭐ Channels she reads, and what each will actually tell us.
 *
 * VERIFIED LIVE 2026-08-05 by calling each endpoint and reading the payload —
 * not from docs, which is how the `create_time`-in-seconds bug got in.
 *
 * | | date | likes | comments | views |
 * |---|---|---|---|---|
 * | TikTok `search/keyword` | unix seconds | ✅ | ✅ | ✅ |
 * | Instagram `reels/search` | **ISO string** | ✅ | ✅ | ✅ |
 * | YouTube `search` → videos | **ISO string** | ❌ | ❌ | ✅ |
 * | YouTube `search` → shorts | ⛔ **none** | ❌ | ❌ | ✅ |
 * | X `advanced_search` | legacy string | ✅ | ✅ (replies) | ✅ |
 *
 * ⭐ **X is the richest of the four**, not the poorest. An earlier version of
 * this file excluded it on the belief that its search wasn't wrapped —
 * `twitterApiIoSearch` has wrapped `advanced_search` all along, and its only
 * callers were in frozen v1. Since X is the launch channel and often the only
 * connected one, that omission mattered more than any of the rest.
 *
 * Two consequences that shape everything below:
 *
 * **1. Velocity cannot be compared across channels.** `velocity()` scores
 * likes + 3×comments, on purpose — views are inflated and mean something
 * different on every platform. YouTube search returns neither, so every
 * YouTube row would score exactly 0 and rank last forever. Sweeping it into
 * one global list means paying for results that can never surface. So each
 * channel is ranked **within itself** and the lists are interleaved.
 *
 * **2. YouTube shorts are excluded from the daily scroll.** The response
 * carries more of them than videos (25 vs 18), and they have no date at all —
 * so they cannot answer "what's moving *today*", which is the only question
 * this sweep asks. Including them ranked by raw view count would be inventing
 * a recency signal that isn't in the data. §2.7: grounded or silent.
 */
export const SCROLLABLE_CHANNELS = ["tiktok", "instagram", "youtube", "x"] as const;
/** What she actually reads. More than this is a firehose, not a scroll. */
export const OBSERVATIONS_RETURNED = 20;
/** Older than this isn't news, whatever its engagement. */
export const NEWS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Read the niche.
 *
 * Returns a named failure rather than an empty list when there is nothing to
 * read, because "the niche was quiet today" and "you never told me what to
 * watch" are different answers and only one of them is her problem.
 */
export const scrollNiche = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    error?: string;
    observations?: Observation[];
    keywordsSwept?: string[];
    channelsSwept?: string[];
  }> => {
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) {
      return {
        ok: false,
        error:
          "I don't know what to watch yet — the niche keywords haven't been worked out",
      };
    }

    const now = args.now ?? Date.now();
    const { tiktok } = await import(
      "../integrations/scrapeCreators/platforms/tiktok"
    );

    /**
     * ⭐ Read where she publishes.
     *
     * A founder who only ships to X and TikTok gains nothing from us buying
     * Instagram credits every morning. So: connected channels only.
     *
     * This gate is a COST choice, not a technical one — every read here is
     * public and unauthenticated, so any channel could be swept whether or not
     * the founder has connected it. If reading a channel she doesn't publish to
     * ever proves worth the credits, this is the line to change.
     *
     * Falls back to TikTok when nothing is connected yet, because a scroll that
     * returns nothing on day one looks identical to a broken scroll.
     */
    const connected = await ctx.runQuery(internal.maya.channels.forCustomer, {
      customerId: args.customerId,
    });
    const live = new Set(
      connected.filter((c) => c.status === "connected").map((c) => c.channel)
    );
    const channels: string[] = SCROLLABLE_CHANNELS.filter((c) => live.has(c));
    if (channels.length === 0) channels.push("tiktok");

    const keywords = targets.keywords.slice(0, KEYWORDS_PER_SCROLL);
    const byChannel = new Map<string, Observation[]>();
    const swept: string[] = [];
    let searches = 0;

    /**
     * Keyword-major, so the cap costs depth rather than a whole channel. Going
     * channel-major would spend every search on TikTok and leave Instagram
     * unread — a silent single-channel scroll that still reports success.
     */
    outer: for (const keyword of keywords) {
      for (const channel of channels) {
        if (searches >= MAX_SEARCHES_PER_SCROLL) break outer;
        searches += 1;
        try {
          let found: Observation[] = [];
          if (channel === "tiktok") {
            const result = await tiktok.searchKeyword(keyword, {
              // This is a *daily* read. A month-old post is not what's moving now.
              datePosted: "this_month",
              sortBy: "relevance",
            });
            for (const post of result.posts) {
              const ms = toMillis(post.postedAt);
              if (!ms || now - ms > NEWS_WINDOW_MS) continue;
              const metrics = {
                likes: post.metrics.likeCount ?? 0,
                comments: post.metrics.commentCount ?? 0,
                views: post.metrics.viewCount ?? 0,
              };
              found.push({
                channel: "tiktok",
                sourceUrl:
                  post.url ??
                  (post.authorHandle
                    ? `https://www.tiktok.com/@${post.authorHandle}/video/${post.postId}`
                    : ""),
                authorHandle: post.authorHandle ?? null,
                text: post.caption ?? "",
                postedAt: ms,
                metrics,
                velocity: channelVelocity("tiktok", metrics, ms, now),
                keyword,
              });
            }
          } else if (channel === "instagram") {
            found = await readInstagram(keyword, now);
          } else if (channel === "youtube") {
            found = await readYouTube(keyword, now);
          } else if (channel === "x") {
            found = await readX(keyword, now);
          }

          if (!swept.includes(keyword)) swept.push(keyword);
          const existing = byChannel.get(channel) ?? [];
          byChannel.set(channel, [...existing, ...found]);
        } catch {
          // A dead search loses one keyword on one channel, never the morning.
          continue;
        }
      }
    }

    const observations = [...byChannel.values()].flat();
    if (observations.length === 0) {
      return {
        ok: true,
        observations: [],
        keywordsSwept: swept,
        channelsSwept: channels,
        error: "nothing new in the niche today",
      };
    }

    /**
     * ⭐ Screen for the niche BEFORE ranking.
     *
     * ⚠️ Measured 2026-08-09: this loop was recording whatever the keyword
     * search returned. For a solo-founder-SaaS account that meant the mined
     * hashtag sets came back led by `#games`, `#familygames`, `#fungames`, and
     * the format library held a card from a video about whether the earth gets
     * heavier as we build buildings.
     *
     * The keywords were right — "no time for marketing", "building not
     * marketing". TikTok's search returns loose matches, and nothing here
     * checked. `trends.ts` has filtered all along, holding non-matching results
     * aside as `foreign`; this file, which produces far more rows, did not.
     *
     * Nothing looked broken: real posts, real metrics, sweeps reporting
     * success. The pollution only surfaced two layers downstream.
     *
     * Screened before `interleave` on purpose — filtering afterwards would let
     * off-niche posts consume the returned slots and then be discarded, which
     * is how a good day still reports three usable observations.
     */
    const screen = await ctx.runAction(internal.maya.relevance.screenForNiche, {
      customerId: args.customerId,
      niche: targets.keywords,
      itemsJson: JSON.stringify(
        observations.map((o) => ({ key: o.sourceUrl, text: o.text }))
      ),
    });
    const inNiche = new Set(screen.keep);
    for (const [channel, rows] of byChannel) {
      byChannel.set(
        channel,
        rows.filter((o) => inNiche.has(o.sourceUrl))
      );
    }

    /**
     * ⚠️ A screen that removed everything is reported, not published as an
     * empty morning. §12: honest silence beats fake activity — but "the niche
     * was quiet" and "I threw all of it away" are different sentences and the
     * founder is owed the right one.
     */
    if ([...byChannel.values()].flat().length === 0) {
      return {
        ok: true,
        observations: [],
        keywordsSwept: swept,
        channelsSwept: channels,
        error: `nothing that came back today was actually about your niche — ${screen.screened} posts, none of them yours`,
      };
    }

    // Interleaved, NOT globally sorted — the channels don't report the same
    // metrics, so their velocities aren't on one scale. See `channelVelocity`.
    const ranked = interleave([...byChannel.values()], OBSERVATIONS_RETURNED);

    // Written down before they're returned, so a scroll she never acts on
    // still counts toward "this keeps coming up".
    await ctx.runMutation(internal.maya.scroll.recordObservations, {
      customerId: args.customerId,
      observationsJson: JSON.stringify(ranked),
      now,
    });

    return { ok: true, keywordsSwept: swept, channelsSwept: channels, observations: ranked };
  },
});



/* -------------------------------------------------------------------------- */
/* Per-channel readers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ Rank WITHIN a channel, never across.
 *
 * `velocity()` scores likes + 3×comments and ignores views, which is right —
 * views are inflated and mean something different on every platform. But
 * YouTube search returns no likes and no comments at all, so a YouTube row
 * scored that way is always exactly 0.
 *
 * Rather than pretend the numbers are comparable, each channel gets the best
 * signal it actually reports, and the lists are merged by interleaving instead
 * of by sorting. A number that ranks correctly inside its own channel and
 * nonsensically outside it is still useful — as long as nothing sorts across.
 */
function channelVelocity(
  channel: string,
  metrics: { likes: number; comments: number; views: number },
  postedAt: number | null,
  now: number
): number {
  if (postedAt === null) return 0;
  const ageHours = Math.max(1, (now - postedAt) / 3_600_000);
  if (channel === "youtube") {
    // Views ÷ age. On a different scale to the others by an order of
    // magnitude, which is exactly why nothing sorts across channels.
    return metrics.views / ageHours;
  }
  return (metrics.likes + metrics.comments * 3) / ageHours;
}

/**
 * Instagram Reels matching a keyword.
 *
 * ⚠️ `taken_at` is an **ISO 8601 string** — TikTok's `create_time` is unix
 * seconds. Feeding one to the other's parser is precisely the bug that made
 * every TikTok post look fifty years old and rejected every keyword.
 *
 * ⚠️ Two view counts come back: `video_view_count` and `video_play_count`, and
 * on a live sample they differed 5×  (1,191 vs 5,850). Plays is the larger and
 * the one Instagram surfaces as "views" today, so plays is what's recorded —
 * but nothing ranks on it, so the ambiguity can't move a decision.
 */
async function readInstagram(
  keyword: string,
  now: number
): Promise<Observation[]> {
  const { instagram } = await import(
    "../integrations/scrapeCreators/platforms/instagram"
  );
  /**
   * ⚠️ The envelope field is `raw`, not `payload`.
   *
   * Guessed wrong on the first pass, and the failure mode is the dangerous
   * kind: `undefined?.reels ?? []` yields an empty list, so the sweep would
   * have reported "nothing new in the niche today" every single morning,
   * forever, and looked exactly like a quiet niche.
   */
  const result = (await instagram.reelsSearch(keyword)) as unknown as {
    raw?: { reels?: unknown[] };
  };
  return normalizeInstagramReels(
    (result.raw?.reels ?? []) as Array<Record<string, unknown>>,
    keyword,
    now
  );
}

/**
 * Pure, so the mapping is testable against a REAL captured payload without a
 * network — the same reason `channels.ts` splits its interpretation out. Every
 * field name below was read off a live response, and a vendor rename has to
 * fail in a test rather than as a silently empty morning.
 */
export function normalizeInstagramReels(
  reels: Array<Record<string, unknown>>,
  keyword: string,
  now: number
): Observation[] {
  const out: Observation[] = [];
  for (const reel of reels) {
    const takenAt = typeof reel.taken_at === "string" ? Date.parse(reel.taken_at) : NaN;
    const postedAt = Number.isFinite(takenAt) ? takenAt : null;
    if (postedAt === null || now - postedAt > NEWS_WINDOW_MS) continue;

    const owner = (reel.owner ?? {}) as { username?: string };
    const metrics = {
      likes: num(reel.like_count),
      comments: num(reel.comment_count),
      views: num(reel.video_play_count) || num(reel.video_view_count),
    };
    out.push({
      channel: "instagram",
      sourceUrl:
        typeof reel.url === "string"
          ? reel.url
          : `https://www.instagram.com/reel/${String(reel.shortcode ?? "")}/`,
      authorHandle: owner.username ?? null,
      text: typeof reel.caption === "string" ? reel.caption : "",
      postedAt,
      metrics,
      velocity: channelVelocity("instagram", metrics, postedAt, now),
      keyword,
    });
  }
  return out;
}

/**
 * YouTube videos matching a keyword.
 *
 * ⛔ **`shorts` is deliberately not read**, even though the live response
 * carried more shorts (25) than videos (18). A short comes back with a title,
 * a url and a view count and **no date whatsoever** — so it cannot answer
 * "what's moving today", which is the only question this sweep asks. Ranking
 * them by raw views would invent a recency signal that isn't in the payload.
 */
async function readYouTube(
  keyword: string,
  now: number
): Promise<Observation[]> {
  const { youtube } = await import(
    "../integrations/scrapeCreators/platforms/youtube"
  );
  // `raw`, not `payload` — see the note in `readInstagram`.
  const result = (await youtube.search(keyword)) as unknown as {
    raw?: { videos?: unknown[] };
  };
  return normalizeYouTubeVideos(
    (result.raw?.videos ?? []) as Array<Record<string, unknown>>,
    keyword,
    now
  );
}

/** Pure — see `normalizeInstagramReels`. */
export function normalizeYouTubeVideos(
  videos: Array<Record<string, unknown>>,
  keyword: string,
  now: number
): Observation[] {
  const out: Observation[] = [];
  for (const video of videos) {
    const published =
      typeof video.publishedTime === "string" ? Date.parse(video.publishedTime) : NaN;
    const postedAt = Number.isFinite(published) ? published : null;
    if (postedAt === null || now - postedAt > NEWS_WINDOW_MS) continue;

    const channelInfo = (video.channel ?? {}) as { handle?: string };
    // No likes, no comments — the endpoint simply doesn't return them. Zeroes
    // here are honest absences, not measured values.
    const metrics = { likes: 0, comments: 0, views: num(video.viewCountInt) };
    out.push({
      channel: "youtube",
      sourceUrl:
        typeof video.url === "string"
          ? video.url
          : `https://www.youtube.com/watch?v=${String(video.id ?? "")}`,
      authorHandle: channelInfo.handle ?? null,
      // The title IS the text on YouTube — there is no caption in search.
      text: typeof video.title === "string" ? video.title : "",
      postedAt,
      metrics,
      velocity: channelVelocity("youtube", metrics, postedAt, now),
      keyword,
    });
  }
  return out;
}


/**
 * X posts matching a keyword, via twitterapi.io.
 *
 * ⭐ The division of labour on X, stated in §2 and worth restating here:
 * **read via twitterapi.io, write via Zernio. Never conflate them.** This is a
 * read — unauthenticated, never touching the founder's account, so it carries
 * zero ban risk and costs ~$0.15 per 1,000 tweets.
 *
 * Shape VERIFIED LIVE 2026-08-05. It returns likeCount AND replyCount, which
 * makes X the one non-TikTok channel whose velocity is directly comparable —
 * `channelVelocity` gives it the standard likes + 3×comments treatment.
 *
 * ⚠️ `createdAt` is Twitter's legacy format, a fourth date format across four
 * channels: `"Wed Aug 05 13:27:17 +0000 2026"`.
 */
async function readX(keyword: string, now: number): Promise<Observation[]> {
  const { twitterApiIoSearch } = await import(
    "../integrations/twitterApiIo/twitterSearch"
  );
  const result = await twitterApiIoSearch(keyword, { queryType: "Latest" });
  return normalizeXSearch(
    (result.items ?? []) as unknown as Array<Record<string, unknown>>,
    keyword,
    now
  );
}

/**
 * ⭐ Pure — and written against the shape the wrapper ACTUALLY returns.
 *
 * `twitterApiIoSearch` does not hand back raw tweets. It normalises them into
 * a `ResearchRawItem` first:
 *
 *   { externalId, url, excerpt, author: string|null, createdAtMs: number|null,
 *     engagement: { likes, comments, shares, views } }
 *
 * I wrote this against the raw tweet shape — `text`, `createdAt`,
 * `likeCount`, `author.userName` — none of which survive that normalisation.
 * It returned zero every time, which is indistinguishable from "X was quiet",
 * and it is the SECOND shape-assumption in this file after the `payload`/`raw`
 * mix-up. Both failed silently and both were found by running it, not reading
 * it.
 *
 * One upside of the wrapper doing the work: `createdAtMs` is already
 * milliseconds, so X is the one channel here that needs no date parsing at all.
 */
export function normalizeXSearch(
  items: Array<Record<string, unknown>>,
  keyword: string,
  now: number
): Observation[] {
  const out: Observation[] = [];
  for (const item of items) {
    const text = typeof item.excerpt === "string" ? item.excerpt : "";
    const url = typeof item.url === "string" ? item.url : "";
    if (!text || !url) continue;

    const postedAt =
      typeof item.createdAtMs === "number" && Number.isFinite(item.createdAtMs)
        ? item.createdAtMs
        : null;
    if (postedAt === null || now - postedAt > NEWS_WINDOW_MS) continue;

    const engagement = (item.engagement ?? {}) as Record<string, unknown>;
    const metrics = {
      likes: num(engagement.likes),
      // Replies ARE the comments on X — the thing velocity weighs 3×.
      comments: num(engagement.comments),
      views: num(engagement.views),
    };
    out.push({
      channel: "x",
      sourceUrl: url,
      // Already a handle string here, not an object.
      authorHandle: typeof item.author === "string" ? item.author : null,
      text,
      postedAt,
      metrics,
      velocity: channelVelocity("x", metrics, postedAt, now),
      keyword,
    });
  }
  return out;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * ⭐ Merge per-channel lists round-robin.
 *
 * Not `.sort()` — see `channelVelocity`. Interleaving guarantees every channel
 * she reads is represented in what she actually sees, which a global sort
 * cannot: one platform's number scale would take every slot.
 */
export function interleave(lists: Observation[][], limit: number): Observation[] {
  const ranked = lists.map((list) => [...list].sort((a, b) => b.velocity - a.velocity));
  const out: Observation[] = [];
  for (let i = 0; out.length < limit; i += 1) {
    let tookAny = false;
    for (const list of ranked) {
      if (i < list.length) {
        out.push(list[i]);
        tookAny = true;
        if (out.length >= limit) break;
      }
    }
    if (!tookAny) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Remembering what she saw                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Write observations down, once each.
 *
 * ## Why idempotent matters more than it sounds
 *
 * A climbing post shows up in the sweep for several days running — that's what
 * climbing means. Without dedupe, a week of scrolling turns one post into seven
 * rows, and any "how often does this come up?" question answers itself wrongly.
 *
 * Keyed on `sourceUrl` because it's the one identifier the vendor can't
 * renumber. Velocity is **not** updated on a re-sight: the row records what
 * made it worth noticing *then*, and overwriting that loses the history that
 * makes the second sighting interesting.
 *
 * ## Measured, not assumed
 *
 * Two consecutive scrolls of the same keywords produced **16 new rows out of
 * 20** — TikTok's keyword search rotates its results rather than returning a
 * stable ranking. So dedupe catches genuine repeats but far fewer than the
 * daily-cron intuition suggests, and rows accumulate at roughly a full scroll
 * per run.
 *
 * ⚠️ **The consequence is about meaning, not storage.** "This keeps coming up"
 * cannot be measured by counting URL repeats when the search itself shuffles.
 * Topic frequency has to come from CONTENT similarity — which is what the
 * complaint clustering in `complaints.ts` does, and why it reads comment text
 * rather than counting posts.
 */
export const recordObservations = internalMutation({
  args: {
    customerId: v.id("customers"),
    observationsJson: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ written: number; alreadyKnown: number }> => {
    const incoming = JSON.parse(args.observationsJson) as Observation[];
    const now = args.now ?? Date.now();
    let written = 0;
    let alreadyKnown = 0;

    for (const o of incoming) {
      if (!o.sourceUrl) continue;
      const existing = (await ctx.db
        .query("observations")
        .withIndex("by_customer_and_source", (q) =>
          q.eq("customerId", args.customerId).eq("sourceUrl", o.sourceUrl)
        )
        .first()) as Doc<"observations"> | null;
      if (existing) {
        alreadyKnown += 1;
        continue;
      }
      await ctx.db.insert("observations", {
        customerId: args.customerId,
        channel: o.channel,
        sourceUrl: o.sourceUrl,
        authorHandle: o.authorHandle ?? undefined,
        kind: "post",
        text: o.text,
        postedAt: o.postedAt ?? undefined,
        capturedAt: now,
        metricsJson: JSON.stringify(o.metrics),
        velocity: o.velocity,
        keyword: o.keyword,
      });
      written += 1;
    }

    return { written, alreadyKnown };
  },
});

/** What she's seen lately — the raw material for "this keeps coming up". */
export const recentObservations = internalQuery({
  args: {
    customerId: v.id("customers"),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"observations">[]> => {
    const rows = (await ctx.db
      .query("observations")
      .withIndex("by_customer_and_captured", (q) =>
        q.eq("customerId", args.customerId)
      )
      .order("desc")
      .take(args.limit ?? 100)) as Doc<"observations">[];
    return args.since ? rows.filter((r) => r.capturedAt >= args.since!) : rows;
  },
});
