import type { Metadata } from "next";
import BusinessHome from "./business/page";
import CreatorLanding from "./creators/page";

/**
 * Home (`/`). Conditional, single-source-of-truth front door:
 *
 *   - NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT !== "true" (v0 default):
 *       renders the service-business landing in-place. No redirect hop.
 *       CLAUDE.md prescribes this; previously a middleware 308 took
 *       /` → /business, but the redirect is now unnecessary because
 *       the home page IS the business landing.
 *
 *   - NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT === "true":
 *       renders the creator landing. `/business` continues to serve the
 *       business landing directly for visitors who want the trades pitch.
 *
 * The earlier Sprint 12.4 "split-router" hero ("Your manager before you
 * have one") read as a generic stub between two real product landings —
 * killed. The MarketingNav already exposes the cross-product choice, so
 * the picker surface lives in the nav, not a dedicated screen.
 */
const CREATOR_PRODUCT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT === "true";

export const metadata: Metadata = CREATOR_PRODUCT_ENABLED
  ? {
      title: "HeyMaya — your AI manager in messages",
      description:
        "Maya helps creators decide what to post, when to make it, what deserves follow-up, and what the next move should be.",
    }
  : {
      title: "HeyMaya — your AI marketing manager for the trades",
      description:
        "Maya turns every completed job into local marketing. Drafts review requests, GBP posts, and replies in your voice. You approve, she sends.",
    };

export default function Home() {
  return CREATOR_PRODUCT_ENABLED ? <CreatorLanding /> : <BusinessHome />;
}
