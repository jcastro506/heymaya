export type OpenClawDeployMode = "mock" | "live_test" | "production";

export interface OpenClawDeployGateInput {
  mode: OpenClawDeployMode;
  creatorId: string;
  workspaceManifestReady: boolean;
  phoneNumberCollected: boolean;
  calendarConnected: boolean;
  creatorPictureReady: boolean;
  hasFlyToken: boolean;
  allowPaidDeploy: boolean;
  allMockE2EGatesGreen: boolean;
}

export type OpenClawDeployGateResult =
  | {
      ok: true;
      mode: OpenClawDeployMode;
      deployLabel: string;
    }
  | {
      ok: false;
      blockers: ReadonlyArray<string>;
    };

export function evaluateOpenClawDeployGate(
  input: OpenClawDeployGateInput
): OpenClawDeployGateResult {
  const blockers: string[] = [];

  if (!input.workspaceManifestReady) blockers.push("workspace_manifest_missing");
  if (!input.phoneNumberCollected) blockers.push("phone_number_missing");
  if (!input.calendarConnected) blockers.push("calendar_not_connected");
  if (!input.creatorPictureReady) blockers.push("creator_picture_missing");

  if (input.mode !== "mock") {
    if (!input.allMockE2EGatesGreen) blockers.push("mock_e2e_not_green");
    if (!input.hasFlyToken) blockers.push("fly_token_missing");
    if (!input.allowPaidDeploy) blockers.push("paid_deploy_not_allowed");
  }

  if (blockers.length > 0) return { ok: false, blockers };

  return {
    ok: true,
    mode: input.mode,
    deployLabel: `${input.mode}:${input.creatorId}`,
  };
}
