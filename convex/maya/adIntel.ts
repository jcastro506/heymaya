/**
 * ⭐ COMPETITOR AD INTELLIGENCE — the strongest rung on the evidence ladder.
 *
 * `pick-the-week` ranks what to build on by how much someone else has already
 * risked on it, and rung 1 is *"a competitor ad still running after three
 * weeks."* Until this module existed there were no ads to rank, so the skill
 * silently fell through to rung 2 every week — a ladder whose top rung is
 * missing does not announce itself, it just quietly grades everything lower.
 *
 * ## Why an ad beats a viral post
 *
 * A viral organic post tells you something got attention once. An ad running
 * for 90 days tells you a company with a dashboard has been paying every single
 * morning to keep it alive, and has decided each morning not to kill it. That
 * is the only signal in this product that comes with someone else's money
 * behind it.
 *
 * ## ⚠️ THE SIGNAL IS LONGEVITY, AND IT HAS TO BE COMPUTED
 *
 * Existence means nothing — anyone can boost a post for twenty dollars and it
 * sits in the library looking identical to a proven winner.
 *
 * The vendor exposes `total_active_time` and `spend`, which sound exactly like
 * what we want. **Measured against a real advertiser on 2026-08-19 (Duolingo,
 * 30 live ads): `start_date` populated 30/30, `total_active_time` 0/30, `spend`
 * 0/30.** Both are declared-but-null. Ranking on either would have produced a
 * uniform zero across every ad and an ordering that was really just the
 * vendor's arbitrary return order — a silent, plausible, totally wrong answer.
 *
 * So longevity is derived here from `start_date` and nothing else.
 *
 * ⚠️ `start_date` IS IN UNIX **SECONDS**. Every other timestamp in this
 * codebase is milliseconds. Treating it as ms dates every ad to 1970 and makes
 * every one of them look maximally proven.
 *
 * ## What the spread actually looks like
 *
 * The same measurement, sorted: 111, 110, 110, 49, 49, 49 … down to 8 days.
 * A genuine spread, which is what makes ranking worth doing — the top ad had
 * been running nearly four months and would never have surfaced by recency.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * The "proven" line, in days. Three weeks is the threshold `pick-the-week`
 * names, and it is a judgement about ad ops rather than statistics: a losing
 * ad is killed inside a week or two, so surviving three is evidence of a
 * dashboard saying it works.
 */
export const PROVEN_DAYS = 21;

/**
 * ⚠️ EVERY CALL COSTS A CREDIT. Measured: `credits_charged: 1` on all four
 * endpoints, with 794 remaining on the account at the time of writing.
 *
 * One customer's sweep is `MAX_COMPETITORS` company lookups + the same number
 * of ad pulls + `TRANSCRIBE_TOP` transcripts ≈ 15 credits. Weekly, that is ~60
 * per customer per month — at 200 customers, 12,000/month on this endpoint
 * family alone. That is an ENTERPRISE-CONVERSATION number, not a rounding
 * error, which is why the caps are constants here rather than inlined.
 */
export const MAX_COMPETITORS = 6;
/** The vendor returns 30 per page. One page is plenty; ranking picks the few. */
export const ADS_PER_COMPETITOR = 30;
/** Transcripts are the expensive half and only the winners are worth reading. */
export const TRANSCRIBE_TOP = 3;
/** Handed to the model. More than this is a firehose, not a shortlist. */
export const ADS_RETURNED = 12;

export interface RankedAd {
  adArchiveId: string;
  pageId: string;
  pageName: string;
  /** Derived here from `start_date`; never read from the vendor. */
  daysRunning: number;
  startedAtMs: number;
  isActive: boolean;
  /** `collation_count` — how many variants of this concept are running. */
  variants: number;
  /** Groups the variants of ONE concept. The dedupe key for a shortlist. */
  collationId: string;
  hasVideo: boolean;
  /**
   * ⭐ THE PLAYABLE FILE. Without this an ad can only ever be READ, and the
   * whole point of a competitor's video ad is what it looks like.
   *
   * SD deliberately: `watchFormat` caps downloads at 12MB because the bytes are
   * base64'd into the Gemini request (~1.33× inflation), and the HD cut of a
   * 30-second ad clears that regularly.
   */
  videoUrl: string;
  /** First frame. The cheapest possible answer to "what does this look like". */
  thumbUrl: string;
  /** Filled by the watch pass: how the ad is MADE, never what it says. */
  watchedJson: string | null;
  title: string;
  body: string;
  ctaText: string;
  linkUrl: string;
  url: string;
  /** Filled for the top few only. `null` = not fetched; "" = none available. */
  transcript: string | null;
}

/**
 * Days an ad has been live.
 *
 * Returns `null` rather than 0 for a missing or unparseable date, because 0 and
 * "unknown" must not sort together — an undated ad is not a brand-new one, and
 * ranking it as such buries it forever.
 */
export function daysRunning(
  startDateSec: unknown,
  now: number
): number | null {
  if (typeof startDateSec !== "number" || !Number.isFinite(startDateSec)) {
    return null;
  }
  // Seconds, not milliseconds — see the module docblock.
  const startedMs = startDateSec * 1000;
  if (startedMs <= 0 || startedMs > now) return null;
  return Math.floor((now - startedMs) / 86_400_000);
}

function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/**
 * The playable URL, preferring SD.
 *
 * ⚠️ NEVER the watermarked cuts. `watermarked_video_*` carry Meta's ad-library
 * overlay burned into the frame, which would teach the watch pass that the
 * overlay is part of the creative.
 */
function firstVideoUrl(videos: unknown): string {
  if (!Array.isArray(videos) || videos.length === 0) return "";
  const v = videos[0] as Record<string, unknown>;
  return str(v.video_sd_url) || str(v.video_hd_url);
}

/**
 * Rank a vendor haul by longevity.
 *
 * ⚠️ **INACTIVE ADS ARE DROPPED, not ranked lower.** A dead ad that ran 200
 * days is history, and history is exactly what a founder cannot act on this
 * week. The question this answers is "what is working right now", and a
 * stopped ad has no answer to it.
 */
