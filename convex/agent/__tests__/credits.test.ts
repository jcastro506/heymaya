/** The belt's prices and the ledger's fallback table agree with the vendor's published costs (docs/scrapecreators-credits.json). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDITS_BY_PATH } from "../../integrations/scrapeCreators/platforms/cross";
import { priceFor, TOOL_CREDITS } from "../tools";

const table = JSON.parse(readFileSync(new URL("../../../docs/scrapecreators-credits.json", import.meta.url), "utf8")) as { byPath: Record<string, number> };

describe("credits", () => {
  it("every path we price matches the vendor's number", () => {
    for (const [path, credits] of Object.entries(table.byPath)) {
      if (CREDITS_BY_PATH[path] !== undefined) expect(CREDITS_BY_PATH[path], path).toBe(credits);
    }
    expect(CREDITS_BY_PATH["/v2/tiktok/video"]).toBe(10);
    expect(CREDITS_BY_PATH["/v2/instagram/post/comments"]).toBe(15);
  });
  it("the belt prices post_info at the vendor's 10 and comments by platform", () => {
    expect(TOOL_CREDITS.post_info).toBe(10);
    expect(priceFor("post_comments", { url: "https://www.tiktok.com/@a/video/1" })).toBe(1);
    expect(priceFor("post_comments", { url: "https://www.instagram.com/reel/abc/" })).toBe(15);
    expect(priceFor("publish", {})).toBeUndefined();
  });
});
