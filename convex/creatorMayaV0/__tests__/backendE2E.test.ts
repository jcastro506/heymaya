import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";

const TZ = "America/New_York";
const NOW = Date.UTC(2026, 4, 4, 11, 0, 0);
const SLOT = Date.UTC(2026, 4, 4, 19, 0, 0);

function asUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject });
}

describe("Creator Maya v0 Convex MVP flow", () => {
  it("walks signup to TikTok, calendar, readback, iMessage, mock deploy, daily brief, and calendar hold", async () => {
    const t = convexTest(schema, modules);
    const user = asUser(t, "creator-a");

    await user.mutation(api.creatorMayaV0.backend.getOrCreateAccount, {
      email: "creator-a@example.com",
      timezone: TZ,
      tier: "starter",
    });

    const tiktok = await user.mutation(api.creatorMayaV0.backend.connectTikTokMock, {
      handle: "founder_maya",
      displayName: "Founder Maya",
      followerCount: 42_000,
      bio: "Founder building in public with result-first demos",
    });
    expect(tiktok.postCount).toBe(30);
    expect(tiktok.selectedPostIds.length).toBeLessThanOrEqual(8);

    await user.mutation(api.creatorMayaV0.backend.connectCalendarMock, {
      provider: "mock",
      timezone: TZ,
      availabilityWindows: [{ startMs: SLOT, endMs: SLOT + 2 * 60 * 60 * 1000 }],
      canCreateHolds: true,
    });

    const intake = await user.mutation(api.creatorMayaV0.backend.submitIntake, {
      ninetyDayGoal: "grow authority and become sponsor-ready",
      creatorStage: "growing_consistently",
      biggestBlocker: "inconsistent posting",
      weeklyHoursAvailable: 4,
      tone: "strategic",
      doNotSuggest: ["daily vlogs"],
    });
    expect(intake.readback.goal).toContain("sponsor-ready");

    await user.mutation(api.creatorMayaV0.backend.confirmReadback, {
      corrections: {
        niche: "solo founder TikTok education",
      },
    });

    await user.mutation(api.creatorMayaV0.backend.pairImessage, {
      phoneNumber: "+15555550123",
    });

    const deploy = await user.mutation(api.creatorMayaV0.backend.deployOpenClaw, {
      mode: "mock",
    });
    expect(deploy.ok).toBe(true);

    const brief = await user.mutation(api.creatorMayaV0.backend.runMorningBrief, {
      nowMs: NOW,
    });
    expect(brief.shouldSend).toBe(true);
    if (!brief.shouldSend) return;
    expect(brief.dailyBrief.message).toContain("Reply \"draft\"");
    expect(brief.dailyBrief.message).toContain("\"schedule\"");

    const firstHold = await user.mutation(
      api.creatorMayaV0.backend.scheduleLatestBriefHold,
      {}
    );
    const secondHold = await user.mutation(
      api.creatorMayaV0.backend.scheduleLatestBriefHold,
      {}
    );
    expect(firstHold.ok).toBe(true);
    expect(secondHold.ok).toBe(true);
    expect(secondHold.idempotent).toBe(true);

    const state = await user.query(api.creatorMayaV0.backend.state, {});
    expect(state?.onboarding.mayaDeployed).toBe(true);
    expect(state?.onboarding.currentStep).toBe("active");
    expect(state?.picture?.niche).toBe("solo founder TikTok education");
    expect(state?.latestDeployment?.deployLabel).toContain("mock:");

    const otherState = await asUser(t, "creator-b").query(
      api.creatorMayaV0.backend.state,
      {}
    );
    expect(otherState).toBeNull();
  });

  it("imports provider calendar lookahead and only marks native iMessage after OpenClaw row is active", async () => {
    const t = convexTest(schema, modules);
    const user = asUser(t, "creator-native");

    const account = await user.mutation(api.creatorMayaV0.backend.getOrCreateAccount, {
      email: "native@example.com",
      timezone: TZ,
      tier: "starter",
    });

    const calendar = await user.mutation(
      api.creatorMayaV0.backend.connectCalendarProvider,
      {
        provider: "google",
        providerMode: "google_api",
        externalAccountId: "ca_google_123",
        timezone: TZ,
        availabilityWindows: [{ startMs: SLOT, endMs: SLOT + 60 * 60 * 1000 }],
        lookaheadEvents: [
          {
            providerEventId: "evt_launch",
            title: "Product launch livestream",
            startMs: Date.UTC(2026, 4, 8, 16),
            endMs: Date.UTC(2026, 4, 8, 17),
          },
        ],
      }
    );
    expect(calendar.providerMode).toBe("google_api");
    expect(calendar.contentArcCount).toBe(3);

    await expect(
      user.mutation(api.creatorMayaV0.backend.markImessagePairedFromNativeChannel, {})
    ).rejects.toThrow("active OpenClaw iMessage pairing required");

    await user.mutation(api.creatorMayaV0.backend.recordLiveOpenClawDeployment, {
      mode: "live_test",
      flyAppId: "maya-cmv0-native",
      machineId: "machine123",
    });

    await t.run((ctx) =>
      ctx.db.insert("pairedChannels", {
        creatorId: account.creatorId,
        channel: "imessage",
        phoneNumber: "+15555550123",
        externalPairingId: "pair_imessage_native",
        externalIdentifier: "imessage:+15555550123",
        status: "active",
        requestedAt: NOW,
        pairedAt: NOW + 1,
      })
    );

    const paired = await user.mutation(
      api.creatorMayaV0.backend.markImessagePairedFromNativeChannel,
      {}
    );
    expect(paired.externalIdentifier).toBe("imessage:+15555550123");

    const state = await user.query(api.creatorMayaV0.backend.state, {});
    expect(state?.creator.mayaFlyAppId).toBe("maya-cmv0-native");
    expect(state?.onboarding.imessagePaired).toBe(true);
    expect(
      state?.calendarEvents.some(
        (event: { source: string }) => event.source === "context"
      )
    ).toBe(true);
    expect(state?.pairedChannels[0]?.status).toBe("active");
  });

  it("disconnects calendar access and removes lookahead context", async () => {
    const t = convexTest(schema, modules);
    const user = asUser(t, "creator-calendar-revoke");

    await user.mutation(api.creatorMayaV0.backend.getOrCreateAccount, {
      email: "calendar-revoke@example.com",
      timezone: TZ,
      tier: "starter",
    });

    await user.mutation(api.creatorMayaV0.backend.connectCalendarProvider, {
      provider: "google",
      providerMode: "google_api",
      externalAccountId: "ca_google_revoke",
      timezone: TZ,
      lookaheadEvents: [
        {
          providerEventId: "evt_revoke",
          title: "Launch prep",
          startMs: Date.UTC(2026, 4, 8, 16),
          endMs: Date.UTC(2026, 4, 8, 17),
        },
      ],
    });

    const before = await user.query(api.creatorMayaV0.backend.state, {});
    expect(before?.calendar?.status).toBe("active");
    expect(before?.calendarEvents).toHaveLength(1);

    await user.mutation(api.creatorMayaV0.backend.disconnectCalendarProvider, {});

    const after = await user.query(api.creatorMayaV0.backend.state, {});
    expect(after?.calendar).toBeNull();
    expect(after?.calendarEvents).toHaveLength(0);
    expect(after?.onboarding.calendarConnected).toBe(false);
  });

  it("keeps outbound brand sends Studio-only and approval-gated", async () => {
    const t = convexTest(schema, modules);
    const starter = asUser(t, "starter");
    await starter.mutation(api.creatorMayaV0.backend.getOrCreateAccount, {
      email: "starter@example.com",
      timezone: TZ,
      tier: "starter",
    });

    await expect(
      starter.mutation(api.creatorMayaV0.backend.queueBrandTarget, {
        brandName: "DeskKit",
        category: "workspace gear",
        contactProvenance: "brand website",
        audienceFit: 0.9,
        contentFit: 0.9,
        timingFit: 0.8,
        valuesFit: 0.8,
        requestedAutonomyLevel: 2,
        creatorApproved: true,
        suppressed: false,
      })
    ).rejects.toThrow("tier gate failed");

    const studio = asUser(t, "studio");
    await studio.mutation(api.creatorMayaV0.backend.getOrCreateAccount, {
      email: "studio@example.com",
      timezone: TZ,
      tier: "studio",
    });
    const queued = await studio.mutation(api.creatorMayaV0.backend.queueBrandTarget, {
      brandName: "DeskKit",
      category: "workspace gear",
      contactProvenance: "brand website",
      audienceFit: 0.9,
      contentFit: 0.9,
      timingFit: 0.8,
      valuesFit: 0.8,
      requestedAutonomyLevel: 2,
      creatorApproved: true,
      suppressed: false,
    });

    expect(queued.canSend).toBe(true);
    expect(queued.fit.score).toBeGreaterThan(0.8);
  });
});
