/**
 * getMyMediaAssets — the founder-facing Assets gallery query. Pins: auth-scoping
 * (cross-tenant isolation, fail-closed), newest-first ordering, archived
 * exclusion, and the derived flags (generatedByMaya / isVideo / groundedCount)
 * the UI groups + badges on.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

async function setup(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  return { authed, agentId: started.agentId as Id<"gtmAgents"> };
}

describe("getMyMediaAssets", () => {
  it("returns the agent's media newest-first, with maya-vs-source + video flags", async () => {
    const t = convexTest(schema, modules);
    const { authed, agentId } = await setup(t, "media_owner");
    const ids = await t.run(async (ctx) => ({
      slide: await ctx.storage.store(new Blob(["s"], { type: "image/png" })),
      shot: await ctx.storage.store(new Blob(["h"], { type: "image/png" })),
      vid: await ctx.storage.store(new Blob(["v"], { type: "video/mp4" })),
    }));
    const lib = [
      { storageId: ids.shot, kind: "screenshot", source: "telegram", mimeType: "image/png", storageBytes: 1, createdAt: 100 },
      { storageId: ids.slide, kind: "slide", source: "generated", mimeType: "image/png", storageBytes: 1, createdAt: 300, referenceStorageIds: [ids.shot] },
      { storageId: ids.vid, kind: "video", source: "creatify", mimeType: "video/mp4", storageBytes: 1, createdAt: 200 },
    ];
    await t.run((ctx) => ctx.db.patch(agentId, { mediaLibraryJson: JSON.stringify(lib) }));

    const items = await authed.query(api.gtmMaya.mediaAssets.getMyMediaAssets, {});
    expect(items.length).toBe(3);
    // newest first: slide(300) → video(200) → screenshot(100)
    expect(items.map((i) => i.kind)).toEqual(["slide", "video", "screenshot"]);

    const slide = items.find((i) => i.kind === "slide")!;
    expect(slide.generatedByMaya).toBe(true); // Maya made it
    expect(slide.isVideo).toBe(false);
    expect(slide.groundedCount).toBe(1); // built from 1 screenshot

    const shot = items.find((i) => i.kind === "screenshot")!;
    expect(shot.generatedByMaya).toBe(false); // founder supplied it

    const vid = items.find((i) => i.kind === "video")!;
    expect(vid.isVideo).toBe(true);
    expect(vid.generatedByMaya).toBe(true);
  });

  it("excludes archived entries", async () => {
    const t = convexTest(schema, modules);
    const { authed, agentId } = await setup(t, "media_arch");
    const id = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "image/png" }))
    );
    await t.run((ctx) =>
      ctx.db.patch(agentId, {
        mediaLibraryJson: JSON.stringify([
          { storageId: id, kind: "slide", source: "generated", mimeType: "image/png", storageBytes: 1, createdAt: 1, archivedAt: 2 },
        ]),
      })
    );
    expect(
      (await authed.query(api.gtmMaya.mediaAssets.getMyMediaAssets, {})).length
    ).toBe(0);
  });

  it("cross-tenant: an operator with no agent sees nothing (fail-closed)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setup(t, "media_a");
    const id = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "image/png" }))
    );
    await t.run((ctx) =>
      ctx.db.patch(agentId, {
        mediaLibraryJson: JSON.stringify([
          { storageId: id, kind: "slide", source: "generated", mimeType: "image/png", storageBytes: 1, createdAt: 1 },
        ]),
      })
    );
    const other = t.withIdentity({ subject: "media_b", email: "b@clawlaunch.test" });
    expect(await other.query(api.gtmMaya.mediaAssets.getMyMediaAssets, {})).toEqual([]);
  });
});
