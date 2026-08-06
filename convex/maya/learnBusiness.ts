/**
 * `learn-business` — who to watch, and in whose words (§5.0, Sprint 4).
 *
 * ## Why this runs before perception
 *
 * §5.0 is explicit: every sweep needs targets, and the targets come from here.
 * Sweeping before this exists means scrolling **general** TikTok and **general**
 * X — content in nobody's niche, which is the opposite of the product. That
 * ordering was nearly broken on 2026-08-04 by proposing a sweep sprint first.
 *
 * ## The rule that shapes everything below
 *
 * > **Topic keywords are the buyer's own words for the problem — never our
 * > marketing vocabulary.**
 *
 * That's easy to write and easy to violate, because the product page is written
 * in marketing vocabulary and it's the thing we just read. So candidates are
 * *proposed* from product truth and then **validated against what actually
 * comes back**: a term the niche genuinely uses returns recent posts with real
 * engagement; a term we invented returns noise or nothing.
 *
 * Search yield is the referee, not our judgment about which words sound right.
 *
 * ## Pure here, vendor calls at the edge
 *
 * Everything except `learnBusiness` itself is a pure function over data we
 * already fetched, so the reasoning is testable exhaustively without a network
 * — the same split `buyerMap.ts` uses.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

/**
 * The main brain, deliberately.
 *
 * ## Why not a cheaper model
 *
 * It was `gpt-oss-120b` first — the volume worker — and it approved
 * wedding-proposal captions as relevant to a B2B SaaS product. Then
 * `qwen/qwen3.7-flash`, which judged correctly but is a *reasoning* model whose
 * thinking is billed and budgeted as completion, and silently returned empty
 * until the token budget was raised.
 *
 * ## Why not a different family, like the critic
 *
 * The critic must be a different family because it audits **Luna's own
 * writing** — a model cannot see the tells that are its own defaults. This
 * judges **TikTok captions**. There is nothing of Luna's to audit, so the
 * requirement doesn't apply.
 *
 * ## The cost, since that's the only argument for anything else
 *
 * ~5k in / ~1k out, **once a month per customer**: $0.0011 on Luna against
 * $0.0004 on qwen. At 200 customers that's **$0.22/month versus $0.08** — a
 * difference of fourteen cents.
 *
 * Fourteen cents does not buy a second model's failure modes. This one cost
 * three debug cycles before it worked.
 */
export const RELEVANCE_MODEL = "openai/gpt-5.6-luna-pro";

/** A term we might watch, and what the evidence said about it. */
export interface KeywordVerdict {
  keyword: string;
  /** Posts the search returned that were recent enough to count. */
  freshPosts: number;
  /** Median engagement ÷ age across those posts — §5.1's velocity. */
  medianVelocity: number;
  keep: boolean;
  /** Plain words, because this list is meant to be read and steered. */
  why: string;
}

export interface TrackedAccount {
  handle: string;
  channel: string;
  /** How many of our validated keywords this account keeps showing up under. */
  keywordHits: number;
  /** Their median velocity — a big dormant account is not a target. */
  medianVelocity: number;
  followerCount?: number;
  why: string;
}

export interface BusinessTargets {
  /**
   * ⭐ DID THE RELEVANCE JUDGE ACTUALLY RUN?
   *
   * It fails open by design, which means "the judge approved everything" and
   * "the judge never ran" produce an identical target list. That is the silent
   * failure this codebase keeps re-shipping, so the state is recorded rather
   * than inferred.
   */
  relevance: "checked" | "unavailable" | "skipped";
  keywords: string[];
  /** Kept AND rejected, because a wrong list quietly poisons everything. */
  keywordVerdicts: KeywordVerdict[];
  trackedAccounts: TrackedAccount[];
  learnedAt: number;
}

/* -------------------------------------------------------------------------- */
/* Proposing candidates                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Words that describe a *category* rather than a *problem*.
 *
 * These return millions of unrelated posts, so they pass a naive yield check
 * with flying colours while pointing at nobody's niche. They are exactly the
 * words a marketing page uses about itself.
 */
