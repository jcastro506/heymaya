/**
 * Shared input shapes for the per-business OpenClaw workspace generators.
 *
 * Mirror of `convex/agents/packs/maya/workspace/types.ts` for the service
 * product. The `businesses` and `businessPicture` Convex tables (per
 * § 8 schema) land in Sprint 1 — these types model the planned shape so
 * generators can be written + tested before the schema lands. Once the
 * schema is in place, `Doc<"businesses">` and `Doc<"businessPicture">` will
 * be substituted in (search-and-replace; the field set is identical).
 *
 * Generators are pure functions, deterministic, DB-free. The Convex action
 * wrapper that drives the deploy pipeline (Sprint 2) is responsible for
 * loading these from the database.
 */

export type ServicePlan = "starter" | "pro" | "studio";

export type ServiceTonePreference =
  | "friendly-neighborhood-pro"
  | "professional-efficient"
  | "authoritative-expert";

export type ServiceType =
  | "hvac"
  | "plumbing"
  | "electrical"
  | "landscaping"
  | "cleaning"
  | "roofing"
  | "pest"
  | "restoration"
  | "contracting"
  | "mobile-detailing";

export interface NamedCompetitor {
  name: string;
  reputationalNote?: string;
  gbpRating?: number;
}

export interface RecurringLocalHook {
  kind: "weather" | "event" | "landmark" | "sport" | "season" | "community";
  text: string;
}

export interface LocalPositioning {
  servedZips: ReadonlyArray<string>;
  servedNeighborhoods: ReadonlyArray<string>;
  namedCompetitors: ReadonlyArray<NamedCompetitor>;
  recurringLocalHooks: ReadonlyArray<RecurringLocalHook>;
  /** Free-form synthesis: why locals choose this operator over the alternatives. */
  localChoiceThesis: string;
}

export interface BrandVoiceSample {
  source: "review-reply" | "gbp-post" | "fb-post" | "operator-quote";
  text: string;
}

export interface BusinessPictureLite {
  brandVoice: string;
  brandVoiceSamples: ReadonlyArray<BrandVoiceSample>;
  localPositioning: LocalPositioning;
  customerSentiment?: string;
  recurringServicePatterns?: ReadonlyArray<string>;
}

export interface OperatorLite {
  firstName: string;
  lastName?: string;
  /** Display preference, e.g. "Mike", "Mike H.", "Mike Henderson". */
  displayName: string;
}

export interface BusinessLite {
  name: string;
  serviceTypes: ReadonlyArray<ServiceType>;
  /** Free-form area description, e.g. "25-mile radius around Lincoln, NE". */
  serviceArea: string;
  /** IANA timezone string for the operator's location. */
  timezone: string;
  /** Operator's preferred tone register. */
  tonePreference: ServiceTonePreference;
  /** Operator-named technicians, if any (CRM-derived or self-entered). */
  technicianNames: ReadonlyArray<string>;
  /** Business hours, free-form — "M-F 7a-6p, Sat 8a-noon" works fine. */
  businessHours: string;
  voiceEnabled: boolean;
}

/**
 * The full input bundle every workspace generator pulls from. Generators
 * accept narrow subsets of this — only the bundle assembler needs all fields.
 */
export interface ServiceWorkspaceInputs {
  operator: OperatorLite;
  business: BusinessLite;
  businessPicture: BusinessPictureLite | null;
  plan: ServicePlan;
  /** Test seam — pinned for determinism in tests. */
  now: number;
}

/** Marker for fields that aren't yet provided at workspace-generation time. */
export const NOT_YET_PROVIDED = "not yet provided";

/**
 * Hard caps from `docs/SPRINT_PLAN_SERVICE_V0.md` § 9 ("Bootstrap caps").
 *   - 12K chars per file default in OpenClaw spec.
 *   - HEARTBEAT.md soft cap 2K (R3 § 4 — read every tick, token-burn matters).
 *   - Combined SOUL+AGENTS+USER+HEARTBEAT under 150K.
 *   - BOOT.md soft cap 3K.
 *   - DREAMING.md soft cap 4K.
 *
 * AGENTS.md is bumped to 28K for the inline-standing-orders pattern
 * (matches creator-side `MAYA_BOOTSTRAP_MAX_CHARS` in
 * `convex/agents/packs/maya/configGeneratorMaya.ts`). Per OpenClaw docs
 * + creator-side validation, only the canonical root files are
 * auto-injected — arbitrary `.md` files in the workspace root aren't
 * guaranteed to load. Embedding the 15 standing orders inline AGENTS.md
 * is the validated pattern.
 *
 * The bundle assembler asserts these before upload.
 */
export const FILE_DEFAULT_MAX_CHARS = 12_000;
export const AGENTS_MAX_CHARS = 28_000;
export const SOUL_MAX_CHARS = 6_000;
export const HEARTBEAT_MAX_CHARS = 2_000;
export const BOOT_MAX_CHARS = 3_000;
export const DREAMING_MAX_CHARS = 4_000;
export const COMBINED_BUNDLE_MAX_CHARS = 150_000;
