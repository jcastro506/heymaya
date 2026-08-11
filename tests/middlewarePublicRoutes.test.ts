/**
 * ⭐ Server-to-server routes must be public at the Clerk layer.
 *
 * This test exists because two of them weren't, and nothing anywhere said so.
 *
 * `clerkMiddleware` calls `auth.protect()` on anything not matched by
 * `isPublic`, and for a request with no session that answers **404** — chosen
 * deliberately so the app doesn't leak which routes exist. For a machine caller
 * the result is indistinguishable from an undeployed route: the handler never
 * executes, so nothing it would have logged is logged, and the response is a
 * Next.js 404 page rather than anything the route wrote.
 *
 * `/api/billing/stripe-webhook` had never been listed in any commit. It only
 * escaped notice because no real subscription has been processed yet.
 *
 * The route's own tests can't catch this — they invoke the handler directly and
 * no middleware runs. So the check has to be against the route table itself.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PUBLIC_BROWSER_ROUTES,
  PUBLIC_ROUTES,
  SERVER_TO_SERVER_ROUTES,
} from "../middleware";

describe("middleware public routes", () => {
  /**
   * ⭐ The demo is the only thing an anonymous stranger can reach.
   *
   * Sprint 11's exit requires it — "without signing up" — so this asserts the
   * list stays short. Anything added here needs the same guards the demo has:
   * SSRF, per-IP limit, global spend cap.
   */
  it("keeps the anonymous-reachable surface to the demo alone", () => {
    expect([...PUBLIC_BROWSER_ROUTES]).toEqual(["/api/demo/read"]);
    for (const route of PUBLIC_BROWSER_ROUTES) {
      expect(PUBLIC_ROUTES).toContain(route);
    }
  });

  it("lists every server-to-server route as public", () => {
    for (const route of SERVER_TO_SERVER_ROUTES) {
      expect(
        PUBLIC_ROUTES,
        `${route} is called by a machine with its own credential and can never ` +
          `carry a Clerk session. Unlisted, auth.protect() answers 404 and the ` +
          `handler never runs.`
      ).toContain(route);
    }
  });

  it("points every server-to-server entry at a route that exists", () => {
    // A path that no longer exists is worse than useless: it reads as covered.
    for (const route of SERVER_TO_SERVER_ROUTES) {
      const file = join(process.cwd(), "app", route.replace(/^\//, ""), "route.ts");
      expect(() => statSync(file), `${route} → ${file} not found`).not.toThrow();
    }
  });

  /**
   * ⚠️ The reverse direction, and the one that actually catches the next
   * instance: an API route nobody classified.
   *
   * Every route under `app/api` is either browser-called (a Clerk session
   * reaches it, so protection is correct) or machine-called (it must be listed).
   * This asserts the set of API routes hasn't grown without that decision being
   * made — a new webhook added next sprint fails here rather than in production
   * three days after a customer's payment.
   */
  it("has a classification for every API route", () => {
    const apiRoot = join(process.cwd(), "app", "api");
    const found: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, `${prefix}/${entry.name}`);
        else if (entry.name === "route.ts") found.push(prefix);
      }
    };
    walk(apiRoot, "/api");

    /**
     * Browser-called: a signed-in user's session cookie reaches these, so
     * Clerk protecting them is correct and intended.
     */
    const BROWSER_CALLED = [
      "/api/auth/convex-token",
      "/api/account/delete",
      "/api/google-calendar-gtm/start",
      "/api/google-calendar-gtm/callback",
    ];

    const classified = new Set<string>([
      ...SERVER_TO_SERVER_ROUTES,
      ...PUBLIC_BROWSER_ROUTES,
      ...BROWSER_CALLED,
    ]);
    const unclassified = found.filter((r) => !classified.has(r));

    expect(
      unclassified,
      `Unclassified API route(s). Decide who calls each: a browser (leave it ` +
        `protected, add to BROWSER_CALLED here) or a machine (add to ` +
        `SERVER_TO_SERVER_ROUTES in middleware.ts, which also makes it public). ` +
        `Getting this wrong is silent — the route just 404s.`
    ).toEqual([]);
  });
});
