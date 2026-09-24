/**
 * Deep links into the app (app spec §6.7): /o/idea/<id> resolves only the creator's own idea;
 * the app-link tool links only objects that are theirs. Mandatory: cross-tenant isolation,
 * adversarial input (made-up and malformed ids).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";
import { appObjectUrl } from "../agent/missionControl";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await seedCreator(ctx, "a", { clerkUserId: "user_a" });
    const b = await seedCreator(ctx, "b", { clerkUserId: "user_b" });
    const idea = (creatorId: typeof a) => ctx.db.insert("ideas", { creatorId, evidenceLinks: ["https://www.tiktok.com/@x/video/1"], fit: "yes", fitWhy: "fits", version: { hook: "h" }, messageText: "m", status: "sent", produced: { skillVersion: "t", model: "t", thresholdsVersion: "t" }, createdAt: Date.now(), sentAt: Date.now() } as never);
    return { a, b, ideaA: await idea(a), ideaB: await idea(b) };
  });
  return { t, ...ids };
}

describe("deep links", () => {
  it("builds the object URL with no tenant id in it", () => {
    expect(appObjectUrl("https://hey-maya.ai/", "idea", "abc")).toBe("https://hey-maya.ai/o/idea/abc");
    expect(appObjectUrl(undefined, "post", "a/b")).toBe("https://hey-maya.ai/o/post/a%2Fb");
  });

  it("ui.idea returns your own idea with its covers, and null for anyone else's or junk", async () => {
    const { t, ideaA, ideaB } = await setup();
    const asA = t.withIdentity({ subject: "user_a" });
    const mine = await asA.query(api.ui.idea, { id: ideaA });
    expect(mine?.id).toBe(ideaA);
    expect(mine?.evidenceCovers).toEqual([null]);
    expect(await asA.query(api.ui.idea, { id: ideaB })).toBeNull();
    expect(await asA.query(api.ui.idea, { id: "not-an-id" })).toBeNull();
    expect(await t.query(api.ui.idea, { id: ideaA })).toBeNull();
  });

  it("the link tool's ownership check refuses foreign and made-up objects", async () => {
    const { t, a, ideaA, ideaB } = await setup();
    expect(await t.query(internal.ui.ownsObject, { creatorId: a, kind: "idea", id: ideaA })).toBe(true);
    expect(await t.query(internal.ui.ownsObject, { creatorId: a, kind: "idea", id: ideaB })).toBe(false);
    expect(await t.query(internal.ui.ownsObject, { creatorId: a, kind: "post", id: ideaA })).toBe(false);
    expect(await t.query(internal.ui.ownsObject, { creatorId: a, kind: "idea", id: "'; drop" })).toBe(false);
  });
});
