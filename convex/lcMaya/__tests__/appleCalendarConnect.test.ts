/**
 * `lc_maya.apple_calendar_connect` endpoint tests (Sprint 9.8 Workstream B).
 *
 * The validate-against-iCloud step calls `validateAndListCalendars` which
 * hits the live iCloud CalDAV server. We mock that module so tests never
 * touch the network — the endpoint's logic (parse + auth + encrypt +
 * upsert + response shape) is what we cover.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";
import * as caldavModule from "../../integrations/apple/caldav";

const TEST_SECRET = "deadbeef".repeat(8);
const ENCRYPTION_KEY_TEST =
  // 32 bytes of base64 — required by convex/lib/encryption.ts.
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_apple_${suffix}`,
      email: `apple_${suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/New_York",
      status: "onboarding",
      plan: "manager",
      createdAt: 1_700_000_000_000,
    })
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
});

describe("POST /lc_maya/apple_calendar_connect", () => {
  it("HAPPY: validates with iCloud, encrypts password, stores connection, returns 200", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "h1");

    vi.spyOn(caldavModule, "validateAndListCalendars").mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123/calendars/home/",
        displayName: "Home",
        components: ["VEVENT"],
      },
      {
        url: "https://caldav.icloud.com/123/calendars/work/",
        displayName: "Work",
        components: ["VEVENT"],
      },
    ]);

    const res = await t.fetch("/lc_maya/apple_calendar_connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        appleId: "kevin@example.com",
        appPassword: "abcd-efgh-ijkl-mnop",
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      calendarsCount: number;
      defaultCalendarUrl: string;
      defaultCalendarName: string;
    };
    expect(json.ok).toBe(true);
    expect(json.calendarsCount).toBe(2);
    expect(json.defaultCalendarName).toBe("Home");

    // The connection row exists, password is encrypted (not the plaintext).
    const row = await t.run((ctx) =>
      ctx.db
        .query("appleCalendarConnections")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(row).not.toBeNull();
    expect(row?.appleId).toBe("kevin@example.com");
    expect(row?.encryptedAppPassword).not.toBe("abcd-efgh-ijkl-mnop");
    expect(row?.encryptedAppPassword.length).toBeGreaterThan(20);
    expect(row?.status).toBe("active");
    expect(row?.defaultCalendarUrl).toBe(
      "https://caldav.icloud.com/123/calendars/home/"
    );
  });

  it("HAPPY: defaultCalendarHint matches by name (case-insensitive)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "h2");

    vi.spyOn(caldavModule, "validateAndListCalendars").mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123/calendars/home/",
        displayName: "Home",
        components: ["VEVENT"],
      },
      {
        url: "https://caldav.icloud.com/123/calendars/work/",
        displayName: "Work",
        components: ["VEVENT"],
      },
    ]);

    const res = await t.fetch("/lc_maya/apple_calendar_connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        appleId: "k@x.com",
        appPassword: "wxyz-wxyz-wxyz-wxyz",
        defaultCalendarHint: "work",
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { defaultCalendarName: string };
    expect(json.defaultCalendarName).toBe("Work");
  });

  it("HAPPY: re-pasting overwrites the prior connection (single-active-conn invariant)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "h3");

    vi.spyOn(caldavModule, "validateAndListCalendars").mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123/calendars/home/",
        displayName: "Home",
        components: ["VEVENT"],
      },
    ]);

    // First paste.
    await t.fetch("/lc_maya/apple_calendar_connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        appleId: "k@x.com",
        appPassword: "aaaa-aaaa-aaaa-aaaa",
      }),
    });

    // Second paste — different password.
    await t.fetch("/lc_maya/apple_calendar_connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        appleId: "k@x.com",
        appPassword: "bbbb-bbbb-bbbb-bbbb",
      }),
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("appleCalendarConnections")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows).toHaveLength(1);
  });

  it("ADVERSARIAL: iCloud 401 surfaces creator-friendly hint about app-specific passwords", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "a1");

    vi.spyOn(caldavModule, "validateAndListCalendars").mockRejectedValue(
      new caldavModule.AppleCaldavError("auth-failed", undefined, 401)
    );

    const res = await t.fetch("/lc_maya/apple_calendar_connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        appleId: "k@x.com",
        appPassword: "wrong",
      }),
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string; hint: string };
    expect(json.error).toBe("icloud-auth-failed");
    expect(json.hint).toContain("appleid.apple.com");
    expect(json.hint).toContain("app-specific password");

    // No connection row written.
    const row = await t.run((ctx) =>
      ctx.db
        .query("appleCalendarConnections")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(row).toBeNull();
  });

  it("ADVERSARIAL: zero VEVENT-supporting calendars returns 400 with hint", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "a2");

    vi.spyOn(caldavModule, "validateAndListCalendars").mockResolvedValue([]);

    const res = await t.fetch("/lc_maya/apple_calendar_connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        appleId: "k@x.com",
        appPassword: "abcd-efgh-ijkl-mnop",
      }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("no-event-calendars");
  });

  it("ADVERSARIAL: missing/wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "a3");
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/apple_calendar_connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: bad,
          creatorId,
          appleId: "k@x.com",
          appPassword: "abcd-efgh-ijkl-mnop",
        }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: missing fields return 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "a4");
    const cases = [
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, appleId: "k@x.com" }),
        label: "missing-appPassword",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, appPassword: "x" }),
        label: "missing-appleId",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, appleId: "k@x.com", appPassword: "x" }),
        label: "missing-creatorId",
      },
    ];
    for (const c of cases) {
      const res = await t.fetch("/lc_maya/apple_calendar_connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: c.body,
      });
      expect(res.status, c.label).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, "a5");
    await t.run((ctx) => ctx.db.delete(creatorId));

    vi.spyOn(caldavModule, "validateAndListCalendars").mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123/calendars/home/",
        displayName: "Home",
        components: ["VEVENT"],
      },
    ]);

    const res = await t.fetch("/lc_maya/apple_calendar_connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        appleId: "k@x.com",
        appPassword: "abcd-efgh-ijkl-mnop",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("CROSS-TENANT: connecting creator A leaves creator B with no row", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, "ta");
    const b = await insertCreator(t, "tb");

    vi.spyOn(caldavModule, "validateAndListCalendars").mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123/calendars/home/",
        displayName: "Home",
        components: ["VEVENT"],
      },
    ]);

    await t.fetch("/lc_maya/apple_calendar_connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId: a,
        appleId: "a@x.com",
        appPassword: "aaaa-aaaa-aaaa-aaaa",
      }),
    });

    const rowA = await t.run((ctx) =>
      ctx.db
        .query("appleCalendarConnections")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .first()
    );
    const rowB = await t.run((ctx) =>
      ctx.db
        .query("appleCalendarConnections")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .first()
    );
    expect(rowA).not.toBeNull();
    expect(rowB).toBeNull();
  });
});
