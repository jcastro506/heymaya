/**
 * Discovered profiles, normalized (2026-09-14, plan §27). The discovery, following and
 * Instagram profile-search reads used to return the vendor's raw payload: a fresh read handed
 * callers a wrapper holding fields they never looked for, and the cache stripped the raw payload,
 * so no suggestion or belt lookup ever saw a profile. Field names come from the recorded vendor
 * responses in integrations/scrapeCreators/fixtures.spec.json.
 */

export type DiscoveredPlatform = "tiktok" | "instagram";

export interface DiscoveredProfile {
  platform: DiscoveredPlatform;
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  avatarUrl: string | null;
  bio: string | null;
  isPrivate: boolean;
}

type Row = Record<string, unknown>;
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const num = (x: unknown): number | null => {
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const clean = (h: string | null): string => (h ?? "").replace(/^@/, "").trim().toLowerCase();
const rows = (raw: unknown, key: string): Row[] => {
  const v = (raw as Row | null)?.[key];
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Row[]) : [];
};

/** TikTok creators by follower band: the handle lives only in `tt_link`. Pure. */
export function tiktokPopularProfiles(raw: unknown): DiscoveredProfile[] {
  return rows(raw, "creators").map((c) => ({
    platform: "tiktok" as const,
    handle: clean(/@([^/?#]+)/.exec(String(c.tt_link ?? ""))?.[1] ?? null),
    displayName: str(c.nick_name),
    followerCount: num(c.follower_cnt),
    avatarUrl: str(c.avatar_url),
    bio: null,
    isPrivate: false,
  })).filter((p) => p.handle);
}

/** The accounts a TikTok user follows. Pure. */
export function tiktokFollowingProfiles(raw: unknown): DiscoveredProfile[] {
  return rows(raw, "followings").map((f) => {
    const avatar = (f.avatar_medium as { url_list?: unknown[] } | undefined)?.url_list?.[0];
    return {
      platform: "tiktok" as const,
      handle: clean(str(f.unique_id)),
      displayName: str(f.nickname),
      followerCount: num(f.follower_count),
      avatarUrl: str(avatar),
      bio: str(f.signature),
      isPrivate: false,
    };
  }).filter((p) => p.handle);
}

/** Instagram profiles for a keyword. Pure. */
export function instagramSearchProfiles(raw: unknown): DiscoveredProfile[] {
  return rows(raw, "profiles").map((p) => ({
    platform: "instagram" as const,
    handle: clean(str(p.username)),
    displayName: str(p.full_name),
    followerCount: num(p.follower_count),
    avatarUrl: str(p.profile_pic_url),
    bio: str(p.biography),
    isPrivate: p.is_private === true,
  })).filter((p) => p.handle);
}

/**
 * The value a discovery read stores and returns. `credits_charged` stays at the top level so the
 * read layer still records what the vendor charged; nothing raw is kept.
 */
export function profilesResult(result: { source: string; raw?: unknown }, normalize: (raw: unknown) => DiscoveredProfile[]): { source: string; profiles: DiscoveredProfile[]; credits_charged?: number } {
  const charged = num((result.raw as Row | null)?.credits_charged);
  return { source: result.source, profiles: normalize(result.raw), ...(charged !== null ? { credits_charged: charged } : {}) };
}

/** Profiles from any read value: the normalized shape, or nothing. Pure. */
export function profilesOf(value: unknown): DiscoveredProfile[] | null {
  const p = (value as { profiles?: unknown } | null)?.profiles;
  return Array.isArray(p) ? (p as DiscoveredProfile[]) : null;
}
