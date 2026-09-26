/**
 * K1: the media kit's facts, v2. Every number is a stored row with its date, never re-derived by a
 * model and never invented; a fact the platform doesn't give is null and said so, never zero.
 *
 * What brands read first (docs/CREATOR_MASTER_PLAN.md K1): who they are (photo, one line, handles),
 * per platform (followers, typical views, engagement, growth), who watches (audience), the best
 * recent posts, what they do (services), brand work, and how to reach them.
 *
 * Pure helpers are exported for the tests; `readKitV2` is shared by the tool, the app and the page
 * (a query can't call a query).
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { normalViews } from "../core/normal";
import { appCards } from "../connections/audience";
import { avatarKey, coverForUrl, mediaUrl } from "../media";
import { Opportunity, Profile } from "./contracts";

/** Posts older than this don't lead a kit (the research: nothing older than ~6 months). */
export const BEST_WINDOW_DAYS = 180;
/** Engagement is the median of this window, so one viral post doesn't speak for the account. */
export const ENGAGEMENT_WINDOW_DAYS = 90;
/** Fewer posts than this and engagement isn't a number worth printing. */
export const ENGAGEMENT_MIN_POSTS = 3;
/** A TikTok Studio screenshot older than this is hidden, and she asks for a fresh one when a pitch needs it. */
export const SCREENSHOT_AUDIENCE_DAYS = 60;
export const BEST_POSTS = 6;

const DAY = 86_400_000;

export interface KitPost { url: string; platform: string; views: number; multiple: number | null; caption: string; createTime: number; cover: string | null }
export interface KitShare { label: string; share: number }
export interface KitAudience { source: "connected" | "tiktok_studio"; asOf: number; age: KitShare[]; gender: KitShare[]; countries: KitShare[]; cities: KitShare[] }
export interface KitPlatform {
  platform: "tiktok" | "instagram";
  handle: string | null;
  followers: number | null;
  followersAsOf: number | null;
  normalViews: number | null;
  posts: number;
  engagement: { perView: number; perFollower: number | null; posts: number } | null;
  growth30d: { net: number; gained: number | null; lost: number | null } | null;
  audience: KitAudience | null;
  /** TikTok only: a screenshot they sent is older than the window; she asks for a fresh one when it matters. */
  audienceStale?: boolean;
  best: KitPost[];
}
export interface KitV2 {
  name: string;
  lane: string | null;
  asOf: number;
  photo: { url: string; source: "instagram" | "tiktok" | "upload" } | null;
  photoSetting: "auto" | "upload" | "none";
  photoCheck: { weak: boolean; reason: string; offered: boolean } | null;
  oneLine: { text: string; approved: boolean } | null;
  showAudience: boolean | null;
  services: string[];
  region: string | null;
  contactEmail: string | null;
  brandWork: Array<{ brand: string; source: "their_post" | "deal"; url: string | null; at: number }>;
  platforms: KitPlatform[];
}

// ------------------------------------------------------------------ pure

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Engagement, defined once: interactions (likes + comments + shares + saves) ÷ views, the median
 * over the last 90 days; and the median interactions ÷ followers, where brands expect that one.
 */
export function engagementOf(posts: Array<{ createTime: number; metrics: { views: number; likes: number; comments: number; shares: number; saves?: number } }>, followers: number | null, now: number): KitPlatform["engagement"] {
  const pool = posts.filter((p) => now - p.createTime <= ENGAGEMENT_WINDOW_DAYS * DAY && p.metrics.views > 0);
  if (pool.length < ENGAGEMENT_MIN_POSTS) return null;
  const inter = (p: (typeof pool)[number]) => p.metrics.likes + p.metrics.comments + p.metrics.shares + (p.metrics.saves ?? 0);
  const perView = median(pool.map((p) => inter(p) / p.metrics.views));
  const perFollower = followers && followers > 0 ? median(pool.map(inter)) / followers : null;
  return { perView: Math.round(perView * 10_000) / 10_000, perFollower: perFollower === null ? null : Math.round(perFollower * 10_000) / 10_000, posts: pool.length };
}

/** 30-day growth from their follower snapshots: net from the snapshot nearest 30 days back; gained/lost only where the platform reports them. */
export function growthOf(snaps: Array<{ day: string; followers: number; gained?: number; lost?: number }>, now: number): KitPlatform["growth30d"] {
  if (snaps.length < 2) return null;
  const sorted = [...snaps].sort((a, b) => a.day.localeCompare(b.day));
  const latest = sorted[sorted.length - 1];
  const target = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const back = [...sorted].reverse().find((s) => s.day <= target);
  if (!back || back === latest) return null;
  const month = sorted.filter((s) => s.day > back.day);
  const reported = month.some((s) => s.gained !== undefined || s.lost !== undefined);
  return { net: latest.followers - back.followers, gained: reported ? month.reduce((n, s) => n + (s.gained ?? 0), 0) : null, lost: reported ? month.reduce((n, s) => n + (s.lost ?? 0), 0) : null };
}

