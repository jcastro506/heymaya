import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { buildGtmGoogleAuthUrl } from "../calendarOAuth";

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
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
  return { authed, accountId: started.accountId, agentId: started.agentId };
}

describe("Sprint 9 — calendarOAuth pure helpers", () => {
  it("buildGtmGoogleAuthUrl emits the right URL shape", () => {
    const url = buildGtmGoogleAuthUrl({
      clientId: "client-abc.apps.googleusercontent.com",
      redirectUri: "https://clawlaunch.io/api/google-calendar-gtm/callback",
      state: "tok-xyz",
    });
    expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("client_id=client-abc");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("state=tok-xyz");
  });
});

describe("Sprint 9 — issue/claim state tokens", () => {
  it("issueGtmOauthStateToken creates a fresh token bound to the signed-in account", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId } = await setupAgent(t, "u_oauth_issue");
    const out = await authed.mutation(
      api.gtmMaya.calendarOAuth.issueGtmOauthStateToken,
      {}
    );
    expect(out.token.length).toBeGreaterThan(20);
    expect(out.expiresAt).toBeGreaterThan(Date.now());

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("gtmOauthStateTokens")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.claimedAt).toBeUndefined();
  });

  it("issueGtmOauthStateToken rejects when not signed in", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.gtmMaya.calendarOAuth.issueGtmOauthStateToken, {})
    ).rejects.toThrow("signed-in user required");
  });

  it("claimGtmOauthStateToken returns accountId+agentId atomically + rejects re-claim", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_oauth_claim");
    const out = await authed.mutation(
      api.gtmMaya.calendarOAuth.issueGtmOauthStateToken,
      {}
    );
    const claim = await t.mutation(
      internal.gtmMaya.calendarOAuth.claimGtmOauthStateToken,
      { token: out.token }
    );
    expect(claim.accountId).toBe(accountId);
    expect(claim.agentId).toBe(agentId);
    await expect(
      t.mutation(internal.gtmMaya.calendarOAuth.claimGtmOauthStateToken, {
        token: out.token,
      })
    ).rejects.toThrow("already claimed");
  });

  it("claimGtmOauthStateToken rejects expired tokens", async () => {
    const t = convexTest(schema, modules);
    const { authed } = await setupAgent(t, "u_oauth_expired");
    const out = await authed.mutation(
      api.gtmMaya.calendarOAuth.issueGtmOauthStateToken,
      {}
    );
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("gtmOauthStateTokens")
        .withIndex("by_token", (q) => q.eq("token", out.token))
        .first();
      if (row) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 });
    });
    await expect(
      t.mutation(internal.gtmMaya.calendarOAuth.claimGtmOauthStateToken, {
        token: out.token,
      })
    ).rejects.toThrow("expired");
  });

  it("claimGtmOauthStateToken rejects unknown tokens", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.gtmMaya.calendarOAuth.claimGtmOauthStateToken, {
        token: "totally-bogus",
      })
    ).rejects.toThrow("not found");
  });
});