export function rankAds(raw: unknown, now: number): RankedAd[] {
  /**
   * ⚠️ THE ROOT KEY DIFFERS BY ENDPOINT AND THERE IS NO PATTERN TO IT.
   * `company/ads` returns `results`; `search/ads` returns `searchResults`.
   * Measured on live calls, 2026-08-19. Accepting both is not defensive
   * programming, it is the actual contract.
   */
  const root = raw as Record<string, unknown> | null;
  const list = Array.isArray(root?.results)
    ? root.results
    : Array.isArray(root?.searchResults)
      ? root.searchResults
      : [];

  const out: RankedAd[] = [];
  for (const item of list) {
    const ad = item as Record<string, unknown>;
    if (ad.is_active !== true) continue;

    const days = daysRunning(ad.start_date, now);
    if (days === null) continue;

    const snap = (ad.snapshot ?? {}) as Record<string, unknown>;
    const videos = snap.videos;
    const id = str(ad.ad_archive_id);
    if (!id) continue;

    out.push({
      adArchiveId: id,
      pageId: str(ad.page_id),
      pageName: str(ad.page_name) || str(snap.page_name),
      daysRunning: days,
      startedAtMs: (ad.start_date as number) * 1000,
      isActive: true,
      variants:
        typeof ad.collation_count === "number" ? ad.collation_count : 1,
      collationId: str(ad.collation_id) || id,
      hasVideo: Array.isArray(videos) && videos.length > 0,
      videoUrl: firstVideoUrl(videos),
      thumbUrl: str(
        (Array.isArray(videos) && videos.length > 0
          ? (videos[0] as Record<string, unknown>).video_preview_image_url
          : "") as unknown
      ),
      watchedJson: null,
      title: str(snap.title),
      body: str((snap.body as Record<string, unknown> | undefined)?.text)
        || str(snap.body),
      ctaText: str(snap.cta_text),
      linkUrl: str(snap.link_url),
      url: `https://www.facebook.com/ads/library?id=${id}`,
      transcript: null,
    });
  }

  /**
   * Longevity first, then variant count. The tiebreak matters: two ads at 49
   * days where one is running three variants and the other one means the first
   * advertiser is actively investing in that concept, not merely tolerating it.
   */
  out.sort(
    (a, b) => b.daysRunning - a.daysRunning || b.variants - a.variants
  );
  return out;
}

/**
 * ⭐ IDENTIFYING THE RIGHT PAGE IS A JUDGEMENT, AND HEURISTICS GET IT WRONG.
 *
 * A name search matches every page on Facebook containing the word, and the
 * collisions are not fan pages — they are whole other companies. Measured live
 * 2026-08-19, searching "Creatify" for a customer whose competitor is
 * creatify.ai:
 *
 * | name | category | likes |
 * |---|---|---|
 * | Creatify AI | Internet Company | 14,269 |
 * | **CREATIFY** | **Advertising Agency** | **43,600** |
 * | Creatify | Textile Company | 154 |
 *
 * ⚠️ **THE FIRST HEURISTIC I WROTE PICKED THE ADVERTISING AGENCY**, and the
 * sweep returned ten Spanish-language holographic-sticker ads that a founder
 * would have built a week on. Every tiebreak available fails here:
 *
 * - **Exact name match fails** — the real one is "Creatify AI", not "Creatify".
 * - **Likes fails** — the wrong one has 3× the followers.
 * - **Verification fails** — every candidate is `NOT_VERIFIED`.
 * - **Link domain fails** — they are `creatify.ai` and `creatify.mx`; both
 *   contain the name.
 *
 * The only thing that separates them is knowing that a video-ad tool competes
 * with an Internet Company and not with a sticker printer. That is meaning, not
 * string distance, so the model decides and the code only collects.
 *
 * A wrong page is worse than no page: no page is a visible gap, a wrong page is
 * a confident week of irrelevant work. So an unsure answer resolves to null.
 */
export interface PageCandidate {
  pageId: string;
  name: string;
  category: string;
  likes: number;
}

