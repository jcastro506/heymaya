import { describe, expect, it } from "vitest";
import { inspectApp, inspectAppHtml } from "../appInspector";

const HOME_HTML = `
  <html>
    <head>
      <title>BugBrief - Customer bug reports for small teams</title>
      <meta name="description" content="BugBrief helps startup teams turn customer messages into clear bug reports." />
    </head>
    <body>
      <h1>Turn customer messages into bug reports your developers can fix</h1>
      <h2>Connect your support inbox</h2>
      <h2>Analytics dashboard</h2>
      <a>Start free trial</a>
      <p>Built for startup teams, founders, and developers.</p>
    </body>
  </html>
`;

describe("GTM app inspector", () => {
  it("extracts product promise, audience, feature, pricing, and CTA signals from HTML", () => {
    const page = inspectAppHtml("https://bugbrief.test/", 200, HOME_HTML);

    expect(page.title).toContain("BugBrief");
    expect(page.description).toContain("startup teams");
    expect(page.h1).toContain("customer messages");
    expect(page.audienceSignals).toEqual(
      expect.arrayContaining(["founder", "developer", "startup"])
    );
    expect(page.featureSignals).toEqual(
      expect.arrayContaining(["dashboard", "analytics"])
    );
    expect(page.ctaSignals).toContain("start");
  });

  it("crawls standard pages and summarizes the app", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const textUrl = String(url);
      if (textUrl.endsWith("/pricing")) {
        return new Response("<h1>Pricing</h1><p>$19 monthly plan</p>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (textUrl.endsWith("/docs") || textUrl.endsWith("/blog")) {
        return new Response("not found", {
          status: 404,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(HOME_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;

    const diagnosis = await inspectApp("https://bugbrief.test", fetchImpl);

    expect(diagnosis.pages).toHaveLength(4);
    expect(diagnosis.summary.productPromise).toContain("customer messages");
    expect(diagnosis.summary.likelyAudience).toContain("developer");
    expect(diagnosis.summary.visibleFeatures).toContain("analytics");
    expect(diagnosis.summary.missingContext).not.toContain("pricing not visible");
  });

  it("records broken URL failures without fabricating diagnosis", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const diagnosis = await inspectApp("https://broken.test", fetchImpl);

    expect(diagnosis.pages).toEqual([]);
    expect(diagnosis.failures).toHaveLength(4);
    expect(diagnosis.summary.productPromise).toBe(
      "No clear product promise found on crawled pages."
    );
  });
});
