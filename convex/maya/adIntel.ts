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

    const named = (truth?.competitors ?? [])
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .slice(0, MAX_COMPETITORS);

    if (named.length === 0) {
      /**
       * ⭐ A REAL FINDING, NOT AN ERROR. `competitors` is populated only when
       * the founder's own page names them, which most landing pages don't. The
       * honest answer is that we don't know who they compete with — and the
       * fix is to ask the founder, which is a message, not a retry.
       */
      return {
        ok: true,
        competitorsTried: 0,
        adsFound: 0,
        proven: 0,
        failures: [],
        detail:
          "no competitors on file — ask the founder who they lose deals to, then this runs",
      };
    }

    const { facebook } = await import(
      "../integrations/scrapeCreators/platforms/facebook"
    );

    const failures: string[] = [];
    const all: RankedAd[] = [];

    /**
     * Pass 1 — COLLECT. One name search per competitor, no judgement yet.
     */
    const groups: { competitor: string; candidates: PageCandidate[] }[] = [];
    for (const name of named) {
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
    let chosen = new Map<string, PageCandidate>();
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
        chosen = parseIdentified(completion.content, groups);
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