/** Deterministic half: pull the candidate list out of the vendor payload. */
export function candidatesFrom(raw: unknown, limit = 8): PageCandidate[] {
  const root = raw as Record<string, unknown> | null;
  const list = Array.isArray(root?.searchResults) ? root.searchResults : [];
  const out: PageCandidate[] = [];
  for (const item of list) {
    const p = item as Record<string, unknown>;
    const pageId = str(p.page_id);
    const name = str(p.name);
    if (!pageId || !name) continue;
    out.push({
      pageId,
      name,
      category: str(p.category),
      likes: typeof p.likes === "number" ? p.likes : 0,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export const IDENTIFY_MODEL = "google/gemini-3.1-flash-lite";

export const IDENTIFY_SYSTEM = `You match competitor names to Facebook advertiser pages.

You are given a founder's product and, for each competitor name, the pages the ad
library returned for it. Many are unrelated companies that happen to share the
name — a textile company, a local advertising agency, a school.

Pick the page that is genuinely a competitor OF THIS PRODUCT. Judge by what the
company appears to do, using the page category and name together. Follower count
is not evidence: an unrelated local business often has more followers than the
real competitor.

If none of the candidates is plausibly the right company, return null for that
competitor. A wrong match is much worse than no match.

Return ONLY JSON: {"matches":[{"competitor":"<name as given>","pageId":"<id or null>"}]}`;

export function buildIdentifyPrompt(
  product: { name: string; whatItIs: string },
  groups: { competitor: string; candidates: PageCandidate[] }[]
): string {
  const blocks = groups
    .map((g) => {
      const rows = g.candidates
        .map(
          (c) =>
            `  - pageId=${c.pageId} | name="${c.name}" | category="${c.category}" | followers=${c.likes}`
        )
        .join("\n");
      return `COMPETITOR: ${g.competitor}\n${rows}`;
    })
    .join("\n\n");

  return `THE FOUNDER'S PRODUCT
${product.name} — ${product.whatItIs}

CANDIDATE PAGES
${blocks}`;
}

/**
 * Parse the model's choice back to page ids.
 *
 * Unknown competitors and unknown page ids are DROPPED rather than trusted: the
 * model naming a page id that was never offered means it invented one, and an
 * invented id would be looked up as though it were real.
 */
export function parseIdentified(
  content: string,
  groups: { competitor: string; candidates: PageCandidate[] }[]
): Map<string, PageCandidate> {
  const chosen = new Map<string, PageCandidate>();
  let parsed: unknown;
  try {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : content);
  } catch {
    return chosen;
  }
  const matches = (parsed as { matches?: unknown })?.matches;
  if (!Array.isArray(matches)) return chosen;

  for (const item of matches) {
    const row = item as Record<string, unknown>;
    const competitor = str(row.competitor);
    const pageId = str(row.pageId);
    if (!competitor || !pageId) continue;
    const group = groups.find((g) => g.competitor === competitor);
    if (!group) continue;
    const hit = group.candidates.find((c) => c.pageId === pageId);
    if (!hit) continue;
    chosen.set(competitor, hit);
  }
  return chosen;
}

/**
 * ⭐ BUILD THE SHORTLIST: ONE CONCEPT PER ROW, SPREAD ACROSS COMPETITORS.
 *
 * Ranking by longevity alone produced a shortlist that was measurably useless
 * on the first live run — 12 rows, all Synthesia, five of them the same
 * creative under `👉 Try it out for FREE now`. Two separate faults, both
 * invisible until real data went through it:
 *
 * **Variants are not evidence, they are one piece of evidence.** An advertiser
 * running five cuts of a concept produces five rows that say the same thing.
 * `collation_id` is the vendor's own grouping for exactly this, so one concept
 * becomes one row — keeping the variant COUNT, which is itself a signal of
 * conviction, without letting it consume the list.
 *
 * **And one advertiser must not eat the whole page.** Every Synthesia ad
 * started the same day, so a pure longevity sort buried every competitor whose
 * ads happened to be newer. A founder needs to see what the field is doing, not
 * one company's campaign. Round-robin gives each competitor a turn before
 * anyone gets a second row.
 */
export function buildShortlist(ads: RankedAd[], limit: number): RankedAd[] {
  const byConcept = new Map<string, RankedAd>();
  for (const ad of ads) {
    const seen = byConcept.get(ad.collationId);
    // Longest-running wins the slot; variant count breaks the tie.
    if (
      !seen ||
      ad.daysRunning > seen.daysRunning ||
      (ad.daysRunning === seen.daysRunning && ad.variants > seen.variants)
    ) {
      byConcept.set(ad.collationId, ad);
    }
  }

  const byPage = new Map<string, RankedAd[]>();
  for (const ad of [...byConcept.values()].sort(
    (a, b) => b.daysRunning - a.daysRunning || b.variants - a.variants
  )) {
    const key = ad.pageId || ad.pageName;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key)!.push(ad);
  }

  const queues = [...byPage.values()];
  const out: RankedAd[] = [];
  let round = 0;
  while (out.length < limit) {
    let tookOne = false;
    for (const q of queues) {
      if (round >= q.length) continue;
      out.push(q[round]);
      tookOne = true;
      if (out.length >= limit) break;
    }
    if (!tookOne) break;
    round += 1;
  }
  return out;
}

/**
 * Weekly competitor-ad sweep for one customer.
 *
 * ⚠️ **DELIBERATELY NOT AN AGENT TURN.** Principle 3: deterministic code
 * watches, the model judges. Collection, capping and ranking are code here so
 * that the weekly pick is a judgement over a fixed shortlist rather than a
 * model deciding how many paid API calls to make. The model never sees this
 * function; it sees the rows.
 *
 * ⚠️ **ONE COMPETITOR'S FAILURE MUST NOT END THE SWEEP.** Each is caught
 * separately and named in `failures`, because the alternative is a sweep that
 * returns three ads instead of twelve with nothing anywhere saying why.
 */
export const sweepAdIntel = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    competitorsTried: number;
    adsFound: number;
    proven: number;
    failures: string[];
    detail: string;
  }> => {
    const now = args.now ?? Date.now();
    const truth = await ctx.runQuery(internal.maya.productTruth.forCustomer, {
      customerId: args.customerId,
    });

    const clean = (xs: string[] | undefined) =>
      (xs ?? []).map((c) => c.trim()).filter((c) => c.length > 0);

    /**
     * Confirmed names first, then the ones we worked out ourselves.
     *
     * ⭐ AND IF WE HAVE NEITHER, WORK THEM OUT NOW RATHER THAN GIVING UP.
     * `competitors` is populated only when the founder's own page names rivals,
     * which most don't — so for most customers this used to return "nothing on
     * file" forever, and the top rung of the ladder was permanently unreachable.
     * Discovery runs once here and its result persists, so this is a first-run
     * cost rather than a weekly one.
     */
    let named = [...clean(truth?.competitors), ...clean(truth?.discoveredCompetitors)];
    let knownPages = truth?.discoveredCompetitorPages ?? [];

    if (named.length === 0) {
      const discovered = await ctx.runAction(
        internal.maya.adIntel.discoverCompetitors,
        { customerId: args.customerId, now }
      );
      named = discovered.found;
      if (named.length === 0) {
        return {
          ok: true,
          competitorsTried: 0,
          adsFound: 0,
          proven: 0,
          failures: [],
          detail: `couldn't work out who the competitors are — ${discovered.detail}`,
        };
      }
      const fresh = await ctx.runQuery(internal.maya.productTruth.forCustomer, {
        customerId: args.customerId,
      });
      knownPages = fresh?.discoveredCompetitorPages ?? [];
    }
    named = [...new Set(named)].slice(0, MAX_COMPETITORS);

    /**
     * ⭐ NAMES WE ALREADY HAVE A PAGE FOR SKIP THE LOOKUP ENTIRELY.
     *
     * Discovery found these by reading their ads, so the page id is exact. Any
     * re-derivation from the name is a wasted paid call AND a fresh chance to
     * land on the wrong company — measured live: `AutoReel`, discovered from
     * its own running ads, was re-looked-up onto a namesake page with none, and
     * the sweep reported it was not advertising.
     */
    const pageFor = new Map(knownPages.map((p) => [p.name, p.pageId]));

    const { facebook } = await import(
      "../integrations/scrapeCreators/platforms/facebook"
    );

    const failures: string[] = [];
    const all: RankedAd[] = [];

    /**
     * Pass 1 — COLLECT. One name search per competitor, no judgement yet.
     */
    const groups: { competitor: string; candidates: PageCandidate[] }[] = [];
    const resolved = new Map<string, PageCandidate>();

    for (const name of named) {
      const known = pageFor.get(name);
      if (known) {
        resolved.set(name, { pageId: known, name, category: "", likes: 0 });
        continue;
      }
      try {
        const found = await facebook.searchCompanies(name);
        const candidates = candidatesFrom(found.raw);
        if (candidates.length === 0) {
          failures.push(`${name}: nothing by that name in the ad library`);
          continue;
        }
        groups.push({ competitor: name, candidates });
      } catch (e) {
        failures.push(
          `${name}: ${e instanceof Error ? e.message : "lookup failed"}`
        );
      }
    }

    /**
     * Pass 2 — JUDGE. ⭐ ONE model call for every competitor at once, not one
     * per competitor: the judgement is identical in kind each time and batching
     * makes the weekly sweep a single, priceable line on the bill.
     */
    let chosen = new Map<string, PageCandidate>(resolved);
    if (groups.length > 0) {
      const { callModel } = await import("./llm");
      const completion = await callModel(ctx, {
        customerId: args.customerId,
        purpose: "ad_competitor_identify",
        apiKey: process.env.OPENROUTER_API_KEY ?? "",
        model: IDENTIFY_MODEL,
        temperature: 0,
        maxTokens: 1_200,
        messages: [
          { role: "system", content: IDENTIFY_SYSTEM },
          {
            role: "user",
            content: buildIdentifyPrompt(
              {
                name: truth?.name ?? "this product",
                whatItIs: truth?.whatItIs ?? "",
              },
              groups
            ),
          },
        ],
      });

      if (completion.ok) {
        for (const [k, v2] of parseIdentified(completion.content, groups)) {
          chosen.set(k, v2);
        }
      } else {
        /**
         * ⚠️ NO HEURISTIC FALLBACK HERE, DELIBERATELY. Guessing by name or
         * follower count is what returned a sticker printer as a video-tool
         * competitor. If the judgement can't be made, the honest outcome is no
         * ads this week — the founder is told, and the next run retries.
         */
        failures.push(`couldn't work out which pages are the competitors (${completion.reason})`);
      }
    }

    for (const group of groups) {
      if (!chosen.has(group.competitor)) {
        failures.push(
          `${group.competitor}: no page in the library is clearly them`
        );
      }
    }

    /**
     * Pass 3 — PULL. Ads only for pages that survived the judgement.
     */
    for (const [competitor, page] of chosen) {
      try {
        const ads = await facebook.companyAds(page.pageId);
        const ranked = rankAds(ads.raw, now);
        if (ranked.length === 0) {
          failures.push(`${competitor}: not running any ads right now`);
          continue;
        }
        all.push(...ranked);
      } catch (e) {
        failures.push(
          `${competitor}: ${e instanceof Error ? e.message : "ad pull failed"}`
        );
      }
    }

    const shortlist = buildShortlist(all, ADS_RETURNED);

    /**
     * Transcripts for the winners only, and only where there is a video to
     * transcribe. §7.5.3: copy the STRUCTURE, never the claims — the script is
     * the part that travels between products.
     *
     * ⚠️ A transcript can come back nearly empty and still be `available`.
     * Measured: a 49-day Duolingo video ad transcribed to the single word
     * "What?". Stored as-is; a thin script is a fact about the ad (it is
     * carried visually), not a failure to record.
     */
    for (const ad of shortlist.slice(0, TRANSCRIBE_TOP)) {
      if (!ad.hasVideo) continue;
      try {
        const t = await facebook.adTranscript(ad.adArchiveId);
        const body = t.raw as Record<string, unknown>;
        ad.transcript = str(body.transcript);
      } catch {
        failures.push(`transcript ${ad.adArchiveId}: unavailable`);
      }
    }

    await ctx.runMutation(internal.maya.adIntel.recordAds, {
      customerId: args.customerId,
      adsJson: JSON.stringify(shortlist),
      now,
    });

    const proven = shortlist.filter((a) => a.daysRunning >= PROVEN_DAYS).length;
    return {
      ok: true,
      competitorsTried: named.length,
      adsFound: shortlist.length,
      proven,
      failures,
      detail:
        shortlist.length === 0
          ? "nobody we track is running ads right now"
          : `${shortlist.length} live ads, ${proven} running ${PROVEN_DAYS}+ days`,
    };
  },
});

