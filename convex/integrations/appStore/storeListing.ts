/**
 * W1.3 — Mobile-app store-listing reader (pure core).
 *
 * For founders whose product is a mobile app with no (or a thin) landing
 * page, the app-store listing is the richest product-context source we have.
 * This module holds the dependency-free, unit-testable core: store-URL
 * parsing, the Apple iTunes Lookup fetch (clean public JSON, no key), and the
 * pure normalizers that flatten each store's raw shape into one `StoreListing`.
 *
 * The Google Play fetch lives in `playScraper.ts` (a `"use node"` module that
 * imports `google-play-scraper`) because Play has no public metadata API and
 * the listing's description/category/rating live in an embedded JS blob, NOT
 * in `og:` meta tags. Both verified live 2026-06-15 (Apple Lookup + gplay).
 *
 * Everything soft-fails to `null` so onboarding never blocks on a store
 * outage or markup drift — the caller falls back to `geminiGroundedSearch`.
 */

export type StoreSource = "app_store" | "play_store";

export interface StoreListing {
  source: StoreSource;
  /** Apple numeric track id, or Google Play package name. */
  storeId: string;
  /** Canonical store URL. */
  url: string;
  name: string | null;
  description: string | null;
  category: string | null;
  /** 0–5 average rating. */
  rating: number | null;
  ratingCount: number | null;
  screenshotUrls: string[];
  developer: string | null;
}

const MAX_SCREENSHOTS = 8;

/* -------------------------------------------------------------------------- */
/* URL parsing                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Extract the Apple App Store numeric id from a listing URL, e.g.
 * `https://apps.apple.com/us/app/duolingo/id570060128` → `570060128`.
 * Tolerates country prefixes, trailing slugs, and query/hash suffixes.
 */
export function parseAppleAppId(url: string): string | null {
  const match = url.match(/\/id(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract the Google Play package name from a listing URL, e.g.
 * `https://play.google.com/store/apps/details?id=com.duolingo&hl=en` →
 * `com.duolingo`. Package names are reverse-DNS (letters/digits/`.`/`_`).
 */
export function parsePlayPackage(url: string): string | null {
  const match = url.match(/[?&]id=([a-zA-Z0-9_.]+)/);
  return match ? match[1] : null;
}

/**
 * Classify a URL as an App Store / Play Store listing and pull its id.
 * Returns null for non-store URLs (web landing pages, etc.).
 */
export function detectStoreUrl(
  url: string
): { source: StoreSource; id: string } | null {
  if (/apps\.apple\.com/i.test(url)) {
    const id = parseAppleAppId(url);
    return id ? { source: "app_store", id } : null;
  }
  if (/play\.google\.com/i.test(url)) {
    const id = parsePlayPackage(url);
    return id ? { source: "play_store", id } : null;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Apple — iTunes Lookup API (no key, public JSON)                            */
/* -------------------------------------------------------------------------- */

interface ItunesResult {
  trackName?: string;
  description?: string;
  primaryGenreName?: string;
  genres?: string[];
  averageUserRating?: number;
  userRatingCount?: number;
  screenshotUrls?: string[];
  sellerName?: string;
  artistName?: string;
  trackViewUrl?: string;
}

/** Pure normalizer for one iTunes Lookup result row. */
export function normalizeAppleResult(
  appId: string,
  r: ItunesResult
): StoreListing {
  return {
    source: "app_store",
    storeId: appId,
    url: r.trackViewUrl ?? `https://apps.apple.com/app/id${appId}`,
    name: r.trackName ?? null,
    description: r.description ?? null,
    category: r.primaryGenreName ?? r.genres?.[0] ?? null,
    rating: typeof r.averageUserRating === "number" ? r.averageUserRating : null,
    ratingCount:
      typeof r.userRatingCount === "number" ? r.userRatingCount : null,
    screenshotUrls: Array.isArray(r.screenshotUrls)
      ? r.screenshotUrls.slice(0, MAX_SCREENSHOTS)
      : [],
    developer: r.sellerName ?? r.artistName ?? null,
  };
}

/**
 * Fetch + normalize an App Store listing via the iTunes Lookup API.
 * Soft-fails to null on network error, non-200, or empty result set.
 * `fetchImpl` is injectable for deterministic tests.
 */
export async function fetchAppleListing(
  appId: string,
  fetchImpl: typeof fetch = fetch
): Promise<StoreListing | null> {
  try {
    const res = await fetchImpl(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      resultCount?: number;
      results?: ItunesResult[];
    };
    if (!data.resultCount || !data.results || data.results.length === 0) {
      return null;
    }
    return normalizeAppleResult(appId, data.results[0]);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Google Play — pure normalizer for the google-play-scraper result shape     */
/* (the network call itself lives in playScraper.ts, a "use node" module).    */
/* -------------------------------------------------------------------------- */

export interface PlayAppResult {
  title?: string;
  description?: string;
  genre?: string;
  score?: number;
  ratings?: number;
  screenshots?: string[];
  developer?: string | { devId?: string };
  url?: string;
  appId?: string;
}

/** Pure normalizer for a google-play-scraper `app()` result. */
export function normalizePlayApp(pkg: string, app: PlayAppResult): StoreListing {
  const developer =
    typeof app.developer === "string"
      ? app.developer
      : (app.developer?.devId ?? null);
  return {
    source: "play_store",
    storeId: pkg,
    url: app.url ?? `https://play.google.com/store/apps/details?id=${pkg}`,
    name: app.title ?? null,
    description: app.description ?? null,
    category: app.genre ?? null,
    rating: typeof app.score === "number" ? app.score : null,
    ratingCount: typeof app.ratings === "number" ? app.ratings : null,
    screenshotUrls: Array.isArray(app.screenshots)
      ? app.screenshots.slice(0, MAX_SCREENSHOTS)
      : [],
    developer,
  };
}

/**
 * Render a `StoreListing` into a compact plain-text block suitable for
 * feeding the W1.0 grounded-picture synthesis prompt alongside crawled HTML
 * and grounded-search results.
 */
export function storeListingToContext(listing: StoreListing): string {
  const lines = [
    `Store: ${listing.source === "app_store" ? "Apple App Store" : "Google Play"}`,
    listing.name ? `App name: ${listing.name}` : null,
    listing.developer ? `Developer: ${listing.developer}` : null,
    listing.category ? `Category: ${listing.category}` : null,
    listing.rating != null
      ? `Rating: ${listing.rating.toFixed(2)} (${listing.ratingCount ?? 0} ratings)`
      : null,
    listing.description
      ? `Listing description:\n${listing.description.trim()}`
      : null,
  ];
  return lines.filter((l): l is string => Boolean(l)).join("\n");
}
