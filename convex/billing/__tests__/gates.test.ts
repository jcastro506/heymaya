/**
 * P1: plans, billing and gating. The gate matrix (every tier × plan status × door), the app's
 * plan screen mirroring tiers.ts and the doors (sibling coherence), the plan-change decision,
 * and fail-closed: an unknown tier or a dead plan never opens a paid door.
 * CAPTURE_APP_FIXTURES=1 writes the app's plans fixture from the real query.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { entitlementsFor, TIER_NAMES, TIERS, price } from "../tiers";
import { partnershipsOpen } from "../../partnerships/store";
import { planChange } from "../checkout";

const STATUSES = ["onboarding", "trialing", "active", "past_due", "paused", "canceled", "comped", "deleting"] as const;
const LIVE = new Set(["trialing", "active", "comped"]);

describe("the gate matrix: tier × status × door", () => {
  for (const tier of [...TIER_NAMES, undefined, "enterprise"] as const) {
    for (const status of STATUSES) {
      it(`${tier ?? "(none)"} / ${status}`, () => {
        const plan = { status, tier: tier as string | undefined };
        const e = entitlementsFor(plan);
        const known = TIER_NAMES.includes(tier as never);
        // accounts: the tier's cap, unknown tiers fall to solo (comped → duo), never above the tier
        const expectedTier = known ? tier : status === "comped" ? "duo" : "solo";
        expect(e.tier).toBe(expectedTier);
        expect(e.accounts).toBe(TIERS[e.tier].accounts);
        // partnerships: only a live plan on a tier that has them (fail-closed everywhere else)
        const open = partnershipsOpen({ _id: "c1", plan }, {});
        expect(open).toBe(LIVE.has(status) && TIERS[e.tier].partnerships.opportunitiesPerMonth > 0);
      });
    }
  }
});

describe("plan changes", () => {
  it("a live subscriber updates; anyone else checks out; the same tier is refused", () => {
    expect(planChange({ tier: "solo", status: "active", subscriptionId: "sub_1" }, "partner")).toEqual({ kind: "update" });
    expect(planChange({ tier: "duo", status: "trialing", subscriptionId: "sub_1" }, "solo")).toEqual({ kind: "update" });
    expect(planChange({ tier: "partner", status: "active", subscriptionId: "sub_1" }, "partner")).toEqual({ kind: "same" });
    expect(planChange({ tier: "solo", status: "canceled", subscriptionId: "sub_1" }, "duo")).toEqual({ kind: "checkout" });
    expect(planChange({ tier: "solo", status: "onboarding" }, "duo")).toEqual({ kind: "checkout" });
  });
});

describe("the app's plan screen mirrors tiers.ts and the doors", () => {
  it("every tier with its real price; 'yours' is what the server enforces", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a", plan: { status: "trialing", founding: false, tier: "duo", stripeSubscriptionId: "sub_1", trialEndsAt: Date.UTC(2026, 9, 1) } }));
    const p = (await t.withIdentity({ subject: "user_a" }).query(api.ui.plans, {}))!;
    expect(p.tiers.map((x) => x.tier)).toEqual([...TIER_NAMES]);
    for (const x of p.tiers) {
      expect(x.monthly).toBe(price(TIERS[x.tier].priceUsd));
      expect(x.annual).toBe(price(TIERS[x.tier].annualUsd));
    }
    expect(p.current).toMatchObject({ tier: "duo", status: "trialing", subscribed: true, partnershipsOpen: false });
    if (process.env.CAPTURE_APP_FIXTURES === "1") writeFileSync("apps/ios/Fixtures/plans.json", JSON.stringify(p, null, 1));
    // another creator's identity sees nothing of A
    expect(await t.withIdentity({ subject: "nobody" }).query(api.ui.plans, {})).toBeNull();
  });

  it("no price literal lives in the app, and nothing outside billing checks a tier name", () => {
    const swift = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? swift(p) : p.endsWith(".swift") ? [p] : []; });
    // A dollar amount inside a string literal ("$19", "from $24.99"); Swift's $0 and $binding aren't strings.
    const priceInString = (src: string) => [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].some((m) => /\$(\d{2,}|\d+\.\d\d)\b/.test(m[1])); // "$19", "$24.99"; never $0
    const offenders = swift(join(__dirname, "../../../apps/ios")).filter((f) => priceInString(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    const ts = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? (f === "_generated" || f === "__tests__" || f === "billing" ? [] : ts(p)) : p.endsWith(".ts") ? [p] : []; });
    const tierChecks = ts(join(__dirname, "../..")).filter((f) => /tier\s*===?\s*"(solo|duo|partner)"|"(solo|duo|partner)"\s*===?\s*\S*tier/.test(readFileSync(f, "utf8")));
    expect(tierChecks).toEqual([]);
  });
});
