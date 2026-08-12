/**
 * ⭐ House Rules — the browser-callable pair (§18.9.3 ⑥).
 *
 * Every other function in `maya/directives.ts` is `internal*`, reachable only
 * by her runtime. These two take input from a signed-in browser, which makes
 * them the first place a founder's id can be swapped for someone else's.
 *
 * ⚠️ The revoke is the dangerous half. `directiveId` arrives **from the
 * client**. A handler that trusted it would let anyone holding an id delete
 * another founder's standing instructions — and the damage wouldn't look like
 * an error, it would look like Maya quietly forgetting something she was told.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { modules } from "./_modules";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

async function seedAccount(ctx: unknown, clerkUserId: string): Promise<string> {
  const c = ctx as InsertCtx & {
    db: {
      insert: (t: string, v: unknown) => Promise<string>;
      patch: (i: string, v: unknown) => Promise<void>;
      get: (i: string) => Promise<Record<string, unknown> | null>;
    };
  };
  const creatorId = (await c.db.insert(
    "creators",
    await minimalRow(c, "creators", {
      clerkUserId,
      email: `${clerkUserId}@example.com`,
      accountType: "gtm-agent",
    }),
  )) as string;
  return (await c.db.insert(
    "customers",
    await minimalRow(c, "customers", { accountId: creatorId }),
  )) as string;
}

async function addRule(
  ctx: unknown,
  customerId: string,
  verbatim: string,
  createdAt: number,
): Promise<string> {
  const c = ctx as {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  };
  return await c.db.insert("directives", {
    customerId,
    kind: "cadence",
    verbatim,
    active: true,
    createdAt,
  });
}

describe("House Rules", () => {
  it("lists the founder's own rules, newest first, verbatim", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const mine = await seedAccount(ctx, "user_mine");
      await addRule(ctx, mine, "stop posting on Sundays", 1_000);
      await addRule(ctx, mine, "no emojis in captions", 5_000);

      // A second account whose rules must never appear.
      const theirs = await seedAccount(ctx, "user_theirs");
      await addRule(ctx, theirs, "post twice on Fridays", 9_000);
    });

    const out = await t
      .withIdentity({ subject: "user_mine" })
      .query(api.maya.directives.myHouseRules, {});

    expect(out.ok).toBe(true);
    /**
     * ⭐ Newest first — the same precedence order she applies them in, so the
     * screen reads top-to-bottom as "what wins".
     */
    expect(out.rules?.map((r) => r.verbatim)).toEqual([
      "no emojis in captions",
      "stop posting on Sundays",
    ]);
  });

  it("shows the sentence unedited", async () => {
    const t = convexTest(schema, modules);
    // ⚠️ The whole screen is "recognise your own words". A trimmed, cased, or
    // punctuation-normalised version quietly breaks the only thing it does.
    const raw = "  no more of that corporate voice pls!!  ";

    await t.run(async (ctx) => {
      const mine = await seedAccount(ctx, "user_raw");
      await addRule(ctx, mine, raw, 1_000);
    });

    const out = await t
      .withIdentity({ subject: "user_raw" })
      .query(api.maya.directives.myHouseRules, {});

    expect(out.rules?.[0].verbatim).toBe(raw);
  });

  it("omits rules already revoked", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const mine = await seedAccount(ctx, "user_revoked");
      const id = await addRule(ctx, mine, "old rule", 1_000);
      await (
        ctx as unknown as {
          db: { patch: (i: string, v: unknown) => Promise<void> };
        }
      ).db.patch(id, { active: false, supersededAt: 2_000 });
    });

    const out = await t
      .withIdentity({ subject: "user_revoked" })
      .query(api.maya.directives.myHouseRules, {});

    expect(out.rules).toEqual([]);
  });

  it("revokes the founder's own rule", async () => {
    const t = convexTest(schema, modules);

    const ruleId = await t.run(async (ctx) => {
      const mine = await seedAccount(ctx, "user_revoker");
      return await addRule(ctx, mine, "stop posting on Sundays", 1_000);
    });

    const asUser = t.withIdentity({ subject: "user_revoker" });
    const res = await asUser.mutation(api.maya.directives.revokeMyHouseRule, {
      directiveId: ruleId as never,
    });

    expect(res.revoked).toBe(true);
    expect(
      (await asUser.query(api.maya.directives.myHouseRules, {})).rules,
    ).toEqual([]);

    // ⚠️ Deactivated, NOT deleted — her runtime asks "what replaced this?",
    // and a deleted row cannot answer.
    await t.run(async (ctx) => {
      const row = await (
        ctx as unknown as {
          db: { get: (i: string) => Promise<Record<string, unknown> | null> };
        }
      ).db.get(ruleId);
      expect(row).not.toBeNull();
      expect(row?.active).toBe(false);
      expect(row?.supersededAt).toBeTruthy();
    });
  });

  it("⭐ will not revoke a rule belonging to someone else", async () => {
    const t = convexTest(schema, modules);

    const theirRuleId = await t.run(async (ctx) => {
      await seedAccount(ctx, "user_attacker");
      const victim = await seedAccount(ctx, "user_victim");
      return await addRule(ctx, victim, "never post about pricing", 1_000);
    });

    const res = await t
      .withIdentity({ subject: "user_attacker" })
      .mutation(api.maya.directives.revokeMyHouseRule, {
        directiveId: theirRuleId as never,
      });

    expect(res.revoked).toBe(false);

    // And the victim still has it — the part that actually matters.
    const victimRules = await t
      .withIdentity({ subject: "user_victim" })
      .query(api.maya.directives.myHouseRules, {});
    expect(victimRules.rules?.map((r) => r.verbatim)).toEqual([
      "never post about pricing",
    ]);
  });

  it("refuses when nobody is signed in", async () => {
    const t = convexTest(schema, modules);
    expect((await t.query(api.maya.directives.myHouseRules, {})).ok).toBe(
      false,
    );
  });
});