const TOO_GENERIC = new Set([
  "software", "platform", "tool", "app", "solution", "service", "system",
  "product", "technology", "business", "company", "startup", "saas", "ai",
  "data", "analytics", "dashboard", "automation", "productivity", "marketing",
  "online", "digital", "cloud", "api", "team", "teams", "work", "workflow",
]);

/** Fragments of marketing register that never describe a real problem. */
const MARKETING_TELLS = [
  "best-in-class", "world-class", "cutting-edge", "seamless", "robust",
  "leverage", "empower", "revolutionize", "game-changing", "next-generation",
  "one-stop", "all-in-one", "end-to-end",
];

export function looksGeneric(term: string): boolean {
  const t = term.trim().toLowerCase();
  if (t.length < 3) return true;
  if (MARKETING_TELLS.some((m) => t.includes(m))) return true;
  const words = t.split(/\s+/);
  // A single generic noun is a category. The same noun qualified — "csv
  // dashboard" — is a real thing someone searches for.
  return words.length === 1 && TOO_GENERIC.has(words[0]);
}

/**
 * ⭐ Think like the person doing the searching.
 *
 * `deriveKeywords` below EXTRACTS from the page. That is string handling where
 * judgment belongs, and the output proves it — HeyMaya's own read produced
 * `draft reply`, `native posting`, `conversion`: the words the marketing page
 * uses about itself. **No human marketer would ever type those into TikTok
 * search.** Handed the same brief — *"solo devs who built an app and can't get
 * users"* — a person searches `indie hackers`, `building in public`,
 * `shipped my app`, `no users`.
 *
 * So the proposing half is a model call now, per the standing rule that
 * judgment belongs to the model and not to a wordlist.
 *
 * ⚠️ **The validating half does NOT move.** The two gates below stay exactly
 * as they are, because they test against reality rather than reasoning about
 * it — and reality is where this goes wrong in ways nobody predicts. They are
 * what caught `threads` returning sewing, `engagement` returning wedding
 * photos, and `reddit` returning family stories. A better proposer makes those
 * gates cheaper; it does not make them optional.
 */
export const KEYWORD_MODEL = "openai/gpt-5.6-luna-pro";

const KEYWORD_SYSTEM = `You are a social media manager who has just been hired by this business. Before you post anything, you want to find where this market actually talks — so you are about to type search terms into TikTok, Instagram, YouTube and X.

Return STRICT JSON, no prose:
{ "keywords": string[] }

What you are looking for, in order:
1. **What the buyer calls their problem** — in their words, not the product's. Someone who needs this searches for the pain, not the solution.
2. **What this audience calls ITSELF.** Communities have names. People who build software alone call themselves indie hackers; they do not call themselves "solo developers or indie founders".
3. **The moment of need** — what someone posts about right before they'd want this.

Hard rules:
- **Never the product's own marketing words.** If the term appears on their homepage describing themselves, it is the wrong term.
- **Never a bare category noun** — "dashboard", "automation", "saas", "ai", "analytics". These return millions of unrelated posts. Qualified is fine: "csv dashboard".
- Between 6 and 12 terms. Two to four words each. Things a person would actually type.
- No hashtags, no punctuation, lowercase.

You will be wrong sometimes and that is expected — every term is searched and checked before it is used. Propose the ones worth checking.`;

export function parseKeywordProposal(raw: string): string[] | null {
  const fenced = raw.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(fenced) as { keywords?: unknown };
    if (!Array.isArray(parsed.keywords)) return null;
    const out = parsed.keywords
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim().toLowerCase().replace(/^#/, ""))
      .filter((k) => k.length > 2)
      /**
       * The generic check survives as a FLOOR, not a decision. It encodes a
       * measured fact — a bare category noun returns millions of unrelated
       * posts — and costs nothing. The model is told the same thing; this
       * catches the times it agrees and then does it anyway.
       */
      .filter((k) => !looksGeneric(k));
    const seen = new Set<string>();
    const deduped = out.filter((k) => (seen.has(k) ? false : (seen.add(k), true)));
    return deduped.length > 0 ? deduped.slice(0, 12) : null;
  } catch {
    return null;
  }
}

/**
 * Propose search terms from the product read.
 *
 * Deliberately generous: this stage is cheap and the *next* stage is the one
 * that decides. Rejecting a good term here is expensive because nothing
 * downstream can recover it; carrying a bad one costs one search.
 */
