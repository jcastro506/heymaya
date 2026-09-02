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
import { internalMutation, mutation, query } from "../_generated/server";
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
/**
 * ⚠️ THIS BLOCKED EVERY SIGNUP. The public read (`demo.ts`) returns `gaps`
 * alongside the four fields below, and a Convex `v.object` REJECTS an extra
 * field rather than ignoring it — so step 2 of onboarding died with
 * `ArgumentValidationError: Object contains extra field 'gaps'` for anyone who
 * clicked "yes, that's it". Nobody could finish signing up.
 *
 * ⭐ Accepted rather than stripped client-side, because `gaps` is the most
 * useful thing in the read: it is what she does NOT know about their product.
 * That is exactly what should drive her first questions, and throwing it away
 * at the door would repeat the defect already recorded against
 * `ProductTruth.competitors` — a field the read produces and nothing consumes.
 *
 * ⚠️ The lesson generalises: `demo.ts` extracts five fields and this validator
 * knew about four. Any field added there must be added here in the same
 * commit, or onboarding breaks for everyone at once and silently passes tests.
 */
const READ = v.object({
  name: v.optional(v.string()),
  whatItIs: v.optional(v.string()),
  whoItsFor: v.optional(v.string()),
  whatsDifferent: v.optional(v.string()),
  gaps: v.optional(v.array(v.string())),
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

    /**
     * ⭐ A SIGNED-IN IDENTITY IS THE ACCOUNT. Create the row if it is missing.
     *
     * ⚠️ THIS USED TO RETURN "no account yet" AND STRAND THE FOUNDER FOREVER.
     * `creators` rows are written by the Clerk `user.created` webhook — and
     * that webhook fires exactly ONCE per user, at signup, and is never
     * replayed. So any user whose row is absent could not onboard, could not
     * recover, and had no action available to them: they were authenticated,
     * looking at a screen that said they had no account, with nothing in the
     * product able to create one.
     *
     * ⚠️ AND ON STAGING IT IS NOT HYPOTHETICAL — IT IS EVERY USER.
     * `CLERK_WEBHOOK_SECRET` is configured on Production only, so on preview
     * the webhook cannot verify its signature and no row is ever written. The
     * only creator rows staging has ever had came from the frozen gtm
     * onboarding, which inserted them directly. v2's on-ramp had no such path,
     * which means a genuinely new signup could never complete it.
     *
     * Clerk has already authenticated this person; requiring a second,
     * asynchronous, silently-failing confirmation of that fact buys nothing.
     * `createFromClerk` is idempotent — it returns the existing row when there
     * is one — so this is safe on every call, not just the first.
     */
    let creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();

    if (!creator) {
      const creatorId = await ctx.runMutation(internal.creators.createFromClerk, {
        clerkUserId: identity.subject,
        email: typeof identity.email === "string" ? identity.email : "",
        timezone: args.timezone,
        /**
         * ⚠️ WITHOUT THIS, SETTINGS AND BILLING SHOW "No agent yet" FOREVER.
         *
         * The self-heal above created the account and left `accountType`
         * undefined. `resolveMyGtmCreator` — which every `gtmMaya` query gates
         * on, including `getMyAccount` — returns null for anything that is not
         * `gtm-agent`. So a founder who onboarded, paired, connected channels
         * and had Maya posting still saw "Finish setting up HeyMaya" on
         * Settings, with no way to reach their own billing.
         *
         * Found by looking at a live account: the creator row had every other
         * field and no `accountType`.
         *
         * ⚠️ It is not a legacy value. `gtm-agent` denotes THIS product line —
         * `convex/gtmMaya` is the frozen previous implementation of the same
         * thing, being replaced module by module. Settings and billing are the
         * modules that have not moved yet, so the type has to be set for them
         * to see the account at all.
         */
        accountType: "gtm-agent",
      });
      creator = await ctx.db.get(creatorId);
      if (!creator) return { ok: false, error: "couldn't set up your account" };
    }

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
/**
 * ⭐ Whether this customer still needs their first learn.
 *
 * Pure and exported so the DECISION is testable without a scheduler. The
 * scheduling itself races in `convex-test` — `runAfter(0)` fires before a
 * separate read-then-cancel can catch it — and a test that fights the harness
 * ends up asserting the harness rather than the rule.
 *
 * ⚠️ An unparseable map counts as UNLEARNED. Treating it as learned would lock
 * a customer out of the perception layer permanently and silently, with all ten
 * `targetsFor` readers reporting a clean null forever.
 */
export function needsFirstLearn(buyerJson: string | undefined): boolean {
  if (!buyerJson) return true;
  try {
    return !(JSON.parse(buyerJson) as { targets?: unknown }).targets;
  } catch {
    return true;
  }
}

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
       * ⭐ What she does NOT know yet — kept, not discarded. These are the
       * honest holes in the read ("pricing after the trial not disclosed",
       * "target audience not stated"), and they are the best possible source
       * for her first real questions to the founder. Capped, because this is
       * model output arriving from a browser.
       */
      gaps: (args.read.gaps ?? [])
        .map((g) => clamp(g))
        .filter((g) => g.length > 0)
        .slice(0, 8),
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
    /**
     * ⭐ THE FIRST LEARN. Nothing scheduled this, and the gap was an OWNERSHIP
     * one rather than a missing function: `relearnIfStale` skips customers who
     * have no map at all, with the comment "onboarding owns that" — and
     * onboarding did not own it. Each side assumed the other did.
     *
     * The cost of that: `targetsFor` is read by ten production modules
     * (trends, formats x5, competitors, scroll, complaints, benchmarks,
     * dashboard, strategy, audience) and every one takes its null branch
     * permanently for every customer onboarded this way. The perception layer
     * — the thing the whole product claims as its moat — was dark for exactly
     * the people we had just onboarded.
     *
     * ⚠️ Guarded on an existing map, not on the insert/patch branch above. A
     * re-run of `applyRead` (a retried submit, a corrected URL) would otherwise
     * spend twelve searches again on a customer who already has targets, and
     * `learnBusiness` is the most expensive single call in onboarding.
     *
     * ⚠️ Scheduled, never awaited. This is a mutation on the signup path; the
     * founder should reach the pairing screen while she reads the niche, not
     * after.
     */
    const row = (await ctx.db.get(customerId)) as { buyerJson?: string } | null;
    if (needsFirstLearn(row?.buyerJson)) {
      await ctx.scheduler.runAfter(
        0,
        internal.maya.learnBusiness.learnBusiness,
        { customerId }
      );
    }

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

/* -------------------------------------------------------------------------- */
/* Did she actually connect?                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ THE ONBOARDING'S LAST SCREEN HAD NO WAY TO KNOW IT HAD SUCCEEDED.
 *
 * `/start` walks url → read → assets → pair, and `pair` was TERMINAL. It
 * rendered the Telegram button and the QR and then sat there forever — the
 * founder taps Start, Maya replies in Telegram, and the browser tab they just
 * came from still says "She'll take it from here", with no way forward.
 *
 * ⚠️ THIS WAS NEVER BUILT, in any version. Five commits on that page since "the
 * live product had no front door" and not one of them closed the loop. The
 * server side has always worked — `claimPairing` sets `telegramChatId` the
 * moment the founder taps Start — so the fact was sitting in a row that nothing
 * on the web ever asked for.
 *
 * ⭐ AND IT NEEDS NO POLLING. Convex queries are reactive: the page subscribes,
 * `claimPairing` patches the row, and the screen advances by itself. A polling
 * loop here would be strictly worse and is the obvious thing to reach for.
 *
 * Returns a plain shape rather than the customer row: this is read by an
 * unauthenticated-until-signed-in screen, and the row carries tokens.
 */
export const pairingState = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{ signedIn: boolean; paired: boolean; hasChannels: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { signedIn: false, paired: false, hasChannels: false };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { signedIn: true, paired: false, hasChannels: false };

    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    if (!customer) return { signedIn: true, paired: false, hasChannels: false };

    /**
     * Whether they have a channel already decides where "next" points: a
     * founder with nothing connected has nothing for her to post to, and
     * sending them to Mission Control first shows an empty room.
     */
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .first();

    return {
      signedIn: true,
      paired: Boolean(customer.telegramChatId),
      hasChannels: channel !== null,
    };
  },
});
