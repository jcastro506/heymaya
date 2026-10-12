/**
 * Deals v2 (2026-10-12): who could pay this creator, from where money is moving in their lane; the pitch they send
 * with one tap; a kit a brand can reach them from.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import fixtures from "./commerce.fixtures.json";
import { metaAds, shopProducts, tiktokAds } from "../../integrations/scrapeCreators/platforms/commerce";
import { HOW_DEALS_SCALE, lastRead, leadsFrom, parseDeals, whereTheyAre } from "../dealScout";
import { sendPageText, sendPageUrl } from "../drafts";
import { stylesOf } from "../kitData";

describe("where the money is (pure, on the vendor's documented answers)", () => {
  it("TikTok Shop: product, price, sold, rating, the shop, the page", () => {
    const p = shopProducts(fixtures.shop);
    expect(p.length).toBeGreaterThan(0);
    expect(p[0]).toMatchObject({ title: "Crocs Adult Classic Clogs", price: "$49.99", sold: 24737, rating: 4.8, shop: "Crocs" });
    expect(p[0].url).toMatch(/^https:\/\/www\.tiktok\.com\/shop\//);
  });
  it("ad libraries: the advertiser, when, and whether it was made with a creator", () => {
    expect(tiktokAds(fixtures.tiktokAds)[0]).toMatchObject({ advertiser: "GYMSHARK LTD", platform: "tiktok" });
    const m = metaAds(fixtures.metaAds);
    expect(m[0]).toMatchObject({ advertiser: "Makhumalo", active: true, platform: "meta" });
    expect(m[0].lastShown).toBeGreaterThan(1e12); // seconds made milliseconds
    expect(shopProducts(null)).toEqual([]);
    expect(metaAds({ searchResults: [{ page_name: "" }] })).toEqual([]);
  });
});

describe("the deal scout (pure)", () => {
  it("where they are is HER judgment from today's numbers, never a band in code; she sees her own last read to notice growth", () => {
    expect(whereTheyAre({ followers: 6_200, normalViews: 9_000, engagementPerView: 0.081, growth30d: 1_400 })).toBe("6,200 followers, about 9,000 views on a normal post, engagement 8.1% of views, +1,400 followers in the last 30 days");
    expect(whereTheyAre({ followers: null, normalViews: null, engagementPerView: null, growth30d: null })).toBe("followers unknown");
    expect(lastRead(undefined)).toBeNull();
    const r = lastRead({ stage: "small, UGC and affiliate", followers: 800, at: Date.UTC(2026, 9, 12) })!;
    expect(r).toContain('"small, UGC and affiliate" at 800 followers');
    expect(r).toMatch(/grown/);
    // The patterns are knowledge with room for judgment, not cutoffs.
    expect(HOW_DEALS_SCALE).toMatch(/not rules/);
    expect(HOW_DEALS_SCALE).toMatch(/engagement/);
  });
  it("leads: merged across sources by brand, strongest first; known and excluded brands drop out", () => {
    const leads = leadsFrom({
      products: [{ productId: "1", title: "Trail socks", price: "$12", sold: 5000, rating: 4.7, reviews: 100, shop: "Darn Tough", url: "https://www.tiktok.com/shop/pdp/x/1" }],
      ads: [{ advertiser: "Darn Tough Inc", text: "socks", firstShown: null, lastShown: null, active: true, url: null, platform: "meta", withCreator: true }, { advertiser: "Hoka", text: null, firstShown: null, lastShown: null, active: null, url: null, platform: "tiktok" }, { advertiser: "SecretBrand", text: null, firstShown: null, lastShown: null, active: true, url: null, platform: "meta" }],
      laneBrands: [{ handle: "nike", platform: "tiktok", posts: 2, creators: ["a", "b"], lastSeen: 1 }],
      known: ["Nike"], excluded: ["secretbrand"],
    });
    expect(leads.map((l) => l.brand)).toEqual(["Darn Tough", "Hoka"]);
    expect(leads[0].signals.join(" ")).toMatch(/TikTok Shop/);
    expect(leads[0].signals.join(" ")).toMatch(/made with creators/);
  });
  it("her picks are held to the leads: an invented brand or deal type is dropped", () => {
    const leads = leadsFrom({ products: [], ads: [{ advertiser: "Hoka", text: null, firstShown: null, lastShown: null, active: true, url: null, platform: "meta" }], laneBrands: [], known: [], excluded: [] });
    const out = parseDeals(JSON.stringify({ picks: [{ brand: "hoka", type: "ugc", why: "x" }, { brand: "Made Up Co", type: "ugc", why: "y" }, { brand: "Hoka", type: "lottery", why: "z" }], message: "hi" }), leads);
    expect(out.picks).toEqual([{ brand: "Hoka", type: "ugc", why: "x" }]);
    expect(parseDeals(JSON.stringify({ stage: "established, paid posts realistic", picks: [{ brand: "Hoka", type: "sponsorship", why: "x" }], message: "hi" }), leads).stage).toBe("established, paid posts realistic");
    expect(parseDeals(JSON.stringify({ picks: [{ brand: "Made Up Co", type: "ugc" }], message: "hi" }), leads).message, "no real pick, no message").toBe("");
    expect(parseDeals("not json", leads).picks).toEqual([]);
  });
});

describe("one tap to send (pure and on rows)", () => {
  it("her text is one link and who it's going to; it never says she sent it", () => {
    const t = sendPageText("email", "Tracksmith", "creators@tracksmith.com", sendPageUrl("a".repeat(24), { APP_URL: "https://staging.hey-maya.ai" }));
    expect(t).toContain("https://staging.hey-maya.ai/m/aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(t).toContain("creators@tracksmith.com");
    expect(t).not.toMatch(/\bsent it\b|i sent|connect.*gmail/i);
    expect(sendPageText("application", "Glossier", "https://x/form", "u")).toMatch(/submit/);
    const dm = sendPageText("dm", "Glossier", "https://www.instagram.com/glossier/", "u", "hey Glossier team, i make…");
    expect(dm).toContain("@glossier on Instagram");
    expect(dm.split("\n---\n")[1], "the message alone in its bubble, so it copies clean").toBe("hey Glossier team, i make…");
    expect(dm).not.toContain("/m/");
  });
  it("the send page shows only the live draft, by its code; unknown, canceled or old ones are gone", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "eval-send", { clerkUserId: "eval:send" }));
    const { code } = await t.mutation(internal.eval.sendPage.plantDraft, { creatorId: c, channel: "email" });
    const d = await t.query(api.partnerships.drafts.publicDraft, { code });
    expect(d).toMatchObject({ brand: "Tracksmith", channel: "email", to: "creators@tracksmith.com" });
    expect(d!.body).toContain("/k/");
    expect(await t.query(api.partnerships.drafts.publicDraft, { code: "f".repeat(24) })).toBeNull();
    expect(await t.query(api.partnerships.drafts.publicDraft, { code: "not-a-code" })).toBeNull();
    await t.run(async (ctx) => { const row = (await ctx.db.query("partnershipDrafts").collect())[0]; await ctx.db.patch(row._id, { data: { ...(row.data as object), status: "canceled" } }); });
    expect(await t.query(api.partnerships.drafts.publicDraft, { code })).toBeNull();
    await expect(t.mutation(internal.eval.sendPage.plantDraft, { creatorId: await t.run((ctx) => seedCreator(ctx, "real", { clerkUserId: "user_real" })), channel: "email" }), "never on a real account").rejects.toThrow(/eval personas only/);
  });
});

describe("the kit a brand can use", () => {
  it("what they make: plain, public-safe, no cut-off words, at most five", () => {
    expect(stylesOf({ growthPlan: { formats: ["short candid running clip with relatable", "fit check @someone", "talking to camera"] } as never, dossier: { strengths: [{ skill: "Talking directly to camera with relaxed charisma" }] } as never }))
      .toEqual(["short candid running clip", "talking to camera", "Talking directly to camera with relaxed charisma"]);
  });
  it("a contact email they give goes on the kit; junk is refused", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "kit", { plan: { status: "active", founding: true, tier: "partner" } }));
    await expect(t.mutation(internal.partnerships.kitSettings.change, { creatorId: c, change: { op: "contact_email", email: "not an email" } })).rejects.toThrow();
    expect((await t.mutation(internal.partnerships.kitSettings.change, { creatorId: c, change: { op: "contact_email", email: " Me@Example.com " } })).note).toContain("me@example.com");
    const k = await t.query(internal.partnerships.kitTools.kitFor, { creatorId: c });
    expect(k?.kit.contactEmail).toBe("me@example.com");
  });
});
