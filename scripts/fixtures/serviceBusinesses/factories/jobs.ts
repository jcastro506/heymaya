/**
 * `makeCustomers` + `makeServiceJobs` — composable factories for the
 * customer + job rows that populate `serviceCustomers` and `serviceJobs`.
 *
 * Jobs reference customers by `customerSlug`. The loader resolves slug →
 * `Id<"serviceCustomers">` after both tables are inserted into convex-test.
 *
 * Realism budget per fixture: 30 jobs across the last 30 days, ticket sizes
 * matched to service type + crew size, technicianName from a fixed crew list
 * sized by truck count. Field-tech notes prose has texture, not lorem ipsum.
 */

import {
  CUSTOMER_FIRST_NAMES,
  CUSTOMER_LAST_NAMES,
  JOB_TYPES,
  SIZE_TRUCK_COUNT,
  TECH_FIRST_NAMES,
  TICKET_BANDS,
  type ServiceType,
  type SizeBracket,
} from "./data";
import type { FixtureCustomer, FixtureJob } from "../types";
import type { Rng } from "./rng";

const NOW = 1_700_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

interface MakeCustomersInput {
  count: number;
  crmConnected: boolean;
  slug: string;
  address: { city: string; state: string; zip: string };
}

export function makeCustomers(
  rng: Rng,
  input: MakeCustomersInput
): FixtureCustomer[] {
  const { count, crmConnected, slug, address } = input;
  const out: FixtureCustomer[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < count; i++) {
    let first = rng.pick(CUSTOMER_FIRST_NAMES);
    let last = rng.pick(CUSTOMER_LAST_NAMES);
    let key = `${first} ${last}`;
    // Force unique names — most reviewers + customers should not collide.
    let guard = 0;
    while (usedNames.has(key) && guard < 8) {
      first = rng.pick(CUSTOMER_FIRST_NAMES);
      last = rng.pick(CUSTOMER_LAST_NAMES);
      key = `${first} ${last}`;
      guard++;
    }
    usedNames.add(key);
    const customerSlug = `${slug}-cust-${i}`;
    const phone = `+1${rng.int(2000000000, 9899999999)}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@customer.example`;
    const street = `${rng.int(100, 9899)} ${rng.pick([
      "Maple",
      "Oak",
      "Cedar",
      "Pine",
      "Elm",
      "Spring",
      "Willow",
      "Highland",
    ])} ${rng.pick(["St", "Ave", "Rd", "Ln"])}`;
    const lifetimeValueUsd = rng.int(120, 18000);
    const lastJobAt = NOW - rng.int(0, 60) * ONE_DAY;
    const reviewStatus = rng.pick([
      "not-yet",
      "asked",
      "left",
      "declined",
    ] as const);
    out.push({
      slug: customerSlug,
      name: `${first} ${last}`,
      phone,
      email,
      address: `${street}, ${address.city} ${address.state} ${address.zip}`,
      lifetimeValueUsd,
      lastJobAt,
      reviewStatus,
      crmCustomerId: crmConnected ? `crm-cust-${slug}-${i}` : null,
    });
  }
  return out;
}

interface MakeJobsInput {
  count: number;
  serviceType: ServiceType;
  sizeBracket: SizeBracket;
  customers: FixtureCustomer[];
  crmConnected: boolean;
  truckCount: number;
}

export function makeServiceJobs(
  rng: Rng,
  input: MakeJobsInput
): FixtureJob[] {
  const { count, serviceType, sizeBracket, customers, crmConnected, truckCount } =
    input;
  const [tickLow, tickHigh] = TICKET_BANDS[serviceType];
  const jobTypes = JOB_TYPES[serviceType];

  // Crew size — solo has 1 named tech, multi-truck has up to truckCount uniques.
  const crewSize = Math.max(1, Math.min(truckCount, 12));
  const crew = rng.sample(TECH_FIRST_NAMES, crewSize);

  const out: FixtureJob[] = [];
  for (let i = 0; i < count; i++) {
    // Distribute across last 30 days. ~85% completed, ~10% scheduled, ~5% other.
    const dayOffset = rng.int(0, 29);
    const scheduledAt = NOW - dayOffset * ONE_DAY - rng.int(0, 9) * 60 * 60 * 1000;
    const lifecycleRoll = rng.next();
    const status: FixtureJob["status"] =
      lifecycleRoll < 0.85
        ? "completed"
        : lifecycleRoll < 0.95
          ? "scheduled"
          : lifecycleRoll < 0.98
            ? "in-progress"
            : "cancelled";
    const completedAt =
      status === "completed"
        ? scheduledAt + rng.int(30, 240) * 60 * 1000
        : undefined;
    const customer = rng.pick(customers);
    const tech = rng.pick(crew);
    const jobType = rng.pick(jobTypes);
    const ticketAmountUsd =
      status === "cancelled"
        ? 0
        : Math.round((rng.int(tickLow, tickHigh) / 5) * 5);
    const notes = makeJobNotes(rng, jobType, tech, customer.name.split(" ")[1]);
    out.push({
      customerSlug: customer.slug,
      crmJobId: crmConnected ? `crm-job-${i}-${rng.int(10000, 99999)}` : null,
      status,
      scheduledAt,
      completedAt,
      technicianName: tech,
      serviceType: jobType,
      ticketAmountUsd,
      notes,
    });
  }
  return out;
}

function makeJobNotes(
  rng: Rng,
  jobType: string,
  tech: string,
  customerLastName: string
): string {
  const templates = [
    `Arrived 8:15a, ${jobType}. ${customerLastName} home. Walked the work, gave estimate $X. Approved. Completed in 2.5h. Customer happy. Asked for a review on the way out.`,
    `${tech} on site. ${jobType} per ticket. Found additional issue with [supply line / capacitor / breaker / shutoff valve]. Discussed w/ ${customerLastName}, recommended fix, declined for now. Scheduled followup.`,
    `Quick ${jobType}. ${customerLastName} property. In and out in under an hour. Took before/after photos. Customer mentioned referring neighbor.`,
    `Tougher ${jobType} than expected. Tight access. Took ${tech} 4h. ${customerLastName} cooperative. Wrote up a thorough invoice.`,
    `Routine ${jobType}. Standard parts, standard time. ${tech} efficient. ${customerLastName} paid cash, declined receipt.`,
    `Emergency call. ${jobType}. Got there in 90m. Stabilized issue. Coming back tomorrow with the right part. ${customerLastName} understanding.`,
  ];
  return rng.pick(templates);
}
