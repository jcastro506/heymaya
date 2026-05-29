/**
 * Sprint C — Attribution (the moat foundation).
 *
 * Our own link instrumentation, zero platform OAuth:
 *   - createLinkWrap → Maya wraps a product link; we hand back a short token.
 *   - /r/<token> (public redirect) → logs a click, then 302s to the
 *     destination with UTM appended (so the user's own analytics also sees it).
 *   - recordConversion → a signup/demo/feedback lands, learned either from the
 *     operator's structured self-report (no app instrumentation needed) or a
 *     pixel POST from the user's app.
 *
 * Click capture is fully ours. Signup attribution depends on the destination
 * reporting back (self-report or pixel) — that's the honest hard part, not a
 * social OAuth problem.
 */

import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { authenticate } from "./openclaw/inboundCallback";

const CONVERSION_KIND = v.union(
  v.literal("signup"),
  v.literal("demo"),
  v.literal("feedback"),
  v.literal("revenue")
);

// ───────────────────────── mutations / queries ─────────────────────────

export const createLinkWrap = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    destinationUrl: v.string(),
    platform: v.optional(v.string()),
    draftId: v.optional(v.id("gtmDraftedContent")),
    utmSource: v.optional(v.string()),
    utmMedium: v.optional(v.string()),
    utmCampaign: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ token: string; id: Id<"gtmLinkWraps"> }> => {
    // Collision-checked short token.
    let token = Math.random().toString(36).slice(2, 10);
    for (let i = 0; i < 5; i++) {
      const existing = await ctx.db
        .query("gtmLinkWraps")
        .withIndex("by_token", (q) => q.eq("token", token))
        .first();
      if (!existing) break;
      token = Math.random().toString(36).slice(2, 10);
    }
    const id = await ctx.db.insert("gtmLinkWraps", {
      accountId: args.accountId,
      agentId: args.agentId,
      token,
      destinationUrl: args.destinationUrl,
      platform: args.platform,
      draftId: args.draftId,
      utmSource: args.utmSource,
      utmMedium: args.utmMedium,
      utmCampaign: args.utmCampaign,
      createdAt: Date.now(),
    });
    return { token, id };
  },
});

export const getLinkWrapByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
  },
});

export const recordClick = internalMutation({
  args: {
    linkWrapId: v.id("gtmLinkWraps"),
    userAgent: v.optional(v.string()),
    referrer: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const wrap = await ctx.db.get(args.linkWrapId);
    if (!wrap) return;
    await ctx.db.insert("gtmLinkClicks", {
      accountId: wrap.accountId,
      agentId: wrap.agentId,
      linkWrapId: args.linkWrapId,
      platform: wrap.platform,
      clickedAt: Date.now(),
      userAgent: args.userAgent,
      referrer: args.referrer,
    });
  },
});

export const recordConversion = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    kind: CONVERSION_KIND,
    count: v.number(),
    source: v.union(v.literal("self_report"), v.literal("pixel")),
    linkWrapToken: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmConversions">> => {
    // If a token is supplied, resolve it — and only attribute it when the
    // wrap belongs to THIS agent (cross-tenant safety).
    let linkWrapId: Id<"gtmLinkWraps"> | undefined;
    if (args.linkWrapToken) {
      const wrap = await ctx.db
        .query("gtmLinkWraps")
        .withIndex("by_token", (q) => q.eq("token", args.linkWrapToken!))
        .first();
      if (wrap && wrap.agentId === args.agentId) linkWrapId = wrap._id;
    }
    return await ctx.db.insert("gtmConversions", {
      accountId: args.accountId,
      agentId: args.agentId,
      kind: args.kind,
      count: args.count,
      source: args.source,
      linkWrapId,
      occurredAt: Date.now(),
      note: args.note,
    });
  },
});

// ───────────────────────────── httpActions ─────────────────────────────

interface WrapLinkPayload {
  destinationUrl: string;
  platform?: string;
  draftId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export const wrapLinkHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: WrapLinkPayload;
  try {
    body = (await request.json()) as WrapLinkPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    typeof body.destinationUrl !== "string" ||
    !/^https?:\/\//.test(body.destinationUrl)
  ) {
    return new Response("destinationUrl must be an http(s) URL", {
      status: 400,
    });
  }

  const { token } = await ctx.runMutation(
    internal.gtmMaya.attribution.createLinkWrap,
    {
      accountId: auth.accountId,
      agentId: auth.agentId,
      destinationUrl: body.destinationUrl,
      platform: body.platform,
      draftId: body.draftId as Id<"gtmDraftedContent"> | undefined,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
    }
  );
  const base = process.env.CONVEX_SITE_URL ?? "";
  return new Response(
    JSON.stringify({ ok: true, token, url: `${base}/r/${token}` }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});

/** Public redirect — no auth. Logs a click, then 302s to the destination
 *  with UTM appended. pathPrefix "/r/". */
export const redirectHttp = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const token = url.pathname.replace(/^\/r\//, "").split("/")[0];
  if (!token) return new Response("not found", { status: 404 });

  const wrap = await ctx.runQuery(
    internal.gtmMaya.attribution.getLinkWrapByToken,
    { token }
  );
  if (!wrap) return new Response("not found", { status: 404 });

  // Fire the click log; don't block the redirect on it failing.
  try {
    await ctx.runMutation(internal.gtmMaya.attribution.recordClick, {
      linkWrapId: wrap._id,
      userAgent: request.headers.get("user-agent") ?? undefined,
      referrer: request.headers.get("referer") ?? undefined,
    });
  } catch {
    // swallow — a logging failure must never break the user's click-through
  }

  const dest = new URL(wrap.destinationUrl);
  if (wrap.utmSource) dest.searchParams.set("utm_source", wrap.utmSource);
  if (wrap.utmMedium) dest.searchParams.set("utm_medium", wrap.utmMedium);
  if (wrap.utmCampaign) dest.searchParams.set("utm_campaign", wrap.utmCampaign);
  return new Response(null, {
    status: 302,
    headers: { Location: dest.toString() },
  });
});

interface RecordConversionPayload {
  idempotencyKey: string;
  kind: "signup" | "demo" | "feedback" | "revenue";
  count?: number;
  source?: "self_report" | "pixel";
  linkWrapToken?: string;
  note?: string;
}

export const recordConversionHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: RecordConversionPayload;
  try {
    body = (await request.json()) as RecordConversionPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey) {
    return new Response("missing required fields", { status: 400 });
  }
  const validKinds = ["signup", "demo", "feedback", "revenue"];
  if (!validKinds.includes(body.kind)) {
    return new Response("invalid kind", { status: 400 });
  }
  const count = typeof body.count === "number" ? body.count : 1;
  if (count <= 0) return new Response("count must be > 0", { status: 400 });
  const source = body.source === "pixel" ? "pixel" : "self_report";

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "record_conversion",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  await ctx.runMutation(internal.gtmMaya.attribution.recordConversion, {
    accountId: auth.accountId,
    agentId: auth.agentId,
    kind: body.kind,
    count,
    source,
    linkWrapToken: body.linkWrapToken,
    note: body.note,
  });
  return new Response("ok", { status: 200 });
});
