import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

function user(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
}

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = user(t, subject);
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App for ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  // Plant a Fly app id + hookToken on the gtmAgents row directly via the db
  // run helper, since S16 deploy provisioning isn't yet shipped.
  const flyAppId = `maya-gtm-${subject}`;
  const hookToken = `hook-${subject}-${Math.random().toString(36).slice(2, 10)}`;
  const accountId = started.accountId;
  const agentId = started.agentId;
  await t.run((ctx) =>
    ctx.db.patch(agentId, {
      openClawFlyAppId: flyAppId,
      hookToken,
      updatedAt: Date.now(),
    })
  );
  return { authed, accountId, flyAppId, hookToken };
}

describe("Sprint 14 — delivery failures endpoint", () => {
  it("records a failure on first occurrence", async () => {
    const t = convexTest(schema, modules);
    const { authed, flyAppId } = await setupAgent(t, "u_df_first");
    await t.mutation(internal.gtmMaya.deliveryFailures.recordDeliveryFailure, {
      agentFlyAppId: flyAppId,
      cronJobId: "gtm_heartbeat",
      channel: "telegram",
      recipient: "555111222",
      errorClass: "channel_blocked",
      errorMessage: "user blocked the bot",
      attempt: 1,
    });
    const rows = await authed.query(
      api.gtmMaya.deliveryFailures.getMyDeliveryFailures,
      {}
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.errorClass).toBe("channel_blocked");
    expect(rows[0]?.attemptCount).toBe(1);
  });

  it("dedupes by (agentId, cronJobId) — second failure increments instead of inserting", async () => {
    const t = convexTest(schema, modules);
    const { authed, flyAppId } = await setupAgent(t, "u_df_dedupe");
    for (let i = 1; i <= 3; i++) {
      await t.mutation(
        internal.gtmMaya.deliveryFailures.recordDeliveryFailure,
        {
          agentFlyAppId: flyAppId,
          cronJobId: "gtm_heartbeat",
          channel: "telegram",
          recipient: "555111222",
          errorClass: "channel_blocked",
          attempt: 1,
        }
      );
    }
    const rows = await authed.query(
      api.gtmMaya.deliveryFailures.getMyDeliveryFailures,
      {}
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attemptCount).toBe(3);
  });

  it("creates separate rows per cronJobId", async () => {
    const t = convexTest(schema, modules);
    const { authed, flyAppId } = await setupAgent(t, "u_df_per_cron");
    for (const cron of ["gtm_heartbeat", "gtm_calendar_check", "gtm_weekly_review"]) {
      await t.mutation(
        internal.gtmMaya.deliveryFailures.recordDeliveryFailure,
        {
          agentFlyAppId: flyAppId,
          cronJobId: cron,
          channel: "telegram",
          recipient: "555111222",
          errorClass: "channel_blocked",
          attempt: 1,
        }
      );
    }
    const rows = await authed.query(
      api.gtmMaya.deliveryFailures.getMyDeliveryFailures,
      {}
    );
    expect(rows).toHaveLength(3);
  });

  it("isolates failures cross-tenant", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_df_iso_a");
    const b = await setupAgent(t, "u_df_iso_b");
    for (let i = 0; i < 4; i++) {
      await t.mutation(
        internal.gtmMaya.deliveryFailures.recordDeliveryFailure,
        {
          agentFlyAppId: a.flyAppId,
          cronJobId: "gtm_heartbeat",
          channel: "telegram",
          recipient: "555111222",
          errorClass: "channel_blocked",
          attempt: 1,
        }
      );
    }
    const aRows = await a.authed.query(
      api.gtmMaya.deliveryFailures.getMyDeliveryFailures,
      {}
    );
    const bRows = await b.authed.query(
      api.gtmMaya.deliveryFailures.getMyDeliveryFailures,
      {}
    );
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(0);
  });

  it("returns null when agentFlyAppId is unknown — never throws", async () => {
    const t = convexTest(schema, modules);
    await setupAgent(t, "u_df_unknown");
    const result = await t.mutation(
      internal.gtmMaya.deliveryFailures.recordDeliveryFailure,
      {
        agentFlyAppId: "maya-gtm-unknown",
        cronJobId: "gtm_heartbeat",
        channel: "telegram",
        recipient: "555111222",
        errorClass: "channel_blocked",
        attempt: 1,
      }
    );
    expect(result).toBeNull();
  });

  it("getAgentForDeliveryAuth returns null for unknown fly app, agent + token for known", async () => {
    const t = convexTest(schema, modules);
    const { flyAppId, hookToken } = await setupAgent(t, "u_df_auth_lookup");
    const known = await t.query(
      internal.gtmMaya.deliveryFailures.getAgentForDeliveryAuth,
      { agentFlyAppId: flyAppId }
    );
    expect(known?.hookToken).toBe(hookToken);
    const unknown = await t.query(
      internal.gtmMaya.deliveryFailures.getAgentForDeliveryAuth,
      { agentFlyAppId: "maya-gtm-ghost" }
    );
    expect(unknown).toBeNull();
  });
});
