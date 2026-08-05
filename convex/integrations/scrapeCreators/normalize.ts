/**
 * ScrapeCreators — coercion helpers shared by every platform normalizer.
 *
 * Upstream is inconsistent about numbers-as-strings, missing fields, and where
 * a media URL lives. These absorb that so each platform normalizer reads as
 * field mapping rather than defensive plumbing.
 *
 * Split out of the former 1,746-line `endpoints.ts` (Sprint 1). The public
 * surface is unchanged — `endpoints.ts` re-exports everything — so every
 * existing import keeps working.
 */

/* Normalizers — upstream → canonical                                         */
/* -------------------------------------------------------------------------- */

export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function str(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

export function mediaUrl(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (!v || typeof v !== "object") return null;
  const maybe = v as {
    url_list?: unknown;
    urlList?: unknown;
    url?: unknown;
    uri?: unknown;
  };
  const list = Array.isArray(maybe.url_list)
    ? maybe.url_list
    : Array.isArray(maybe.urlList)
      ? maybe.urlList
      : null;
  const first = list?.find((url): url is string => typeof url === "string" && url.length > 0);
  return first ?? str(maybe.url) ?? str(maybe.uri);
}

export function firstNum(...values: unknown[]): number | null {
  for (const value of values) {
    const n = num(value);
    if (n !== null) return n;
  }
  return null;
}

export function normalizeVideoDurationSec(...values: unknown[]): number | null {
  const duration = firstNum(...values);
  if (duration === null) return null;
  return duration > 1000 ? Math.round(duration / 1000) : duration;
}