describe("Sprint 9 — storeGtmCalendarConnection", () => {
  beforeEach(() => {
    // ENCRYPTION_KEY must be set for the (separate) exchange flow; the
    // store mutation itself takes pre-encrypted blobs and doesn't call
    // encrypt(), so no env needed here.
  });
  afterEach(() => {
    /* noop */
  });

  it("inserts a new connection row + remains idempotent on re-store", async () => {
    const t = convexTest(schema, modules);
    const { accountId } = await setupAgent(t, "u_conn_insert");
    await t.mutation(
      internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection,
      {
        accountId,
        tokens: { access_token: "a", expires_in: 3600, token_type: "Bearer" },
        timezone: "America/New_York",
        encryptedAccessToken: "enc-a",
      }
    );
    let conn = await t.query(
      internal.gtmMaya.calendarOAuth.getGtmCalendarConnection,
      { accountId }
    );
    expect(conn).not.toBeNull();
    expect(conn?.oauthAccessToken).toBe("enc-a");
    expect(conn?.timezone).toBe("America/New_York");
    expect(conn?.status).toBe("active");

    // Re-store with a refreshed token bundle (no refresh token returned).
    await t.mutation(
      internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection,
      {
        accountId,
        tokens: { access_token: "a2", expires_in: 3600 },
        timezone: "America/New_York",
        encryptedAccessToken: "enc-a2",
      }
    );
    conn = await t.query(
      internal.gtmMaya.calendarOAuth.getGtmCalendarConnection,
      { accountId }
    );
    expect(conn?.oauthAccessToken).toBe("enc-a2");

    // Confirm only one row exists.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("gtmCalendarConnections")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    );
    expect(rows).toHaveLength(1);
  });

  it("does not overwrite stored refresh_token with undefined on re-store", async () => {
    const t = convexTest(schema, modules);
    const { accountId } = await setupAgent(t, "u_conn_refresh");
    await t.mutation(
      internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection,
      {
        accountId,
        tokens: {
          access_token: "a",
          refresh_token: "r",
          expires_in: 3600,
        },
        timezone: "UTC",
        encryptedAccessToken: "enc-a",
        encryptedRefreshToken: "enc-r",
      }
    );
    // Re-store WITHOUT a refresh token (common — Google only returns
    // refresh on first consent with prompt=consent).
    await t.mutation(
      internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection,
      {
        accountId,
        tokens: { access_token: "a2", expires_in: 3600 },
        timezone: "UTC",
        encryptedAccessToken: "enc-a2",
      }
    );
    const conn = await t.query(
      internal.gtmMaya.calendarOAuth.getGtmCalendarConnection,
      { accountId }
    );
    expect(conn?.oauthRefreshToken).toBe("enc-r"); // preserved
  });

  it("getMyCalendarConnection returns false-shape when not connected", async () => {
    const t = convexTest(schema, modules);
    const { authed } = await setupAgent(t, "u_conn_unconnected");
    const status = await authed.query(
      api.gtmMaya.calendarOAuth.getMyCalendarConnection,
      {}
    );
    expect(status?.connected).toBe(false);
  });

  it("getMyCalendarConnection returns connected:true once connection exists", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId } = await setupAgent(t, "u_conn_get_my");
    await t.mutation(
      internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection,
      {
        accountId,
        tokens: { access_token: "a" },
        timezone: "America/New_York",
        encryptedAccessToken: "enc-a",
      }
    );
    const status = await authed.query(
      api.gtmMaya.calendarOAuth.getMyCalendarConnection,
      {}
    );
    expect(status?.connected).toBe(true);
    expect(status?.timezone).toBe("America/New_York");
  });

  it("getMyCalendarConnection isolates cross-tenant", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_conn_iso_a");
    const b = await setupAgent(t, "u_conn_iso_b");
    await t.mutation(
      internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection,
      {
        accountId: a.accountId,
        tokens: { access_token: "x" },
        timezone: "UTC",
        encryptedAccessToken: "enc-x",
      }
    );
    const bStatus = await b.authed.query(
      api.gtmMaya.calendarOAuth.getMyCalendarConnection,
      {}
    );
    expect(bStatus?.connected).toBe(false);
  });
});

describe("Sprint 9 — persistGtmCalendarEvent", () => {
  it("inserts an event tagged createdBy=maya, status=scheduled", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, agentId } = await setupAgent(t, "u_evt_insert");
    const id = await t.mutation(
      internal.gtmMaya.calendarWrite.persistGtmCalendarEvent,
      {
        accountId,
        agentId,
        providerEventId: "google_evt_1",
        htmlLink: "https://calendar.google.com/event?eid=evt1",
        title: "Maya: post X thread @ 9am Tue",
        description: "5 tweets, hook + 2 proof beats",
        startsAtMs: Date.now() + 24 * 60 * 60 * 1000,
        endsAtMs: Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000,
        timezone: "America/New_York",
      }
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.createdBy).toBe("maya");
    expect(row?.status).toBe("scheduled");
    expect(row?.providerEventId).toBe("google_evt_1");

    const allMine = await authed.query(
      api.gtmMaya.calendarWrite.getMyCalendarEvents,
      {}
    );
    expect(allMine.length).toBe(1);
    expect(allMine[0]?.title).toContain("X thread");
  });
});