/** Their own paid or gifted posts, by the disclosure in the caption, with the brand they tagged. Pure. */
export function brandWorkIn(posts: Array<{ url: string; caption: string; createTime: number }>, ownHandles: string[]): Array<{ brand: string; url: string; at: number }> {
  const own = new Set(ownHandles.map((h) => h.toLowerCase().replace(/^@/, "")));
  const out: Array<{ brand: string; url: string; at: number }> = [];
  const seen = new Set<string>();
  for (const p of posts) {
    if (!/(^|\s)#(ad|sponsored|partner|gifted|paidpartnership|collab)\b|paid partnership|\bsponsored by\b|\bgifted by\b/i.test(p.caption)) continue;
    const tag = (p.caption.match(/@([a-z0-9._]{2,30})/gi) ?? []).map((t) => t.slice(1).toLowerCase().replace(/\.$/, "")).find((t) => !own.has(t));
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push({ brand: `@${tag}`, url: p.url, at: p.createTime });
  }
  return out;
}

const SERVICE_LABEL: Record<string, string> = { sponsorship: "Sponsored posts", ugc: "UGC (videos for the brand's own channels)", affiliate: "Affiliate", gifting: "Gifted collaborations", ambassador: "Ambassadorships", event: "Events" };
/** What they offer, from the deal types they said yes to; nothing listed means nothing claimed. Pure. */
export function servicesFrom(dealTypes: string[], paidOnly: boolean): string[] {
  return dealTypes.filter((t) => !(paidOnly && t === "gifting")).map((t) => SERVICE_LABEL[t]).filter(Boolean);
}

/** The best recent posts: last 6 months, by views, capped. Pure. */
export function bestPosts<T extends { createTime: number; views: number }>(posts: T[], now: number, n = BEST_POSTS): T[] {
  return posts.filter((p) => now - p.createTime <= BEST_WINDOW_DAYS * DAY).sort((a, b) => b.views - a.views).slice(0, n);
}

/** A screenshot audience is shown only while fresh. Pure. */
export function freshScreenshot(at: number, now: number): boolean {
  return now - at <= SCREENSHOT_AUDIENCE_DAYS * DAY;
}

// ------------------------------------------------------------------ the read

export async function kitSettings(ctx: Pick<QueryCtx, "db">, creatorId: Id<"creators">): Promise<Doc<"mediaKits"> | null> {
  return (await ctx.db.query("mediaKits").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).first()) as Doc<"mediaKits"> | null;
}

export async function readKitV2(ctx: QueryCtx, c: Doc<"creators">, now = Date.now()): Promise<KitV2> {
  const settings = await kitSettings(ctx, c._id);
  const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(200)) as Doc<"ownPosts">[];
  const since = new Date(now - 95 * DAY).toISOString().slice(0, 10);
  const snaps = (await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", c._id).gte("day", since)).take(400)) as Doc<"followerSnapshots">[];
  const audienceRows = (await ctx.db.query("accountInsights").withIndex("by_creator_kind", (q) => q.eq("creatorId", c._id).eq("kind", "audience")).take(20)) as Doc<"accountInsights">[];
  const prof = (await ctx.db.query("partnershipProfiles").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).unique()) as Doc<"partnershipProfiles"> | null;
  const prefs = Profile.parse(prof?.data ?? {});
  const mailbox = (await ctx.db.query("partnershipMailboxes").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).first()) as Doc<"partnershipMailboxes"> | null;
  const opps = (await ctx.db.query("partnershipOpportunities").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).take(200)) as Doc<"partnershipOpportunities">[];

  const platforms: KitPlatform[] = [];
  for (const platform of ["instagram", "tiktok"] as const) {
    const mine = posts.filter((x) => x.platform === platform);
    const handle = c.handles[platform] ?? null;
    if (!mine.length && !handle) continue;
    const pSnaps = snaps.filter((s) => s.platform === platform);
    const latestSnap = [...pSnaps].sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
    const followers = latestSnap?.followers ?? null;
    let audience: KitAudience | null = null;
    let audienceStale = false;
    if (platform === "instagram") {
      const row = audienceRows.find((r) => r.platform === "instagram" && r.status === "ok") ?? null;
      if (row) {
        const a = appCards("instagram", true, { insights: null, audience: row, snaps: [] }, now).audience;
        if (a && a.status === "ok") audience = { source: "connected", asOf: a.asOf ?? row.fetchedAt, age: a.age, gender: a.gender, countries: a.countries, cities: a.cities };
      }
    } else if (settings?.tiktokAudience) {
      if (freshScreenshot(settings.tiktokAudience.at, now)) audience = { source: "tiktok_studio", asOf: settings.tiktokAudience.at, age: settings.tiktokAudience.age, gender: settings.tiktokAudience.gender, countries: settings.tiktokAudience.countries, cities: [] };
      else audienceStale = true;
    }
    const best = bestPosts(mine.map((x) => ({ url: x.url, platform, views: x.metrics.views, multiple: x.multiple ?? null, caption: x.caption.split("\n")[0].slice(0, 100), createTime: x.createTime, cover: null as string | null })), now);
    for (const b of best) b.cover = await coverForUrl(ctx, b.url).catch(() => null);
    platforms.push({
      platform,
      handle,
      followers,
      followersAsOf: latestSnap?.at ?? null,
      normalViews: normalViews(mine, platform, now)?.value ?? null,
      posts: mine.length,
      engagement: engagementOf(mine, followers, now),
      growth30d: growthOf(pSnaps.map((s) => ({ day: s.day, followers: s.followers, gained: s.gained, lost: s.lost })), now),
      audience,
      ...(audienceStale ? { audienceStale } : {}),
      best,
    });
  }

  // The photo: theirs if they sent one, off if they said no photo, else their profile picture (Instagram first).
  const setting = settings?.photo?.source ?? "auto";
  let photo: KitV2["photo"] = null;
  if (setting === "upload" && settings?.photo?.storageId) {
    const url = await ctx.storage.getUrl(settings.photo.storageId);
    if (url) photo = { url, source: "upload" };
  } else if (setting === "auto") {
    for (const p of ["instagram", "tiktok"] as const) {
      const h = c.handles[p];
      const url = h ? await mediaUrl(ctx, p, "avatar", avatarKey(h)) : null;
      if (url) { photo = { url, source: p }; break; }
    }
  }

  const ownHandles = [c.handles.tiktok, c.handles.instagram].filter((h): h is string => Boolean(h));
  const fromPosts = brandWorkIn(posts.map((p) => ({ url: p.url, caption: p.caption, createTime: p.createTime })), ownHandles).map((b) => ({ ...b, source: "their_post" as const }));
  const fromDeals = opps.flatMap((o) => {
    const d = Opportunity.safeParse(o.data);
    return d.success && ["agreed", "completed"].includes(d.data.status) ? [{ brand: d.data.brand, source: "deal" as const, url: null, at: o.updatedAt }] : [];
  });
  const lane = typeof (c.dossier as { lane?: unknown } | undefined)?.lane === "string" ? String((c.dossier as { lane: string }).lane) : c.niche || null;

  return {
    name: c.handles.instagram ?? c.handles.tiktok ?? "creator",
    lane,
    asOf: now,
    photo,
    photoSetting: setting,
    photoCheck: settings?.photoCheck ? { weak: settings.photoCheck.weak, reason: settings.photoCheck.reason, offered: Boolean(settings.photoCheck.offeredAt) } : null,
    oneLine: settings?.oneLine ? { text: settings.oneLine.text, approved: settings.oneLine.status === "approved" } : null,
    showAudience: settings?.showAudience ?? null,
    services: servicesFrom(prefs.dealTypes, prefs.paidOnly),
    region: prefs.region && prefs.region !== "unknown" ? prefs.region : null,
    contactEmail: mailbox?.email ?? null,
    brandWork: [...fromDeals, ...fromPosts].slice(0, 8),
    platforms,
  };
}

