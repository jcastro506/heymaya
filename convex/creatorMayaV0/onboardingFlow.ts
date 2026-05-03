export const CREATOR_MAYA_ONBOARDING_STEPS = [
  "signup",
  "connect_tiktok",
  "pull_metadata",
  "sample_videos",
  "connect_calendar",
  "creator_interview",
  "maya_readback",
  "creator_picture",
  "pair_imessage",
  "deploy_maya",
  "active",
] as const;

export type CreatorMayaOnboardingStep =
  (typeof CREATOR_MAYA_ONBOARDING_STEPS)[number];

export interface CreatorMayaOnboardingState {
  signedUp: boolean;
  tiktokConnected: boolean;
  metadataPulled: boolean;
  videoSamplesAnalyzed: boolean;
  calendarConnected: boolean;
  interviewComplete: boolean;
  readbackConfirmed: boolean;
  creatorPictureReady: boolean;
  imessagePaired: boolean;
  mayaDeployed: boolean;
}

export function nextOnboardingStep(
  state: CreatorMayaOnboardingState
): CreatorMayaOnboardingStep {
  if (!state.signedUp) return "signup";
  if (!state.tiktokConnected) return "connect_tiktok";
  if (!state.metadataPulled) return "pull_metadata";
  if (!state.videoSamplesAnalyzed) return "sample_videos";
  if (!state.calendarConnected) return "connect_calendar";
  if (!state.interviewComplete) return "creator_interview";
  if (!state.readbackConfirmed) return "maya_readback";
  if (!state.creatorPictureReady) return "creator_picture";
  if (!state.imessagePaired) return "pair_imessage";
  if (!state.mayaDeployed) return "deploy_maya";
  return "active";
}

export function canDeployCreatorMaya(
  state: CreatorMayaOnboardingState
): boolean {
  return nextOnboardingStep(state) === "deploy_maya";
}

export function onboardingProgressPercent(
  state: CreatorMayaOnboardingState
): number {
  const next = nextOnboardingStep(state);
  const idx = CREATOR_MAYA_ONBOARDING_STEPS.indexOf(next);
  if (next === "active") return 100;
  return Math.round((idx / (CREATOR_MAYA_ONBOARDING_STEPS.length - 1)) * 100);
}
