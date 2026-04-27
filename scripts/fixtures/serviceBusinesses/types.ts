/**
 * Fixture-corpus types — the on-disk JSON shape + the in-memory shape
 * `seedServiceBusinesses` uses to load convex-test.
 *
 * These types are INTENTIONALLY decoupled from `convex/_generated/dataModel`
 * Doc<"businesses"> shapes — fixture rows have no `_id` / `_creationTime`
 * (those get assigned by convex-test on insert). All other fields match the
 * schema field-for-field so the loader can hand the row straight to
 * `ctx.db.insert("businesses", row)` without massaging.
 */

import type { ServiceType, SizeBracket } from "./factories/data";

export type Persona = "mike" | "sarah" | "ed";

export interface FixtureGbpProfile {
  businessName: string;
  primaryCategory: string;
  /** Single street address for headquarters / primary location. */
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  serviceArea: {
    /** ZIPs the operator services. Polygon centroid is the headquarters ZIP. */
    zips: string[];
    /** Approximate radius miles from headquarters — for geocoder fallback. */
    radiusMiles: number;
  };
  website: string;
  hours: Record<string, string>;
  claimedAt: number;
  /** Stable picsum.photos seeds — clearly fixture URLs. */
  photos: string[];
  /** Operator-provided named local competitors per § 5 Q9. */
  namedCompetitors: string[];
  /** Operator-provided neighborhoods Q10. */
  topNeighborhoods: string[];
  /** Operator-provided local hooks Q11. */
  localHooks: string[];
}

export interface FixtureReview {
  externalReviewId: string;
  platform: "gbp" | "fb" | "yelp";
  reviewerName: string;
  starRating: number;
  body: string;
  /** Sentiment label derived from star rating at generation time. */
  sentiment: "positive" | "neutral" | "negative";
  receivedAt: number;
  /**
   * Optional named-job context — when set, the review prose mentions a
   * technician + service that maps to a real serviceJob in the same fixture.
   * Powers the customer-matched-job-id test in Sprint 3.
   */
  matchedTechnicianName?: string;
}

export interface FixtureCustomer {
  /** Stable per-business customer slug (used to wire jobs/reviewRequests). */
  slug: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  lifetimeValueUsd: number;
  lastJobAt: number;
  reviewStatus: "not-yet" | "asked" | "left" | "declined";
  /** True for fixtures with a CRM connection — null otherwise (Mike). */
  crmCustomerId: string | null;
}

export interface FixtureJob {
  customerSlug: string;
  /** CRM-linked job id; null for no-CRM fixtures (Mike — NER-extracted in prod). */
  crmJobId: string | null;
  status: "scheduled" | "in-progress" | "completed" | "cancelled";
  scheduledAt: number;
  completedAt?: number;
  technicianName: string;
  serviceType: string;
  ticketAmountUsd: number;
  notes: string;
}

export interface FixtureBrandVoiceSample {
  kind: "review-reply" | "gbp-caption";
  body: string;
  /** Date the operator wrote this — distributed across past 90d. */
  writtenAt: number;
}

export interface FixtureVendorContract {
  /** Filename in scripts/fixtures/serviceBusinesses/data/<slug>/contract.md. */
  filename: string;
  vendorName: string;
  /** Markdown body — the contract-redflag skill in Sprint 3 reads this. */
  body: string;
  /** Red-flag ids that ARE embedded — the skill must detect at least these. */
  embeddedRedFlags: readonly string[];
}

export interface FixturePhoto {
  /** Stable picsum URL — `https://picsum.photos/seed/<slug>-<n>/<w>/<h>`. */
  url: string;
  caption: string;
  /** Optional reference to the job the photo came from. */
  jobIdx?: number;
  tags: string[];
}

/** A fixture business — fully realized, ready to load into convex-test. */
export interface FixtureBusiness {
  /** Stable slug (kebab-case). Used in JSON filenames + customer slugs. */
  slug: string;
  /** "mike" / "sarah" / "ed" — null for the 47 generated non-anchor fixtures. */
  persona: Persona | null;
  serviceType: ServiceType;
  sizeBracket: SizeBracket;
  /** A small denormalized summary string for sanity checks + diff readability. */
  summary: string;

  // ── Account-level (creators table) ──────────────────────────────────────
  clerkUserId: string;
  email: string;
  channelPreference: "imessage" | "whatsapp" | "sms" | "web";
  timezone: string;
  plan: "starter" | "pro" | "studio";

  // ── Business-level (businesses table) ───────────────────────────────────
  businessName: string;
  serviceTypes: string[];
  serviceAreaPolygon: { zips: string[]; centroid: [number, number] };
  ticketSizeBucket:
    | "under-200"
    | "200-500"
    | "500-2k"
    | "2k-10k"
    | "over-10k";
  businessSize: SizeBracket;
  tonePreference:
    | "friendly-neighborhood"
    | "professional-efficient"
    | "authoritative-expert";
  responseSpeed: "instant" | "within-5-min" | "within-30-min";
  voiceEnabled: boolean;
  twilioNumber?: string;
  planTier: "starter" | "pro" | "studio";
  trialEndsAt?: number;

  // ── businessPicture (one row, generated for every fixture) ──────────────
  businessPicture: {
    brandVoice: string;
    customerSentiment: string;
    recurringServicePatterns: string[];
    localCompetitors: string[];
    /** "good enough first picture" prose summary. */
    summary: string;
  };

  // ── GBP layer ───────────────────────────────────────────────────────────
  gbp: FixtureGbpProfile;
  /** Up to 5 GBP locations (Studio only — most fixtures have 1). */
  gbpLocations: Array<{
    gbpLocationId: string;
    gbpAccountId: string;
    address: string;
    primaryCategory: string;
    verifiedAt: number;
    ownerEmail: string;
  }>;

  // ── CRM ─────────────────────────────────────────────────────────────────
  crmConnections: Array<{
    provider: "jobber" | "hcp" | "qbo" | "servicetitan" | "none";
    /** "hcp-not-max" → polling fallback per § 5 step 5. */
    planTierWarning: string | null;
    scopes: string[];
    lastSyncAt: number | null;
  }>;

  // ── Customers + jobs + reviews + brand voice ────────────────────────────
  customers: FixtureCustomer[];
  jobs: FixtureJob[];
  reviews: FixtureReview[];
  brandVoiceSamples: FixtureBrandVoiceSample[];
  vendorContract: FixtureVendorContract;
  photos: FixturePhoto[];

  // ── Provenance metadata ─────────────────────────────────────────────────
  meta: {
    /** Root seed used to generate this fixture. */
    rootSeed: number | string;
    /** Fixture index (0-49). */
    idx: number;
    /** Timestamp the fixture was generated. */
    generatedAt: number;
  };
}