/**
 * Store ads as observations, idempotent on the ad's library URL.
 *
 * Reuses `observations` rather than adding a table — the schema is at the
 * TypeScript instantiation ceiling and new tables are not free. The shape fits:
 * an ad IS an observation of the outside world with a stable source URL.
 *
 * ⚠️ **`velocity` CARRIES DAYS RUNNING FOR ADS, and that is a different unit
 * from every other row in this table** (posts store engagement ÷ age). The two
 * kinds must never be sorted together in one list. They aren't — everything
 * reading ads filters `kind: "ad"` first — but the field is reused rather than
 * added, so this comment is the only thing standing between a future reader and
 * a meaningless mixed ranking.
 */
export const recordAds = internalMutation({
  args: {
    customerId: v.id("customers"),
    adsJson: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ written: number; alreadyKnown: number }> => {
    const incoming = JSON.parse(args.adsJson) as RankedAd[];
    const now = args.now ?? Date.now();
    let written = 0;
    let alreadyKnown = 0;

    for (const ad of incoming) {
      if (!ad.url) continue;
      const existing = (await ctx.db
        .query("observations")
        .withIndex("by_customer_and_source", (q) =>
          q.eq("customerId", args.customerId).eq("sourceUrl", ad.url)
        )
        .first()) as Doc<"observations"> | null;

      if (existing) {
        /**
         * ⭐ ADS ARE UPDATED ON RE-SIGHT, WHICH IS THE OPPOSITE OF POSTS.
         *
         * `recordObservations` deliberately never updates a re-seen post: the
         * row records what made it interesting *then*. For an ad the exact
         * reverse is true — the whole signal is that it is STILL RUNNING, and
         * an ad seen at 21 days and again at 90 has become far stronger
         * evidence. Freezing it at first sight would permanently understate
         * every long-running ad we found early.
         */
        await ctx.db.patch(existing._id, {
          velocity: ad.daysRunning,
          metricsJson: JSON.stringify(ad),
          capturedAt: now,
        });
        alreadyKnown += 1;
        continue;
      }

      await ctx.db.insert("observations", {
        customerId: args.customerId,
        channel: "meta_ads",
        sourceUrl: ad.url,
        authorHandle: ad.pageName || undefined,
        kind: "ad",
        text: [ad.title, ad.body, ad.transcript].filter(Boolean).join("\n\n"),
        postedAt: ad.startedAtMs,
        capturedAt: now,
        metricsJson: JSON.stringify(ad),
        velocity: ad.daysRunning,
      });
      written += 1;
    }

    return { written, alreadyKnown };
  },
});

