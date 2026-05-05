/**
 * Growth-product onboarding state machine.
 *
 * Single client-side reducer: each step writes its slice; the next-step
 * gate is the union of "do we have the data this step needed?". Server
 * state lives in `growthAgents.onboardingStep` — the UI mirrors it but
 * is the source of truth for the current step the operator is on.
 */

export type StepId =
  | "connect-linkedin"
  | "connect-twitter"
  | "product-context"
  | "voice-samples"
  | "deploy"
  | "complete";

export const STEPS: ReadonlyArray<{ id: StepId; label: string }> = [
  { id: "connect-linkedin", label: "Connect LinkedIn" },
  { id: "connect-twitter", label: "Connect X / Twitter" },
  { id: "product-context", label: "Tell Maya your product" },
  { id: "voice-samples", label: "Voice samples" },
  { id: "deploy", label: "Deploy Maya" },
];

export interface OnboardingDraft {
  productContext: {
    productName: string;
    oneLiner: string;
    targetAudience: string;
    primaryUrl: string;
    focus: string;
  };
  voiceSamples: {
    linkedin: string[];
    twitter: string[];
  };
  linkedinComposioId: string;
  twitterComposioId: string;
}

export const emptyDraft = (): OnboardingDraft => ({
  productContext: {
    productName: "",
    oneLiner: "",
    targetAudience: "",
    primaryUrl: "",
    focus: "",
  },
  voiceSamples: {
    linkedin: [""],
    twitter: [""],
  },
  linkedinComposioId: "",
  twitterComposioId: "",
});

export function nextStep(current: StepId): StepId {
  const idx = STEPS.findIndex((s) => s.id === current);
  if (idx < 0 || idx >= STEPS.length - 1) return "complete";
  return STEPS[idx + 1].id;
}

export function prevStep(current: StepId): StepId | null {
  const idx = STEPS.findIndex((s) => s.id === current);
  if (idx <= 0) return null;
  return STEPS[idx - 1].id;
}
