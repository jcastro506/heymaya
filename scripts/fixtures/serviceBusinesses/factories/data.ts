/**
 * Static name + prose pools used by the deterministic factories.
 *
 * Why these live in a separate file: keeping the prose pools out of the
 * factory logic makes the factories trivially auditable + lets us tune
 * realism by editing data here without touching generation algorithms.
 *
 * All names are SYNTHETIC — chosen to be obviously fictional (no real
 * living people, no famous brands). City + state pairs ARE real US
 * municipalities so geocoding-driven tests have something coherent.
 */

export const SERVICE_TYPES = [
  "hvac",
  "plumbing",
  "electrical",
  "landscaping",
  "cleaning",
  "roofing",
  "pest-control",
  "restoration",
  "contracting",
  "mobile-detailing",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SIZE_BRACKETS = [
  "solo",
  "2-5",
  "6-15",
  "16-50",
  "50-plus",
] as const;
export type SizeBracket = (typeof SIZE_BRACKETS)[number];

/** Crew size bucket → numeric truck count for ticket / job realism. */
export const SIZE_TRUCK_COUNT: Record<SizeBracket, [number, number]> = {
  solo: [1, 1],
  "2-5": [2, 5],
  "6-15": [6, 15],
  "16-50": [16, 50],
  "50-plus": [50, 80],
};

/** Per-service-type ticket size band ($) — used for serviceJobs ticketAmountUsd. */
export const TICKET_BANDS: Record<ServiceType, [number, number]> = {
  hvac: [180, 8500],
  plumbing: [120, 4200],
  electrical: [150, 5500],
  landscaping: [80, 2800],
  cleaning: [80, 600],
  roofing: [800, 28000],
  "pest-control": [110, 480],
  restoration: [1500, 35000],
  contracting: [2000, 60000],
  "mobile-detailing": [60, 320],
} as const;

/** Synthetic founder/owner surnames (obviously fictional, varied origin). */
export const SURNAMES = [
  "Hansen",
  "Ridgeway",
  "Capital",
  "Brookline",
  "Ironside",
  "Westvale",
  "Northgate",
  "Cypress",
  "Sandstone",
  "Grayson",
  "Quincy",
  "Holloway",
  "Tradewind",
  "Beaumont",
  "Linwood",
  "Marigold",
  "Ashbury",
  "Clearwater",
  "Stonebridge",
  "Maplewood",
  "Pine Ridge",
  "Silvercrest",
  "Riverbend",
  "Foxglove",
  "Ironwood",
  "Birchgrove",
  "Highland",
  "Thornton",
  "Whitmore",
  "Vanderloo",
  "Castillo",
  "Okafor",
  "Nakamura",
  "Petrov",
  "DiSalvo",
  "Henriksen",
  "Marwick",
  "Eldridge",
  "Pemberton",
  "Caldwell",
] as const;

/** Service-type display word for naming. */
export const SERVICE_TYPE_WORDS: Record<ServiceType, string[]> = {
  hvac: ["HVAC", "Heating & Cooling", "Climate Solutions", "Air"],
  plumbing: ["Plumbing", "Plumbing & Drain", "Plumbing Services"],
  electrical: ["Electric", "Electrical", "Electric & Lighting"],
  landscaping: ["Landscaping", "Lawn & Landscape", "Outdoor Services"],
  cleaning: ["Cleaning Services", "Cleaners", "Maids & More"],
  roofing: ["Roofing", "Roof & Gutter", "Roofing Co"],
  "pest-control": ["Pest Control", "Pest Solutions", "Exterminators"],
  restoration: [
    "Restoration",
    "Water Damage & Restoration",
    "Disaster Restoration",
  ],
  contracting: ["Construction", "Remodeling", "Builders", "Contractors"],
  "mobile-detailing": [
    "Mobile Detailing",
    "Auto Detail",
    "Mobile Auto Spa",
  ],
};

/**
 * Real US cities w/ realistic ZIPs + neighborhood pools — varied across
 * urban / suburban / rural to cover local-positioning testing.
 */
export interface CityFixture {
  city: string;
  state: string;
  /** Plausible 5-digit ZIPs in this metro. */
  zips: string[];
  /** Named neighborhoods / districts for review prose + Q10/Q11. */
  neighborhoods: string[];
  /** Local hooks per § 5 Q11 — real seasonal/sports/civic touchstones. */
  localHooks: string[];
  density: "urban" | "suburban" | "rural";
}

export const CITIES: CityFixture[] = [
  {
    city: "Chicago",
    state: "IL",
    zips: ["60614", "60657", "60622", "60618", "60607"],
    neighborhoods: ["Lincoln Park", "Lakeview", "Wicker Park", "West Loop", "Logan Square"],
    localHooks: [
      "polar vortex week",
      "Cubs home opener",
      "Taste of Chicago",
      "lakefront freeze",
    ],
    density: "urban",
  },
  {
    city: "Austin",
    state: "TX",
    zips: ["78704", "78745", "78751", "78702", "78703"],
    neighborhoods: ["South Congress", "Zilker", "Hyde Park", "East Austin", "Travis Heights"],
    localHooks: [
      "ACL weekend",
      "SXSW crowd",
      "100-degree streak",
      "barton springs season",
    ],
    density: "urban",
  },
  {
    city: "Phoenix",
    state: "AZ",
    zips: ["85016", "85032", "85020", "85044", "85254"],
    neighborhoods: ["Arcadia", "Biltmore", "Ahwatukee", "North Phoenix", "Paradise Valley"],
    localHooks: [
      "monsoon prep",
      "haboob season",
      "AC pre-summer rush",
      "Cactus League opening",
    ],
    density: "urban",
  },
  {
    city: "Naperville",
    state: "IL",
    zips: ["60540", "60563", "60564"],
    neighborhoods: ["Downtown Naperville", "Saybrook", "Tall Grass", "Knoch Knolls"],
    localHooks: [
      "Ribfest weekend",
      "first frost",
      "Last Fling Labor Day",
      "Riverwalk Fine Art Fair",
    ],
    density: "suburban",
  },
  {
    city: "Round Rock",
    state: "TX",
    zips: ["78664", "78665", "78681"],
    neighborhoods: ["Forest Creek", "Old Town", "Teravista", "Brushy Creek"],
    localHooks: [
      "Express opening day",
      "back-to-school rush",
      "Frontier Days",
      "summer heat dome",
    ],
    density: "suburban",
  },
  {
    city: "Mesa",
    state: "AZ",
    zips: ["85201", "85209", "85213"],
    neighborhoods: ["Eastmark", "Las Sendas", "Downtown Mesa", "Red Mountain Ranch"],
    localHooks: [
      "Cactus League",
      "spring training crowd",
      "monsoon storm",
      "Mesa Music Festival",
    ],
    density: "suburban",
  },
  {
    city: "Boise",
    state: "ID",
    zips: ["83702", "83706", "83709", "83704"],
    neighborhoods: ["North End", "Boise Bench", "Hyde Park", "Harris Ranch"],
    localHooks: [
      "Boise State football season",
      "first hard freeze",
      "Treefort weekend",
      "Western Idaho Fair",
    ],
    density: "suburban",
  },
  {
    city: "Bozeman",
    state: "MT",
    zips: ["59715", "59718"],
    neighborhoods: ["Downtown Bozeman", "Valley West", "Bridger Foothills"],
    localHooks: [
      "MSU move-in weekend",
      "first big snow",
      "Sweet Pea Festival",
      "elk hunting opener",
    ],
    density: "rural",
  },
  {
    city: "Asheville",
    state: "NC",
    zips: ["28801", "28804", "28806", "28803"],
    neighborhoods: ["West Asheville", "Montford", "Biltmore Forest", "River Arts District"],
    localHooks: [
      "Bele Chere week",
      "leaf-peeping season",
      "ice storm warnings",
      "BMW Charity Pro-Am",
    ],
    density: "suburban",
  },
  {
    city: "Cedar Rapids",
    state: "IA",
    zips: ["52402", "52404", "52403"],
    neighborhoods: ["Czech Village", "Wellington Heights", "Marion border", "NewBo"],
    localHooks: [
      "post-derecho cleanup",
      "Freedom Festival",
      "Hawkeye game day",
      "first deep freeze",
    ],
    density: "rural",
  },
] as const;

/** Street name fragments for synthetic addresses. */
export const STREET_NAMES = [
  "Maple",
  "Oak",
  "Cedar",
  "Pine",
  "Elm",
  "Birch",
  "Willow",
  "Ridge",
  "Hilltop",
  "Sunset",
  "Lakeview",
  "Spring",
  "River",
  "Valley",
  "Highland",
  "Park",
  "Forest",
  "Grove",
  "Cypress",
  "Chestnut",
  "Linden",
  "Magnolia",
  "Sycamore",
  "Walnut",
  "Hickory",
] as const;

export const STREET_TYPES = [
  "St",
  "Ave",
  "Rd",
  "Ln",
  "Dr",
  "Way",
  "Ct",
  "Blvd",
  "Pl",
] as const;

/** Synthetic technician first names — varied origin, obviously fictional. */
export const TECH_FIRST_NAMES = [
  "Eddie",
  "Marcus",
  "Diego",
  "Ana",
  "Priya",
  "Tyler",
  "Sarai",
  "Jamal",
  "Wei",
  "Owen",
  "Ravi",
  "Dani",
  "Caleb",
  "Mei",
  "Hank",
  "Jonas",
  "Lana",
  "Amir",
  "Reyna",
  "Brock",
  "Niko",
  "Tasha",
  "Felix",
  "Quinn",
  "Yara",
  "Chase",
  "Ines",
  "Otis",
  "Naya",
  "Trevor",
] as const;

/** Synthetic customer first names. */
export const CUSTOMER_FIRST_NAMES = [
  "Sarah",
  "Michael",
  "Jennifer",
  "David",
  "Lisa",
  "Carlos",
  "Aisha",
  "Robert",
  "Jessica",
  "Brian",
  "Karen",
  "Marcus",
  "Maria",
  "James",
  "Emily",
  "Hassan",
  "Linda",
  "Daniel",
  "Patricia",
  "Sofia",
  "Mark",
  "Christine",
  "Kevin",
  "Donna",
  "Tomas",
  "Elena",
  "Roy",
  "Margaret",
  "Andre",
  "Beverly",
  "Ian",
  "Tanya",
  "Glenn",
  "Pia",
  "Ross",
  "Yolanda",
  "Curtis",
  "Megan",
  "Olu",
  "Heather",
  "Wesley",
  "Cassandra",
  "Eli",
  "Jasmine",
  "Devin",
] as const;

/** Synthetic customer surnames (different pool from SURNAMES to avoid collision). */
export const CUSTOMER_LAST_NAMES = [
  "Johnson",
  "Williams",
  "Brown",
  "Davis",
  "Miller",
  "Wilson",
  "Moore",
  "Taylor",
  "Anderson",
  "Thomas",
  "Jackson",
  "White",
  "Harris",
  "Martin",
  "Garcia",
  "Robinson",
  "Clark",
  "Rodriguez",
  "Lewis",
  "Lee",
  "Walker",
  "Hall",
  "Allen",
  "Young",
  "Wright",
  "Scott",
  "Torres",
  "Nguyen",
  "Hill",
  "Adams",
  "Baker",
  "Gonzalez",
  "Nelson",
  "Carter",
  "Mitchell",
  "Roberts",
  "Phillips",
  "Campbell",
  "Parker",
  "Evans",
  "Edwards",
  "Collins",
  "Stewart",
  "Morris",
  "Murphy",
] as const;

/**
 * Service-type-keyed review prose templates. Each template uses
 * `{tech}`, `{neighborhood}`, `{landmark}`, `{competitor}` placeholders that
 * the factory substitutes. Prose is kept 30-200 words; star bucketing
 * applied at the factory layer (positive prose for 4-5 star, mixed for 3,
 * negative prose for 1-2). Some templates intentionally mention competitors
 * for behavior #13 competitor-watcher tests.
 */
export const REVIEW_PROSE: Record<
  ServiceType,
  { positive: string[]; mixed: string[]; negative: string[] }
> = {
  hvac: {
    positive: [
      "{tech} came out for our AC tune-up before the heat wave hit and was honestly the best service tech we have had in years. He explained what he was checking, showed me the capacitor reading, and didn't try to upsell. Our place near {neighborhood} stayed at 72 all summer. Already booked the fall furnace check.",
      "We had a complete furnace failure on a Sunday night. {tech} was at the house in two hours. He had the part in the truck and we had heat by 11pm. Could not be happier. Way better than {competitor} who told us 4 days.",
      "Clean techs, clean trucks, clean job. {tech} put down floor protection without me asking and even vacuumed the closet where the air handler lives. Pricing matched the estimate to the dollar.",
      "Booked the AC tune-up special and was honestly skeptical it would be a real tune-up at that price. It was a real tune-up. {tech} spent 90 minutes, cleaned the coils, checked refrigerant pressure, and texted me a photo of the contactor before replacing it.",
      "Our heat pump has been on its last legs for 3 winters. {tech} talked us through replacement options including a high-efficiency option with a rebate I had not heard about. No pressure, just numbers. Install crew was at the house at 7am sharp.",
    ],
    mixed: [
      "Service was fine — {tech} fixed the issue but the dispatch window was 8am to 12pm and they showed up at 1:30. Office did call. Repair itself was quick once they were here.",
      "Got the job done but the quote on the phone was about $200 lower than the final bill. They explained the difference (extra refrigerant) but it would have been nice to know upfront.",
    ],
    negative: [
      "Three visits, three different diagnoses. First {tech} said capacitor, second said compressor, third said leak in the line. Charged me for all three diagnostic fees. Will not be calling back.",
      "Booked an appointment and they no-showed. Nobody called. When I called the office at 5pm they said the tech had a personal emergency. Fine, but at least call.",
    ],
  },
  plumbing: {
    positive: [
      "Drain backed up at 6am and {tech} was here by 8. Cleared it, ran a camera so we could see the root intrusion, and gave us a real number for hydro-jetting. No upsell theater. {neighborhood} neighbors recommended these guys for a reason.",
      "Our water heater died right before family came in for the holidays. {tech} found us a replacement same day, swapped it out by 4pm, and pulled the permit. He even hauled the old one away.",
      "Best plumbing experience we have had in 12 years owning this house. {tech} respected the place — shoes off without asking, used a drop cloth, cleaned up the work area better than he found it.",
      "Called for a kitchen sink leak that turned out to be a bigger issue with the angle stop. {tech} talked us through the options, didn't push the expensive one, and was done in an hour.",
      "Had a slow leak under the master bath we ignored too long. They came out, found it was the wax ring on the toilet, and fixed it for $190. Shopped around — competitors quoted $400+. Honest pricing.",
    ],
    mixed: [
      "The work was good but the pricing felt steep. $385 for a 30-minute drain clear seemed high. They did the work and the line is clear so I cannot complain on quality.",
      "Tech was friendly and quick but they could not get parts for our older fixture and we had to schedule a follow-up. Two trip charges. Annoying but resolved.",
    ],
    negative: [
      "{tech} was at the house for 20 minutes, ran a snake down the kitchen drain, and charged $295. The line backed up again two days later. Different company came out and found a broken pipe under the slab — the original guy never even ran a camera.",
      "I will not be using these guys again. Communication was bad, the tech was 4 hours late, and the invoice did not match the quote.",
    ],
  },
  electrical: {
    positive: [
      "{tech} came out to add a circuit for a hot tub install. Walked me through the panel, explained what an arc fault breaker does, and the inspector signed off without a single correction. Clean work.",
      "Had recurring breaker trips on the kitchen circuit. {tech} found a backstabbed outlet behind the dishwasher in 15 minutes — three other electricians had missed it. Fixed and tested.",
      "Lighting design quote came in lower than two competitors and the work was meticulous. {tech} labeled every breaker in the new sub-panel which is a small thing that says a lot.",
      "Whole-house surge protector install. Quick, clean, and {tech} took the time to test the existing grounding rod which one of the other quotes did not even mention.",
    ],
    mixed: [
      "Work was solid but they charged a $89 trip fee on top of the diagnostic which I did not see in the original quote. Should have read the fine print.",
      "{tech} did a fine job on the ceiling fan install but did not clean up the drywall dust in the bedroom. Small thing but noticeable.",
    ],
    negative: [
      "Booked a service call and the tech could not figure out the issue. Told me to get an electrician — I thought I had hired one. Charged $135 for the visit anyway.",
    ],
  },
  landscaping: {
    positive: [
      "{tech} and crew transformed the front yard near {neighborhood}. We had a half-dead lawn for years. They aerated, overseeded, and redid the irrigation zoning. Looks like a different property.",
      "Reliable weekly service, good communication, and they actually edge every visit which is rare. Three seasons in and zero complaints.",
      "Quote process was the most honest I have had. {tech} walked the property, took notes, and emailed a line-item proposal. Other companies just rounded to the nearest thousand.",
      "Storm dropped a huge limb on our shed and these guys had it cleared, the shed tarped, and a roofer referral by 2pm same day.",
    ],
    mixed: [
      "Crews change a lot — three different leads in a season. Service quality varies but never bad, just inconsistent.",
      "Pricing went up 12% mid-season without much notice. They explained it (fuel + minimum wage) but a heads up would have been nice.",
    ],
    negative: [
      "Hit our sprinkler heads twice with the mower and dragged their feet on fixing them. Eventually I just called an irrigation guy and ate the cost.",
    ],
  },
  cleaning: {
    positive: [
      "{tech} and her partner do a deep clean every other Friday and the house genuinely sparkles. They notice things — like the dust bunnies inside the dryer vent — that I never would.",
      "Move-out clean was perfect. Got the deposit back in full. The walkthrough crew said it was the cleanest unit they had seen all month.",
      "Friendly, professional, on time every visit. They use products that don't trigger my asthma which I asked about in the first call.",
    ],
    mixed: [
      "Quality is fine but they reschedule a lot. Three times this quarter. They communicate but it disrupts our routine.",
      "Initial deep clean was great. Subsequent recurring cleans feel rushed. Asked the office and they said the time budget for recurring is shorter — fair, just not what I expected.",
    ],
    negative: [
      "Booked a deep clean for a move-in and they were here for 90 minutes. The kitchen was barely touched. Asked for a redo and they said they would charge again.",
    ],
  },
  roofing: {
    positive: [
      "Hailstorm hit hard. {tech} did the inspection, met with the adjuster, and our claim went through clean. Crew was on the roof for 1.5 days and you cannot tell anyone was here except for the new roof.",
      "Got 4 estimates after the storm. These guys came in middle of the pack on price and at the top on detail — material spec, warranty terms, dump fee, all itemized.",
      "Whole-roof replacement on a 1920s house in {neighborhood}. {tech} actually understood historic-district restrictions, used the correct shingle, and got the permit on the first try.",
    ],
    mixed: [
      "Work was good but communication during the project was minimal. I had to call to find out the start date.",
      "Materials they delivered were not the brand we agreed on. They corrected it but it pushed the start by a week.",
    ],
    negative: [
      "Hired them after the storm. Inspection was thorough but the install crew left nails in the driveway and a dumpster on the lawn for a week after the job was done.",
    ],
  },
  "pest-control": {
    positive: [
      "{tech} came out for a wasp nest the size of a basketball. Suited up, removed it, sealed the entry point, and was gone in 40 minutes. No drama.",
      "Quarterly service for ants and we have not had a single one inside since we started. The tech text-confirms the appointment day before which is helpful.",
      "Termite inspection was free and honest — they found an old infestation that had been treated and did not push us into a contract we did not need.",
    ],
    mixed: [
      "The recurring service is good. The renewal pricing is a little aggressive year over year. Negotiable if you ask.",
    ],
    negative: [
      "Treated for mice three times and we still hear them in the attic. They keep saying they will come back. Cancelled.",
    ],
  },
  restoration: {
    positive: [
      "Pipe burst behind the wall on a Saturday night. {tech} crew was at the house in 90 minutes, had containment up, and the water mitigation started before midnight. Insurance loved them — claim went smooth.",
      "Smoke damage from a kitchen fire. They handled the cleaning, the textile restoration, AND coordinated with the contractor for the rebuild. One point of contact, no chaos.",
      "Mold remediation in the basement. They tested first, scoped the work clearly, and the post-remediation air clearance came back clean on the first try.",
    ],
    mixed: [
      "Job got done but there was a billing dispute with the insurance carrier that took 3 months to resolve. We were caught in the middle.",
    ],
    negative: [
      "Equipment was left running in our basement for 11 days when the work order said 5. Got hit with a power bill spike. Push-back on the office about pulling them sooner.",
    ],
  },
  contracting: {
    positive: [
      "Kitchen remodel from start to finish. {tech} ran the project hands-on, the subs all showed up on schedule, and the punch list was 6 items long which our last contractor would have laughed at. No surprises on the final invoice.",
      "Master bath addition. They pulled the permit, dealt with the historic-district review, and finished within 2 days of the original schedule. Workmanship is exceptional.",
      "Did a full basement finish including a wet bar. {tech} caught a stack venting issue the original plumber missed. Saved us from a code-fail.",
    ],
    mixed: [
      "Solid work, fair price, but communication during the project was thin. Weekly updates would have helped me sleep.",
    ],
    negative: [
      "Started strong, then the lead carpenter quit mid-project and the replacement was learning on our job. Quality dropped noticeably in the second half.",
    ],
  },
  "mobile-detailing": {
    positive: [
      "{tech} showed up at our office and did a full interior + exterior detail on my truck during a long meeting. Came out and it looked better than the day I bought it. Worth every dollar.",
      "First detail in 3 years and these guys did not flinch. Pet hair, kid crumbs, mystery sticky stuff — all gone. Easy booking and on-time arrival.",
      "Recurring monthly maintenance wash and quarterly detail. Subscription pricing is fair and they remember which products work on the leather.",
    ],
    mixed: [
      "Good detail but they were here for 4 hours. I had to leave for an appointment and asked the wife to pay them. Next time I will book the shorter package.",
    ],
    negative: [
      "Paid for the premium detail and there was still wax residue in the door jambs and cup holders. Asked for a touch-up and they said they were booked out 2 weeks. Disappointing.",
    ],
  },
};

/** Per-service-type list of common job descriptions for serviceJobs.serviceType. */
export const JOB_TYPES: Record<ServiceType, string[]> = {
  hvac: [
    "AC tune-up",
    "furnace repair",
    "heat pump replacement",
    "thermostat install",
    "duct cleaning",
    "capacitor replacement",
    "refrigerant recharge",
    "system replacement",
  ],
  plumbing: [
    "drain clearing",
    "water heater replacement",
    "leak repair",
    "toilet rebuild",
    "garbage disposal install",
    "hydro-jetting",
    "sewer camera",
    "fixture install",
  ],
  electrical: [
    "panel upgrade",
    "circuit add",
    "outlet replacement",
    "ceiling fan install",
    "EV charger install",
    "whole-house surge protector",
    "lighting design",
    "service call diagnostic",
  ],
  landscaping: [
    "weekly mow",
    "spring cleanup",
    "fall cleanup",
    "irrigation repair",
    "aeration & overseed",
    "mulching",
    "tree pruning",
    "sod install",
  ],
  cleaning: [
    "deep clean",
    "recurring biweekly",
    "move-out clean",
    "post-construction clean",
    "carpet cleaning",
    "window cleaning",
  ],
  roofing: [
    "hail damage inspection",
    "full roof replacement",
    "shingle repair",
    "gutter install",
    "flashing repair",
    "skylight install",
  ],
  "pest-control": [
    "ant treatment",
    "wasp nest removal",
    "termite inspection",
    "rodent exclusion",
    "quarterly service",
    "mosquito treatment",
  ],
  restoration: [
    "water mitigation",
    "smoke damage cleanup",
    "mold remediation",
    "structural drying",
    "contents restoration",
    "biohazard cleanup",
  ],
  contracting: [
    "kitchen remodel",
    "bath remodel",
    "basement finish",
    "deck build",
    "addition framing",
    "punch list",
  ],
  "mobile-detailing": [
    "full interior detail",
    "exterior wash + wax",
    "ceramic coating",
    "headlight restoration",
    "engine bay detail",
    "monthly maintenance wash",
  ],
};

/**
 * Brand-voice sample templates — operator-written review replies + GBP
 * captions. Each one shows a slightly different tone register so synthesis
 * tests have texture to extract a "voice" from.
 */
export const BRAND_VOICE_TEMPLATES = {
  reviewReply: [
    "Thank you {customer}! {tech} loved working on this one and we appreciate you taking the time to leave a review. We'll see you on the next service.",
    "{customer} — thanks for the kind words. Glad we could get you back up and running quickly. Tell {tech} hi next time we're out.",
    "Really appreciate this {customer}. We try hard on every call and reviews like this make the team's day. Stay cool out there!",
    "Means a lot {customer}. {tech} mentioned what a great job site you keep, made his work easier. Reach out anytime.",
    "Thanks {customer}! Always glad to help a {neighborhood} neighbor. We're around if anything else comes up.",
  ],
  gbpCaption: [
    "Tackled a tough {jobType} for the {customer} family in {neighborhood} this week. {tech} had it sorted in under an hour. If your home is acting up, you know who to call.",
    "{jobType} season is here — book your service before the rush. We've already done 12 this week in {neighborhood}.",
    "Before & after on a {jobType} we just wrapped. The {customer}s were great to work with. Swipe to see the difference.",
    "Pro tip from the field: most {jobType} issues we see come from one common cause. Catching it early saves you hundreds.",
    "Proud of {tech} this week — knocked out three {jobType}s on tight schedules and every single customer left a 5-star.",
  ],
};

/**
 * Synthetic vendor contract red-flag clauses. Used by `makeVendorContract`
 * — drop 3-4 of these into a generic vendor agreement so the
 * `contract-redflag` skill in Sprint 3 has real material to detect.
 */
export const RED_FLAG_CLAUSES = {
  autoRenew: `**12. Term & Renewal.** This Agreement shall commence on the Effective Date and remain in effect for an initial term of twelve (12) months. **Thereafter this Agreement shall automatically renew for successive twelve-month terms** unless either party provides written notice of non-renewal not less than ninety (90) days prior to the end of the then-current term. Notice provided fewer than 90 days prior shall be ineffective and the Agreement shall renew for the next term.`,
  ipGrant: `**8. Intellectual Property.** Operator hereby grants Vendor a **perpetual, irrevocable, worldwide, royalty-free license** to use, modify, reproduce, distribute, and create derivative works from any photographs, videos, customer testimonials, before-and-after imagery, and any creative materials Operator provides or that arise out of the services performed under this Agreement, including for marketing and promotional purposes by Vendor or its affiliates.`,
  killFee: `**14. Early Termination.** Should Operator terminate this Agreement for any reason other than a documented material breach by Vendor, Operator shall pay Vendor a **kill fee equal to fifty percent (50%) of the remaining contract value** as liquidated damages. Operator acknowledges this amount is a fair estimate of Vendor's losses and not a penalty.`,
  exclusivity: `**5. Exclusivity.** During the Term and for a period of twelve (12) months thereafter, Operator shall not engage **any other vendor providing services materially similar to those provided by Vendor** within a fifty (50) mile radius of any service location identified in Schedule A. A violation of this provision constitutes a material breach.`,
  indemnity: `**11. Indemnification.** Operator shall **indemnify, defend, and hold harmless Vendor and its officers, directors, employees, agents, and affiliates** from and against any and all claims, demands, losses, liabilities, damages, costs, and expenses (including reasonable attorney's fees) arising out of or related to (a) the services performed by Vendor, (b) Operator's use of any deliverable, or (c) any third-party claim regardless of cause. This obligation shall survive termination.`,
  unilateralChange: `**17. Modification.** Vendor reserves the right to **modify the pricing, scope, deliverables, and any terms of this Agreement upon thirty (30) days written notice** to Operator. Continued use of services beyond the notice period constitutes acceptance of the modified terms.`,
  classWaiver: `**19. Dispute Resolution.** Any dispute arising out of this Agreement shall be resolved through binding arbitration administered by the American Arbitration Association. **Operator expressly waives any right to participate in any class action, consolidated action, or representative proceeding** against Vendor.`,
} as const;

export type RedFlagId = keyof typeof RED_FLAG_CLAUSES;

export const ALL_RED_FLAGS: ReadonlyArray<RedFlagId> = Object.keys(
  RED_FLAG_CLAUSES
) as RedFlagId[];
