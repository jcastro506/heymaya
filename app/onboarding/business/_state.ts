/**
 * Service-product onboarding shared state machine.
 *
 * Mirrors the creator-side `app/onboarding/maya/_state.ts` shape but for the
 * service business flow described in service plan § 5 (11 steps,
 * sub-5-min target).
 *
 * Why a hand-rolled reducer (matches creator side):
 *   - Sub-5-min onboarding bounces if the back button drops the operator on
 *     a half-finished step. We model progression in memory only.
 *   - Linear steps with no skips. Reducer / state-machine library is overkill.
 */

export type ServicePlan = "starter" | "pro" | "studio";

export type ServiceTone =
  | "friendly-neighborhood"
  | "professional-efficient"
  | "authoritative-expert";

export type ServiceTypeId =
  | "hvac"
  | "plumbing"
  | "electrical"
  | "landscaping"
  | "cleaning"
  | "contracting"
  | "roofing"
  | "pest"
  | "restoration"
  | "mobile-detailing"
  | "other";

export type CrmProvider =
  | "jobber"
  | "hcp"
  | "qbo"
  | "servicetitan"
  | "none"
  | "later";

export type StepId =
  | "signup"
  | "gbp"
  | "social"
  | "crm"
  | "pulling"
  | "questions"
  | "synth"
  | "channel"
  | "deploy";

export const STEP_ORDER: ReadonlyArray<StepId> = [
  "signup",
  "gbp",
  "social",
  "crm",
  "pulling",
  "questions",
  "synth",
  "channel",
  "deploy",
];

export interface ServiceArea {
  city: string;
  /** Either radius in miles OR a list of zip codes — operator picks one. */
  radiusMiles: number | null;
  zipCodes: ReadonlyArray<string>;
}

export type TicketSizeBucket =
  | "under-200"
  | "200-500"
  | "500-2k"
  | "2k-10k"
  | "over-10k";

export type BusinessSizeBucket = "solo" | "2-5" | "6-15" | "16-50" | "50-plus";

export type ResponseSpeed = "instant" | "within-5-min" | "within-30-min";

export type VoiceChannelChoice = "skip" | "set-up-later" | "set-up-now";

export interface ServiceAnswers {
  /** Q1 — business name + service types. */
  businessName: string;
  serviceTypes: ServiceTypeId[];
  /** Q2 — service area (city + miles OR zips). */
  serviceArea: ServiceArea;
  /** Q3 — business size. */
  businessSize: BusinessSizeBucket | null;
  /** Q4 — top 3 services (free text). */
  topServices: string[];
  /** Q5 — typical job ticket size bucket. */
  ticketSize: TicketSizeBucket | null;
  /** Q6 — tone preference. */
  tone: ServiceTone | null;
  /** Q7 — response speed expectation. */
  responseSpeed: ResponseSpeed | null;
  /** Q8 — voice channel preference. Default skip on Starter/Pro. */
  voiceChoice: VoiceChannelChoice;
  /** Q9 — top 3 local competitors. */
  namedCompetitors: string[];
  /** Q10 — neighborhoods/zips most jobs come from. */
  neighborhoodEmphasis: string[];
  /** Q11 — local hooks operator already uses. */
  localHooks: string[];
}

export const DEFAULT_ANSWERS: ServiceAnswers = {
  businessName: "",
  serviceTypes: [],
  serviceArea: { city: "", radiusMiles: null, zipCodes: [] },
  businessSize: null,
  topServices: [],
  ticketSize: null,
  tone: null,
  responseSpeed: null,
  voiceChoice: "skip",
  namedCompetitors: [],
  neighborhoodEmphasis: [],
  localHooks: [],
};

export type CrmConnectionState = {
  selected: CrmProvider | null;
  hcpMaxWarningAck: boolean;
};

export const DEFAULT_CRM: CrmConnectionState = {
  selected: null,
  hcpMaxWarningAck: false,
};

export interface OnboardingState {
  step: StepId;
  plan: ServicePlan;
  /** GBP account claim — connected via Zernio. */
  gbpConnected: boolean;
  gbpOwnerEmailMatchesGoogle: boolean | null;
  /** Optional FB + IG (Pro+). */
  socialConnected: { facebook: boolean; instagram: boolean };
  crm: CrmConnectionState;
  bulkPullDone: boolean;
  bulkPullSummary: string | null;
  answers: ServiceAnswers;
  synthDone: boolean;
  synthError: string | null;
  /** § 11 — channel pairing handled by OpenClaw native; v0 default = web/sms. */
  channelChosen: "web" | "imessage" | "whatsapp" | "sms" | null;
  deployStatus: "idle" | "running" | "ok" | "failed";
  deployError: string | null;
  error: string | null;
}

