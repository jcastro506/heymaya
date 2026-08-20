/**
 * The operator-facing way to start a machine (§18 Sprint 2.9).
 *
 * `deployMachine` is an `internalAction` — CLI-only by definition, so until
 * this existed nobody could start a v2 agent without a terminal. The whole
 * sprint's exit criteria are behavioural ("she wakes at 07:00 and texts you"),
 * and none of them are reachable without a running machine.
 *
 * ## What this deliberately is NOT
 *
 * **Not Sprint 11's onboarding.** That is a designed six-screen experience
 * (§18.9.25) with a streaming read of the founder's URL, a correction that
 * becomes a directive, connect cards, and payment — and it depends on the
 * perception layer that doesn't exist yet.
 *
 * This is the plumbing underneath it: sign in, name the product, pair Telegram,
 * deploy. Three fields and a button. Keeping the two separate is what stops the
 * real onboarding being quietly pre-decided by whatever was expedient today.
 */

import { v } from "convex/values";
import {
  action,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * The image the machine boots.
 *
 * ⚠️ `:latest` DOES NOT EXIST in this registry. The first deploy failed with
 * `MANIFEST_UNKNOWN: unknown tag=latest` — I'd assumed the tag rather than
 * checking what v1 actually ships.
 *
 * The `tag@digest` form is deliberate and load-bearing, copied from v1's hard-
 * won comment: the digest makes it immutable (the registry app was once
 * destroyed by a fleet sweep, taking the image with it), and Fly's Machines API
 * *rejects* a bare `@digest` identifier — it needs the tag too.
 *
 * Overridable per deploy so a new OpenClaw version can be tried on one machine
 * before it becomes the default.
 */
export const DEFAULT_IMAGE =
  "registry.fly.io/heymaya-openclaw:v2026.5.26@sha256:3856db33c587c2404c71b4a662d0a20ef5027422834e48dfe5f597406e228d0f";

export interface SetupState {
  signedIn: boolean;
  customerId?: string;
  productName?: string;
  productUrl?: string;
  telegramPaired: boolean;
  deployed: boolean;
  /** Present once a machine exists, so the operator can find it in Fly. */
  flyAppId?: string;
}

/**
 * What the setup screen renders from. One query, so the page has a single
 * source of truth rather than assembling state from four subscriptions.
 */
export const myState = query({
  args: {},
  handler: async (ctx): Promise<SetupState> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { signedIn: false, telegramPaired: false, deployed: false };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) {
      return { signedIn: true, telegramPaired: false, deployed: false };
    }

    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    if (!customer) {
      return { signedIn: true, telegramPaired: false, deployed: false };
    }

    const product = safeJson(customer.productTruthJson);
    return {
      signedIn: true,
      customerId: customer._id,
      productName: typeof product.name === "string" ? product.name : undefined,
      productUrl: typeof product.url === "string" ? product.url : undefined,
      telegramPaired: customer.telegramChatId !== undefined,
      /**
       * ⚠️ READ FROM THE ROW THE DEPLOY ACTUALLY WRITES.
       *
       * This asked `creator.mayaFlyAppId`, which is read in exactly two places
       * and WRITTEN IN NONE — `deployMachine` patches `flyAppName` onto the
       * CUSTOMER. So `deployed` was permanently false and Mission Control
       * believed she had never been deployed while her machine was up and
       * posting.
       *
       * Same defect class as `dailyReport` reading a `metricsJson` nothing
       * wrote: a field that only ever reads null looks like an empty state
       * rather than a broken one, so it survives every test that asserts on
       * shape.
       */
      deployed: customer.flyAppName !== undefined,
      flyAppId: customer.flyAppName,
    };
  },
});

function safeJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Create or update the v2 customer for the signed-in user.
 *
 * Idempotent — running it twice updates rather than minting a second account,
 * because "I refreshed the page" should never produce two agents billing in
 * parallel.
 */
export const saveProduct = mutation({
  args: {
    productName: v.string(),
    productUrl: v.string(),
    timezone: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; customerId?: Id<"customers">; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const name = args.productName.trim();
    const url = args.productUrl.trim();
    if (!name || !url) return { ok: false, error: "product name and URL are both required" };
    // A URL she can't fetch is a product she can't ground anything in, and
    // every claim she makes traces back to it.
    if (!/^https?:\/\/.+\..+/.test(url)) {
      return { ok: false, error: "that doesn't look like a URL — include https://" };
    }

    const now = Date.now();
    let creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;

    if (!creator) {
      const creatorId = await ctx.db.insert("creators", {
        clerkUserId: identity.subject,
        email: identity.email ?? "unknown",
        channelPreference: "telegram",
        timezone: args.timezone,
        status: "active",
        plan: "manager",
        // The purge path guards on this: it refuses to delete anything that
        // isn't a gtm-agent, so an account created without it is undeletable.
        accountType: "gtm-agent",
        createdAt: now,
      });
      creator = (await ctx.db.get(creatorId)) as Doc<"creators">;
    }

    const productTruthJson = JSON.stringify({ name, url });
    const existing = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator!._id))
      .first()) as Doc<"customers"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        productTruthJson,
        timezone: args.timezone,
        updatedAt: now,
      });
      // Re-read on a stated change — a founder editing their URL is telling us
      // the old read is stale.
      await ctx.scheduler.runAfter(0, internal.maya.productTruth.readProduct, {
        customerId: existing._id,
      });
      return { ok: true, customerId: existing._id };
    }

    const customerId = await ctx.db.insert("customers", {
      accountId: creator._id,
      // The whole point — this is what routes her to convex/maya rather than
      // the frozen v1 agent.
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: args.timezone,
      productTruthJson,
      createdAt: now,
      updatedAt: now,
    });

    /**
     * ⭐ Read the URL. Signup without this stores three fields and learns
     * nothing (Sprint 2.95).
     *
     * Scheduled directly rather than queued, because a human is sitting at the
     * screen — the job queue drains on a 5-minute cron, which is the right
     * cadence for deferrable work and the wrong one for the first thing the
     * product ever does. The cost is ~$0.02, one-shot, and bounded by signups,
     * so it cannot run away in the manner the spend ceiling exists to catch.
     */
    await ctx.scheduler.runAfter(0, internal.maya.productTruth.readProduct, {
      customerId,
    });
    return { ok: true, customerId };
  },
});

/**
 * Deploy this user's machine.
 *
 * The public wrapper `deployMachine` never had. Authenticates, resolves the
 * caller's own customer, and refuses to accept a customer id — same rule as the
 * agent tool surface, for the same reason: an id in the request body is an id
 * somebody can change.
 */
export const deployMine = action({
  args: { image: v.optional(v.string()) },
  handler: async (
    ctx,
    args
  ): Promise<
    { ok: true; appName: string; machineId: string } | { ok: false; error: string }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const customerId = await ctx.runQuery(internal.maya.setup.myCustomerId, {
      clerkUserId: identity.subject,
    });
    if (!customerId) {
      return { ok: false, error: "tell me about your product first" };
    }

    return await ctx.runAction(internal.maya.deploy.deployMachine, {
      customerId,
      image: args.image ?? DEFAULT_IMAGE,
    });
  },
});

/** Internal: resolves the caller's own customer. Never takes one as input. */
export const myCustomerId = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args): Promise<Id<"customers"> | null> => {
    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first()) as Doc<"creators"> | null;
    if (!creator) return null;
    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    return customer?._id ?? null;
  },
});