export function deriveKeywords(truth: {
  whatItIs?: string;
  whoItsFor?: string;
  vocabulary?: string[];
}): string[] {
  const out: string[] = [];

  // Vocabulary comes from the page's own body text, which is closer to how the
  // market talks than the headline is.
  for (const term of truth.vocabulary ?? []) out.push(term);

  // "Solo developers or indie founders who have built an app" → the audience
  // phrase itself is often what that audience calls itself.
  if (truth.whoItsFor) {
    const audience = truth.whoItsFor
      .toLowerCase()
      .replace(/^(for|aimed at|built for)\s+/, "")
      .split(/\s+(?:who|that|looking|trying|needing)\b/)[0]
      .trim();
    if (audience) out.push(audience);
  }

  const seen = new Set<string>();
  return out
    .map((t) => t.trim().toLowerCase().replace(/[.,;:]$/, ""))
    .filter((t) => t.length > 0 && !looksGeneric(t))
    .filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
    .slice(0, 12);
}

/* -------------------------------------------------------------------------- */
/* Validating them against reality                                             */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ VENDOR TIMESTAMPS ARE NOT ALWAYS MILLISECONDS.
 *
 * TikTok's `create_time` is **seconds** (`1775788135`), and the integration's
 * `firstNum` passes the vendor's number through untouched — `NormalizedPost.
 * postedAt` is typed `number | null` with no unit attached.
 *
 * Compared against a millisecond clock, every post looks ~50 years old. The
 * first live run of `learn-business` rejected **every single keyword** with
 * *"nobody is posting about this"* while the API was returning 30 results per
 * search. The failure is silent and total: perception would have reported an
 * empty niche forever, and it looks exactly like a niche that genuinely has no
 * content.
 *
 * The boundary: 1e11 ms is 1973, and 1e11 seconds is the year 5138. Anything
 * below it is seconds.
 */
export function toMillis(timestamp: number | null | undefined): number | null {
  if (timestamp === null || timestamp === undefined || timestamp <= 0) return null;
  return timestamp < 1e11 ? timestamp * 1000 : timestamp;
}

/** §5.1: rank by engagement ÷ age, never engagement. Freshness beats volume. */
export function velocity(
  metrics: { likeCount?: number | null; commentCount?: number | null; viewCount?: number | null },
  postedAt: number | null | undefined,
  now: number
): number {
  const engagement =
    (metrics.likeCount ?? 0) + (metrics.commentCount ?? 0) * 3;
  const ms = toMillis(postedAt);
  if (ms === null) return 0;
  const ageHours = Math.max(1, (now - ms) / 3_600_000);
  return engagement / ageHours;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** A term needs this many recent posts before we'll believe a niche is there. */
export const MIN_FRESH_POSTS = 3;
/** How far back still counts as "this niche is alive right now". */
export const FRESH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Decide whether a keyword names a place the niche actually lives.
 *
 * The two failure modes are opposite and both fatal: a term nobody uses
 * (returns nothing, so she has no material) and a term everybody uses (returns
 * a category, so she watches strangers). Yield catches the first; `looksGeneric`
 * catches the second, *before* we spend a search on it.
 */
export function judgeKeyword(
  keyword: string,
  posts: Array<{
    postedAt?: number | null;
    metrics: { likeCount?: number | null; commentCount?: number | null; viewCount?: number | null };
  }>,
  now: number
): KeywordVerdict {
  const fresh = posts.filter((p) => {
    const ms = toMillis(p.postedAt);
    return ms !== null && now - ms <= FRESH_WINDOW_MS;
  });
  const velocities = fresh.map((p) => velocity(p.metrics, p.postedAt, now));
  const med = median(velocities);

  if (fresh.length < MIN_FRESH_POSTS) {
    return {
      keyword,
      freshPosts: fresh.length,
      medianVelocity: med,
      keep: false,
      why:
        fresh.length === 0
          ? "nobody is posting about this"
          : `only ${fresh.length} recent posts — too quiet to work from`,
    };
  }

  return {
    keyword,
    freshPosts: fresh.length,
    medianVelocity: med,
    keep: true,
    why: `${fresh.length} recent posts, and they're getting traction`,
  };
}

