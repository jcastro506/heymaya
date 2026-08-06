/**
 * Creatify Links endpoints — path shape.
 *
 * ⭐ Why this file exists: `createLinkWithParams` posted to
 * `/api/link_with_params/` — dropping the `links/` segment — from the day it
 * was written until 2026-08-06. §7.6.2's rule is *"Always use
 * `link_with_params`. Never let Creatify scrape"*, so the single most
 * load-bearing Creatify call was pointed at a 404.
 *
 * It survived because of a gap this file closes: the Links wrappers had **zero
 * tests**, and we hold no Creatify API key, so nothing ever exercised the path.
 * A vendor path is a stable identifier — exactly the kind of thing the coding
 * conventions say to assert on.
 *
 * Paths verified against the published OpenAPI `paths` section, 2026-08-06.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CreatifyClient } from "../client";
import {
  createLinkFromUrl,
  createLinkWithParams,
  updateLink,
} from "../endpoints";

function client(): { client: CreatifyClient; fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ id: "link-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  return {
    client: new CreatifyClient({
      apiId: "id",
      apiKey: "key",
      baseUrl: "https://creatify.test",
      fetchImpl: fetchMock as unknown as typeof fetch,
    }),
    fetch: fetchMock,
  };
}

function calledPath(fetchMock: ReturnType<typeof vi.fn>): string {
  const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
  return new URL(url).pathname;
}

describe("Creatify Links endpoint paths", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createLinkWithParams posts under /api/links/", async () => {
    const { client: c, fetch } = client();
    await createLinkWithParams({ title: "t", image_urls: ["https://x/1.png"] }, c);
    // The regression this file was written for.
    expect(calledPath(fetch)).toBe("/api/links/link_with_params/");
  });

  it("every Links wrapper stays under the /api/links/ prefix", async () => {
    // A sibling-coherence check: one of these three drifted once, silently.
    const cases: Array<[string, (c: CreatifyClient) => Promise<unknown>]> = [
      ["createLinkFromUrl", (c) => createLinkFromUrl("https://example.test", c)],
      ["createLinkWithParams", (c) => createLinkWithParams({ title: "t" }, c)],
      ["updateLink", (c) => updateLink("link-1", { title: "t" }, c)],
    ];
    for (const [name, call] of cases) {
      const { client: c, fetch } = client();
      await call(c);
      expect(calledPath(fetch), `${name} left the /api/links/ prefix`).toMatch(
        /^\/api\/links\//,
      );
    }
  });

  it("carries the founder-supplied images through verbatim", async () => {
    // §7.6.2: we supply the assets so Creatify never scrapes. If image_urls
    // were dropped or renamed, the render silently falls back to whatever
    // Creatify can find — grounded becomes ungrounded with no error.
    const { client: c, fetch } = client();
    const images = ["https://r2.test/shot-1.png", "https://r2.test/shot-2.png"];
    await createLinkWithParams({ title: "Widgetly", image_urls: images }, c);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(body.image_urls).toEqual(images);
  });
});
