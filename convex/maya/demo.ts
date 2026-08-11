/**
 * ⭐ The pre-signup demo (§18.9.2, Sprint 11) — paste a URL, watch her be right.
 *
 * Sprint 11's exit: *"a visitor can paste a URL on the landing page and watch
 * her be specifically right about their company, in under 20 seconds, without
 * signing up."*
 *
 * ## It runs the REAL read
 *
 * `fetchProductPage` → `stripHtml` → `buildExtractionPrompt` →
 * `parseExtraction` — the same functions a paying customer's onboarding uses.
 * A demo-only imitation would be the exact thing §2.7 forbids: a surface that
 * looks like the product and isn't. If the read is weak on someone's site, the
 * demo should be weak on it too, because that is what they would actually get.
 *
 * ## ⚠️ This is an unauthenticated endpoint that fetches arbitrary URLs
 *
 * Which makes it three things at once: a scraper anyone can point anywhere, a
 * way to spend our model budget for free, and — without a guard — an SSRF
 * proxy into anything the Convex runtime can reach.
 *
 * `fetchProductPage` validates the protocol and nothing else. That is fine for
 * its existing caller, where the URL is the founder's own product address given
 * at signup. It is not fine here, so `isPubliclyRoutable` runs first.
 *
 * §18.9.2 names the other three guardrails: IP rate limit · URL cache · daily
 * spend cap · graceful degrade on scrape failure. All four are here.
 */

import { v } from "convex/values";
import { budgetFor } from "./llm";
import { dayKeyInZone } from "./cadence";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  EXTRACTION_SYSTEM,
  PRODUCT_READ_MODEL,
  buildExtractionPrompt,
  extractTitle,
  fetchProductPage,
  parseExtraction,
  stripHtml,
} from "./productTruth";

/** Reads per IP per day. Enough to try your own site and a competitor's. */
export const IP_DAILY_LIMIT = 5;

/**
 * Model calls per day across everyone.
 *
 * ⚠️ A global ceiling, not per-IP. Per-IP limits alone are trivially defeated
 * by using more IPs, and the thing being protected is one shared bill.
 */
export const GLOBAL_DAILY_READS = 500;

/** A site's copy doesn't change hourly, and a repeat visitor should be instant. */
export const CACHE_TTL_SEC = 24 * 60 * 60;

/** Enough for the full extraction — `gaps` alone can run long. */
export const EXTRACTION_TOKENS = 1_200;

export const CACHE_KIND = "demo_read";
export const IP_KIND = "demo_ip";
export const BUDGET_KIND = "demo_budget";

/**
 * ⭐ Refuse anything that isn't a public web address.
 *
 * Blocks loopback, private ranges, link-local — including `169.254.169.254`,
 * the cloud metadata address — and internal-only TLDs.
 *
 * ⚠️ This is a hostname check, not a resolved-IP check, so it does not stop
 * DNS rebinding: a domain that resolves to a private address passes here.
 * Closing that needs resolution before fetch, which the Convex runtime doesn't
 * expose. Stated rather than implied — the guard raises the cost a long way
 * without being airtight, and pretending otherwise is worse than saying so.
 */
export function isPubliclyRoutable(raw: string): { ok: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "that doesn't look like a web address" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "only http and https addresses work" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, reason: "that address isn't reachable from the internet" };
  }
  // Internal-only names. `.local` is mDNS; the rest are conventional intranet.
  if (/\.(local|internal|intranet|lan|home|corp)$/.test(host)) {
    return { ok: false, reason: "that address isn't reachable from the internet" };
  }
  // IPv6 loopback and unique-local.
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) {
    return { ok: false, reason: "that address isn't reachable from the internet" };
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const isPrivate =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224; // multicast and reserved
    if (isPrivate) {
      return { ok: false, reason: "that address isn't reachable from the internet" };
    }
  }

  return { ok: true };
}

