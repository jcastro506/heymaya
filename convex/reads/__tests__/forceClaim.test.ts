import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";

describe("a forced read claims a fresh row (2026-09-07: force was ignored at the claim)", () => {
  it("fresh without force returns the value; fresh with force is claimed for a real read", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run((ctx) => ctx.db.insert("readCache", { kind: "post.info", key: "k1", params: {}, value: { videoUrl: "old" }, expiresAt: now + 3_600_000, fetchedAt: now } as never));
    const plain = await t.mutation(internal.reads.cache.claim, { kind: "post.info", key: "k1", params: {}, now });
    expect(plain.claimed).toBe(false);
    const forced = await t.mutation(internal.reads.cache.claim, { kind: "post.info", key: "k1", params: {}, now, force: true });
    expect(forced.claimed).toBe(true);
  });
});
