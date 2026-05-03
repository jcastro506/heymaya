/**
 * `makeBusiness(seed, idx)` — top-level fixture factory.
 *
 * Produces a fully-realized `FixtureBusiness` with the (service-type, size-
 * bracket, persona-variant) deterministic combo for the given index. Index
 * 0..49 maps onto the 10×5 grid; the ICP variant within each cell is chosen
 * deterministically from `idx` so re-runs are byte-identical.
 *
 * Other factories (reviews/jobs/voice/contract) are called from inside
 * here so the entire fixture's RNG tree is rooted at this function.
 */

import type { FixtureBusiness, FixtureGbpProfile } from "../types";
import {
  CITIES,
  CUSTOMER_FIRST_NAMES,
  CUSTOMER_LAST_NAMES,
  SERVICE_TYPES,
  SERVICE_TYPE_WORDS,
  SIZE_BRACKETS,
  SIZE_TRUCK_COUNT,
  STREET_NAMES,
  STREET_TYPES,
  SURNAMES,
  TICKET_BANDS,
  type CityFixture,
  type ServiceType,
  type SizeBracket,
} from "./data";
import { makeReviews } from "./reviews";
import { makeServiceJobs, makeCustomers } from "./jobs";
import { makeBrandVoiceSamples } from "./voice";
import { makeVendorContract } from "./contract";
import { makePhotos } from "./photos";
import { makeRng, type Rng } from "./rng";

const NOW = 1_700_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_YEAR = 365 * ONE_DAY;

/**
 * Map (size, ticket band) → bucket. Each fixture's bucket choice biases by
 * service type + crew size for realism (a roofer's average ticket is much
 * higher than a maid service).
 */
function bucketTicket(serviceType: ServiceType): FixtureBusiness["ticketSizeBucket"] {
  const [low, high] = TICKET_BANDS[serviceType];
  const median = (low + high) / 2;
  if (median < 200) return "under-200";
  if (median < 500) return "200-500";
  if (median < 2000) return "500-2k";
  if (median < 10000) return "2k-10k";
  return "over-10k";
}

function pickPlan(
  size: SizeBracket,
  rng: Rng
): "starter" | "pro" | "studio" {
  // Solo/small ops cluster on Starter; mid-size on Pro; multi-truck on Studio.
  // Some operators pay up — chance of upgrading by one tier — for ICP variant.
  const base: Record<SizeBracket, "starter" | "pro" | "studio"> = {
    solo: "starter",
    "2-5": "pro",
    "6-15": "pro",
    "16-50": "studio",
    "50-plus": "studio",
  };
  const baseTier = base[size];
  // ICP variant: ~25% of mid-bracket fixtures upgrade one tier
  if (baseTier === "pro" && rng.chance(0.3)) return "studio";
  if (baseTier === "starter" && rng.chance(0.2)) return "pro";
  return baseTier;
}

function makeAddress(rng: Rng, city: CityFixture): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  const num = rng.int(100, 9899);
  const name = rng.pick(STREET_NAMES);
  const type = rng.pick(STREET_TYPES);
  return {
    street: `${num} ${name} ${type}`,
    city: city.city,
    state: city.state,
    zip: rng.pick(city.zips),
  };
}

function timezoneForState(state: string): string {
  const tz: Record<string, string> = {
    IL: "America/Chicago",
    TX: "America/Chicago",
    AZ: "America/Phoenix",
    ID: "America/Boise",
    MT: "America/Denver",
    NC: "America/New_York",
    IA: "America/Chicago",
  };
  return tz[state] ?? "America/Chicago";
}

function pickServiceTypeForIdx(idx: number): ServiceType {
  return SERVICE_TYPES[idx % SERVICE_TYPES.length];
}

function pickSizeBracketForIdx(idx: number): SizeBracket {
  return SIZE_BRACKETS[Math.floor(idx / SERVICE_TYPES.length) % SIZE_BRACKETS.length];
}

function pickCity(rng: Rng, idx: number): CityFixture {
  // Spread across the city pool — every fixture gets a different (idx, city)
  // combination so the corpus covers urban/suburban/rural distribution.
  return CITIES[(idx * 7 + 3) % CITIES.length];
}

function makeName(
  rng: Rng,
  serviceType: ServiceType
): { name: string; surname: string } {
  const surname = rng.pick(SURNAMES);
  const word = rng.pick(SERVICE_TYPE_WORDS[serviceType]);
  return { name: `${surname} ${word}`, surname };
}

