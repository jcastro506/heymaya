/**
 * The website's words that depend on which platforms Maya works with (convex/config/platforms:
 * Instagram is off unless INSTAGRAM_ENABLED says otherwise). One place, so the landing, the page
 * metadata, the pricing cards and the legal pages never disagree. The Instagram wording stays here
 * so turning the switch back on restores it.
 */
import { instagramOn } from "../../convex/config/platforms";
import { TIERS, offeredTiers, price, tierCopy, type Tier } from "../../convex/billing/tiers";

export function platformCopy(igOn: boolean = instagramOn()) {
  const partner = tierCopy("partner", igOn).label;
  return {
    igOn,
    /** "TikTok and Instagram" or "TikTok". */
    platforms: igOn ? "TikTok and Instagram" : "TikTok",
    siteDescription: igOn ? "A creator's assistant for TikTok and Instagram." : "A content assistant for TikTok creators.",
    lede: `Maya is a ${igOn ? "TikTok and Instagram" : "TikTok"} expert who watches your niche, turns what's working into ideas, plans your shoots, writes your captions, reads your numbers, and finds you brand deals. All over text.`,
    eyebrow: igOn ? "For TikTok and Instagram creators" : "For TikTok creators",
    whereYouPost: igOn ? "Your TikTok, your Instagram, or both, and a few creators you love." : "Your TikTok, and a few creators you love.",
    whatSheSees: igOn
      ? "Your public posts from the start. Connect your accounts in the app and she can read more, like followers over time, and on Instagram reach, saves and Reels watch time. TikTok doesn't share watch time, so she says so instead of guessing. She never makes up a number."
      : "Your public posts from the start. Connect your TikTok in the app and she can read more, like followers over time. TikTok doesn't share watch time, so she says so instead of guessing. She never makes up a number.",
    /** The partnerships plan's name as it sits in a sentence ("on the … plan"). */
    partnerPlan: igOn ? partner.toLowerCase() : partner,
    /** The partnerships plan's name as a label. */
    partnerLabel: partner,
    /** Which plan card carries the "recommended" tag, and what the tag says. */
    featured: (igOn ? { tier: "duo", tag: "Most creators" } : { tier: "solo", tag: "Start here" }) as { tier: Tier; tag: string },
    /** The account line on a plan card. */
    accountLine: (tier: Tier) => (igOn ? (tier === "solo" ? "One TikTok or Instagram account" : "Your TikTok and your Instagram") : "Your TikTok account"),
  };
}

/** "$19 a month or $190 a year for Maya, or …": every offered plan, from billing/tiers, so the terms always match what's sold. */
export function paymentLine(igOn: boolean = instagramOn()): string {
  const parts = offeredTiers(igOn).map((t) => {
    const label = tierCopy(t, igOn).label;
    return `${price(TIERS[t].priceUsd)} a month or ${price(TIERS[t].annualUsd)} a year for ${igOn ? label.toLowerCase() : label}`;
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, or ${parts[parts.length - 1]}` : parts[0];
}