/**
 * What the weekly pick reads. Ads only, longest-running first.
 *
 * Recency-capped at 30 days of capture: an ad we last saw two months ago is
 * not evidence about this week, and presenting it as such is the same mistake
 * as ranking a dead ad.
 */
export const provenAds = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<RankedAd[]> => {
    const now = args.now ?? Date.now();
    const floor = now - 30 * 86_400_000;
    const rows = (await ctx.db
      .query("observations")
      .withIndex("by_customer_and_captured", (q) =>
        q.eq("customerId", args.customerId).gt("capturedAt", floor)
      )
      .collect()) as Doc<"observations">[];

    return rows
      .filter((r) => r.kind === "ad" && r.metricsJson)
      .map((r) => JSON.parse(r.metricsJson as string) as RankedAd)
      .sort((a, b) => b.daysRunning - a.daysRunning || b.variants - a.variants)
      .slice(0, ADS_RETURNED);
  },
});

/**
 * Fleet-wide weekly ad sweep.
 *
 * ⭐ **SUNDAY, AND THAT IS A TIMEZONE DECISION, NOT A PREFERENCE.** The weekly
 * pick runs Monday morning in the FOUNDER'S timezone, and this has to have
 * finished before the earliest of those. Monday 07:00 at UTC+14 is Sunday 17:00
 * UTC — so any sweep on Sunday morning UTC is ahead of every founder's Monday
 * on earth, and one fleet-wide cron replaces per-customer timezone arithmetic
 * entirely.
 *
 * ⚠️ A per-agent OpenClaw cron would be wrong here for the opposite reason it
 * is right elsewhere: this spends real vendor credits, and an agent deciding
 * how many paid lookups to make is a budget with a model in the loop.
 */
export const sweepAllAdIntel = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ checked: number; swept: number; adsFound: number }> => {
    const customerIds = await ctx.runQuery(
      internal.maya.scheduler.activeV2Customers,
      {}
    );

    let swept = 0;
    let adsFound = 0;
    for (const customerId of customerIds) {
      /**
       * One customer's vendor outage must not cost the rest of the fleet its
       * week. Named in the log rather than thrown: an uncaught throw here
       * retries every customer already charged for.
       */
      try {
        const result = await ctx.runAction(internal.maya.adIntel.sweepAdIntel, {
          customerId,
          now: args.now,
        });
        if (result.adsFound > 0) swept += 1;
        adsFound += result.adsFound;
        if (result.failures.length > 0) {
          console.warn(
            `[adIntel] ${customerId}: ${result.failures.join("; ")}`
          );
        }
      } catch (e) {
        console.error(
          `[adIntel] ${customerId} swept nothing: ${e instanceof Error ? e.message : e}`
        );
      }
    }

    return { checked: customerIds.length, swept, adsFound };
  },
});

/* -------------------------------------------------------------------------- */
/* Discovery — working out who the competitors are                             */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ SHE BRINGS A LIST INSTEAD OF ASKING A QUESTION.
 *
 * `competitors` is populated only when the founder's own landing page names
 * rivals, and most don't — so the strongest rung of the evidence ladder was
 * unreachable for nearly every customer. The obvious fix is to ask, and the
 * better fix is to ask having already done the work: search the ad library for
 * who is paying to reach the same buyers, then confirm the shortlist.
 *
 * That difference is the product. "Who are your competitors?" is homework for
 * the founder; "these five are advertising against your keywords — right?" is
 * homework already done.
 *
 * ⚠️ **A KEYWORD SEARCH ALONE IS NOT A COMPETITOR LIST.** Measured live
 * 2026-08-19 on "AI video ads" and "UGC ad creative": the top advertisers were
 * ElevenLabs, FlyAds.ai and foreplay.co — real — mixed with `Alex Mehr, Ph.D.`,
 * `Sean Ferres` and `Mr. Paid Social`, who are course sellers advertising INTO
 * the niche rather than competing in it, plus outright noise (`Euro Júnior 2`).
 * So the same split applies here as everywhere else in this module: code
 * collects and counts, the model judges, the founder confirms.
 */
export const DISCOVERY_KEYWORDS = 3;