function makeGbpProfile(
  rng: Rng,
  business: { name: string; serviceType: ServiceType; size: SizeBracket; slug: string },
  city: CityFixture,
  address: { street: string; city: string; state: string; zip: string }
): FixtureGbpProfile {
  const photoSeed = (n: number) => `${business.slug}-${n}`;
  const photoCount = 8;
  const ageYears =
    business.size === "solo"
      ? rng.int(1, 4)
      : business.size === "2-5"
        ? rng.int(3, 10)
        : rng.int(6, 25);
  return {
    businessName: business.name,
    primaryCategory: primaryCategoryForServiceType(business.serviceType),
    address,
    serviceArea: {
      zips: city.zips,
      radiusMiles: city.density === "rural" ? 30 : city.density === "suburban" ? 18 : 10,
    },
    website: `https://${business.slug}.example`,
    hours: {
      mon: "08:00-17:00",
      tue: "08:00-17:00",
      wed: "08:00-17:00",
      thu: "08:00-17:00",
      fri: "08:00-17:00",
      sat: business.size === "solo" ? "08:00-12:00" : "09:00-16:00",
      sun: business.serviceType === "restoration" ? "00:00-23:59" : "closed",
    },
    claimedAt: NOW - ageYears * ONE_YEAR,
    photos: Array.from({ length: photoCount }, (_, n) =>
      `https://picsum.photos/seed/${photoSeed(n)}/1024/768`
    ),
    namedCompetitors: rng.sample(SURNAMES.filter((s) => s !== business.name.split(" ")[0]), 3).map(
      (s) => `${s} ${rng.pick(SERVICE_TYPE_WORDS[business.serviceType])}`
    ),
    topNeighborhoods: rng.sample(city.neighborhoods, 3),
    localHooks: rng.sample(city.localHooks, 2),
  };
}

function primaryCategoryForServiceType(t: ServiceType): string {
  const cat: Record<ServiceType, string> = {
    hvac: "HVAC contractor",
    plumbing: "Plumber",
    electrical: "Electrician",
    landscaping: "Landscape designer",
    cleaning: "House cleaning service",
    roofing: "Roofing contractor",
    "pest-control": "Pest control service",
    restoration: "Water damage restoration service",
    contracting: "General contractor",
    "mobile-detailing": "Mobile detailing service",
  };
  return cat[t];
}

function bucketBusinessSentiment(rng: Rng): string {
  const seeds = [
    "customers consistently praise speed-of-response and clean job sites",
    "local-market positioning is strongest on technical depth and honest pricing",
    "repeat customers anchor the book; review velocity is steady but slow",
    "highest-NPS reviews cluster on emergency-response calls",
    "reviewers reliably name technicians by name — strong crew brand",
  ];
  return rng.pick(seeds);
}

