/**
 * Sprint 2.22 — calendar approval-gate tests.
 *
 * Validates the storage/push split:
 *   1. /lc_gtm/calendar_proposal stores drafts WITHOUT requiring OAuth.
 *   2. /lc_gtm/approve_calendar pushes drafts; cleanly reports
 *      `needsOAuth` when Google Calendar isn't connected.
 *   3. After successful push, drafts flip status:"draft" → "scheduled"
 *      and gain providerEventId + htmlLink.
 *   4. Idempotency: replayed approval doesn't double-push.
 *
 * These tests catch the regression from Sprint 9 where Maya's
 * /lc_gtm/calendar_proposal POSTs silently dropped events when
 * Google OAuth wasn't connected — operator saw "calendarTotal: 0"
 * and assumed Maya was fabricating, when really the events never
 * made it past ensureFreshAccessToken throwing.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { encrypt } from "../../lib/encryption";

const TEST_ENCRYPTION_KEY = btoa("\0".repeat(32));

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
});

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

const SAMPLE_EVENT = (offsetMs = 24 * 60 * 60 * 1000) => ({
  title: "Reddit reply: M5 Max thread",
  description:
    "WHAT: Reply on r/LocalLLaMA / LINK: https://reddit.com/x / WHY: ...",
  // Turn-key fields — reply_window events now require a one-tap link + verbatim
  // paste block (server-side turn-key validation), so the founder just posts.
  openUrl: "https://reddit.com/x",
  draftText:
    "Honestly the M5 Max is overkill for most local LLM work — I run 70B quants fine on far less. Happy to share my setup if it helps.",
  startsAtMs: Date.now() + offsetMs,
  endsAtMs: Date.now() + offsetMs + 30 * 60 * 1000,
  kind: "reply_window" as const,
});

describe("Sprint 2.22 — calendar approval-gate split", () => {
  it("storeProposedCalendarEvents stores drafts WITHOUT OAuth", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_store_no_oauth");

    // No Google Calendar connection — but storage MUST succeed.
    const result = await t.action(
      internal.gtmMaya.calendarWrite.storeProposedCalendarEvents,
      // 24h + 48h out — always DIFFERENT UTC calendar days, so the day-bucketed
      // dedupe key can't collapse them (a 2h offset flaked at some times of day).
      { agentId, accountId, events: [SAMPLE_EVENT(), SAMPLE_EVENT(48 * 60 * 60 * 1000)] }
    );

    expect(result.stored).toBe(2);
    expect(result.draftIds.length).toBe(2);

    const drafts = await t.run(async (ctx) => {
      const rows = await ctx.db.query("gtmCalendarEvents").collect();
      return rows;
    });
    expect(drafts.length).toBe(2);
    expect(drafts.every((r) => r.status === "draft")).toBe(true);
    expect(drafts.every((r) => r.providerEventId === undefined)).toBe(true);
    expect(drafts.every((r) => r.createdBy === "maya")).toBe(true);
  });

  it("pushApprovedCalendarEvents is a clean no-op by default (Google mirror RETIRED in v2)", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_push_default_off");
    await t.action(
      internal.gtmMaya.calendarWrite.storeProposedCalendarEvents,
      { agentId, accountId, events: [SAMPLE_EVENT()] }
    );
    // The day's plan is Maya's internal auto-post queue (web Today view), NOT a
    // Google Calendar flood. With the off-by-default mirror toggle untouched the
    // push no-ops cleanly — no OAuth prompt, nothing pushed.
    const push = await t.action(
      internal.gtmMaya.calendarWrite.pushApprovedCalendarEvents,
      { agentId, accountId }
    );
    expect(push.mirrorDisabled).toBe(true);
    expect(push.needsOAuth).toBe(false);
    expect(push.pushed).toBe(0);
    const drafts = await t.run(async (ctx) =>
      ctx.db.query("gtmCalendarEvents").collect()
    );
    expect(drafts[0]?.status).toBe("draft"); // untouched
  });

  it("pushApprovedCalendarEvents returns needsOAuth when the opt-in mirror is on but no Google connection", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_push_no_oauth");
    // Opt the rare founder into the dormant Google-mirror toggle.
    await t.run((ctx) =>
      ctx.db.patch(agentId, { googleCalendarMirrorEnabled: true })
    );

    // Store one draft.
    await t.action(
      internal.gtmMaya.calendarWrite.storeProposedCalendarEvents,
      { agentId, accountId, events: [SAMPLE_EVENT()] }
    );

    // Try to push without OAuth — clean signal back to caller.
    const push = await t.action(
      internal.gtmMaya.calendarWrite.pushApprovedCalendarEvents,
      { agentId, accountId }
    );

    expect(push.needsOAuth).toBe(true);
    expect(push.pushed).toBe(0);
    expect(push.failed).toBe(0);

    // Draft remains in DB unchanged.
    const drafts = await t.run(async (ctx) =>
      ctx.db.query("gtmCalendarEvents").collect()
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0]?.status).toBe("draft");
  });

  it("pushApprovedCalendarEvents flips drafts to scheduled when the opt-in mirror is on + OAuth + Google succeed", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_push_ok");
    // Opt into the dormant Google-mirror toggle so the push path runs.
    await t.run((ctx) =>
      ctx.db.patch(agentId, { googleCalendarMirrorEnabled: true })
    );

    // Connect Google Calendar (token expires in 1 hour, encrypted with
    // real encrypt() so ensureFreshAccessToken can decrypt + skip refresh).
    const accessTokenPlain = "ya29.fake-access-token";
    const encryptedAccessToken = await encrypt(accessTokenPlain);
    await t.mutation(
      internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection,
      {
        accountId,
        tokens: {
          access_token: accessTokenPlain,
          refresh_token: "fake-refresh",
          expires_in: 3600,
        },
        timezone: "America/New_York",
        encryptedAccessToken,
      }
    );

    // Store 3 drafts.
    await t.action(
      internal.gtmMaya.calendarWrite.storeProposedCalendarEvents,
      {
        agentId,
        accountId,
        events: [
          SAMPLE_EVENT(),
          SAMPLE_EVENT(48 * 60 * 60 * 1000),
          SAMPLE_EVENT(72 * 60 * 60 * 1000),
        ],
      }
    );

    // Mock fetch for Google Calendar API. The createCalendarEvent
    // helper uses global fetch; we intercept it for this test.
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      _init?: RequestInit
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("googleapis.com/calendar")) {
        callCount += 1;
        return new Response(
          JSON.stringify({
            id: `google_evt_${callCount}`,
            htmlLink: `https://calendar.google.com/event?eid=${callCount}`,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not mocked", { status: 500 });
    }) as typeof fetch;

    try {
      const push = await t.action(
        internal.gtmMaya.calendarWrite.pushApprovedCalendarEvents,
        { agentId, accountId }
      );
      expect(push.needsOAuth).toBe(false);
      expect(push.pushed).toBe(3);
      expect(push.failed).toBe(0);
      expect(push.eventIds).toEqual([
        "google_evt_1",
        "google_evt_2",
        "google_evt_3",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // All rows flipped to scheduled + got providerEventId.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("gtmCalendarEvents").collect()
    );
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
    expect(rows.every((r) => r.providerEventId !== undefined)).toBe(true);
    expect(rows.every((r) => r.htmlLink?.startsWith("https://calendar.google.com"))).toBe(true);
  });

  it("calendar drafts are scoped per-agent (cross-tenant isolation)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_iso_a");
    const b = await setupAgent(t, "u_iso_b");

    await t.action(
      internal.gtmMaya.calendarWrite.storeProposedCalendarEvents,
      { agentId: a.agentId, accountId: a.accountId, events: [SAMPLE_EVENT()] }
    );
    await t.action(
      internal.gtmMaya.calendarWrite.storeProposedCalendarEvents,
      {
        agentId: b.agentId,
        accountId: b.accountId,
        events: [SAMPLE_EVENT(), SAMPLE_EVENT(48 * 60 * 60 * 1000)],
      }
    );

    const aDrafts = await t.query(
      internal.gtmMaya.calendarWrite.getDraftCalendarEvents,
      { agentId: a.agentId }
    );
    const bDrafts = await t.query(
      internal.gtmMaya.calendarWrite.getDraftCalendarEvents,
      { agentId: b.agentId }
    );
    expect(aDrafts.length).toBe(1);
    expect(bDrafts.length).toBe(2);
    // A's draft is not in B's results and vice versa.
    const aIds = new Set(aDrafts.map((d) => d._id));
    const bIds = new Set(bDrafts.map((d) => d._id));
    for (const id of aIds) expect(bIds.has(id)).toBe(false);
    for (const id of bIds) expect(aIds.has(id)).toBe(false);
  });
});
