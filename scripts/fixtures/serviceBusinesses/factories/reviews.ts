/**
 * `makeReviews(count)` — review-corpus factory.
 *
 * Star distribution skewed realistically per § 13 Sprint 1 spec:
 *   ~70% 5-star, ~15% 4-star, ~10% 3-star, ~5% 1-2 star.
 * Prose is template-based with substitution slots for technician name,
 * neighborhood, named competitor — these slots are populated from the
 * business's crew + neighborhoods + namedCompetitors so reviewer→job
 * matching tests have something coherent to grip on.
 *
 * Reviewer names are sampled from `CUSTOMER_FIRST_NAMES` + an initial — at
 * least 50% must be unique within a fixture (per the realism check in
 * `serviceFixtures.test.ts`).
 */

import type { FixtureReview } from "../types";
import { CUSTOMER_FIRST_NAMES, REVIEW_PROSE, type ServiceType } from "./data";
import type { Rng } from "./rng";

const NOW = 1_700_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

interface MakeReviewsInput {
  count: number;
  serviceType: ServiceType;
  technicianNames: string[];
  neighborhoods: string[];
  namedCompetitors: string[];
  /** How long the business has been on GBP — caps how far back reviews can go. */
  businessAgeMs: number;
}

/**
 * Realistic star distribution. We sample one band per review per the
 * specified weights and then jitter within the band.
 */
function rollStars(rng: Rng): { stars: number; sentiment: FixtureReview["sentiment"] } {
  const r = rng.next();
  if (r < 0.7) return { stars: 5, sentiment: "positive" };
  if (r < 0.85) return { stars: 4, sentiment: "positive" };
  if (r < 0.95) return { stars: 3, sentiment: "neutral" };
  if (r < 0.98) return { stars: 2, sentiment: "negative" };
  return { stars: 1, sentiment: "negative" };
}

function fillTemplate(
  rng: Rng,
  template: string,
  ctx: {
    technicianNames: string[];
    neighborhoods: string[];
    namedCompetitors: string[];
  }
): { body: string; matchedTechnicianName?: string } {
  let matched: string | undefined;
  let body = template;
  if (body.includes("{tech}") && ctx.technicianNames.length > 0) {
    matched = rng.pick(ctx.technicianNames);
    body = body.replaceAll("{tech}", matched);
  }
  if (body.includes("{neighborhood}") && ctx.neighborhoods.length > 0) {
    body = body.replaceAll("{neighborhood}", rng.pick(ctx.neighborhoods));
  }
  if (body.includes("{competitor}") && ctx.namedCompetitors.length > 0) {
    body = body.replaceAll("{competitor}", rng.pick(ctx.namedCompetitors));
  }
  return { body, matchedTechnicianName: matched };
}

export function makeReviews(
  rng: Rng,
  input: MakeReviewsInput
): FixtureReview[] {
  const { count, serviceType, technicianNames, neighborhoods, namedCompetitors, businessAgeMs } =
    input;
  // Reviews distributed across the business's GBP-claimed window, cap at 18mo
  // newest + a long tail. Most reviews cluster in the last 9 months for
  // realism (review velocity rises over time).
  const oldestMs = Math.min(businessAgeMs, 18 * 30 * ONE_DAY);
  const out: FixtureReview[] = [];
  const usedReviewerKeys = new Set<string>();
  const prosePool = REVIEW_PROSE[serviceType];

  for (let i = 0; i < count; i++) {
    const { stars, sentiment } = rollStars(rng);
    const pool =
      sentiment === "positive"
        ? prosePool.positive
        : sentiment === "neutral"
          ? prosePool.mixed.length > 0
            ? prosePool.mixed
            : prosePool.positive
          : prosePool.negative.length > 0
            ? prosePool.negative
            : prosePool.mixed;
    const template = rng.pick(pool);
    const filled = fillTemplate(rng, template, {
      technicianNames,
      neighborhoods,
      namedCompetitors,
    });

    // Reviewer name — first name + last initial (so collisions allowed but
    // most are unique). 30 distinct first names + initial = 90% unique pool.
    let first = rng.pick(CUSTOMER_FIRST_NAMES);
    let initial = String.fromCharCode(65 + rng.int(0, 25));
    let key = `${first} ${initial}.`;
    let guard = 0;
    while (usedReviewerKeys.has(key) && guard < 6) {
      first = rng.pick(CUSTOMER_FIRST_NAMES);
      initial = String.fromCharCode(65 + rng.int(0, 25));
      key = `${first} ${initial}.`;
      guard++;
    }
    usedReviewerKeys.add(key);

    // Distribute receivedAt — bias newer (last 9mo gets ~60% density).
    const recencyRoll = rng.next();
    const offsetMs =
      recencyRoll < 0.6
        ? rng.int(0, 270) * ONE_DAY
        : rng.int(270, Math.max(271, oldestMs / ONE_DAY)) * ONE_DAY;
    const receivedAt = NOW - offsetMs;

    out.push({
      externalReviewId: `gbp-rev-${i}-${rng.int(100000, 999999)}`,
      platform: rng.chance(0.85) ? "gbp" : rng.chance(0.6) ? "fb" : "yelp",
      reviewerName: key,
      starRating: stars,
      body: filled.body,
      sentiment,
      receivedAt,
      matchedTechnicianName: filled.matchedTechnicianName,
    });
  }
  return out;
}
