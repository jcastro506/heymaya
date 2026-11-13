/**
 * The website's words about what Maya works with: TikTok only (2026-11-13). One place, so the landing, the page
 * metadata, the pricing cards and the legal pages never disagree.
 */
import { TIERS, offeredTiers, price, tierCopy, type Tier } from "../../convex/billing/tiers";

export function platformCopy() {
  const partner = tierCopy("partner").label;
  return {
    platforms: "TikTok",
    siteDescription: "A content assistant for TikTok creators.",
    /** The headline's first half; the second half is "in your texts." */
    headline: "Your TikTok assistant,",
    lede: "Maya helps you decide what to make, plan when to film it, and keep posting every week.",
    eyebrow: "For TikTok creators",
    whereYouPost: "Your TikTok, and a few creators you love.",
    whatSheSees: "Your public posts from the start. Connect your TikTok in the app and she can read more, like followers over time. TikTok doesn't share watch time, so she says so instead of guessing. She never makes up a number.",
    /** The partnerships plan's name, in a sentence or as a label. */
    partnerPlan: partner,
    partnerLabel: partner,
    /** Which plan card carries the "recommended" tag, and what the tag says. */
    featured: { tier: "solo", tag: "Start here" } as { tier: Tier; tag: string },
    /** The account line on a plan card. */
    accountLine: (_tier: Tier) => "Your TikTok account",
  };
}

/** "$19 a month or $190 a year for Maya, or …": every offered plan, from billing/tiers, so the terms always match what's sold. */
export function paymentLine(): string {
  const parts = offeredTiers().map((t) => `${price(TIERS[t].priceUsd)} a month or ${price(TIERS[t].annualUsd)} a year for ${tierCopy(t).label}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, or ${parts[parts.length - 1]}` : parts[0];
}
