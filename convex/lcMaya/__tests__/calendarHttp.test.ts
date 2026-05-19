import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";

const TEST_SECRET = "deadbeef".repeat(8);
const ENCRYPTION_KEY_TEST =
  // 32 bytes of base64 — required by convex/lib/encryption.ts.
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  plan: "coach" | "manager" = "manager"
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_calendar_${suffix}`,
      email: `calendar_${suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/New_York",
      status: "onboarding",
      plan,
      createdAt: NOW,
    })
  );
}

async function storeGoogleConnection(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">
) {
  await t.mutation(
    internal.creatorMayaV0.backend.storeGoogleCalendarOAuthConnectionForCreator,
    {
      creatorId,
      timezone: "America/New_York",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      tokenType: "Bearer",
      scope:
        "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
      lookaheadEvents: [],
    }
  );
}

beforeEach(() => {
  _setWebhookSecretForTests(TEST_SECRET);
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY_TEST;
});

afterEach(() => {
  _setWebhookSecretForTests(null);
  delete process.env.ENCRYPTION_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /lc_maya/calendar_create_maya_event", () => {
  it("creates the Google event, applies popup reminders, and records the Maya sidecar row", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "happy");
    await storeGoogleConnection(t, creatorId);

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("/events?")) {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            id: "google_evt_1",
            htmlLink: "https://calendar.google.com/event?eid=google_evt_1",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const res = await t.fetch("/lc_maya/calendar_create_maya_event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        kind: "content-block",
        start: {
          dateTime: "2026-05-20T14:00:00-04:00",
          timeZone: "America/New_York",
        },
        end: {
          dateTime: "2026-05-20T16:00:00-04:00",
          timeZone: "America/New_York",
        },
        context: {
          filmingFocus: "Wednesday filming",
          ideaCards: ["Kitchen-counter opener", "Deadpan trend response"],
        },
        citedRefs: [
          {
            kind: "post",
            ref: "post_123",
            label: "Recent kitchen-counter post",
          },
        ],
        sourceStandingOrderId: "content_plan_initial",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      googleEventId: "google_evt_1",
      htmlLink: "https://calendar.google.com/event?eid=google_evt_1",
      deduped: false,
    });

    const createCall = calls.find((call) => !call.url.includes("/events?"));
    expect(createCall).toBeDefined();
    const sent = JSON.parse((createCall?.init?.body as string) ?? "{}");
    expect(sent.summary).toContain("Content block");
    expect(sent.description).toContain("Kitchen-counter opener");
    expect(sent.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 30 }],
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("mayaCalendarEvents")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      googleEventId: "google_evt_1",
      kind: "content-block",
      actionable: true,
      sourceStandingOrderId: "content_plan_initial",
    });
  });

  it("rejects occupied slots before creating a Google event", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "conflict");
    await storeGoogleConnection(t, creatorId);

    const fetchSpy = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/events?")) {
        return new Response(JSON.stringify({ items: [{ id: "busy" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ id: "should-not-create" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await t.fetch("/lc_maya/calendar_create_maya_event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        kind: "niche-scroll",
        start: { dateTime: "2026-05-20T14:00:00-04:00" },
        end: { dateTime: "2026-05-20T14:30:00-04:00" },
        citedRefs: [{ kind: "peer", ref: "peer_1", label: "Peer account" }],
      }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "calendar-slot-conflict",
      conflictCount: 1,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