/** Cache and counter keys. Not secret — this only has to be stable and short. */
export function keyFor(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Normalised so `example.com`, `https://example.com/` and
 * `https://example.com/?utm_source=x` share one cache entry and one read.
 */
export function normaliseUrl(raw: string): string {
  /**
   * ⚠️ Only prepend a scheme when there ISN'T one.
   *
   * Testing for `https?://` alone meant anything with another scheme got
   * `https://` glued in front: `file:///etc/passwd` became
   * `https://file///etc/passwd` — a nonsense address that we then tried to
   * FETCH, instead of a `file:` URL that `isPubliclyRoutable` would have
   * rejected outright. Nothing leaked, but normalisation had quietly turned an
   * unsupported scheme into a request, which is the wrong shape for a guard to
   * be standing behind.
   */
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  const withScheme = hasScheme ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return withScheme;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * ⚠️ Counters live in `nicheCache`, which is a deliberate reuse rather than a
 * new table.
 *
 * The schema sits near TypeScript's instantiation ceiling and new tables are
 * not free. `nicheCache` is generically shaped — fingerprint, kind, payload,
 * ttl — and its invariant is only that it carries **no customer identity**,
 * which an IP hash and a global budget both satisfy.
 *
 * The cost is that the table now holds two unrelated things. Named here so the
 * next person reading `nicheCache` isn't confused about why demo counters are
 * in it.
 */
export const claimBudget = internalMutation({
  args: { ipKey: v.string(), day: v.string(), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ allowed: boolean; reason?: string }> => {
    const now = args.now ?? Date.now();

    const read = async (kind: string, fingerprint: string) =>
      (await ctx.db
        .query("nicheCache")
        .withIndex("by_fingerprint_and_kind", (q) =>
          q.eq("nicheFingerprint", fingerprint).eq("kind", kind)
        )
        .unique()
        .catch(() => null)) as Doc<"nicheCache"> | null;

    const bump = async (
      kind: string,
      fingerprint: string,
      row: Doc<"nicheCache"> | null,
      count: number
    ) => {
      const patch = {
        nicheFingerprint: fingerprint,
        kind,
        payloadJson: JSON.stringify({ day: args.day, count }),
        fetchedAt: now,
        ttlSec: CACHE_TTL_SEC,
        sourceKind: "demo",
      };
      if (row) await ctx.db.patch(row._id, patch);
      else await ctx.db.insert("nicheCache", patch);
    };

    const countOf = (row: Doc<"nicheCache"> | null): number => {
      if (!row) return 0;
      try {
        const p = JSON.parse(row.payloadJson) as { day?: string; count?: number };
        // A new day resets the bucket — that's the whole point of storing it.
        return p.day === args.day && typeof p.count === "number" ? p.count : 0;
      } catch {
        return 0;
      }
    };

    const globalRow = await read(BUDGET_KIND, "global");
    const globalCount = countOf(globalRow);
    if (globalCount >= GLOBAL_DAILY_READS) {
      // Honest, and not about them — they did nothing wrong.
      return {
        allowed: false,
        reason: "the demo has had a busy day — try again tomorrow, or sign up and she'll read it properly",
      };
    }

    const ipRow = await read(IP_KIND, args.ipKey);
    const ipCount = countOf(ipRow);
    if (ipCount >= IP_DAILY_LIMIT) {
      return {
        allowed: false,
        reason: `that's ${IP_DAILY_LIMIT} sites today — sign up and she'll read yours properly`,
      };
    }

    await bump(BUDGET_KIND, "global", globalRow, globalCount + 1);
    await bump(IP_KIND, args.ipKey, ipRow, ipCount + 1);
    return { allowed: true };
  },
});

export const cacheRead = internalMutation({
  args: { urlKey: v.string(), payloadJson: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<null> => {
    const now = args.now ?? Date.now();
    const existing = (await ctx.db
      .query("nicheCache")
      .withIndex("by_fingerprint_and_kind", (q) =>
        q.eq("nicheFingerprint", args.urlKey).eq("kind", CACHE_KIND)
      )
      .unique()
      .catch(() => null)) as Doc<"nicheCache"> | null;

    const row = {
      nicheFingerprint: args.urlKey,
      kind: CACHE_KIND,
      payloadJson: args.payloadJson,
      fetchedAt: now,
      ttlSec: CACHE_TTL_SEC,
      sourceKind: "demo",
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("nicheCache", row);
    return null;
  },
});

export interface DemoRead {
  ok: boolean;
  url?: string;
  /** What she worked out. Same shape a real customer's read produces. */
  read?: {
    name?: string;
    whatItIs?: string;
    whoItsFor?: string;
    whatsDifferent?: string;
    gaps?: string[];
  };
  cached?: boolean;
  /** Plain language, shown to a stranger. Never a stack trace. */
  detail?: string;
}

/**
 * ⭐ Read a stranger's site, once, cheaply, and say what she found.
 *
 * Order matters: routability → cache → budget → fetch → model. The cache is
 * checked BEFORE the budget so a popular URL never burns anyone's quota, and
 * the budget is claimed before the fetch so a slow site can't be used to run
 * many concurrent reads past the cap.
 */
export const readForDemo = internalAction({
  args: {
    url: v.string(),
    /** Hashed by the caller — a raw IP should never reach a Convex row. */
    ipKey: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DemoRead> => {
    const url = normaliseUrl(args.url.trim());

    const routable = isPubliclyRoutable(url);
    if (!routable.ok) return { ok: false, detail: routable.reason };

    const urlKey = keyFor(url);
    const now = args.now ?? Date.now();

    const cached = await ctx.runQuery(internal.maya.demo.cachedRead, { urlKey, now });
    if (cached) return { ...cached, cached: true };

    /**
     * ⚠️ UTC here is correct, and it is the ONLY place in this codebase where
     * that is true.
     *
     * Every other day boundary is the founder's, because reporting a day in the
     * wrong timezone turns a broken run into a clean one. A demo visitor is a
     * stranger with no account and no timezone, so the budget day has to be
     * *some* fixed day — and UTC is the one nobody has to guess at.
     *
     * Routed through `dayKeyInZone` rather than `toISOString().slice(0, 10)`
     * so there is one implementation of "what day is it", which is what
     * `founderDay.test.ts` exists to enforce.
     */
    const day = dayKeyInZone(now, "UTC");
    const budget = await ctx.runMutation(internal.maya.demo.claimBudget, {
      ipKey: args.ipKey,
      day,
      now,
    });
    if (!budget.allowed) return { ok: false, detail: budget.reason };

    const page = await fetchProductPage(url);
    if (!page.ok) {
      /**
       * ⚠️ Graceful degrade, per §18.9.2 — and it says what happened in their
       * language. A visitor who pasted a URL and got a blank box concludes the
       * product is broken, which is the opposite of what this page is for.
       */
      return {
        ok: false,
        url,
        detail: page.loginWalled
          ? "that page needs a login, so there's nothing public to read. Try your marketing site."
          : (page.reason ?? "couldn't read that page"),
      };
    }

    const text = stripHtml(page.html);
    const title = extractTitle(page.html);

    /**
     * ⚠️ Deliberately NOT `callModel`.
     *
     * Its first argument is documented as *"whose bill this lands on. Required
     * — spend with no owner is unpriceable"*, and demo spend genuinely has no
     * owner. Passing a fake id, or loosening that argument to optional, would
     * break the invariant for every real call to save one special case here.
     *
     * So this calls OpenRouter directly and `GLOBAL_DAILY_READS` is the cost
     * control — a hard ceiling rather than an attributed line item. The trade
     * is stated: demo spend is capped but not itemised.
     *
     * ⚠️ Bypassing `callModel` means losing the protections it has accumulated,
     * so `budgetFor` is applied explicitly. Without it, swapping
     * `PRODUCT_READ_MODEL` to a reasoning model would spend the budget on
     * thinking and return an EMPTY completion rather than an error — the exact
     * trap PR #321 fixed centrally, which a bypass silently reopens.
     */
    let read: DemoRead["read"];
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`,
        },
        body: JSON.stringify({
          model: PRODUCT_READ_MODEL,
          temperature: 0,
          /**
           * ⚠️ 700 truncated the JSON: a live read of neon.tech came back with
           * `name` and nothing else, and a truncated object parses fine — so it
           * looked like a thin page rather than a clipped answer.
           */
          max_tokens: budgetFor(PRODUCT_READ_MODEL, EXTRACTION_TOKENS),
          messages: [
            // The same system prompt the real read sends — it carries the JSON
            // schema, without which the model answers in prose.
            { role: "system", content: EXTRACTION_SYSTEM },
            {
              role: "user",
              /**
               * ⚠️ The ONE place the demo differs from a real read.
               *
               * `productName` normally comes from the founder at signup. A
               * visitor hasn't given us one, so the hostname stands in —
               * honest, usually right, and better than an empty string, which
               * the prompt reads as "the founder didn't say".
               */
              content: buildExtractionPrompt({
                productName: new URL(url).hostname,
                url,
                title,
                text,
              }),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openrouter ${res.status}`);
      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const parsed = parseExtraction(payload.choices?.[0]?.message?.content ?? "");
      if (!parsed) throw new Error("unparseable");
      read = {
        name: typeof parsed.name === "string" ? parsed.name : (title ?? undefined),
        whatItIs: typeof parsed.whatItIs === "string" ? parsed.whatItIs : undefined,
        whoItsFor: typeof parsed.whoItsFor === "string" ? parsed.whoItsFor : undefined,
        whatsDifferent:
          typeof parsed.whatsDifferent === "string" ? parsed.whatsDifferent : undefined,
        gaps: Array.isArray(parsed.gaps)
          ? parsed.gaps.filter((g): g is string => typeof g === "string")
          : undefined,
      };
    } catch (error) {
      console.error(`[demo] read failed for ${url}: ${String(error)}`);
      return { ok: false, url, detail: "couldn't make sense of that page just now" };
    }

    /**
     * ⚠️ An empty read is a FAILURE, not a success with nothing in it.
     *
     * Reporting `ok: true` with `read: {}` renders as a blank result box on the
     * landing page — which reads as "the product is broken" to the one visitor
     * we most needed to impress.
     */
    if (!read?.whatItIs) {
      return {
        ok: false,
        url,
        detail: "I couldn't get a clear read on that page — try the marketing site rather than a docs or app URL",
      };
    }

    const result: DemoRead = { ok: true, url, read };

    /**
     * ⭐ Only cache a read that actually said something.
     *
     * ⚠️ Found by shipping the bug: a 700-token cap truncated neon.tech's JSON
     * to `{name}` alone, and a truncated object parses fine — so a clipped
     * answer looked like a thin page. It was then cached, and every visitor
     * pasting that URL got the poor read back instantly for 24 hours.
     *
     * `whatItIs` is the field the whole demo turns on: "watch her be
     * specifically right about your company" is that sentence. Without it there
     * is nothing worth keeping, and re-reading costs one call.
     */
    if (read?.whatItIs) {
      await ctx.runMutation(internal.maya.demo.cacheRead, {
        urlKey,
        payloadJson: JSON.stringify(result),
        now,
      });
    }
    return result;
  },
});

/** Cached result, or null when absent or expired. */
export const cachedRead = internalQuery({
  args: { urlKey: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<DemoRead | null> => {
    const row = (await ctx.db
      .query("nicheCache")
      .withIndex("by_fingerprint_and_kind", (q) =>
        q.eq("nicheFingerprint", args.urlKey).eq("kind", CACHE_KIND)
      )
      .unique()
      .catch(() => null)) as Doc<"nicheCache"> | null;
    if (!row) return null;

    const now = args.now ?? Date.now();
    // ⚠️ Expired is a MISS, not stale-but-usable. A site that relaunched should
    // not have last month's positioning read back to its founder as current.
    if (now - row.fetchedAt > row.ttlSec * 1000) return null;

    try {
      return JSON.parse(row.payloadJson) as DemoRead;
    } catch {
      return null;
    }
  },
});

/**
 * ⭐ The public entry point, and the only one.
 *
 * ⚠️ It takes a shared secret, which looks odd on a deliberately public
 * feature. The reason is `ipKey`: the per-IP limit only means anything if the
 * key comes from the real client address, and the caller cannot be trusted to
 * supply it honestly. Only `app/api/demo/read` can see that address, so only it
 * may call this — otherwise anyone rate-limits themselves by passing a fresh
 * key each time, and the per-IP guard is decoration.
 *
 * The GLOBAL cap still holds regardless, which is what actually protects the
 * bill. This protects the fairness of the per-visitor share.
 */
export const readPublic = action({
  args: { url: v.string(), ipKey: v.string(), secret: v.string() },
  handler: async (ctx, args): Promise<DemoRead> => {
    const expected = process.env.DEMO_SHARED_SECRET;
    // Fails CLOSED when unset. An open door because a variable is missing is
    // worse than a closed one.
    if (!expected || args.secret !== expected) {
      return { ok: false, detail: "the demo isn't available right now" };
    }
    return await ctx.runAction(internal.maya.demo.readForDemo, {
      url: args.url,
      ipKey: args.ipKey,
    });
  },
});
