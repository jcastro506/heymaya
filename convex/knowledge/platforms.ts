/**
 * B3 capability 6: Maya's dated notes on TikTok and Instagram rules and programs. Every fact
 * carries its official source and the day it was checked; she must cite "as of <month>" and say a
 * fact may have changed once it's older than 60 days (operator alert flags stale ones).
 *
 * ⚠️ Checked 2026-09-24 against the platforms' own help/creator pages via their search summaries,
 * not a full read of each page. Spot-check at the B5 sign-off; update `verifiedOn` when re-checked.
 * Facts here are rules and programs, never growth advice: advice is her judgment.
 */

export interface PlatformFact {
  id: string;
  platform: "tiktok" | "instagram";
  tags: string[];
  fact: string;
  source: string;
  verifiedOn: string; // YYYY-MM-DD
}

export const PLATFORM_FACTS: PlatformFact[] = [
  {
    id: "tt-creator-rewards",
    platform: "tiktok",
    tags: ["monetization", "money", "paid", "creator rewards", "creativity program", "followers", "get paid", "eligibility"],
    fact: "TikTok's Creator Rewards Program needs: 18+, at least 10,000 followers, 100,000 video views in the last 30 days, a personal (not business) account in good standing, in an eligible country (incl. US, UK, Germany, Japan, South Korea, France, Mexico, Brazil). Only original videos over 1 minute earn, not duets, stitches or sponsored posts.",
    source: "https://www.tiktok.com/creator-academy/article/eligibility",
    verifiedOn: "2026-09-24",
  },
  {
    id: "tt-shop-affiliate",
    platform: "tiktok",
    tags: ["tiktok shop", "affiliate", "shop", "sell", "commission", "money", "followers", "eligibility"],
    fact: "TikTok Shop affiliate creators in the US must be 18+ and based in the US; 1,000 followers to join, 5,000 to promote other sellers' products from the marketplace. Under 5,000 followers you start in a limited pilot for at least 30 days.",
    source: "https://seller-us.tiktok.com/university/essay?knowledge_id=6939143037667118&lang=en",
    verifiedOn: "2026-09-24",
  },
  {
    id: "tt-fyf-ineligible",
    platform: "tiktok",
    tags: ["shadowban", "shadow ban", "views died", "not eligible", "for you", "fyp", "restricted", "violation", "appeal", "reach"],
    fact: "TikTok can mark a post ineligible for the For You feed (e.g. unoriginal or reused content, misleading information, not suitable for a broad audience). The creator is told in the post's Analytics, with a notification they can open to see why and appeal. No notice means no such restriction on that post.",
    source: "https://support.tiktok.com/en/safety-hc/account-and-user-safety/content-violations-and-bans",
    verifiedOn: "2026-09-24",
  },
  {
    id: "tt-hacked",
    platform: "tiktok",
    tags: ["hacked", "can't log in", "locked out", "recover", "password", "security"],
    fact: "For a hacked TikTok account: reset the password from the login screen with the account's email or phone; if you've lost access to your devices, submit an account recovery request and verify identity (registered email, phone number or previous passwords).",
    source: "https://support.tiktok.com/en/log-in-troubleshoot/log-in/my-account-has-been-hacked",
    verifiedOn: "2026-09-24",
  },
  {
    id: "tt-branded-disclosure",
    platform: "tiktok",
    tags: ["sponsored", "brand deal", "disclosure", "paid partnership", "ad", "branded content", "ftc"],
    fact: "On TikTok, turn on the branded content (content disclosure) toggle for any sponsored or promotional post.",
    source: "https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/branded-content-on-tiktok",
    verifiedOn: "2026-09-24",
  },
  {
    id: "ig-account-status",
    platform: "instagram",
    tags: ["shadowban", "shadow ban", "views died", "restricted", "recommend", "explore", "account status", "violation", "appeal", "reach"],
    fact: "Instagram's Account Status (Settings → Account → Account Status) shows whether your content and account are eligible to be recommended to non-followers (Explore, Reels, Search, Suggested), which posts caused it, and lets you edit, delete or request a review.",
    source: "https://help.instagram.com/338481628002750",
    verifiedOn: "2026-09-24",
  },
  {
    id: "ig-originality",
    platform: "instagram",
    tags: ["repost", "reposting", "watermark", "tiktok watermark", "original", "cross-post", "aggregator", "reach"],
    fact: "Instagram says it's less likely to recommend a repost of a reel that's already on Instagram, content with noticeable watermarks, and accounts that mostly reshare others' content; original creators get priority.",
    source: "https://creators.instagram.com/blog/recommendations-and-originality",
    verifiedOn: "2026-09-24",
  },
  {
    id: "ig-trial-reels",
    platform: "instagram",
    tags: ["trial reels", "test", "non-followers", "experiment", "try"],
    fact: "Instagram trial reels (professional accounts) are shown to non-followers first; your followers don't see them unless you later share the reel with everyone. Toggle 'Trial' before sharing.",
    source: "https://help.instagram.com/1013292530224018",
    verifiedOn: "2026-09-24",
  },
  {
    id: "ig-paid-partnership",
    platform: "instagram",
    tags: ["sponsored", "brand deal", "disclosure", "paid partnership", "ad", "branded content", "ftc"],
    fact: "On Instagram, tag sponsored posts with the paid partnership label (branded content tools, for accounts that meet the eligibility requirements).",
    source: "https://help.instagram.com/1109894795810258",
    verifiedOn: "2026-09-24",
  },
  {
    id: "ig-ranking-signals",
    platform: "instagram",
    tags: ["algorithm", "ranking", "how it works", "sends", "shares", "watch time"],
    fact: "Instagram says recommendations are ranked on predicted engagement per viewer: watch time, shares/sends, follows, likes, comments and profile visits.",
    source: "https://about.instagram.com/blog/announcements/instagram-ranking-explained",
    verifiedOn: "2026-09-24",
  },
  {
    id: "tt-one-marketplace",
    platform: "tiktok",
    tags: ["brand deals", "brand deal", "creator marketplace", "tiktok one", "marketplace", "sponsorship", "get paid", "brands find me", "followers", "eligibility"],
    fact: "TikTok One (formerly the Creator Marketplace), where brands find and hire creators: sign-up needs 18+, a country where it has launched, and following the Community Guidelines and Branded Content Policy. Sign-up itself has no follower minimum; brand projects need at least 1,000 followers plus requirements that vary by project. (Third-party guides quoting 10,000 are out of date.)",
    source: "https://ads.tiktok.com/help/article/how-creators-can-sign-up-for-tiktok-one",
    verifiedOn: "2026-09-24",
  },
  {
    id: "ig-creator-marketplace",
    platform: "instagram",
    tags: ["brand deals", "brand deal", "creator marketplace", "marketplace", "sponsorship", "get paid", "brands find me", "partnership messages", "eligibility"],
    fact: "Instagram's creator marketplace (brands find creators and send partnership messages) needs a professional (creator or business) account, 18+, an eligible country, and an account in line with the Partner Monetization Policies. Instagram's help page lists eligibility; confirm the current country list there.",
    source: "https://help.instagram.com/1389278101788752",
    verifiedOn: "2026-09-24",
  },
];

/** Pure: the facts that match a topic (by tag words), for one platform or both. */
export function factsFor(topic: string, platform: "tiktok" | "instagram" | "both" = "both"): PlatformFact[] {
  const t = topic.toLowerCase();
  const words = t.split(/\W+/).filter((w) => w.length > 2);
  return PLATFORM_FACTS
    .filter((f) => platform === "both" || f.platform === platform)
    .map((f) => ({ f, score: f.tags.reduce((s, tag) => s + (t.includes(tag) ? 3 : words.some((w) => tag.split(" ").includes(w)) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.f);
}

/** Pure: whole days since a fact was verified. */
export function staleDays(verifiedOn: string, now = Date.now()): number {
  return Math.floor((now - Date.parse(`${verifiedOn}T00:00:00Z`)) / 86_400_000);
}
