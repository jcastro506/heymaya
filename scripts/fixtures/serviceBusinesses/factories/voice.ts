/**
 * `makeBrandVoiceSamples` — 5 samples per fixture (3 review-replies + 2
 * GBP captions). These are the operator's OWN past writing — not Maya
 * output — used as input to the businessPicture synthesizer.
 *
 * Each sample uses tone-flavored substitution so the voice signal across
 * 5 samples varies enough for synthesis tests to extract a coherent voice.
 */

import {
  BRAND_VOICE_TEMPLATES,
  CUSTOMER_FIRST_NAMES,
  JOB_TYPES,
  type ServiceType,
} from "./data";
import type { FixtureBrandVoiceSample, FixtureCustomer } from "../types";
import type { Rng } from "./rng";

const NOW = 1_700_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

interface MakeBrandVoiceInput {
  technicianNames: string[];
  neighborhoods: string[];
  serviceType: ServiceType;
  customers: FixtureCustomer[];
}

export function makeBrandVoiceSamples(
  rng: Rng,
  input: MakeBrandVoiceInput
): FixtureBrandVoiceSample[] {
  const { technicianNames, neighborhoods, serviceType, customers } = input;
  const out: FixtureBrandVoiceSample[] = [];

  // 3 review replies
  for (let i = 0; i < 3; i++) {
    const tpl = rng.pick(BRAND_VOICE_TEMPLATES.reviewReply);
    const body = tpl
      .replaceAll(
        "{customer}",
        rng.pick(customers).name.split(" ")[0] || rng.pick(CUSTOMER_FIRST_NAMES)
      )
      .replaceAll(
        "{tech}",
        technicianNames.length > 0
          ? rng.pick(technicianNames)
          : "the team"
      )
      .replaceAll(
        "{neighborhood}",
        neighborhoods.length > 0
          ? rng.pick(neighborhoods)
          : "your neighborhood"
      );
    out.push({
      kind: "review-reply",
      body,
      writtenAt: NOW - rng.int(7, 90) * ONE_DAY,
    });
  }

  // 2 GBP captions
  for (let i = 0; i < 2; i++) {
    const tpl = rng.pick(BRAND_VOICE_TEMPLATES.gbpCaption);
    const customer = rng.pick(customers);
    const body = tpl
      .replaceAll("{customer}", customer.name.split(" ")[1] ?? "Smith")
      .replaceAll(
        "{tech}",
        technicianNames.length > 0
          ? rng.pick(technicianNames)
          : "the team"
      )
      .replaceAll(
        "{neighborhood}",
        neighborhoods.length > 0
          ? rng.pick(neighborhoods)
          : "the neighborhood"
      )
      .replaceAll("{jobType}", rng.pick(JOB_TYPES[serviceType]));
    out.push({
      kind: "gbp-caption",
      body,
      writtenAt: NOW - rng.int(3, 60) * ONE_DAY,
    });
  }

  return out;
}