export const SEARCH_TERMS_SYSTEM = `You turn a product description into ad-library search queries.

Given a product, return the search terms a COMPETING PRODUCT would run ads on —
the words a rival uses to describe what it sells, or that a buyer types when
shopping for this category.

⚠️ Do NOT return the problems this product solves. A competitor does not buy ads
on "my ads stopped converting"; it buys ads on "AI video ad generator". Category
and product language only.

Two to four short queries, each 2-4 words.
Return ONLY JSON: {"queries":["...","..."]}`;

export function parseSearchTerms(content: string): string[] {
  try {
    const m = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : content) as { queries?: unknown };
    if (!Array.isArray(parsed.queries)) return [];
    return parsed.queries
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter((q) => q.length > 2)
      .slice(0, DISCOVERY_KEYWORDS);
  } catch {
    return [];
  }
}
export const DISCOVERY_CANDIDATES = 8;

export interface AdvertiserCandidate {
  pageId: string;
  pageName: string;
  /** How many live ads they are running against our keywords. */
  liveAds: number;
  /** Their longest-running ad, in days — conviction, not just presence. */
  longestDays: number;
}

/**
 * Group a keyword-search haul by advertiser.
 *
 * Ranked by how many live ads they run against our terms, then by longevity: an
 * advertiser with six ads and a 104-day survivor is committed to this audience,
 * which is what makes them worth watching. One ad is a passer-by.
 */
export function advertisersFrom(
  hauls: unknown[],
  now: number
): AdvertiserCandidate[] {
  const byPage = new Map<string, AdvertiserCandidate>();
  for (const haul of hauls) {
    for (const ad of rankAds(haul, now)) {
      if (!ad.pageName) continue;
      const key = ad.pageId || ad.pageName;
      const seen = byPage.get(key);
      if (seen) {
        seen.liveAds += 1;
        seen.longestDays = Math.max(seen.longestDays, ad.daysRunning);
      } else {
        byPage.set(key, {
          pageId: ad.pageId,
          pageName: ad.pageName,
          liveAds: 1,
          longestDays: ad.daysRunning,
        });
      }
    }
  }
  return [...byPage.values()].sort(
    (a, b) => b.liveAds - a.liveAds || b.longestDays - a.longestDays
  );
}

export const DISCOVERY_SYSTEM = `You work out which advertisers are genuine competitors.

You are given a founder's product and a list of advertisers currently running ads
against the same keywords. Most are NOT competitors. Typical false positives:

- coaches, course sellers and agencies advertising INTO this niche rather than
  competing in it (often a person's name, or a name promising to teach the thing)
- unrelated businesses that happened to match a keyword
- tool vendors from an adjacent category that this product's buyer would not
  consider instead of it — SAME TECHNOLOGY, DIFFERENT BUYER is the most common
  mistake here. An AI video tool for realtors does not compete with an AI video
  tool for ecommerce advertisers, however similar the product sounds.

A competitor is a company whose product a buyer might genuinely choose INSTEAD of
this one. Judge by what the company appears to sell, not by how many ads it runs.

Return ONLY JSON: {"competitors":["Exact Page Name", ...]}
Use the page names exactly as given. Return an empty array if none qualify —
that is a real answer and much better than a stretch.`;

/**
 * ⚠️ THE BUYER'S OWN WORDS GO IN THE PROMPT, AND LEAVING THEM OUT PICKS THE
 * WRONG COMPANY.
 *
 * Measured live 2026-08-19: for Arcads (UGC ads for ecommerce), discovery
 * returned `AutoReel` — an AI video tool for REALTORS turning listing photos
 * into reels. Adjacent technology, completely different buyer. The cause was in
 * the prompt: `whoItsFor` is empty on that record (the page never says), so the
 * model was asked to judge who competes for a buyer it had never been told
 * about, and fell back to "also makes videos with AI".
 *
 * The niche keywords ARE the buyer — "ecommerce media buyers", "dropshipping
 * store owners", "ad creative fatigue" — so they go in. This costs nothing and
 * is the difference between judging a category and judging a customer.
 */
export function buildDiscoveryPrompt(
  product: { name: string; whatItIs: string; whoItsFor?: string },
  candidates: AdvertiserCandidate[],
  buyerWords: string[] = []
): string {
  const rows = candidates
    .map(
      (c) =>
        `  - "${c.pageName}" | live ads against our keywords: ${c.liveAds} | longest running: ${c.longestDays} days`
    )
    .join("\n");

  const who = product.whoItsFor?.trim()
    ? `\nWHO IT IS FOR\n${product.whoItsFor}`
    : "";
  const buyer = buyerWords.length
    ? `\n\nWHAT THIS PRODUCT'S BUYER SEARCHES FOR — a competitor serves THIS person\n${buyerWords.map((k) => `  - ${k}`).join("\n")}`
    : "";

  return `THE FOUNDER'S PRODUCT
${product.name} — ${product.whatItIs}${who}${buyer}

ADVERTISERS IN THIS SPACE
${rows}`;
}

