/** A failed read is remembered (1,000-creator test: 754 credits re-reading handles that don't exist). */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { isNotFound } from "../cache";

describe("remembered failures", () => {
  it("a missing account is remembered for a day; an outage for minutes", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    for (const [key, err] of [["gone", 'ScrapeCreators HTTP 404: {"error":"not_found"}'], ["down", "ScrapeCreators HTTP 503"]] as const) {
      await t.mutation(internal.reads.cache.claim, { kind: "profile", key, params: {}, now });
      await t.mutation(internal.reads.cache.fail, { kind: "profile", key, error: err, now });
    }
    expect((await t.query(internal.reads.cache.getFresh, { kind: "profile", key: "gone", now: now + 3_600_000 })).state).toBe("failed");
    expect((await t.query(internal.reads.cache.getFresh, { kind: "profile", key: "down", now: now + 60_000 })).state).toBe("failed");
    expect((await t.query(internal.reads.cache.getFresh, { kind: "profile", key: "down", now: now + 3 * 60_000 })).state).not.toBe("failed");
  });
  it("knows a not-found from an outage", () => {
    expect(isNotFound("HTTP 404")).toBe(true);
    expect(isNotFound('{"error":"account_deactivated"}')).toBe(true);
    expect(isNotFound("HTTP 402 out of credits")).toBe(false);
    expect(isNotFound("HTTP 429")).toBe(false);
  });
});
