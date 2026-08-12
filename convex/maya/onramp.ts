/**
 * ⭐ The on-ramp — screens ① ② ③ of §18.9.25.
 *
 * > *"Six web screens total. Four before any value is asked for… The web page
 * > is a **90-second on-ramp, not a wizard**: sign up → paste the URL → watch
 * > her read it live → pair Telegram."*
 *
 * ## Why this exists as its own module
 *
 * `maya/setup.ts` says of itself: *"Not Sprint 11's onboarding… This is the
 * plumbing underneath it: sign in, name the product, pair Telegram, deploy.
 * Three fields and a button."* It is the operator's way to start a machine, and
 * it is deliberately unlinked from anything a customer can reach.
 *
 * ⚠️ Which means the live module had **no customer on-ramp at all** — every
 * public CTA points at `/onboarding/gtm`, the product being replaced. That is
 * correct during a module-by-module cutover, and it is also why "onboarding end
 * to end" could not be demonstrated: there was nothing to demonstrate.
 *
 * This is that missing piece. It does not repoint any CTA — the cutover is a
 * deliberate operator decision, not a side effect of building the thing it
 * needs.
 *
 * ## The one idea worth protecting
 *
 * §18.9.25 ②: *"a single **'Right?'** with two affordances — one tap for yes,
 * one free-text field for a correction. **The correction becomes a directive**,
 * so the very first thing the founder types is already permanent."*
 *
 * ⭐ That sentence is the whole product in miniature. The correction is not
 * form input that gets averaged into a profile — it is stored **verbatim**,
 * dated, and it shows up on the House Rules screen forever. The first thing
 * they type is the first proof she remembers.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * The three beats of the read, as `maya/demo.ts` produces them.
 *
 * Passed back in from the browser rather than re-fetched: the visitor already
 * watched this exact text stream in, and re-reading the URL server-side could
 * produce different words than the ones they just agreed to. It is also a
 * second model call for an answer we already have.
 *
 * ⚠️ So it is UNTRUSTED input — see the length caps below.
 */
const READ = v.object({
  name: v.optional(v.string()),
  whatItIs: v.optional(v.string()),
  whoItsFor: v.optional(v.string()),
  whatsDifferent: v.optional(v.string()),
});

/**
 * ⚠️ Caps on everything that arrives from the browser.
 *
 * `productTruthJson` is read by her runtime on every turn and reaches the
 * model. Without a bound, a crafted read field is an unbounded prompt injected
 * into every future generation, billed to us.
 */
const MAX_FIELD = 2_000;
const MAX_CORRECTION = 2_000;

function clamp(value: string | undefined, limit = MAX_FIELD): string {
  return (value ?? "").slice(0, limit);
}

/**
 * ⭐ Turn a read the founder just agreed to into an account.
 *
 * Idempotent on the customer, same as `saveProduct`: refreshing the page must
 * never mint a second agent billing in parallel.
 */
export interface StartResult {
  ok: boolean;
  customerId?: Id<"customers">;
  directiveId?: Id<"directives">;
  error?: string;
}

/**
 * ⭐ The public entry point: resolve who is asking, then delegate.
 *
 * ⚠️ It does NOTHING else. Every line of the actual work lives in
 * `applyRead` below, keyed by `creatorId` rather than by a Clerk session.
 *
 * That split is deliberate and it is the difference between a chain that can
 * be demonstrated on a live deploy and one that can only be asserted in a
 * harness (§18.0). Welded to `ctx.auth`, this mutation is unreachable without
 * a browser and a real sign-in — so the one loop that crosses the on-ramp,
 * directives and the House Rules screen could never be exercised against the
 * deployed functions, only against a mocked identity.
 */
export const startFromRead = mutation({
  args: {
    url: v.string(),
    read: READ,
    /** Their correction, verbatim. Empty when they tapped "yes". */
    correction: v.optional(v.string()),
    timezone: v.string(),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator) return { ok: false, error: "no account yet" };

    return await ctx.runMutation(internal.maya.onramp.applyRead, {
      creatorId: creator._id,
      url: args.url,
      read: args.read,
      correction: args.correction,
      timezone: args.timezone,
    });
  },
});

/**
 * The work, keyed by account rather than by session.
 *
 * ⚠️ Internal — the only public caller is the wrapper above, which resolves
 * `creatorId` from the signed-in identity. Taking it as an argument here is
 * safe for exactly that reason and unsafe anywhere else, which is why this is
 * not exported publicly.
 */
export const applyRead = internalMutation({
  args: {
    creatorId: v.id("creators"),
    url: v.string(),
    read: READ,
    correction: v.optional(v.string()),
    timezone: v.string(),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    const url = args.url.trim();
    // Same check `saveProduct` makes: a URL she can't fetch is a product she
    // can't ground anything in, and every claim traces back to it.
    if (!/^https?:\/\/.+\..+/.test(url)) {
      return {
        ok: false,
        error: "that doesn't look like a URL — include https://",
      };
    }

    const now = Date.now();

    const creator = (await ctx.db.get(
      args.creatorId,
    )) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "no account yet" };

    const productTruth = {
      url,
      name: clamp(args.read.name) || url,
      whatItIs: clamp(args.read.whatItIs),
      whoItsFor: clamp(args.read.whoItsFor),
      whatsDifferent: clamp(args.read.whatsDifferent),
      /**
       * ⚠️ Provenance, on the row. §2.7 — grounded or silent. Six months from
       * now, "where did she get this?" has to be answerable, and "the founder
       * confirmed this read on day one" is a different fact from "she inferred
       * it last Tuesday".
       */
      source: "onboarding_read",
      confirmedAt: now,
    };

    /**
     * ⚠️ Deliberately does NOT schedule `productTruth.readProduct`, which
     * `saveProduct` does. The founder just watched this read stream in and
     * confirmed it — re-reading spends another call to produce possibly
     * different words, and would overwrite the version they actually agreed
     * to. A confirmed read outranks a fresh one.
     */
    const existing = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;

    let customerId: Id<"customers">;
    if (existing) {
      await ctx.db.patch(existing._id, {
        productTruthJson: JSON.stringify(productTruth),
        updatedAt: now,
      });
      customerId = existing._id;
    } else {
      customerId = await ctx.db.insert("customers", {
        accountId: creator._id,
        /**
         * ⚠️ THE load-bearing field. `agentVersion` is what routes this
         * account to `convex/maya` instead of the frozen v1 agent — omit it
         * and the on-ramp for the new product quietly provisions the old one,
         * which is the exact failure this module was written to end.
         */
        agentVersion: "v2",
        plan: "mvp",
        state: "active",
        timezone: args.timezone,
        productTruthJson: JSON.stringify(productTruth),
        createdAt: now,
        updatedAt: now,
      });
    }

    /**
     * ⭐ The correction becomes a directive — verbatim, dated, permanent.
     *
     * `product_truth` rather than `icp_correction`: at this point in the flow
     * they are correcting what the product IS, and classifying it as an
     * audience note would file the first thing they ever told her in the wrong
     * drawer.
     */
    const correction = (args.correction ?? "").trim().slice(0, MAX_CORRECTION);
    if (!correction) return { ok: true, customerId };

    const { directiveId } = await ctx.runMutation(
      internal.maya.directives.append,
      {
        customerId,
        kind: "product_truth",
        // ⚠️ Never cleaned up, never paraphrased. It appears on the House Rules
        // screen as their own sentence, which is the entire point of it.
        verbatim: correction,
      },
    );

    return { ok: true, customerId, directiveId };
  },
});
