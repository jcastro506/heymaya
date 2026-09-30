/**
 * M3 favorites: computed on the server once her first read is written, followed live by the app.
 * Pending until then (the app shows "finding creators"), then exactly this person's picks; never
 * another creator's (cross-tenant).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const pick = (handle: string) => ({ platform: "tiktok", handle, followers: 12_000, why: "Films the same hill repeats you do." });

describe("favorites picks", () => {
  it("pending before the read, then theirs, and only theirs", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "pa"));
    const b = await t.run((ctx) => seedCreator(ctx, "pb"));
    const subjectOf = async (id: typeof a) => (await t.run((ctx) => ctx.db.get(id)))!.clerkUserId;
    const asA = t.withIdentity({ subject: await subjectOf(a) });
    const asB = t.withIdentity({ subject: await subjectOf(b) });

    expect(await asA.query(api.onboarding.admired.picks, {})).toEqual({ ready: false, items: [] });
    await t.mutation(internal.onboarding.suggest.storePicks, { creatorId: a, items: [pick("hillsforbreakfast")] });
    expect(await asA.query(api.onboarding.admired.picks, {})).toEqual({ ready: true, items: [pick("hillsforbreakfast")] });
    expect(await asB.query(api.onboarding.admired.picks, {}), "B never sees A's picks").toEqual({ ready: false, items: [] });

    // An honest empty answer is still an answer: the app stops waiting and shows the empty state.
    await t.mutation(internal.onboarding.suggest.storePicks, { creatorId: b, items: [] });
    expect(await asB.query(api.onboarding.admired.picks, {})).toEqual({ ready: true, items: [] });
  });

  it("signed out gets nothing", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.onboarding.admired.picks, {})).toBeNull();
  });

  it("they start the moment her first read is stored (onboarding only, not every rewrite)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../ingest.ts", import.meta.url), "utf8");
    expect(src).toMatch(/if \(args\.reason === "onboarding"\) await ctx\.scheduler\.runAfter\(0, internal\.onboarding\.suggest\.refreshPicks/);
  });
});
