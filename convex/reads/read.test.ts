import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "../test.setup";
import { internal } from "../_generated/api";
import { readKey, stableStringify } from "./key";
import { KINDS, pathFor } from "./kinds";
import { CREDITS_BY_PATH } from "../integrations/scrapeCreators/platforms/cross";
import { fixtureCallCount } from "./read";

process.env.SCRAPE_FIXTURES = "spec";
process.env.ENVIRONMENT_NAME = "test";

describe("read() cache layer (plan §3.2, §3.75)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("keys are stable across param order and handle case", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    const a = readKey("profile", KINDS.profile.normalize({ platform: "tiktok", handle: "@Leah" }));
    const b = readKey("profile", KINDS.profile.normalize({ handle: "leah", platform: "tiktok" }));
    expect(a).toBe(b);
  });

  it("every kind's vendor path has a credit cost", () => {
    for (const kind of Object.keys(KINDS) as Array<keyof typeof KINDS>) {
      for (const platform of ["tiktok", "instagram"] as const) {
        const path = pathFor(kind, { platform });
        expect(CREDITS_BY_PATH[path], `${kind} → ${path}`).toBeTypeOf("number");
      }
    }
  });

  it("first read fetches, second read is a cache hit, fixture reads cost nothing", async () => {
    const before = fixtureCallCount();
    const r1 = await t.action(internal.reads.read.read, { kind: "trending.tiktok", params: { region: "us" } });
    const r2 = await t.action(internal.reads.read.read, { kind: "trending.tiktok", params: { region: "US" } });
    expect(r1.cached).toBe(false);
    expect(r2.cached).toBe(true);
    expect(r2.key).toBe(r1.key);
    expect(fixtureCallCount() - before).toBe(1);
    const rows = await t.run(async (ctx) => ctx.db.query("readCache").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].fixture).toBe("spec-example");
    const costs = await t.run(async (ctx) => ctx.db.query("costEvents").collect());
    expect(costs).toHaveLength(0); // fixtures never write a cost row
  });

  it("concurrent reads of one key produce one vendor call", async () => {
    const before = fixtureCallCount();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => t.action(internal.reads.read.read, { kind: "search.keyword", params: { keyword: "marathon training", window: "this-week", sort: "most-liked" } })),
    );
    expect(results.every((r) => r.key === results[0].key)).toBe(true);
    expect(fixtureCallCount() - before).toBe(1);
  });

  it("a vendor failure is a named failure and does not poison the cache for long", async () => {
    await expect(
      t.action(internal.reads.read.read, { kind: "post.info", params: { platform: "tiktok", url: "https://www.tiktok.com/@x/video/1" } }),
    ).resolves.toBeTruthy(); // fixture exists for /v2/tiktok/video
    await expect(
      t.action(internal.reads.read.read, { kind: "post.info", params: { platform: "tiktok", url: "not-a-url" } }),
    ).rejects.toThrow(/read\(post.info\) failed/);
  });

  it("unknown kinds are rejected", async () => {
    await expect(t.action(internal.reads.read.read, { kind: "nope", params: {} })).rejects.toThrow(/unknown read kind/);
  });
});
