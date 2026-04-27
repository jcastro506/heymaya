/**
 * 30-message synthetic operator-text corpus for the no-CRM NER extractor.
 *
 * Per spec (Sprint 4 § 13 + Wave-C scope): >85% extraction accuracy on
 * customer_last_name + service_type fields across kitchen / bathroom / HVAC /
 * electrical / yard / cleaning service descriptions.
 *
 * Each entry is a real-shaped text-message Maya might receive from an
 * operator after wrapping a job. Expected fields are what an operator-eye
 * reading the message would extract — extraction accuracy is measured
 * against this ground truth.
 *
 * Categories — 5 messages each × 6 categories = 30 messages.
 *
 * The corpus is exposed as both a flat array (`NER_CORPUS`) and a per-
 * category lookup (`NER_CORPUS_BY_CATEGORY`) so tests can scope to a
 * single category.
 */

export type NerCategory =
  | "kitchen"
  | "bathroom"
  | "hvac"
  | "electrical"
  | "yard"
  | "cleaning";

export interface NerCorpusEntry {
  id: string;
  category: NerCategory;
  message: string;
  expected: {
    customer_last_name: string | null;
    service_type: string | null;
    address: string | null;
    completed_at_hint: "now" | null;
  };
}

export const NER_CORPUS: ReadonlyArray<NerCorpusEntry> = [
  // ── Kitchen ─────────────────────────────────────────────────────────
  {
    id: "k1",
    category: "kitchen",
    message: "just finished the Johnson kitchen sink at 432 Oak",
    expected: {
      customer_last_name: "Johnson",
      service_type: "kitchen sink",
      address: "432 Oak",
      completed_at_hint: "now",
    },
  },
  {
    id: "k2",
    category: "kitchen",
    message: "wrapped up Mrs. Bautista garbage disposal install",
    expected: {
      customer_last_name: "Bautista",
      service_type: "garbage disposal",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "k3",
    category: "kitchen",
    message: "done with Patel kitchen faucet replacement, 1801 Maple Dr",
    expected: {
      customer_last_name: "Patel",
      service_type: "kitchen faucet",
      address: "1801 Maple Dr",
      completed_at_hint: "now",
    },
  },
  {
    id: "k4",
    category: "kitchen",
    message: "Schmidt dishwasher hookup tomorrow 9am",
    expected: {
      customer_last_name: "Schmidt",
      service_type: "dishwasher",
      address: null,
      completed_at_hint: null,
    },
  },
  {
    id: "k5",
    category: "kitchen",
    message: "just left the O'Brien place — refrigerator water line repair",
    expected: {
      customer_last_name: "O'Brien",
      service_type: "refrigerator water line",
      address: null,
      completed_at_hint: "now",
    },
  },

  // ── Bathroom ────────────────────────────────────────────────────────
  {
    id: "b1",
    category: "bathroom",
    message: "wrapped Hernandez toilet rebuild at 88 Cedar Ln",
    expected: {
      customer_last_name: "Hernandez",
      service_type: "toilet rebuild",
      address: "88 Cedar Ln",
      completed_at_hint: "now",
    },
  },
  {
    id: "b2",
    category: "bathroom",
    message: "Robinson shower valve replaced, all tested good",
    expected: {
      customer_last_name: "Robinson",
      service_type: "shower valve",
      address: null,
      completed_at_hint: null,
    },
  },
  {
    id: "b3",
    category: "bathroom",
    message: "just finished the Tanaka master bath leak at 2200 Pine",
    expected: {
      customer_last_name: "Tanaka",
      service_type: "master bath leak",
      address: "2200 Pine",
      completed_at_hint: "now",
    },
  },
  {
    id: "b4",
    category: "bathroom",
    message: "done with the Williams bathroom remodel rough-in",
    expected: {
      customer_last_name: "Williams",
      service_type: "bathroom remodel",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "b5",
    category: "bathroom",
    message: "Adelaide vanity install scheduled for Friday",
    expected: {
      customer_last_name: "Adelaide",
      service_type: "vanity install",
      address: null,
      completed_at_hint: null,
    },
  },

  // ── HVAC ────────────────────────────────────────────────────────────
  {
    id: "h1",
    category: "hvac",
    message: "just wrapped Garcia AC tune-up, capacitor was shot, replaced",
    expected: {
      customer_last_name: "Garcia",
      service_type: "AC tune-up",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "h2",
    category: "hvac",
    message: "done with Lee furnace replacement at 605 Birch",
    expected: {
      customer_last_name: "Lee",
      service_type: "furnace replacement",
      address: "605 Birch",
      completed_at_hint: "now",
    },
  },
  {
    id: "h3",
    category: "hvac",
    message: "finished the Nguyen mini-split install",
    expected: {
      customer_last_name: "Nguyen",
      service_type: "mini-split install",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "h4",
    category: "hvac",
    message: "Murphy heat pump diagnostic at 1124 Sunset",
    expected: {
      customer_last_name: "Murphy",
      service_type: "heat pump diagnostic",
      address: "1124 Sunset",
      completed_at_hint: null,
    },
  },
  {
    id: "h5",
    category: "hvac",
    message: "wrapped up the Cooper duct cleaning, 3 tons of dust",
    expected: {
      customer_last_name: "Cooper",
      service_type: "duct cleaning",
      address: null,
      completed_at_hint: "now",
    },
  },

  // ── Electrical ──────────────────────────────────────────────────────
  {
    id: "e1",
    category: "electrical",
    message: "just finished Davis panel upgrade at 47 Elm St",
    expected: {
      customer_last_name: "Davis",
      service_type: "panel upgrade",
      address: "47 Elm St",
      completed_at_hint: "now",
    },
  },
  {
    id: "e2",
    category: "electrical",
    message: "Knapp ceiling fan install done — three rooms",
    expected: {
      customer_last_name: "Knapp",
      service_type: "ceiling fan install",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "e3",
    category: "electrical",
    message: "wrapped Ferreira EV charger install, NEMA 14-50",
    expected: {
      customer_last_name: "Ferreira",
      service_type: "EV charger install",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "e4",
    category: "electrical",
    message: "done at the Morales house — outlet replacement, kitchen GFCI",
    expected: {
      customer_last_name: "Morales",
      service_type: "outlet replacement",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "e5",
    category: "electrical",
    message: "Fitzgerald rewire estimate scheduled Thursday",
    expected: {
      customer_last_name: "Fitzgerald",
      service_type: "rewire",
      address: null,
      completed_at_hint: null,
    },
  },

  // ── Yard / Landscaping ──────────────────────────────────────────────
  {
    id: "y1",
    category: "yard",
    message: "wrapped Rodriguez yard cleanup — hauled 4 yards of debris",
    expected: {
      customer_last_name: "Rodriguez",
      service_type: "yard cleanup",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "y2",
    category: "yard",
    message: "just finished the Thompson lawn mow at 982 River Rd",
    expected: {
      customer_last_name: "Thompson",
      service_type: "lawn mow",
      address: "982 River Rd",
      completed_at_hint: "now",
    },
  },
  {
    id: "y3",
    category: "yard",
    message: "done with Khan tree trim, two oaks and a maple",
    expected: {
      customer_last_name: "Khan",
      service_type: "tree trim",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "y4",
    category: "yard",
    message: "Anders sprinkler repair — head replacement on zone 3",
    expected: {
      customer_last_name: "Anders",
      service_type: "sprinkler repair",
      address: null,
      completed_at_hint: null,
    },
  },
  {
    id: "y5",
    category: "yard",
    message: "wrapped the Ortega mulch install, 6 yards spread",
    expected: {
      customer_last_name: "Ortega",
      service_type: "mulch install",
      address: null,
      completed_at_hint: "now",
    },
  },

  // ── Cleaning ────────────────────────────────────────────────────────
  {
    id: "c1",
    category: "cleaning",
    message: "just finished the Bell move-out clean at 14 Birch Ave",
    expected: {
      customer_last_name: "Bell",
      service_type: "move-out clean",
      address: "14 Birch Ave",
      completed_at_hint: "now",
    },
  },
  {
    id: "c2",
    category: "cleaning",
    message: "done with Reyes deep clean, kitchen and 2 bathrooms",
    expected: {
      customer_last_name: "Reyes",
      service_type: "deep clean",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "c3",
    category: "cleaning",
    message: "wrapped Ng carpet shampoo, all four bedrooms",
    expected: {
      customer_last_name: "Ng",
      service_type: "carpet shampoo",
      address: null,
      completed_at_hint: "now",
    },
  },
  {
    id: "c4",
    category: "cleaning",
    message: "Brown post-construction cleanup tomorrow morning",
    expected: {
      customer_last_name: "Brown",
      service_type: "post-construction cleanup",
      address: null,
      completed_at_hint: null,
    },
  },
  {
    id: "c5",
    category: "cleaning",
    message: "just left the Wallace window wash, all 22 windows good",
    expected: {
      customer_last_name: "Wallace",
      service_type: "window wash",
      address: null,
      completed_at_hint: "now",
    },
  },
];

export const NER_CORPUS_BY_CATEGORY: Record<
  NerCategory,
  ReadonlyArray<NerCorpusEntry>
> = {
  kitchen: NER_CORPUS.filter((e) => e.category === "kitchen"),
  bathroom: NER_CORPUS.filter((e) => e.category === "bathroom"),
  hvac: NER_CORPUS.filter((e) => e.category === "hvac"),
  electrical: NER_CORPUS.filter((e) => e.category === "electrical"),
  yard: NER_CORPUS.filter((e) => e.category === "yard"),
  cleaning: NER_CORPUS.filter((e) => e.category === "cleaning"),
};
