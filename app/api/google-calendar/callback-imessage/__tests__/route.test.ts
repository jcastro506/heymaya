import { afterEach, describe, expect, it } from "vitest";

import { convexHttpUrlForGoogleCalendarCallback } from "../route";

describe("iMessage Google Calendar OAuth callback config", () => {
  const originalHttpUrl = process.env.NEXT_PUBLIC_CONVEX_HTTP_URL;
  const originalSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_CONVEX_HTTP_URL = originalHttpUrl;
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = originalSiteUrl;
  });

  it("prefers the explicit Convex HTTP URL", () => {
    process.env.NEXT_PUBLIC_CONVEX_HTTP_URL = "https://http.convex.site";
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://site.convex.site";

    expect(convexHttpUrlForGoogleCalendarCallback()).toBe(
      "https://http.convex.site"
    );
  });

  it("falls back to the documented Convex site URL", () => {
    delete process.env.NEXT_PUBLIC_CONVEX_HTTP_URL;
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://site.convex.site";

    expect(convexHttpUrlForGoogleCalendarCallback()).toBe(
      "https://site.convex.site"
    );
  });
});