function bucketRecurringPatterns(rng: Rng, t: ServiceType): string[] {
  const map: Record<ServiceType, string[]> = {
    hvac: [
      "AC tune-ups in April-May",
      "furnace pre-winter checks October",
      "emergency same-day response 24/7",
      "duct-cleaning add-on attach rate ~40%",
    ],
    plumbing: [
      "drain-clearing accounts for ~35% of weekly volume",
      "water-heater replacement spike Nov-Dec",
      "weekend emergency premium",
      "sewer-camera diagnostic upsell ~25%",
    ],
    electrical: [
      "panel upgrades on home-sale prep",
      "EV-charger installs growing 2x YoY",
      "ceiling-fan installs cluster pre-summer",
      "service-call diagnostics fee waived if work performed",
    ],
    landscaping: [
      "weekly mow accounts April-October",
      "spring + fall cleanup bookings",
      "snow removal contracts winter",
      "irrigation activation late March",
    ],
    cleaning: [
      "biweekly recurring is bulk of book",
      "move-out deep cleans peak May-August",
      "post-construction one-time premium",
      "deep clean upsell on first visit",
    ],
    roofing: [
      "post-storm hail inspections drive quarterly spikes",
      "insurance claim coordination",
      "gutter add-on attach rate ~30%",
      "warranty registration with manufacturer",
    ],
    "pest-control": [
      "quarterly recurring service is 70% of revenue",
      "termite inspections at home-sale",
      "mosquito treatments May-September",
      "rodent exclusion winter",
    ],
    restoration: [
      "burst-pipe season Dec-Feb",
      "smoke-damage cleanups",
      "mold remediation post-water-event",
      "insurance carrier coordination",
    ],
    contracting: [
      "kitchen + bath remodels are bulk of book",
      "deck builds in spring",
      "addition framing summer",
      "punch-list close-outs end-of-quarter",
    ],
    "mobile-detailing": [
      "monthly maintenance subscription anchors recurring",
      "quarterly full details",
      "ceramic coating premium service",
      "pre-sale prep details",
    ],
  };
  return rng.sample(map[t], 3);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface BusinessOverrides {
  /** Persona anchor (mike/sarah/ed) — null for the 47 generated fixtures. */
  persona?: FixtureBusiness["persona"];
  /** Pin a specific service type — anchors override the deterministic pick. */
  serviceType?: ServiceType;
  /** Pin a specific size bracket. */
  sizeBracket?: SizeBracket;
  /** Pin a specific city. */
  cityIdx?: number;
  /** Pin the plan tier (e.g. mike forces starter regardless of size). */
  plan?: "starter" | "pro" | "studio";
  /** Override CRM connection (mike="none"; sarah="hcp"; ed="servicetitan"). */
  crmProvider?: "jobber" | "hcp" | "qbo" | "servicetitan" | "none";
  /** HCP MAX warning override — set "hcp-not-max" for sarah variant. */
  hcpWarning?: string | null;
  /** Pin gbpLocations count (Studio Ed has 4). */
  gbpLocationCount?: number;
  /** Override the surname (anchor names are pinned). */
  surname?: string;
  /** Override slug (anchors pin "mike-hansen-hvac" etc). */
  slug?: string;
  /** Override the GBP claimedAt — Mike has ~1.5 years for tested-as-new check. */
  claimedAtOffsetMs?: number;
  /** Force `voiceEnabled` (Studio default). */
  voiceEnabled?: boolean;
}

export function makeBusiness(
  rootSeed: number | string,
  idx: number,
  overrides: BusinessOverrides = {}
): FixtureBusiness {
  const baseSeed = `${rootSeed}:biz:${idx}`;
  const rng = makeRng(baseSeed);

  const serviceType = overrides.serviceType ?? pickServiceTypeForIdx(idx);
  const sizeBracket = overrides.sizeBracket ?? pickSizeBracketForIdx(idx);
  const city =
    overrides.cityIdx !== undefined
      ? CITIES[overrides.cityIdx % CITIES.length]
      : pickCity(rng, idx);
  const address = makeAddress(rng.subRng("address"), city);

  const surname = overrides.surname ?? rng.pick(SURNAMES);
  const word = rng.pick(SERVICE_TYPE_WORDS[serviceType]);
  const businessName = `${surname} ${word}`;
  const slug = overrides.slug ?? `${slugify(surname)}-${serviceType}-${idx}`;

  const plan = overrides.plan ?? pickPlan(sizeBracket, rng.subRng("plan"));
  const planTier = plan;
  const voiceEnabled =
    overrides.voiceEnabled ?? (plan === "studio" && rng.chance(0.85));

  const truckRange = SIZE_TRUCK_COUNT[sizeBracket];
  const truckCount = rng.int(truckRange[0], truckRange[1]);

  const gbpRng = rng.subRng("gbp");
  const gbp = makeGbpProfile(
    gbpRng,
    { name: businessName, serviceType, size: sizeBracket, slug },
    city,
    address
  );
  if (overrides.claimedAtOffsetMs !== undefined) {
    gbp.claimedAt = NOW - overrides.claimedAtOffsetMs;
  }

  // Generate gbpLocations rows (1 for Starter/Pro, up to 5 for Studio).
  const gbpLocationCount =
    overrides.gbpLocationCount ?? (plan === "studio" ? Math.min(rng.int(1, 4), 5) : 1);
  const gbpLocations = Array.from({ length: gbpLocationCount }, (_, i) => ({
    gbpLocationId: `loc-${slug}-${i}`,
    gbpAccountId: `acc-${slug}`,
    address:
      i === 0
        ? `${address.street}, ${city.city} ${city.state} ${address.zip}`
        : `${rng.int(100, 9899)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_TYPES)}, ${city.city} ${city.state} ${rng.pick(city.zips)}`,
    primaryCategory: primaryCategoryForServiceType(serviceType),
    verifiedAt: NOW - rng.int(180, 1500) * ONE_DAY,
    ownerEmail: `owner@${slug}.example`,
  }));

  // CRM connection — anchors override; otherwise deterministic by size.
  const crmProvider =
    overrides.crmProvider ??
    (sizeBracket === "solo"
      ? "none"
      : sizeBracket === "2-5" || sizeBracket === "6-15"
        ? rng.pick(["jobber", "hcp", "qbo"] as const)
        : rng.pick(["servicetitan", "hcp"] as const));
  const crmConnections = [
    {
      provider: crmProvider,
      planTierWarning:
        overrides.hcpWarning !== undefined
          ? overrides.hcpWarning
          : crmProvider === "hcp" && rng.chance(0.3)
            ? "hcp-not-max"
            : null,
      scopes:
        crmProvider === "none"
          ? []
          : ["read:jobs", "read:customers", "read:invoices", "webhook:job.completed"],
      lastSyncAt: crmProvider === "none" ? null : NOW - rng.int(1, 5) * ONE_DAY,
    },
  ];

  // ── Customers + jobs (jobs depend on customers) ────────────────────────
  const customers = makeCustomers(rng.subRng("customers"), {
    count: 30,
    crmConnected: crmProvider !== "none",
    slug,
    address,
  });
  const jobs = makeServiceJobs(rng.subRng("jobs"), {
    count: 30,
    serviceType,
    sizeBracket,
    customers,
    crmConnected: crmProvider !== "none",
    truckCount,
  });

  // ── Reviews ────────────────────────────────────────────────────────────
  const techNames = Array.from(new Set(jobs.map((j) => j.technicianName)));
  const reviews = makeReviews(rng.subRng("reviews"), {
    count: 50,
    serviceType,
    technicianNames: techNames,
    neighborhoods: gbp.topNeighborhoods,
    namedCompetitors: gbp.namedCompetitors,
    businessAgeMs: NOW - gbp.claimedAt,
  });

  // ── Brand-voice samples (5 per fixture) ────────────────────────────────
  const brandVoiceSamples = makeBrandVoiceSamples(rng.subRng("voice"), {
    technicianNames: techNames,
    neighborhoods: gbp.topNeighborhoods,
    serviceType,
    customers,
  });

  // ── Vendor contract w/ red flags ───────────────────────────────────────
  const vendorContract = makeVendorContract(rng.subRng("contract"), {
    operatorName: businessName,
    operatorAddress: `${address.street}, ${city.city} ${city.state} ${address.zip}`,
    serviceType,
  });

  // ── Photos (5 serviceContent rows) ─────────────────────────────────────
  const photos = makePhotos(rng.subRng("photos"), { slug, serviceType, jobs });

  const businessPicture = {
    brandVoice:
      overrides.persona === "mike"
        ? "warm-direct, low-frills, second-person, mentions techs by first name"
        : overrides.persona === "sarah"
          ? "professional-efficient, dispatch-fluent, names crew + ETA"
          : overrides.persona === "ed"
            ? "authoritative-expert, multi-location consistent, references service area + warranty terms"
            : `${rng.pick(["warm-direct", "professional-efficient", "authoritative-expert"])}, ${rng.pick(["second-person", "first-person plural"])}, names technicians`,
    customerSentiment: bucketBusinessSentiment(rng.subRng("sentiment")),
    recurringServicePatterns: bucketRecurringPatterns(rng.subRng("patterns"), serviceType),
    localCompetitors: gbp.namedCompetitors,
    summary: `${businessName} — ${serviceType} operator in ${city.city}, ${city.state} (${city.density}). ${truckCount}-truck team, ${plan} tier. ${reviews.length} reviews on file (avg ${(
      reviews.reduce((s, r) => s + r.starRating, 0) / reviews.length
    ).toFixed(2)} stars). Strongest hooks: ${gbp.localHooks.join("; ")}.`,
  };

  return {
    slug,
    persona: overrides.persona ?? null,
    serviceType,
    sizeBracket,
    summary: `${businessName} (${city.city} ${city.state}, ${sizeBracket}, ${plan}, CRM=${crmProvider})`,

    clerkUserId: `clerk-${slug}`,
    email: `owner@${slug}.example`,
    channelPreference:
      overrides.persona === "ed"
        ? "imessage"
        : overrides.persona === "sarah"
          ? "imessage"
          : overrides.persona === "mike"
            ? "imessage"
            : rng.pick(["imessage", "whatsapp", "sms"] as const),
    timezone: timezoneForState(city.state),
    plan,

    businessName,
    serviceTypes: [serviceType],
    serviceAreaPolygon: {
      zips: city.zips,
      centroid: [
        // Synthetic but stable lon/lat — picked from rng so deterministic.
        Math.round((-100 + rng.int(0, 35)) * 1000) / 1000,
        Math.round((30 + rng.int(0, 12)) * 1000) / 1000,
      ],
    },
    ticketSizeBucket: bucketTicket(serviceType),
    businessSize: sizeBracket,
    tonePreference:
      overrides.persona === "mike"
        ? "friendly-neighborhood"
        : overrides.persona === "sarah"
          ? "professional-efficient"
          : overrides.persona === "ed"
            ? "authoritative-expert"
            : rng.pick([
                "friendly-neighborhood",
                "professional-efficient",
                "authoritative-expert",
              ] as const),
    responseSpeed:
      overrides.persona === "mike"
        ? "within-30-min"
        : overrides.persona === "sarah"
          ? "within-5-min"
          : overrides.persona === "ed"
            ? "instant"
            : rng.pick(["instant", "within-5-min", "within-30-min"] as const),
    voiceEnabled,
    twilioNumber: voiceEnabled
      ? `+1555${rng.int(1000000, 9999999).toString().padStart(7, "0")}`
      : undefined,
    planTier,
    trialEndsAt: undefined,

    businessPicture,
    gbp,
    gbpLocations,
    crmConnections,
    customers,
    jobs,
    reviews,
    brandVoiceSamples,
    vendorContract,
    photos,

    meta: {
      rootSeed,
      idx,
      generatedAt: NOW,
    },
  };
}
