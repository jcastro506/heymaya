/**
 * smokeFixtures/cronHeartbeat — Wave 0b: insert + delete a smoke creator and
 * read back the cronHeartbeat rows. Used by `scripts/cron-fly-smoke.ts`.
 *
 * Scope — admin-only via the shared webhook secret (`assertWebhookSecret`).
 * The smoke harness POSTs to the public Convex HTTP surface (so we don't
 * have to set admin auth in tsx); the body carries the secret. This is
 * the SAME gating pattern used by all other `lc_maya/*` endpoints.
 *
 * Cross-tenant: we mint a deterministic-but-unique clerk id per smoke run
 * (`smoke_<timestamp>_<randhex>`) and tag every row with that id. Teardown
 * filters by exact creatorId only.
 */

import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assertWebhookSecret } from "../lib/webhookSecret";

/* -------------------------------------------------------------------------- */
/* Internal mutations + queries (called via HTTP)                              */
/* -------------------------------------------------------------------------- */

export const insertSmokeCreatorInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const clerkUserId = `smoke_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const creatorId = await ctx.db.insert("creators", {
      clerkUserId,
      email: `${clerkUserId}@heymaya.smoke`,
      channelPreference: "web",
      timezone: "UTC",
      status: "onboarding",
      plan: "coach",
      createdAt: now,
    });
    return { creatorId };
  },
});

export const deleteSmokeCreatorInternal = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    const heartbeats = await ctx.db
      .query("cronHeartbeat")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    for (const row of heartbeats) await ctx.db.delete(row._id);
    const creator = await ctx.db.get(args.creatorId);
    if (creator) await ctx.db.delete(args.creatorId);
    return { deletedHeartbeats: heartbeats.length };
  },
});

export const cronHeartbeatsForCreatorInternal = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("cronHeartbeat")
      .withIndex("by_creator_and_firedAt", (q) =>
        q.eq("creatorId", args.creatorId)
      )
      .order("desc")
      .take(20);
  },
});

/* -------------------------------------------------------------------------- */
/* HTTP wrappers — secret-gated                                                */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify({ value: body }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const insertSmokeCreatorHttp = httpAction(async (ctx, request) => {
  let body: { secret?: unknown };
  try {
    body = (await request.json()) as { secret?: unknown };
  } catch {
    return jsonResponse({ error: "bad-json" }, 400);
  }
  if (typeof body.secret !== "string") {
    return jsonResponse({ error: "secret-required" }, 400);
  }
  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const result = await ctx.runMutation(
    internal.smokeFixtures.cronHeartbeat.insertSmokeCreatorInternal,
    {}
  );
  return jsonResponse(result, 200);
});

export const deleteSmokeCreatorHttp = httpAction(async (ctx, request) => {
  let body: { secret?: unknown; creatorId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "bad-json" }, 400);
  }
  if (typeof body.secret !== "string") {
    return jsonResponse({ error: "secret-required" }, 400);
  }
  if (typeof body.creatorId !== "string" || body.creatorId.length === 0) {
    return jsonResponse({ error: "creatorId-required" }, 400);
  }
  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const result = await ctx.runMutation(
    internal.smokeFixtures.cronHeartbeat.deleteSmokeCreatorInternal,
    { creatorId: body.creatorId as Id<"creators"> }
  );
  return jsonResponse(result, 200);
});

export const cronHeartbeatsForCreatorHttp = httpAction(async (ctx, request) => {
  let body: { secret?: unknown; creatorId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "bad-json" }, 400);
  }
  if (typeof body.secret !== "string") {
    return jsonResponse({ error: "secret-required" }, 400);
  }
  if (typeof body.creatorId !== "string" || body.creatorId.length === 0) {
    return jsonResponse({ error: "creatorId-required" }, 400);
  }
  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const rows = await ctx.runQuery(
    internal.smokeFixtures.cronHeartbeat.cronHeartbeatsForCreatorInternal,
    { creatorId: body.creatorId as Id<"creators"> }
  );
  return jsonResponse(rows, 200);
});
