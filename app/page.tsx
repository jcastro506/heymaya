import type { Metadata } from "next";
import CreatorLanding from "./creators/page";

/**
 * Home (`/`). The creator product is the single public surface.
 *
 * The service-business (trades) product was discontinued (2026-05-18) —
 * Google Business Profile API access was an unworkable dependency. `/`
 * renders the creator landing unconditionally. The trades landing at
 * `/business` redirects here; service-business Convex tables/functions
 * remain in the codebase (hidden, not deleted) but have no public surface.
 *
 * A second vertical ("For VibeCoders") is in planning and will ship as its
 * own route + nav tab when ready — it is NOT this page.
 */
export const metadata: Metadata = {
  title: "HeyMaya — your social media manager, in your messages",
  description:
    "Maya decides what to post, when to make it, what deserves follow-up, and the next move — so you can focus on creating. Lives in your iMessages.",
};

export default function Home() {
  return <CreatorLanding />;
}
