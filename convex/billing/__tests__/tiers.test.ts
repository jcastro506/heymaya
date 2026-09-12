/**
 * §26: three tiers, enforced by the server. Prices come from one place; the tier lands
 * from the Stripe price; unknown means solo; a client can choose a price, never the row;
 * the doors (connections, partnerships, the belt, the opening) read the tier and nothing else.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { TIERS, TIER_NAMES, accountsWithinPlan, entitlementsFor, planLineFor, price, priceEnvKey, tierFromPriceId } from "../tiers";
import { tierFor } from "../plan";
import { partnershipAllowance, partnershipsOpen } from "../../partnerships/store";
import { converseSkillFor } from "../../agent/converse";
import { helloFor } from "../../core/pairing";
import { openingQuestionFor } from "../../onboarding/conversation";
import { PARTNERSHIP_SKILL } from "../../partnerships/contracts";

afterEach(() => vi.unstubAllEnvs());

const ENV = { STRIPE_PRICE_SOLO_MONTHLY: "price_solo_m", STRIPE_PRICE_DUO_MONTHLY: "price_duo_m", STRIPE_PRICE_PARTNER_ANNUAL: "price_partner_a" };

describe("the tiers", () => {
  it("are the operator's three prices, and everything reads them from one place", () => {
    expect(TIERS.solo.priceUsd).toBe(19);
    expect(TIERS.duo.priceUsd).toBe(24.99);
    expect(TIERS.partner.priceUsd).toBe(29.99);
    expect(TIERS.solo.accounts).toBe(1);
    expect(TIERS.duo.accounts).toBe(2);
    expect(TIERS.partner.partnerships.opportunitiesPerMonth).toBeGreaterThan(0);
    expect(TIERS.duo.partnerships.opportunitiesPerMonth).toBe(0);
    for (const f of ["app/landing/Landing.tsx", "app/app/settings/page.tsx"]) expect(readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8"), `${f} reads prices from tiers.ts`).toMatch(/from "@\/convex\/billing\/tiers"/);
    const terms = readFileSync(new URL("../../../app/terms/page.tsx", import.meta.url), "utf8");
    for (const t of TIER_NAMES) expect(terms).toContain(price(TIERS[t].priceUsd));
    expect(readFileSync(new URL("../../../app/landing/Landing.tsx", import.meta.url), "utf8")).not.toMatch(/\$19|\$29|founding price/i);
    expect(readFileSync(new URL("../../../app/app/settings/page.tsx", import.meta.url), "utf8")).not.toMatch(/\$19|\$180/);
  });

  it("fail closed: unknown or missing is solo; comped defaults to duo; a dead plan zeroes partnerships and keeps the cap", () => {
    expect(entitlementsFor({ status: "active" }).tier).toBe("solo");
    expect(entitlementsFor({ status: "active", tier: "platinum" }).tier).toBe("solo");
    expect(entitlementsFor({ status: "comped" }).tier).toBe("duo");
    expect(entitlementsFor({ status: "active", tier: "partner" }).partnerships).toEqual(TIERS.partner.partnerships);
    const dead = entitlementsFor({ status: "canceled", tier: "partner" });
    expect(dead.accounts).toBe(2);
    expect(dead.partnerships.opportunitiesPerMonth).toBe(0);
    expect(accountsWithinPlan(["a", "b", "c"], 1)).toEqual(["a"]);
    expect(accountsWithinPlan(["a"], 2)).toEqual(["a"]);
    expect(accountsWithinPlan(["a"], -1)).toEqual([]);
  });

  it("the tier lands from the Stripe price; metadata is the fallback; an unknown price keeps the row; metadata cannot outrank a price", () => {
    expect(priceEnvKey("duo", "annual")).toBe("STRIPE_PRICE_DUO_ANNUAL");
    expect(tierFromPriceId("price_partner_a", ENV)).toBe("partner");
    expect(tierFromPriceId("price_nope", ENV)).toBeNull();
    expect(tierFromPriceId(undefined, ENV)).toBeNull();
    expect(tierFor({ priceId: "price_solo_m", metadataTier: "partner" }, "duo", ENV), "adversarial: metadata claims partner, the price says solo").toBe("solo");
    expect(tierFor({ metadataTier: "duo" }, undefined, ENV)).toBe("duo");
    expect(tierFor({ priceId: "price_nope", metadataTier: "nonsense" }, "partner", ENV)).toBe("partner");
    expect(tierFor({}, undefined, ENV)).toBeUndefined();
  });

  it("her plan line states their tier and the two others, and carries no plumbing", () => {
    const line = planLineFor("duo");
    expect(line).toContain("$24.99 a month");
    expect(line).toContain("$19");
    expect(line).toContain("$29.99");
    expect(line).not.toMatch(/tier|solo|entitlement/i);
  });

  it("partnerships follow the tier; the pilot list is a comp on top, never the gate", () => {
    const solo = { _id: "c1", plan: { status: "active", tier: "solo" } };
    expect(partnershipsOpen(solo, {})).toBe(false);
    expect(partnershipsOpen({ _id: "c1", plan: { status: "active", tier: "partner" } }, {})).toBe(true);
    expect(partnershipsOpen(solo, { PARTNERSHIP_PILOT_CREATOR_IDS: "c1" })).toBe(true);
    expect(partnershipAllowance(solo, { PARTNERSHIP_PILOT_CREATOR_IDS: "c1" })).toEqual(TIERS.partner.partnerships);
    expect(partnershipsOpen({ _id: "c1", plan: { status: "canceled", tier: "partner" } }, { PARTNERSHIP_PILOT_CREATOR_IDS: "c1" }), "a dead plan has nothing, comp or not").toBe(false);
  });

  it("the skill, the opening and the hello name partnerships only for a plan that has them", () => {
    expect(converseSkillFor(true)).toContain(PARTNERSHIP_SKILL);
    expect(converseSkillFor(false)).not.toContain(PARTNERSHIP_SKILL);
    expect(converseSkillFor(false)).toContain("When: any message");
    expect(openingQuestionFor(true)).toMatch(/brand deals/);
    expect(openingQuestionFor(false)).not.toMatch(/brand/);
    expect(helloFor(false)).not.toMatch(/brand/);
    expect(helloFor(true)).toMatch(/brand deals/);
    expect(helloFor(false)).toMatch(/what would you most like help with/);
  });

  it("the belt: a duo creator never sees partnership tools; the investigate loop filters them unless told the plan allows", () => {
    const src = readFileSync(new URL("../../agent/investigate.ts", import.meta.url), "utf8");
    expect(src).toMatch(/input\.partnerships && input\.sourceMessageId \? TOOLS : TOOLS\.filter/);
    const conv = readFileSync(new URL("../../agent/converse.ts", import.meta.url), "utf8");
    expect(conv).toMatch(/const partnerships = partnershipsOpen\(creator\)/);
    expect(conv).toMatch(/partnershipTurn = partnerships &&/);
    expect(conv).not.toMatch(/^\$\{PARTNERSHIP_SKILL\}$/m);
  });
});

describe("the doors, on rows", () => {
  it("cross-tenant and fail-closed: a third account is nobody's; the delta path never writes it; the cap follows the tier", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "solo", { plan: { status: "active", founding: false, tier: "solo" } }));
    const b = await t.run((ctx) => seedCreator(ctx, "duo", { plan: { status: "active", founding: false, tier: "duo" } }));
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("connections", { creatorId: a, provider: "zernio", status: "connected", zernioProfileId: "p_a", zernioAccounts: [{ accountId: "acc_a1", platform: "tiktok", needsReconnect: false, canFetchAnalytics: true }, { accountId: "acc_a2", platform: "instagram", needsReconnect: false, canFetchAnalytics: true }], updatedAt: now });
      await ctx.db.insert("connections", { creatorId: b, provider: "zernio", status: "connected", zernioProfileId: "p_b", zernioAccounts: [{ accountId: "acc_b1", platform: "tiktok", needsReconnect: false, canFetchAnalytics: true }, { accountId: "acc_b2", platform: "instagram", needsReconnect: false, canFetchAnalytics: true }], updatedAt: now });
    });
    expect(await t.query(internal.connections.sync.accountCap, { creatorId: a })).toBe(1);
    expect(await t.query(internal.connections.sync.accountCap, { creatorId: b })).toBe(2);
    expect(await t.query(internal.connections.sync.creatorForAccount, { accountId: "acc_a1" })).toBe(a);
    expect(await t.query(internal.connections.sync.creatorForAccount, { accountId: "acc_a2" }), "solo: the second account is beyond the plan").toBeNull();
    expect(await t.query(internal.connections.sync.creatorForAccount, { accountId: "acc_b2" })).toBe(b);
    expect(await t.query(internal.connections.sync.creatorForAccount, { accountId: "acc_nobody" })).toBeNull();
  });

  it("partnership access on rows: partner tier opens it without any env; duo is refused with a named reason", async () => {
    const t = convexTest(schema, modules);
    const p = await t.run((ctx) => seedCreator(ctx, "p", { plan: { status: "active", founding: false, tier: "partner" } }));
    const d = await t.run((ctx) => seedCreator(ctx, "d", { plan: { status: "active", founding: false, tier: "duo" } }));
    const rp = await t.query(internal.partnerships.store.read, { creatorId: p });
    expect("opportunities" in rp).toBe(true);
    await expect(t.query(internal.partnerships.store.read, { creatorId: d })).rejects.toThrow(/not on this plan/);
  });

  it("the webhook lands the tier from the price and records an unknown price without changing it", async () => {
    vi.stubEnv("STRIPE_PRICE_DUO_MONTHLY", "price_duo_m");
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "w", { timezone: "UTC", channel: { paired: true }, plan: { status: "onboarding", founding: false, stripeCustomerId: "cus_w" } }));
    const at = Math.floor(Date.UTC(2026, 8, 12, 12) / 1000);
    const sub = (over: Record<string, unknown>) => ({ id: "sub_w", status: "trialing", trial_end: null, current_period_end: at + 30 * 86_400, ...over });
    await t.mutation(internal.billing.plan.applyEvent, { eventId: "evt_1", type: "customer.subscription.created", livemode: false, createdAt: at, customerId: "cus_w", creatorIdFromMetadata: c, subscription: sub({ priceId: "price_duo_m", metadataTier: "partner" }) });
    let row = await t.run((ctx) => ctx.db.get(c));
    expect(row!.plan.tier, "the price outranks the metadata").toBe("duo");
    await t.mutation(internal.billing.plan.applyEvent, { eventId: "evt_2", type: "customer.subscription.updated", livemode: false, createdAt: at + 10, customerId: "cus_w", creatorIdFromMetadata: c, subscription: sub({ status: "active", priceId: "price_unknown" }) });
    row = await t.run((ctx) => ctx.db.get(c));
    expect(row!.plan.tier, "an unknown price keeps the row").toBe("duo");
    expect(row!.plan.status).toBe("active");
    const audit = await t.run((ctx) => ctx.db.query("stripeWebhookEvents").collect());
    expect(audit.find((e) => e.eventId === "evt_2")?.detail).toMatch(/matches no tier/);
  });
});