/** Names the model returned that were actually offered. Invented ones dropped. */
export function parseDiscovered(
  content: string,
  candidates: AdvertiserCandidate[]
): string[] {
  let parsed: unknown;
  try {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : content);
  } catch {
    return [];
  }
  const names = (parsed as { competitors?: unknown })?.competitors;
  if (!Array.isArray(names)) return [];

  const offered = new Map(
    candidates.map((c) => [c.pageName.trim().toLowerCase(), c.pageName])
  );
  const out: string[] = [];
  for (const n of names) {
    if (typeof n !== "string") continue;
    const hit = offered.get(n.trim().toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/**
 * Work out who this founder competes with, from who advertises against their
 * keywords.
 *
 * ⚠️ WRITES TO `discoveredCompetitors`, NEVER TO `competitors`. The latter
 * means "the page said so", and mixing inferred names into it would destroy the
 * only thing that makes it trustworthy. These are a proposal awaiting a yes.
 */
export const discoverCompetitors = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; found: string[]; detail: string }> => {
    const now = args.now ?? Date.now();
    const truth = await ctx.runQuery(internal.maya.productTruth.forCustomer, {
      customerId: args.customerId,
    });
    if (!truth) {
      return { ok: false, found: [], detail: "nothing known about the product yet" };
    }

    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });

    const { callModel } = await import("./llm");

    /**
     * ⭐ SEARCH ON PRODUCT WORDS, NOT ON THE BUYER'S PROBLEM WORDS.
     *
     * ⚠️ This function originally reused the niche keywords, and that was the
     * wrong vocabulary — measured live 2026-08-19 for Arcads (UGC ads for
     * ecommerce). Its keywords are buyer PAINS: "ad creative fatigue", "meta
     * ads not converting", "facebook ads low ctr". Searching those returned
     * `Meta for Business` (24 ads), `Kong`, `Glitch Studios`, `Hernan Vazquez`
     * and an academy — coaches and unrelated businesses, and NOT ONE genuine
     * competitor, because a rival product does not buy ads against its buyer's
     * complaints. It buys them against category terms.
     *
     * Searching "AI video ads" and "UGC ad creative" against the same library
     * returned ElevenLabs, FlyAds.ai and foreplay.co on the first try.
     *
     * So the product description becomes search terms first. One cheap call,
     * once per customer, and it decides whether everything after it is aimed at
     * the right pool.
     */
    const termCall = await callModel(ctx, {
      customerId: args.customerId,
      purpose: "ad_competitor_search_terms",
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      model: IDENTIFY_MODEL,
      temperature: 0,
      maxTokens: 300,
      messages: [
        { role: "system", content: SEARCH_TERMS_SYSTEM },
        {
          role: "user",
          content: `${truth.name} — ${truth.whatItIs}${truth.whoItsFor ? `\nFor: ${truth.whoItsFor}` : ""}`,
        },
      ],
    });
    const keywords = termCall.ok ? parseSearchTerms(termCall.content) : [];
    if (keywords.length === 0) {
      return {
        ok: false,
        found: [],
        detail: "couldn't work out what to search the ad library for",
      };
    }

    const { facebook } = await import(
      "../integrations/scrapeCreators/platforms/facebook"
    );

    const hauls: unknown[] = [];
    for (const keyword of keywords) {
      try {
        const found = await facebook.searchAds(keyword);
        hauls.push(found.raw);
      } catch {
        // One dead keyword is not a dead search; the others still count.
      }
    }

    const candidates = advertisersFrom(hauls, now).slice(0, DISCOVERY_CANDIDATES);
    if (candidates.length === 0) {
      return {
        ok: true,
        found: [],
        detail: "nobody is running ads against this niche's terms right now",
      };
    }

    const completion = await callModel(ctx, {
      customerId: args.customerId,
      purpose: "ad_competitor_discover",
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      model: IDENTIFY_MODEL,
      temperature: 0,
      maxTokens: 800,
      messages: [
        { role: "system", content: DISCOVERY_SYSTEM },
        {
          role: "user",
          content: buildDiscoveryPrompt(
            {
              name: truth.name,
              whatItIs: truth.whatItIs,
              whoItsFor: truth.whoItsFor,
            },
            candidates,
            targets?.keywords ?? []
          ),
        },
      ],
    });
    if (!completion.ok) {
      return { ok: false, found: [], detail: `couldn't judge the candidates (${completion.reason})` };
    }

    const found = parseDiscovered(completion.content, candidates);
    if (found.length > 0) {
      /**
       * ⭐ KEEP THE PAGE IDS. We got them by reading these advertisers' ads, so
       * re-deriving them from the name later is both a wasted call and a chance
       * to land on the wrong company.
       */
      const pages = found
        .map((name) => {
          const hit = candidates.find((c) => c.pageName === name);
          return hit ? { name, pageId: hit.pageId } : null;
        })
        .filter((x): x is { name: string; pageId: string } => x !== null);

      await ctx.runMutation(internal.maya.adIntel.storeDiscovered, {
        customerId: args.customerId,
        namesJson: JSON.stringify(found),
        pagesJson: JSON.stringify(pages),
      });
    }

    return {
      ok: true,
      found,
      detail:
        found.length === 0
          ? `${candidates.length} advertisers in this space, none of them actually competitors`
          : `${found.length} likely competitors, from ${candidates.length} advertisers running ads on ${keywords.join(", ")}`,
    };
  },
});

/** Store the proposal. Confirmed names live in `competitors` and are untouched. */
export const storeDiscovered = internalMutation({
  args: {
    customerId: v.id("customers"),
    namesJson: v.string(),
    pagesJson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer?.productTruthJson) return null;
    try {
      const truth = JSON.parse(customer.productTruthJson) as Record<string, unknown>;
      truth.discoveredCompetitors = JSON.parse(args.namesJson) as string[];
      if (args.pagesJson) {
        truth.discoveredCompetitorPages = JSON.parse(args.pagesJson) as {
          name: string;
          pageId: string;
        }[];
      }
      await ctx.db.patch(args.customerId, {
        productTruthJson: JSON.stringify(truth),
        updatedAt: Date.now(),
      });
    } catch {
      // A corrupt truth record is not this function's to repair.
    }
    return null;
  },
});

/* -------------------------------------------------------------------------- */
/* Watching them                                                               */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ SHE ACTUALLY WATCHES THE ADS.
 *
 * Everything above this point READS an ad — the title, the body, the transcript.
 * That is the cheap half, and for a video ad it is the half that matters least.
 * What makes a competitor's ad worth copying is what it LOOKS like in the first
 * two seconds, and no amount of text tells you that.
 *
 * ⚠️ THE STRUCTURE TRAVELS, THE CLAIMS DO NOT. §7.5.3. We take the visual
 * device, the beat order, how the on-screen text behaves and how fast it cuts.
 * We never take their numbers, their offer, or their words — those belong to
 * their product and would be a lie in ours.
 *
 * Reuses the proven Gemini path from `formats.ts` rather than inventing a
 * second one: video goes as `inlineData` on the direct Gemini API, because
 * routing bytes through a text-completions API is not a thing to discover is
 * broken in production.
 */