/* -------------------------------------------------------------------------- */
/* Is it actually OUR niche?                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ YIELD PROVES A TERM IS BUSY. IT CANNOT PROVE THE TERM IS OURS.
 *
 * Verified live 2026-08-04 against a B2B SaaS product. Every keyword passed
 * yield validation, and the watchlist came back as:
 *
 *   @lizziedarlene · @lil.lean.cuisine · @sofia.and.arran · @sophiebakewell
 *
 * Because on TikTok, *"engagement"* is weddings, *"threads"* is sewing,
 * *"waitlist"* is restaurants and *"conversion"* is camper vans. All four are
 * enormously busy and none of them is this founder's market.
 *
 * A denylist can't fix this — the collision is per-product, not universal, and
 * "engagement" is a perfectly good term for a social tool. So this is exactly
 * where principle 3 applies: **deterministic code collects, the model judges.**
 *
 * ONE call for ALL keywords, with sample captions. ~5k tokens on the worker
 * model, about $0.0002, once a month per customer. The alternative — a call
 * per keyword — costs 12× for the same answer.
 */
const RELEVANCE_SYSTEM = `You are checking whether search terms actually reach a product's market.

For each keyword you get real captions the search returned. Decide whether that content is the world this product's buyers live in.

Return STRICT JSON, no prose:
{ "verdicts": [ { "keyword": string, "contentIs": string, "ours": boolean, "why": string } ] }

**Fill "contentIs" FIRST, before deciding.** In four or five words, say what these
captions are actually about — as a stranger would describe them. "engagement
photos and proposals". "sewing and embroidery". "indie founders shipping apps".

Then decide "ours" from what you just wrote, NOT from the keyword.

- This is the whole job: a keyword can sound perfect for the product and return
  a completely different world. "engagement" is a real social-media metric AND
  the thing people get before a wedding. "conversion" is a funnel metric AND a
  camper van. "threads" is a social app AND sewing. Being a plausible word for
  this product means nothing if the posts are weddings.
- "ours": true only if the content you described in "contentIs" is a world this
  product's buyers actually inhabit. Adjacent is fine; a different meaning of
  the same word is not.
- Default to false when the content is unrelated. A watchlist of strangers is
  worse than a short one.`;

export function buildRelevancePrompt(
  product: { whatItIs?: string; whoItsFor?: string },
  samples: Array<{ keyword: string; captions: string[] }>
): string {
  return [
    `PRODUCT: ${product.whatItIs ?? "unknown"}`,
    `ITS BUYERS: ${product.whoItsFor ?? "unknown"}`,
    "",
    ...samples.map(
      (s) =>
        `KEYWORD "${s.keyword}" returned:\n${s.captions
          .slice(0, 5)
          .map((c) => `  - ${c.slice(0, 140)}`)
          .join("\n")}`
    ),
    "",
    "Which of these searches actually reach this product's market? Strict JSON only.",
  ].join("\n");
}

