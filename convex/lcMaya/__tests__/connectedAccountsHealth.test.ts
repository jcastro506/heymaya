/**
 * Sprint 12.7.1 — connected_accounts_health endpoint tests.
 *
 * The Kevin re-onboard failure (2026-05-11) had Maya confabulating
 * `/lc_maya/connected_accounts_health` (404), then trying calendar_list_events
 * as a proxy with the wrong payload (400). This endpoint is the answer:
 * one canonical "is the OAuth landed?" check with simple args.
 *
 * Five mandatory categories:
 *   1. Cross-tenant — health check returns ONLY the creator from body.
 *   2. Plan-tier × action — open to all plan tiers (asserted).
 *   3. Adversarial — missing/wrong secret 401; malformed body 400;
 *      missing creator 404.
 *   4. Sibling — endpoint reads from `creatorMayaV0CalendarConnections`
 *      (the same table the live OAuth callback writes to); no parallel
 *      shadow storage.
 *   5. TODO grep — covered repo-wide.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";

const TEST_SECRET = "deadbeef".repeat(8);
const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

async function seedGoogleConnection(
  t: ReturnType<typeof convexTest>,
  args: {
    creatorId: Id<"creators">;
    scope: string;
    expiresAt?: number;
  }
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("creatorMayaV0CalendarConnections", {
      creatorId: args.creatorId,
      provider: "google" as const,
      providerMode: "google_api" as const,
      oauthAccessToken: "encrypted-fake",
      oauthRefreshToken: "encrypted-fake-refresh",
      oauthExpiresAt: args.expiresAt ?? NOW + 3_600_000,
      oauthScope: args.scope,
      timezone: "America/Los_Angeles",
      scopes: args.scope.split(/\s+/).filter((s) => s.length > 0),
      canCreateHolds: true,
      connectedAt: NOW,
      status: "active" as const,
    })
  );
}

describe("POST /lc_maya/connected_accounts_health", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: no connection → calendar/gmail both connected=false", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "empty", plan: "manager" });
    const res = await t.fetch("/lc_maya/connected_accounts_health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.calendar.connected).toBe(false);
    expect(json.gmail.connected).toBe(false);
    expect(json.apple_calendar.connected).toBe(false);
  });

  it("HAPPY: Google connection with calendar + gmail scopes → both connected=true (Kevin's actual state)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "kevin", plan: "manager" });
    await seedGoogleConnection(t, {
      creatorId,
      scope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.modify",
    });
    const res = await t.fetch("/lc_maya/connected_accounts_health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.calendar.connected).toBe(true);
    expect(json.calendar.provider).toBe("google");
    expect(json.gmail.connected).toBe(true);
    expect(json.calendar.scopes).toContain(
      "https://www.googleapis.com/auth/calendar.events"
    );
    expect(json.gmail.scopes).toContain(
      "https://www.googleapis.com/auth/gmail.modify"
    );
    expect(typeof json.calendar.expiresAt).toBe("number");
  });

  it("HAPPY: calendar-only scopes (no gmail) → gmail.connected=false", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "cal", plan: "manager" });
    await seedGoogleConnection(t, {
      creatorId,
      scope:
        "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
    });
    const res = await t.fetch("/lc_maya/connected_accounts_health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.calendar.connected).toBe(true);
    expect(json.gmail.connected).toBe(false);
  });

  it("CROSS-TENANT: creator A's health check returns A's connection only, never B's", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "tnA", plan: "manager" });
    const creatorB = await insertCreator(t, { suffix: "tnB", plan: "manager" });
    await seedGoogleConnection(t, {
      creatorId: creatorB,
      scope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify",
    });
    // A has no connection; B does. Querying A should report A's empty state.
    const res = await t.fetch("/lc_maya/connected_accounts_health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId: creatorA }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.calendar.connected).toBe(false);
    expect(json.gmail.connected).toBe(false);
  });

  it("PLAN-TIER: both coach and manager creators can call (API surface open)", async () => {
    for (const plan of ["coach", "manager"] as const) {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, { suffix: `pt-${plan}`, plan });
      const res = await t.fetch("/lc_maya/connected_accounts_health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
      });
      expect(res.status, `plan=${plan}`).toBe(200);
    }
  });

  it("ADVERSARIAL: missing / wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "advs", plan: "manager" });
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/connected_accounts_health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: bad, creatorId }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: malformed body returns 400", async () => {
    const t = convexTest(schema, modules);
    const cases = [
      { body: "not-json", label: "non-json" },
      { body: JSON.stringify({}), label: "missing-secret" },
      { body: JSON.stringify({ secret: TEST_SECRET }), label: "missing-creatorId" },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId: "" }),
        label: "empty-creatorId",
      },
    ];
    for (const { body, label } of cases) {
      const res = await t.fetch("/lc_maya/connected_accounts_health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status, `case=${label}`).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "404", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(creatorId));
    const res = await t.fetch("/lc_maya/connected_accounts_health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(404);
  });
});