/** The same kit, as it may be shown to a brand: no rates, no preferences, audience only with their yes. Pure. */
export interface PublicKitV2 {
  name: string;
  oneLine: string | null;
  lane: string | null;
  asOf: string;
  photo: string | null;
  services: string[];
  region: string | null;
  contactEmail: string | null;
  brandWork: string[];
  platforms: Array<Omit<KitPlatform, "audience" | "audienceStale" | "posts"> & { audience: KitAudience | null }>;
  /** A per-brand view: the posts she picked for them lead, and one idea. */
  forBrand?: { brand: string; idea: string };
}

/** Pure: a caption as a brand may see it: no @handles (who they tag is private), tidy spaces. */
export function publicCaption(c: string): string {
  return c.replace(/(^|\s)@[a-z0-9._]{2,30}/gi, "$1").replace(/\s+(with|x|ft\.?|feat\.?)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
}

export function publicView(k: KitV2, variant?: { brand: string; idea: string; postUrls: string[] }): PublicKitV2 {
  const platforms = k.platforms.map((p) => {
    let best = p.best;
    if (variant) {
      const lead = variant.postUrls.map((u) => best.find((b) => b.url === u)).filter((b): b is KitPost => Boolean(b));
      best = [...lead, ...best.filter((b) => !variant.postUrls.includes(b.url))];
    }
    const { audience, audienceStale: _s, posts: _n, ...rest } = p;
    void _s; void _n;
    // Who they tag stays private: handles are cut from captions on anything a brand sees.
    const shown = best.map((b) => ({ ...b, caption: publicCaption(b.caption) }));
    return { ...rest, best: shown, audience: k.showAudience === true ? audience : null };
  });
  if (variant) platforms.sort((a, b) => Number(b.best.some((x) => variant.postUrls.includes(x.url))) - Number(a.best.some((x) => variant.postUrls.includes(x.url))));
  return {
    name: k.name,
    oneLine: k.oneLine?.approved ? k.oneLine.text : null,
    lane: k.lane,
    asOf: new Date(k.asOf).toISOString().slice(0, 10),
    photo: k.photo?.url ?? null,
    services: k.services,
    region: k.region,
    contactEmail: k.contactEmail,
    brandWork: [...new Set(k.brandWork.map((b) => b.brand))],
    platforms,
    ...(variant ? { forBrand: { brand: variant.brand, idea: variant.idea } } : {}),
  };
}
