/**
 * The media library — and knowing when to ask.
 *
 * §6.4.6b measured that **half** of target-type sites publish no product
 * screenshot at all, and a headless browser doesn't help because the images
 * aren't hidden — they don't exist. So for roughly half of customers, what the
 * founder sends is the only real product imagery there will ever be.
 *
 * Which makes the ask load-bearing, and makes asking the WRONG people the
 * expensive mistake: a founder pestered for assets they already sent stops
 * reading the messages that matter.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { kindFor, parseTags, TELEGRAM_MAX_BYTES } from "../media";
import { HEALTHY_SCREENSHOT_FLOOR } from "../assetClassifier";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 14, 0, 0);

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_media",
      email: "media@example.com",
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function addAsset(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  over: Partial<Doc<"mediaAssets">> = {}
) {
  await t.mutation(internal.maya.media.record, {
    customerId,
    kind: over.kind ?? "image",
    source: "telegram",
    storageKey: over.storageKey ?? `k-${Math.random()}`,
    contentType: "image/png",
    classifiedAs: over.classifiedAs,
    now: NOW,
  });
}

describe("⭐ ASK THE RIGHT PEOPLE, ONCE", () => {
  it("an empty library means ask", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const health = await t.query(internal.maya.media.libraryHealth, { customerId });
    expect(health.shouldAsk).toBe(true);
    expect(health.detail).toMatch(/no real product imagery/i);
  });

  it("⭐ A LIBRARY OF ILLUSTRATIONS STILL MEANS ASK", async () => {
    // The measured failure mode. A gradient hero passes every presence check,
    // satisfies Creatify's "at least one image" minimum, and produces generic
    // content nobody flags. Counting FILES would call this healthy.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    for (let i = 0; i < 8; i += 1) {
      await addAsset(t, customerId, { classifiedAs: "illustration" });
    }
    const health = await t.query(internal.maya.media.libraryHealth, { customerId });
    expect(health.total).toBe(8);
    expect(health.productScreenshots).toBe(0);
    expect(health.shouldAsk).toBe(true);
  });

  it("ONE real screenshot stops the ask — thin is not degraded", async () => {
    // Asking on `thin` would pester founders who are already fine. Fewer
    // screenshots than ideal is a worse video and still a real post.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await addAsset(t, customerId, { classifiedAs: "product_screenshot" });
    const health = await t.query(internal.maya.media.libraryHealth, { customerId });
    expect(health.shouldAsk).toBe(false);
  });

  it("⭐ A SCREEN RECORDING ANSWERS THE ASK BY ITSELF", async () => {
    // It yields frames, so counting screenshots against someone who sent one
    // asks them twice for something they already did.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await addAsset(t, customerId, {
      kind: "screen_recording",
      classifiedAs: undefined,
    });
    const health = await t.query(internal.maya.media.libraryHealth, { customerId });
    expect(health.hasRecording).toBe(true);
    expect(health.shouldAsk).toBe(false);
    expect(health.detail).toMatch(/frames and b-roll/i);
  });

  it("a healthy library reports the count it has", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    for (let i = 0; i < HEALTHY_SCREENSHOT_FLOOR; i += 1) {
      await addAsset(t, customerId, { classifiedAs: "product_screenshot" });
    }
    const health = await t.query(internal.maya.media.libraryHealth, { customerId });
    expect(health.detail).toMatch(/enough to work from/i);
  });
});

describe("INGEST", () => {
  it("the same file twice is one asset", async () => {
    // uploadAsset is idempotent by content hash, so a founder re-sending the
    // same screenshot under a new filename lands on the same key.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await addAsset(t, customerId, { storageKey: "same-bytes" });
    await addAsset(t, customerId, { storageKey: "same-bytes" });
    const all = await t.query(internal.maya.media.forCustomer, { customerId });
    expect(all).toHaveLength(1);
  });

  it("⭐ A VIDEO IS A SCREEN RECORDING, NOT A VIDEO TO POST", () => {
    // A founder sending video almost always means "here's me using it". Filing
    // it as postable content throws away the frames and b-roll inside it.
    expect(kindFor("video/mp4")).toBe("screen_recording");
    expect(kindFor("video/quicktime")).toBe("screen_recording");
  });

  it("a caption mentioning a logo files it as one", () => {
    expect(kindFor("image/png", "here's our logo")).toBe("logo");
    expect(kindFor("image/png", "the export screen")).toBe("image");
  });

  it("an unknown mime is treated as an image rather than dropped", () => {
    // Telegram omits content-type on some downloads. Guessing wrong costs a
    // mis-filed asset; dropping costs the file.
    expect(kindFor("application/octet-stream")).toBe("image");
  });

  it("the 20MB cap is Telegram's, and it's real", () => {
    // A 60-second screen recording can exceed it, which is the exact thing we
    // ask for — so it needs a named failure, not a mystery.
    expect(TELEGRAM_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("TAGGING IS WHAT MAKES THE LIBRARY USABLE", () => {
  it("reads a caption, kind and tags", () => {
    const parsed = parseTags(
      '{"caption":"the export screen with an error","kind":"product_screenshot","tags":["export","error"]}'
    );
    expect(parsed?.caption).toMatch(/export screen/);
    expect(parsed?.kind).toBe("product_screenshot");
    expect(parsed?.tags).toContain("error");
  });

  it("survives a fenced response", () => {
    expect(
      parseTags('```json\n{"caption":"empty state","kind":"product_screenshot"}\n```')
        ?.kind
    ).toBe("product_screenshot");
  });

  it("unreadable output is null — an untagged asset beats a wrong one", () => {
    expect(parseTags("It looks like a dashboard.")).toBeNull();
    expect(parseTags('{"caption":"x"}')).toBeNull();
  });
});

describe("⭐ NO STORED URL FOR CREATIFY", () => {
  it("ingest never persists a publicUrl", async () => {
    // uploadAsset's storageUrl is private — the module says "never given to
    // OpenClaw". And Creatify's servers FETCH what we hand them, so the render
    // path needs a SIGNED url minted at brief time with a TTL longer than a
    // render. Storing one here either leaks a private path or bakes in an
    // expiry that dies days before it's used.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await addAsset(t, customerId, { classifiedAs: "product_screenshot" });
    const all = await t.query(internal.maya.media.forCustomer, { customerId });
    expect(all[0].publicUrl).toBeUndefined();
  });
});
