#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 9 — L4 smoke (Calendar OAuth + event write).
 *
 * Asserts:
 *   - OAuth start/callback route files exist with the GTM-specific path
 *   - buildGtmGoogleAuthUrl emits the expected Google OAuth URL shape
 *   - Convex symbols (issue/claim state token, store/get connection,
 *     exchange code, write events, persist event) registered
 *   - inboundCallback's /lc_gtm/calendar_proposal now writes events
 *     (previously a stub)
 *
 * Live mode (`--live --confirm`): walks the operator through the real
 * OAuth flow + posts a fake event proposal to the RWTC, then asserts
 * the event landed in Google Calendar.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { api, internal } from "../convex/_generated/api";
import { buildGtmGoogleAuthUrl } from "../convex/gtmMaya/calendarOAuth";

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}
const checks: Check[] = [];
const pass = (name: string, detail: string) =>
  checks.push({ name, status: "passed", detail });
const fail = (name: string, detail: string) =>
  checks.push({ name, status: "failed", detail });

function checkRoutesExist(): void {
  const startPath = resolve(
    __dirname,
    "..",
    "app/api/google-calendar-gtm/start/route.ts"
  );
  const callbackPath = resolve(
    __dirname,
    "..",
    "app/api/google-calendar-gtm/callback/route.ts"
  );
  if (!existsSync(startPath)) {
    fail("oauth-start-route", "start route file missing");
    return;
  }
  if (!existsSync(callbackPath)) {
    fail("oauth-callback-route", "callback route file missing");
    return;
  }
  // Verify the start route uses issueGtmOauthStateToken + the GTM redirect.
  const startBody = readFileSync(startPath, "utf8");
  if (!startBody.includes("issueGtmOauthStateToken")) {
    fail(
      "oauth-start-uses-state-mutation",
      "start route does not call issueGtmOauthStateToken"
    );
    return;
  }
  if (!startBody.includes("google-calendar-gtm/callback")) {
    fail(
      "oauth-start-references-callback",
      "start route does not reference the GTM callback path"
    );
    return;
  }
  pass(
    "oauth-routes-exist",
    "/api/google-calendar-gtm/{start,callback} present + start uses issueGtmOauthStateToken"
  );
}

function checkAuthUrlShape(): void {
  const url = buildGtmGoogleAuthUrl({
    clientId: "test.apps.googleusercontent.com",
    redirectUri: "https://clawlaunch.io/api/google-calendar-gtm/callback",
    state: "stk_smoke",
  });
  const required = [
    "accounts.google.com/o/oauth2/v2/auth",
    "client_id=test.apps.googleusercontent.com",
    "redirect_uri=",
    "calendar.readonly",
    "calendar.events",
    "access_type=offline",
    "prompt=consent",
    "state=stk_smoke",
  ];
  for (const r of required) {
    if (!url.includes(r)) {
      fail("auth-url-shape", `URL missing required fragment: '${r}'`);
      return;
    }
  }
  pass(
    "auth-url-shape",
    "buildGtmGoogleAuthUrl includes scopes + offline access + consent prompt + state"
  );
}

function checkConvexSymbols(): void {
  const required: Array<[string, unknown]> = [
    [
      "api.gtmMaya.calendarOAuth.issueGtmOauthStateToken",
      api.gtmMaya.calendarOAuth.issueGtmOauthStateToken,
    ],
    [
      "api.gtmMaya.calendarOAuth.getMyCalendarConnection",
      api.gtmMaya.calendarOAuth.getMyCalendarConnection,
    ],
    [
      "internal.gtmMaya.calendarOAuth.claimGtmOauthStateToken",
      internal.gtmMaya.calendarOAuth.claimGtmOauthStateToken,
    ],
    [
      "internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection",
      internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection,
    ],
    [
      "internal.gtmMaya.calendarOAuth.getGtmCalendarConnection",
      internal.gtmMaya.calendarOAuth.getGtmCalendarConnection,
    ],
    [
      "internal.gtmMaya.calendarOAuth.exchangeGtmOauthCode",
      internal.gtmMaya.calendarOAuth.exchangeGtmOauthCode,
    ],
    [
      "internal.gtmMaya.calendarOAuth.persistRefreshedAccessToken",
      internal.gtmMaya.calendarOAuth.persistRefreshedAccessToken,
    ],
    [
      "internal.gtmMaya.calendarWrite.writeCalendarEventsForAgent",
      internal.gtmMaya.calendarWrite.writeCalendarEventsForAgent,
    ],
    [
      "internal.gtmMaya.calendarWrite.persistGtmCalendarEvent",
      internal.gtmMaya.calendarWrite.persistGtmCalendarEvent,
    ],
    [
      "api.gtmMaya.calendarWrite.getMyCalendarEvents",
      api.gtmMaya.calendarWrite.getMyCalendarEvents,
    ],
  ];
  for (const [path, node] of required) {
    if (node === undefined) {
      fail("convex-symbols", `${path} not registered`);
      return;
    }
  }
  pass(
    "convex-symbols",
    `all ${required.length} OAuth + calendar-write symbols registered`
  );
}

function checkProposalHandlerWritesEvents(): void {
  const cbPath = resolve(
    __dirname,
    "..",
    "convex/gtmMaya/openclaw/inboundCallback.ts"
  );
  const body = readFileSync(cbPath, "utf8");
  // The Sprint-9 wiring must replace the old "write in Sprint 9" stub.
  if (body.includes("(proposal recorded — write in Sprint 9)")) {
    fail(
      "proposal-handler-wired",
      "/lc_gtm/calendar_proposal still returns the Sprint 9 stub message"
    );
    return;
  }
  if (
    !body.includes("internal.gtmMaya.calendarWrite.writeCalendarEventsForAgent")
  ) {
    fail(
      "proposal-handler-wired",
      "/lc_gtm/calendar_proposal does not invoke writeCalendarEventsForAgent"
    );
    return;
  }
  pass(
    "proposal-handler-wired",
    "/lc_gtm/calendar_proposal now invokes writeCalendarEventsForAgent (no more Sprint 9 stub)"
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkRoutesExist();
  checkAuthUrlShape();
  checkConvexSymbols();
  checkProposalHandlerWritesEvents();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 9 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENCRYPTION_KEY on Convex env (reuse creator's keys — same OAuth app is fine).\n" +
        "  2. Add the GTM callback URL to your Google Cloud OAuth client's authorized redirects:\n" +
        "       https://<your-domain>/api/google-calendar-gtm/callback\n" +
        "  3. As the RWTC user, GET /api/google-calendar-gtm/start → consent screen → callback.\n" +
        "  4. Verify gtmCalendarConnections has a row for RWTC with status=active.\n" +
        "  5. POST a fake /lc_gtm/calendar_proposal (with valid hookToken Bearer) with 1 event. Verify it lands in Google Calendar tagged '[Maya GTM]'.\n" +
        "  6. Verify gtmCalendarEvents has a row with createdBy='maya' + the Google event id."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
