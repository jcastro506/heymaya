/**
 * ⭐ Sprint 4's exit criterion, measured — §4.5's cringe eval.
 *
 * > *"a stranger can't tell it isn't the founder writing."*
 *
 * ⚠️ Six anti-slop layers are built and **nothing measured whether they work**.
 * `runEvalForCustomer` had no caller, and no caller could have kept the answer
 * because nothing persisted it — the eval computed a verdict and discarded it.
 * So the criterion was graded on a vibe, and vibes drift silently across prompt
 * edits, model swaps and corpus changes.
 *
 * ## The trap the eval itself is built to avoid
 *
 * An eval that always passes. A judge saying "human" to everything scores a
 * perfect 50% and measures nothing. So every run carries a **control** — and a
 * run whose control slipped past is `void`, not a pass.
 *
 * ⚠️ That distinction has to survive all the way to the operator's screen.
 * Counting a void run as a pass blesses whatever shipped; counting it as a
 * failure sends someone chasing a voice problem that was never measured.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { modules } from "./_modules";
import { WEEKLY_SWEEPS, sweepRefs } from "../convex/maya/watchers";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

async function seed(ctx: unknown, clerkUserId: string): Promise<string> {
  const c = ctx as InsertCtx & {
    db: { insert: (t: string, v: unknown) => Promise<string> };
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

describe("the voice eval is actually run and kept", () => {
  it("⭐ is scheduled weekly and has a handler", () => {
    // Without both halves it is scheduled and never runs, or runs and is never
    // scheduled — the two failure modes this sweep table has already had.
    expect(WEEKLY_SWEEPS as readonly string[]).toContain("voice");
    expect(sweepRefs().voice).toBeTruthy();
  });

  it("stores the verdict where something can read it", async () => {
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) => seed(ctx, "user_voice"));

    await t.mutation(internal.maya.cringeEval.storeEvalResult, {
      customerId: customerId as never,
      resultJson: JSON.stringify({
        verdict: "indistinguishable",
        accuracy: 0.5,
        pairs: 9,
      }),
      now: 1_700_000,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(customerId as never);
      const c = row as unknown as {
        voiceEvalJson?: string;
        voiceEvalAt?: number;
      };
      expect(c.voiceEvalAt).toBe(1_700_000);
      // ⚠️ The WHOLE verdict, not just a score — a number with no way to check
      // it is a number nobody can act on.
      const parsed = JSON.parse(c.voiceEvalJson!);
      expect(parsed.verdict).toBe("indistinguishable");
      expect(parsed.pairs).toBe(9);
    });
  });
});

describe("the fleet view separates void from detectable", () => {
  /**
   * ⚠️ The token MUST be set here.
   *
   * `health` fails closed without `ADMIN_DASH_TOKEN`, so the first version of
   * this test hit its own `if (!health.ok) return` and asserted NOTHING while
   * reporting green — the exact defect this file exists to document, committed
   * into the file documenting it.
   */
  const ORIGINAL = process.env.ADMIN_DASH_TOKEN;
  beforeEach(() => {
    process.env.ADMIN_DASH_TOKEN = "test-operator-token";
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_DASH_TOKEN;
    else process.env.ADMIN_DASH_TOKEN = ORIGINAL;
  });

  async function fleetVoice(rows: Array<string | null>) {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < rows.length; i += 1) {
        const customerId = await seed(ctx, `user_v${i}`);
        if (rows[i] === null) continue;
        await (
          ctx as unknown as {
            db: { patch: (id: string, v: unknown) => Promise<void> };
          }
        ).db.patch(customerId, {
          voiceEvalJson: JSON.stringify({ verdict: rows[i] }),
          voiceEvalAt: 1_000 + i,
        });
      }
    });
    return await t.query(api.founder.fleetHealth.health, {
      token: "test-operator-token",
    });
  }

  it("⚠️ a void run is neither a pass nor a failure", async () => {
    /**
     * A void run means the judge failed to catch the deliberately-synthetic
     * control — the INSTRUMENT was broken that week. Folding it into either
     * column produces a confident number about something that wasn't measured.
     */
    const health = await fleetVoice([
      "indistinguishable",
      "detectable",
      "void",
      null,
    ]);
    // No early return — a guard that skips the assertions is a test that
    // passes without testing.
    expect(health.ok).toBe(true);
    expect(health.voice).toBeTruthy();
    expect(health.voice!.measured).toBe(3); // the unmeasured customer is excluded
    expect(health.voice!.indistinguishable).toBe(1);
    expect(health.voice!.detectable).toBe(1);
    expect(health.voice!.voided).toBe(1);
  });
});