export function initialState(plan: ServicePlan = "starter"): OnboardingState {
  return {
    step: "signup",
    plan,
    gbpConnected: false,
    gbpOwnerEmailMatchesGoogle: null,
    socialConnected: { facebook: false, instagram: false },
    crm: DEFAULT_CRM,
    bulkPullDone: false,
    bulkPullSummary: null,
    answers: DEFAULT_ANSWERS,
    synthDone: false,
    synthError: null,
    channelChosen: "web",
    deployStatus: "idle",
    deployError: null,
    error: null,
  };
}

export function nextStep(step: StepId): StepId {
  const idx = STEP_ORDER.indexOf(step);
  if (idx < 0 || idx === STEP_ORDER.length - 1) return step;
  return STEP_ORDER[idx + 1];
}

export function setStep(state: OnboardingState, step: StepId): OnboardingState {
  return { ...state, step, error: null };
}

export function setAnswer<K extends keyof ServiceAnswers>(
  state: OnboardingState,
  key: K,
  value: ServiceAnswers[K]
): OnboardingState {
  return { ...state, answers: { ...state.answers, [key]: value } };
}

export function canAdvance(state: OnboardingState): boolean {
  switch (state.step) {
    case "signup":
      return true;
    case "gbp":
      return state.gbpConnected;
    case "social":
      // optional — Pro+ feature, but never required.
      return true;
    case "crm":
      // optional — operator can pick "none" / "later".
      return state.crm.selected !== null;
    case "pulling":
      return state.bulkPullDone;
    case "questions":
      return allRequiredAnswered(state.answers);
    case "synth":
      return state.synthDone;
    case "channel":
      return state.channelChosen !== null;
    case "deploy":
      return false;
  }
}

export function allRequiredAnswered(a: ServiceAnswers): boolean {
  if (a.businessName.trim().length === 0) return false;
  if (a.serviceTypes.length === 0) return false;
  if (
    a.serviceArea.city.trim().length === 0 &&
    a.serviceArea.zipCodes.length === 0
  ) {
    return false;
  }
  if (a.businessSize === null) return false;
  if (a.topServices.length === 0) return false;
  if (a.ticketSize === null) return false;
  if (a.tone === null) return false;
  if (a.responseSpeed === null) return false;
  // Q9 / Q10 / Q11 are optional — local-texture is nice-to-have at onboarding,
  // backfilled by cron behaviors over time per § 5 step 7.
  return true;
}

/* -------------------------------------------------------------------------- */
/* UI labels — exported so step components don't drift from the type union    */
/* -------------------------------------------------------------------------- */

export const SERVICE_TYPE_LABELS: Record<ServiceTypeId, string> = {
  hvac: "HVAC",
  plumbing: "Plumbing",
  electrical: "Electrical",
  landscaping: "Landscaping",
  cleaning: "Cleaning",
  contracting: "Contracting",
  roofing: "Roofing",
  pest: "Pest control",
  restoration: "Restoration",
  "mobile-detailing": "Mobile detailing",
  other: "Other",
};

export const TICKET_SIZE_LABELS: Record<TicketSizeBucket, string> = {
  "under-200": "Under $200",
  "200-500": "$200 – $500",
  "500-2k": "$500 – $2K",
  "2k-10k": "$2K – $10K",
  "over-10k": "Over $10K",
};

export const BUSINESS_SIZE_LABELS: Record<BusinessSizeBucket, string> = {
  solo: "Solo / 1 truck",
  "2-5": "2 – 5 trucks",
  "6-15": "6 – 15 trucks",
  "16-50": "16 – 50 trucks",
  "50-plus": "50+ trucks",
};

export const TONE_LABELS: Record<ServiceTone, string> = {
  "friendly-neighborhood": "Friendly neighborhood pro",
  "professional-efficient": "Professional & efficient",
  "authoritative-expert": "Authoritative expert",
};

export const RESPONSE_SPEED_LABELS: Record<ResponseSpeed, string> = {
  instant: "Instant (sub-1 min)",
  "within-5-min": "Within 5 minutes",
  "within-30-min": "Within 30 minutes",
};

export const STEP_BREADCRUMBS: Record<StepId, string> = {
  signup: "Welcome",
  gbp: "Claim your Google Business Profile",
  social: "Connect Facebook + Instagram (optional)",
  crm: "Connect your CRM (optional)",
  pulling: "Maya is reading your business",
  questions: "Eleven quick questions",
  synth: "Maya is forming her first picture",
  channel: "Where should Maya text you?",
  deploy: "Deploying Maya",
};
