/**
 * `lc_maya.apple_calendar_connect` HTTP endpoint (Sprint 9.8 Workstream B).
 *
 * Maya posts here after the creator pastes their Apple ID + app-specific
 * password back into iMessage. The endpoint validates the credentials by
 * doing a CalDAV login + listing iCloud calendars, then encrypts the
 * password and stores the connection in `appleCalendarConnections`.
 *
 * Body shape:
 *   {
 *     secret: string,
 *     creatorId: Id<"creators">,
 *     appleId: string,                         // user's iCloud email
 *     appPassword: string,                     // xxxx-xxxx-xxxx-xxxx
 *     defaultCalendarHint?: string,            // optional: which calendar
 *                                              //   name to set as default;
 *                                              //   defaults to the first
 *                                              //   one with VEVENT support
 *   }
 *
 * Returns:
 *   - 200 { ok: true, calendarsCount, defaultCalendarUrl, defaultCalendarName }
 *   - 400 malformed body
 *   - 401 wrong webhook secret
 *   - 401 iCloud auth failure → message includes hint to retry with an
 *         app-specific password (NOT the regular Apple ID password)
 *   - 404 creator not found
 *   - 500 unexpected error
 */

import { httpAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { assertWebhookSecret } from "../lib/webhookSecret";
import { encrypt } from "../lib/encryption";
import {
  AppleCaldavError,
  validateAndListCalendars,
} from "../integrations/apple/caldav";

interface AppleConnectPayload {
  secret: string;
  creatorId: string;
  appleId: string;
  appPassword: string;
  defaultCalendarHint?: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parsePayload(raw: unknown): AppleConnectPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.secret !== "string") {
    throw new Error("secret must be a string.");
  }
  if (typeof obj.creatorId !== "string" || obj.creatorId.length === 0) {
    throw new Error("creatorId is required.");
  }
  if (typeof obj.appleId !== "string" || obj.appleId.length === 0) {
    throw new Error("appleId is required.");
  }
  if (typeof obj.appPassword !== "string" || obj.appPassword.length === 0) {
    throw new Error("appPassword is required.");
  }
  // Loose validation — Apple's app passwords are formatted `xxxx-xxxx-xxxx-xxxx`
  // (16 lowercase letters + 3 dashes = 19 chars), but we don't enforce the
  // exact shape here — let iCloud reject malformed credentials with a 401
  // and surface that to the user. This keeps us resilient if Apple ever
  // changes the format.
  if (typeof obj.defaultCalendarHint !== "undefined" &&
      typeof obj.defaultCalendarHint !== "string") {
    throw new Error("defaultCalendarHint must be a string when provided.");
  }
  return {
    secret: obj.secret,
    creatorId: obj.creatorId,
    appleId: obj.appleId.trim(),
    appPassword: obj.appPassword.trim(),
    defaultCalendarHint:
      typeof obj.defaultCalendarHint === "string"
        ? obj.defaultCalendarHint
        : undefined,
  };
}

/** Internal mutation that writes the connection row + clears any prior
 *  apple-calendar connection for the same creator (single-active-conn
 *  invariant — re-pasting overwrites). */
export const upsertAppleCalendarConnectionInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    appleId: v.string(),
    encryptedAppPassword: v.string(),
    appPasswordHash: v.string(),
    principalUrl: v.optional(v.string()),
    defaultCalendarUrl: v.optional(v.string()),
    nowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("creator-not-found");
    }
    // Single-active-connection invariant: delete any prior row for this
    // creator before inserting the new one. Apple users only have one
    // iCloud account; supporting multiple would require a UI affordance
    // we don't have.
    const existing = await ctx.db
      .query("appleCalendarConnections")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }
    const id = await ctx.db.insert("appleCalendarConnections", {
      creatorId: args.creatorId,
      appleId: args.appleId,
      encryptedAppPassword: args.encryptedAppPassword,
      appPasswordHash: args.appPasswordHash,
      principalUrl: args.principalUrl,
      defaultCalendarUrl: args.defaultCalendarUrl,
      status: "active",
      connectedAt: args.nowMs,
      lastValidatedAt: args.nowMs,
    });
    return { id };
  },
});

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const appleCalendarConnectHttp = httpAction(async (ctx, request) => {
  let payload: AppleConnectPayload;
  try {
    payload = parsePayload(await request.json());
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(payload.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // Validate by hitting iCloud CalDAV. If credentials are wrong, this
  // throws AppleCaldavError with status: 401 and we surface a creator-
  // friendly hint about app-specific passwords.
  let calendars;
  try {
    calendars = await validateAndListCalendars({
      appleId: payload.appleId,
      appPassword: payload.appPassword,
    });
  } catch (err) {
    if (err instanceof AppleCaldavError && err.status === 401) {
      return jsonResponse(
        {
          error: "icloud-auth-failed",
          hint:
            "iCloud rejected those credentials. Generate an app-specific password at appleid.apple.com → Sign-In and Security → App-Specific Passwords (NOT your regular Apple ID password) and paste the new one back.",
        },
        401
      );
    }
    return jsonResponse(
      { error: "icloud-validation-failed", message: (err as Error).message },
      500
    );
  }

  if (calendars.length === 0) {
    return jsonResponse(
      {
        error: "no-event-calendars",
        hint:
          "Connected to iCloud but no calendars that accept events were found. Check that at least one calendar exists in iCloud → Calendar (not just Reminders).",
      },
      400
    );
  }

  // Pick the default calendar. Hint match by display name first; otherwise
  // fall back to the first VEVENT-supporting calendar (typically "Home"
  // in iCloud).
  const hinted =
    payload.defaultCalendarHint
      ? calendars.find(
          (c) =>
            c.displayName.toLowerCase() ===
            payload.defaultCalendarHint!.toLowerCase()
        )
      : undefined;
  const defaultCalendar = hinted ?? calendars[0]!;

  // Encrypt + hash the password.
  const encryptedAppPassword = await encrypt(payload.appPassword);
  const appPasswordHash = await sha256Hex(payload.appPassword);

  try {
    await ctx.runMutation(
      internal.lcMaya.appleCalendarConnect.upsertAppleCalendarConnectionInternal,
      {
        creatorId: payload.creatorId as Id<"creators">,
        appleId: payload.appleId,
        encryptedAppPassword,
        appPasswordHash,
        defaultCalendarUrl: defaultCalendar.url,
        nowMs: Date.now(),
      }
    );
  } catch (err) {
    const msg = (err as Error).message ?? "internal-error";
    if (msg === "creator-not-found") {
      return jsonResponse({ error: "creator-not-found" }, 404);
    }
    return jsonResponse({ error: msg }, 500);
  }

  return jsonResponse(
    {
      ok: true,
      calendarsCount: calendars.length,
      defaultCalendarUrl: defaultCalendar.url,
      defaultCalendarName: defaultCalendar.displayName,
      calendars: calendars.map((c) => ({
        url: c.url,
        displayName: c.displayName,
      })),
    },
    200
  );
});
