/**
 * §15.7: a dossier rewrite is a diff row, never a silent overwrite. The previous
 * version is kept, the changed sections are named by code, and learn-creator's
 * inputs carry the house rules, notes and taste that must beat inference.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

describe("writeDossier", () => {
  it("keeps the previous dossier and names the changed sections", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const v1 = { persona: { summary: "runner" }, works: [{ claim: "talking heads" }], keywords: ["running"], readFrom: { tiktokPosts: 10 } };
    await t.mutation(internal.onboarding.ingest.writeDossier, { creatorId, dossier: v1, mode: "thin" });
    const after1 = await t.run((ctx) => ctx.db.get(creatorId));
    expect(after1?.dossierVersion).toBe(1);
    expect(after1?.dossierPrevious).toBeUndefined();
    const v2 = { persona: { summary: "runner" }, works: [{ claim: "talking heads" }, { claim: "deadpan bits" }], keywords: ["running"], readFrom: { tiktokPosts: 14 } };
    await t.mutation(internal.onboarding.ingest.writeDossier, { creatorId, dossier: v2, mode: "thin" });
    const after2 = await t.run((ctx) => ctx.db.get(creatorId));
    expect(after2?.dossierVersion).toBe(2);
    expect((after2?.dossierPrevious as { version: number }).version).toBe(1);
    expect(after2?.dossierDiff?.changed).toEqual(["works"]); // readFrom and version are not "changes"
  });

  it("learn-creator's inputs carry rules, live notes, taste and posted ideas", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { notes: [{ id: "n1", text: "training for chicago", kind: "life", at: 1 }, { id: "n2", text: "old", kind: "fact", at: 1, tombstonedAt: 2 }], dossier: { persona: { summary: "x" } }, dossierVersion: 3 }));
    await t.run(async (ctx) => {
      await ctx.db.insert("directives", { creatorId, kind: "correction", verbatim: "i don't do gear reviews", active: true, source: "settings", createdAt: 1 });
      await ctx.db.insert("ideas", { creatorId, evidenceLinks: ["https://x"], fit: "yes", fitWhy: "f", version: { hook: "the mile repeat rant" }, messageText: "m", status: "posted", produced: { skillVersion: "t", model: "t", thresholdsVersion: "t" }, createdAt: 1, sentAt: 1 });
    });
    const inp = await t.query(internal.onboarding.ingest.learnInputs, { creatorId });
    expect(inp?.dossierVersion).toBe(3);
    expect(inp?.rules).toEqual(["i don't do gear reviews"]);
    expect(inp?.notes).toEqual(["training for chicago"]);
    expect(inp?.postedIdeas).toEqual(["the mile repeat rant"]);
  });
});
