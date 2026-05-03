import { describe, expect, it } from "vitest";
import { evaluateOpenClawDeployGate } from "../openClawDeployGate";

const ready = {
  mode: "mock" as const,
  creatorId: "creator_1",
  workspaceManifestReady: true,
  phoneNumberCollected: true,
  calendarConnected: true,
  creatorPictureReady: true,
  hasFlyToken: false,
  allowPaidDeploy: false,
  allMockE2EGatesGreen: false,
};

describe("Creator Maya v0 OpenClaw deploy gate", () => {
  it("allows mocked deploy tests without Fly credentials or paid deploy approval", () => {
    expect(evaluateOpenClawDeployGate(ready)).toEqual({
      ok: true,
      mode: "mock",
      deployLabel: "mock:creator_1",
    });
  });

  it("blocks mocked deploy when onboarding prerequisites are missing", () => {
    const result = evaluateOpenClawDeployGate({
      ...ready,
      phoneNumberCollected: false,
      calendarConnected: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers).toEqual(
      expect.arrayContaining(["phone_number_missing", "calendar_not_connected"])
    );
  });

  it("requires mock E2E, Fly token, and paid-deploy approval for live test deploys", () => {
    const blocked = evaluateOpenClawDeployGate({
      ...ready,
      mode: "live_test",
    });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockers).toEqual(
        expect.arrayContaining([
          "mock_e2e_not_green",
          "fly_token_missing",
          "paid_deploy_not_allowed",
        ])
      );
    }

    const allowed = evaluateOpenClawDeployGate({
      ...ready,
      mode: "live_test",
      hasFlyToken: true,
      allowPaidDeploy: true,
      allMockE2EGatesGreen: true,
    });

    expect(allowed).toEqual({
      ok: true,
      mode: "live_test",
      deployLabel: "live_test:creator_1",
    });
  });
});
