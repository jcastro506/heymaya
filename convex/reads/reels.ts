/**
 * Instagram Reels search, normalized (2026-09-14, plan §27.3). The kind returned the vendor's raw
 * payload, which the cache strips, so the lane sweep's Instagram half never stored a post (zero
 * Instagram observations on dev) and the belt's search_reels read nothing on a cached copy. Field
 * names come from the recorded responses. The search carries no play count: views stay null,
 * never guessed from likes.
 */

export interface ReelsPost {
  platform: "instagram";
  postId: string;
  url: string | null;
  caption: string | null;
  authorHandle: string | null;
  /** Milliseconds. The vendor sends an ISO string here, unlike the account posts endpoint. */
  postedAt: number | null;
  metrics: { viewCount: null; likeCount: number | null; commentCount: number | null; shareCount: null; saveCount: null };
  mediaType: "video";
  thumbnailUrl: string | null;
  videoUrl: string | null;
  videoDurationSec: number | null;
  author: { followerCount: number | null; displayName: string | null; avatarUrl: string | null; isPrivate: boolean; verified: boolean };
  raw: { is_ad: boolean };
}

type Row = Record<string, unknown>;
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const num = (x: unknown): number | null => { const n = typeof x === "string" ? Number(x) : x; return typeof n === "number" && Number.isFinite(n) ? n : null; };
const when = (x: unknown): number | null => {
  if (typeof x === "string") { const t = Date.parse(x); return Number.isFinite(t) ? t : null; }
  const n = num(x);
  return n === null ? null : n < 1e12 ? n * 1000 : n;
};

/** Reels search results as posts with their authors. Pure. */
export function instagramReelsPosts(raw: unknown): ReelsPost[] {
  const reels = (raw as Row | null)?.reels;
  if (!Array.isArray(reels)) return [];
  return (reels.filter((r) => r && typeof r === "object") as Row[]).map((r) => {
    const owner = (r.owner && typeof r.owner === "object" ? r.owner : {}) as Row;
    const code = str(r.shortcode) ?? str(r.code);
    const captionRaw = r.caption;
    const caption = typeof captionRaw === "string" ? captionRaw : str((captionRaw as Row | null)?.text);
    return {
      platform: "instagram" as const,
      postId: String(r.id ?? code ?? ""),
      url: str(r.url) ?? (code ? `https://www.instagram.com/reel/${code}/` : null),
      caption: caption ?? null,
      authorHandle: str(owner.username)?.replace(/^@/, "").toLowerCase() ?? null,
      postedAt: when(r.taken_at),
      metrics: { viewCount: null, likeCount: num(r.like_count), commentCount: num(r.comment_count), shareCount: null, saveCount: null },
      mediaType: "video" as const,
      thumbnailUrl: str(r.display_url) ?? str(r.thumbnail_src),
      videoUrl: str(r.video_url),
      videoDurationSec: num(r.video_duration),
      author: { followerCount: num(owner.follower_count), displayName: str(owner.full_name), avatarUrl: str(owner.profile_pic_url), isPrivate: owner.is_private === true, verified: owner.is_verified === true },
      raw: { is_ad: r.is_ad === true },
    };
  }).filter((p) => p.postId);
}