export const ADS_WATCHED = 3;

export const AD_WATCH_SYSTEM = `You are watching a competitor's video ad to describe HOW IT IS MADE, so a different product can rebuild the same shape.

Return STRICT JSON, no prose:
{ "hook": string,
  "visualDevice": string,
  "spokenScript": string,
  "beats": [ { "atSec": number, "whatHappens": string, "onScreen": string } ],
  "onScreenText": string,
  "cta": { "ask": string, "atSec": number },
  "pacing": { "cutsPerSecond": number, "totalLength": number },
  "requires": string,
  "whyItWorks": string,
  "borrowable": string }

- "hook": what the FIRST TWO SECONDS show or say. The thing that stops a scroll.
- "visualDevice": the format itself — talking head, screen recording, before/after,
  hands-on-product, text-on-b-roll. What someone would have to film.
- "spokenScript": what is actually SAID, start to finish, as plain text. "" if
  nobody speaks. This is the part that travels furthest between products.
- "beats": what happens when, six at most. "onScreen" is what is literally
  visible in that beat — the shot, not the meaning.
- "cta": the ask, and the second it lands.
- "requires": what someone would need IN HAND to rebuild this shape. Answer with
  EXACTLY ONE of these words and nothing else:
    "founder_footage"     a real person on camera is essential to it
    "screen_recording"    the product's own interface carries it
    "product_screenshot"  stills of the product are enough
    "generated_background" stock or generated visuals carry it
    "avatar"              a presenter is needed but any presenter would do
- "whyItWorks": your read on why this has kept running. One sentence.
- "borrowable": the ONE structural thing worth stealing, described so it could be
  rebuilt for a completely different product.

⚠️ Describe only what you can see and hear. Do not repeat their claims, their
statistics or their offer as though they were ours — those are theirs and are not
transferable. If you cannot tell, say so in that field rather than filling it in.`;

/**
 * Watch the top ads for one customer and store what they are made of.
 *
 * ⚠️ Capped hard at `ADS_WATCHED`. Each watch downloads a video and base64s it
 * into a model request — the expensive tier by a wide margin, and the reason
 * `formats.ts` caps its own watching at five a week.
 */
export const watchTopAds = internalAction({
  args: {
    customerId: v.id("customers"),
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; watched: number; failed: number; detail: string }> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { ok: false, watched: 0, failed: 0, detail: "no GEMINI_API_KEY" };
    }

    const ads = await ctx.runQuery(internal.maya.adIntel.provenAds, {
      customerId: args.customerId,
      now: args.now,
    });

    /**
     * Only ads with a playable file, only ones not already watched, longest
     * first — re-watching spends the expensive tier on a settled question.
     */
    const queue = ads
      .filter((a) => a.hasVideo && a.videoUrl && !a.watchedJson)
      .slice(0, args.limit ?? ADS_WATCHED);

    if (queue.length === 0) {
      return {
        ok: true,
        watched: 0,
        failed: 0,
        detail:
          ads.length === 0
            ? "no competitor ads to watch yet"
            : "their live ads are all stills — nothing to watch",
      };
    }

    let watched = 0;
    let failed = 0;
    for (const ad of queue) {
      try {
        const seen = await watchOneAd(ctx, ad, apiKey, args.customerId);
        if (!seen) {
          failed += 1;
          continue;
        }
        await ctx.runMutation(internal.maya.adIntel.storeWatched, {
          customerId: args.customerId,
          url: ad.url,
          watchedJson: seen,
        });
        watched += 1;
      } catch (error) {
        failed += 1;
        console.warn(
          `[adIntel] watch failed for ${ad.url}: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    return {
      ok: true,
      watched,
      failed,
      detail: `watched ${watched} of ${queue.length} competitor ads`,
    };
  },
});

/** One video, one model call. Returns the raw JSON string, or null. */
async function watchOneAd(
  ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
  ad: RankedAd,
  apiKey: string,
  customerId: string
): Promise<string | null> {
  const { MAX_VIDEO_BYTES, WATCH_MODEL } = await import("./formats");

  const res = await fetch(ad.videoUrl);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    console.warn(
      `[adIntel] ${ad.url} is ${Math.round(bytes.byteLength / 1e6)}MB — over the cap`
    );
    return null;
  }

  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  const base64 = btoa(binary);

  const gem = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${WATCH_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "video/mp4", data: base64 } },
              { text: AD_WATCH_SYSTEM },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  /**
   * Recorded whether or not it parsed — the video was uploaded and processed by
   * then, so the spend happened. A ledger counting only usable answers
   * understates cost exactly when something is failing repeatedly.
   */
  try {
    await ctx.runMutation(internal.maya.cogs.record as never, {
      customerId,
      vendor: "gemini",
      resource: WATCH_MODEL,
      purpose: "ad_watch",
    } as never);
  } catch {
    // Never let ledger trouble cost the observation.
  }

  if (!gem.ok) {
    console.error(`[adIntel] watch model returned ${gem.status}`);
    return null;
  }

  const payload = (await gem.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  return text;
}

/** Attach what the watch found to the ad's row. */
export const storeWatched = internalMutation({
  args: {
    customerId: v.id("customers"),
    url: v.string(),
    watchedJson: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const row = (await ctx.db
      .query("observations")
      .withIndex("by_customer_and_source", (q) =>
        q.eq("customerId", args.customerId).eq("sourceUrl", args.url)
      )
      .first()) as Doc<"observations"> | null;
    if (!row?.metricsJson) return null;

    try {
      const ad = JSON.parse(row.metricsJson) as RankedAd;
      ad.watchedJson = args.watchedJson;
      await ctx.db.patch(row._id, { metricsJson: JSON.stringify(ad) });
    } catch {
      // A corrupt row is not this function's to repair.
    }
    return null;
  },
});
