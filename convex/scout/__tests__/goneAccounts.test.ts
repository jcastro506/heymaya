/**
 * A handle the platform has deleted is retired, not retried forever.
 *
 * `status: "gone"` was in the schema from the start and nothing ever set it, so two dead
 * handles failed every six-hour sweep, burned a request each time, and filled the operator
 * alerts with noise that looked like a vendor problem.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

async function withTracked() {
  const t = convexTest(schema, modules);
  const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
  const id = await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: "emmasrunclub", status: "active", addedBy: "creator", baselineN: 0, createdAt: Date.now() } as never));
  return { t, creatorId, id };
}

describe("a deleted account is retired", () => {
  it("marks it gone and tells the creator once", async () => {
    const { t, id } = await withTracked();
    const first = await t.mutation(internal.scout.sampler.markGone, { ids: [id], handle: "emmasrunclub", platform: "tiktok" });
    expect(first.retired).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("gone");

    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain("emmasrunclub");
    expect(out[0].kind).toBe("status");

    // A second sweep must neither re-retire it nor say it again.
    const second = await t.mutation(internal.scout.sampler.markGone, { ids: [id], handle: "emmasrunclub", platform: "tiktok" });
    expect(second.retired).toBe(0);
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out")).toHaveLength(1);
  });

  it("duplicate tracked rows for one handle say it once, not twice", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const mk = () => t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: "runwithcarly", status: "active", addedBy: "creator", baselineN: 0, createdAt: Date.now() } as never));
    const ids = [await mk(), await mk()];
    await t.mutation(internal.scout.sampler.markGone, { ids, handle: "runwithcarly", platform: "tiktok" });
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out, "the operator got this twice on the live pilot").toHaveLength(1);
  });

  it("a retired account is never sampled again", async () => {
    const { t, id } = await withTracked();
    expect((await t.query(internal.scout.sampler.distinctTracked, {})).length).toBe(1);
    await t.mutation(internal.scout.sampler.markGone, { ids: [id], handle: "emmasrunclub", platform: "tiktok" });
    expect((await t.query(internal.scout.sampler.distinctTracked, {})).length).toBe(0);
  });
});

describe("ignoreRails is measurement-only", () => {
  it("never lets anything send: it is refused unless dryRun is also set", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../scout.ts", import.meta.url), "utf8");
    // The guard must require BOTH flags, so no live path can ever skip the rails.
    expect(src).toMatch(/args\.ignoreRails === true && args\.dryRun === true/);
    const evalSrc = readFileSync(new URL("../../eval/run.ts", import.meta.url), "utf8");
    expect(evalSrc, "the suite must pass dryRun alongside it").toMatch(/dryRun: true, ignoreRails: true/);
  });
});