export function parseRelevance(
  content: string
): Map<string, { ours: boolean; why: string }> {
  const out = new Map<string, { ours: boolean; why: string }>();
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return out;
  try {
    const parsed = JSON.parse(text.slice(first, last + 1)) as {
      verdicts?: Array<{ keyword?: unknown; ours?: unknown; why?: unknown }>;
    };
    for (const v of parsed.verdicts ?? []) {
      if (typeof v.keyword !== "string") continue;
      out.set(v.keyword.toLowerCase(), {
        ours: v.ours === true,
        // Prefer what it SAW over what it concluded — "wedding photos" is
        // checkable by a human; "not relevant" is not.
        why:
          typeof (v as { contentIs?: unknown }).contentIs === "string"
            ? String((v as { contentIs?: unknown }).contentIs)
            : typeof v.why === "string"
              ? v.why
              : "",
      });
    }
  } catch {
    return out;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Who to watch                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Rank accounts by how often they show up across DIFFERENT validated keywords.
 *
 * The same insight the buyer map uses for followers: appearing under one
 * keyword might be coincidence, appearing under four means this person is
 * genuinely in the niche. Overlap is the signal, not raw reach — which is why a
 * big account that only ever matched one term ranks below a smaller one that
 * matched several.
 */
export function rankAccounts(
  appearances: Array<{
    handle: string;
    channel: string;
    keyword: string;
    velocity: number;
    followerCount?: number;
  }>,
  limit = 30
): TrackedAccount[] {
  const byHandle = new Map<
    string,
    { channel: string; keywords: Set<string>; velocities: number[]; followers?: number }
  >();

  for (const a of appearances) {
    const key = `${a.channel}:${a.handle.toLowerCase()}`;
    const entry = byHandle.get(key) ?? {
      channel: a.channel,
      keywords: new Set<string>(),
      velocities: [],
      followers: a.followerCount,
    };
    entry.keywords.add(a.keyword);
    entry.velocities.push(a.velocity);
    if (a.followerCount !== undefined) entry.followers = a.followerCount;
    byHandle.set(key, entry);
  }

  return [...byHandle.entries()]
    .map(([key, e]) => ({
      handle: key.split(":").slice(1).join(":"),
      channel: e.channel,
      keywordHits: e.keywords.size,
      medianVelocity: median(e.velocities),
      followerCount: e.followers,
      why:
        e.keywords.size > 1
          ? `posts about ${e.keywords.size} of the things this niche talks about`
          : "posts about this niche",
    }))
    .sort(
      (a, b) =>
        b.keywordHits - a.keywordHits || b.medianVelocity - a.medianVelocity
    )
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

export const storeTargets = internalMutation({
  args: { customerId: v.id("customers"), targetsJson: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;

    // The buyer map is one document; targets are a section of it, so learning
    // them must not blow away complaints or gathering places learned later.
    let existing: Record<string, unknown> = {};
    try {
      existing = customer.buyerJson ? JSON.parse(customer.buyerJson) : {};
    } catch {
      existing = {};
    }
    await ctx.db.patch(args.customerId, {
      buyerJson: JSON.stringify({
        ...existing,
        targets: JSON.parse(args.targetsJson),
      }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const targetsFor = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<BusinessTargets | null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer?.buyerJson) return null;
    try {
      const parsed = JSON.parse(customer.buyerJson) as {
        targets?: BusinessTargets;
      };
      return parsed.targets ?? null;
    } catch {
      return null;
    }
  },
});

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Learn who to watch.
 *
 * ## Why TikTok is the discovery surface even for an X-only customer
 *
 * Search quality, not channel preference. TikTok's keyword search returns
 * post-level engagement and recency for arbitrary terms, which is exactly what
 * validation needs; X's search is thinner and Instagram's is thinner still.
 * **The niche's vocabulary is the same wherever they post** — what people call
 * their problem doesn't change between apps — so terms validated here are the
 * terms to search anywhere.
 *
 * Tracked *accounts* are per-channel and get discovered per-channel later. This
 * establishes the language.
 *
 * ## Cost
 *
 * One search credit per candidate keyword, ~12 max, once per customer per
 * month. At 200 customers that's ~2,400 credits/month against the perception
 * budget — a rounding error next to the daily sweeps, and it is the input that
 * makes those sweeps worth running at all.
 */
/** One call for every keyword. Fails open — see the call site. */
async function judgeRelevance(
  // ⚠️ ctx and customerId are threaded in purely so this call's cost has an
  // owner. Spend with no customer is unpriceable, and this helper is one of
  // the more expensive calls in the package — a reasoning model, once per
  // keyword batch.
  ctx: ActionCtx,
  customerId: Id<"customers">,
  truth: { whatItIs?: string; whoItsFor?: string },
  samples: Array<{ keyword: string; captions: string[] }>
): Promise<{
  state: "checked" | "unavailable" | "skipped";
  verdicts: Map<string, { ours: boolean; why: string }>;
  detail?: string;
}> {
  if (samples.length === 0) {
    return { state: "skipped", verdicts: new Map() };
  }
  const { callModel } = await import("./llm");
  const completion = await callModel(ctx, {
    customerId,
    purpose: "keyword_relevance",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    model: RELEVANCE_MODEL,
    temperature: 0,
    // Reasoning model: budget for the thinking, not just the verdicts.
    maxTokens: 4_000,
    messages: [
      { role: "system", content: RELEVANCE_SYSTEM },
      { role: "user", content: buildRelevancePrompt(truth, samples) },
    ],
  });
  if (!completion.ok) {
    return { state: "unavailable", verdicts: new Map(), detail: completion.reason };
  }
  const verdicts = parseRelevance(completion.content);
  if (verdicts.size === 0) {
    // A parse that yields nothing is indistinguishable from approval unless we
    // say so — the model answered, we just couldn't read it.
    return {
      state: "unavailable",
      verdicts,
      detail: `couldn't read the verdict: ${completion.content.slice(0, 160)}`,
    };
  }
  return { state: "checked", verdicts };
}

export const learnBusiness = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    error?: string;
    targets?: BusinessTargets;
  }> => {
    const truth = await ctx.runQuery(internal.maya.productTruth.forCustomer, {
      customerId: args.customerId,
    });
    if (!truth) {
      // Not a failure to retry — §5.0's whole point is that targets derive from
      // the product read, so there is nothing to derive from yet.
      return { ok: false, error: "no product truth yet — read the product first" };
    }

    /**
     * ⭐ Ask, then fall back to extracting.
     *
     * The model gets the whole picture — including what the founder has told
     * us directly, which outranks anything scraped — and proposes what a
     * person would actually search. `deriveKeywords` remains as the fallback
     * for a dead key or a bad response: worse terms beat no terms, and the
     * gates below judge either the same way.
     */
    let candidates: string[] = [];
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const { callModel } = await import("./llm");
        const completion = await callModel(ctx, {
          customerId: args.customerId,
          purpose: "keyword_proposal",
          apiKey: process.env.OPENROUTER_API_KEY,
          model: KEYWORD_MODEL,
          temperature: 0.4,
          maxTokens: 800,
          messages: [
            { role: "system", content: KEYWORD_SYSTEM },
            {
              role: "user",
              content: [
                `PRODUCT: ${truth.name ?? "(unnamed)"}`,
                `WHAT IT IS: ${truth.whatItIs ?? "(unknown)"}`,
                `WHO IT'S FOR: ${truth.whoItsFor ?? "(unknown)"}`,
                `WHAT'S DIFFERENT: ${truth.whatsDifferent ?? "(unknown)"}`,
                // Named as theirs, so the model can see these are the words to
                // avoid rather than the words to use.
                `THE PRODUCT'S OWN MARKETING WORDS (do not reuse these): ${(truth.vocabulary ?? []).join(", ") || "(none)"}`,
                truth.founderSays?.length
                  ? `THE FOUNDER TOLD US DIRECTLY (outranks everything above): ${truth.founderSays.join(" | ")}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        });
        if (completion.ok) {
          candidates = parseKeywordProposal(completion.content) ?? [];
        }
      } catch (error) {
        console.error(`[learn-business] keyword proposal failed: ${String(error)}`);
      }
    }
    if (candidates.length === 0) candidates = deriveKeywords(truth);
    if (candidates.length === 0) {
      return {
        ok: false,
        error: "the product read didn't turn up any usable vocabulary",
      };
    }

    const { tiktok } = await import(
      "../integrations/scrapeCreators/platforms/tiktok"
    );

    const now = args.now ?? Date.now();
    const verdicts: KeywordVerdict[] = [];
    const samples: Array<{ keyword: string; captions: string[] }> = [];
    const appearances: Array<{
      handle: string;
      channel: string;
      keyword: string;
      velocity: number;
      followerCount?: number;
    }> = [];

    for (const keyword of candidates) {
      let posts: Array<{
        authorHandle?: string | null;
        caption?: string | null;
        postedAt?: number | null;
        metrics: {
          likeCount?: number | null;
          commentCount?: number | null;
          viewCount?: number | null;
        };
      }> = [];
      try {
        // 3 months matches FRESH_WINDOW_MS — asking for a wider window than
        // we'd count wastes the search on posts `judgeKeyword` will discard.
        const result = await tiktok.searchKeyword(keyword, {
          datePosted: "last_3_months",
        });
        posts = result.posts;
      } catch (error) {
        // One bad term must not lose the other eleven. Recorded as a verdict so
        // the reason is visible rather than the keyword silently vanishing.
        verdicts.push({
          keyword,
          freshPosts: 0,
          medianVelocity: 0,
          keep: false,
          why: `couldn't check this one (${
            error instanceof Error ? error.message.slice(0, 60) : "search failed"
          })`,
        });
        continue;
      }

      const verdict = judgeKeyword(keyword, posts, now);
      verdicts.push(verdict);
      if (!verdict.keep) continue;

      samples.push({
        keyword,
        captions: posts
          .map((p) => p.caption ?? "")
          .filter((c) => c.trim().length > 0)
          .slice(0, 5),
      });

      for (const post of posts) {
        if (!post.authorHandle) continue;
        appearances.push({
          handle: post.authorHandle,
          channel: "tiktok",
          keyword,
          velocity: velocity(post.metrics, post.postedAt, now),
        });
      }
    }

    /**
     * ⭐ THE SECOND GATE. Yield said these terms are busy; this asks whether
     * they're busy with US.
     *
     * Without it the watchlist for a B2B SaaS product came back as wedding
     * planners and food creators, because "engagement" and "conversion" are
     * enormous on TikTok in meanings that have nothing to do with software.
     *
     * Fails OPEN deliberately: if the judge can't run we keep the
     * yield-validated terms rather than losing every target. A too-broad
     * watchlist is recoverable — the founder can say "stop watching that
     * account" and §5.0 makes that a directive. An empty one silently starves
     * every sweep downstream.
     */
    const relevance = await judgeRelevance(ctx, args.customerId, truth, samples);
    if (relevance.state === "unavailable") {
      console.warn(
        `[learn-business] relevance judge unavailable: ${relevance.detail ?? "no reason given"}`
      );
    }
    for (const verdict of verdicts) {
      if (!verdict.keep) continue;
      const call = relevance.verdicts.get(verdict.keyword.toLowerCase());
      if (call && !call.ours) {
        verdict.keep = false;
        verdict.why = `busy, but it's not our market — ${call.why}`;
      }
    }

    const kept = new Set(
      verdicts.filter((v) => v.keep).map((v) => v.keyword)
    );

    const targets: BusinessTargets = {
      relevance: relevance.state,
      keywords: [...kept],
      keywordVerdicts: verdicts,
      // Only from terms that survived BOTH gates.
      trackedAccounts: rankAccounts(
        appearances.filter((a) => kept.has(a.keyword))
      ),
      learnedAt: now,
    };

    await ctx.runMutation(internal.maya.learnBusiness.storeTargets, {
      customerId: args.customerId,
      targetsJson: JSON.stringify(targets),
    });

    return { ok: true, targets };
  },
});


/* -------------------------------------------------------------------------- */
/* Staleness                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ Re-learn the niche when the map goes stale.
 *
 * §5.0.0: the buyer map is *"refreshed monthly, because a stale buyer map
 * silently poisons the idea bank, the format library, and the benchmarks all
 * at once."*
 *
 * `buyerMap.ts` has an `isStale` and a `BUYER_MAP_MAX_AGE_MS` written for
 * exactly this. **The entire module was unimported** — twenty-seventh find —
 * so nothing has ever checked, and a niche learned in July would still be
 * driving every keyword, every sweep and every idea in December.
 *
 * ⚠️ The word "silently" in that sentence is the whole problem. Stale keywords
 * do not fail; they return posts. They return the WRONG posts, and everything
 * downstream reports success.
 */
export const relearnIfStale = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ checked: number; relearned: number }> => {
    const now = args.now ?? Date.now();
    const customerIds = await ctx.runQuery(
      internal.maya.scheduler.activeV2Customers,
      {}
    );
    const { isStale } = await import("./buyerMap");

    let relearned = 0;
    for (const customerId of customerIds) {
      const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
        customerId,
      });
      /**
       * No map at all is NOT stale — it is unlearned, and onboarding owns
       * that. Re-running the full learn for a customer who has never had one
       * would spend twelve searches on someone who may not even be set up.
       */
      if (!targets) continue;
      if (!isStale(targets.learnedAt, now)) continue;

      await ctx.runAction(internal.maya.learnBusiness.learnBusiness, {
        customerId,
      });
      relearned += 1;
    }

    return { checked: customerIds.length, relearned };
  },
});
