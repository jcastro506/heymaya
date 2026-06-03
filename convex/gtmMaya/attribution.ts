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
  v.literal("revenue"),
  // Sprint 3 (top-tier): a signed-up user who came BACK / reached value. Lets
  // Maya prove a customer who STUCK, not just a first-touch signup.
  v.literal("activated")
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

/** First pixel conversion → stamp the app so Maya knows the automatic path is
 *  live (and can stop nudging the founder to self-report). Idempotent. */
export const markPixelInstalled = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || !agent.appId) return;
    const app = await ctx.db.get(agent.appId);
    if (!app || app.conversionPixelInstalledAt) return;
    await ctx.db.patch(app._id, { conversionPixelInstalledAt: Date.now() });
  },
});

/** Read the conversion setup for an agent (signup URL + what counts as a win +
 *  whether the pixel has ever fired) so Maya can hand over the right snippet. */
export const getConversionSetupForAgent = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{
    signupUrl: string | null;
    conversionKind: string | null;
    pixelInstalled: boolean;
  }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || !agent.appId) {
      return { signupUrl: null, conversionKind: null, pixelInstalled: false };
    }
    const app = await ctx.db.get(agent.appId);
    if (!app || app.accountId !== agent.accountId) {
      return { signupUrl: null, conversionKind: null, pixelInstalled: false };
    }
    return {
      signupUrl: app.signupUrl ?? null,
      conversionKind: app.conversionKind ?? null,
      pixelInstalled: Boolean(app.conversionPixelInstalledAt),
    };
  },
});

/**
 * Agent-scoped per-post attribution read-back — the runtime twin of the web
 * `getMyPostAttribution` query, but keyed off {agentId, accountId} from the
 * hookToken auth (NOT Clerk) so Maya can pull "which post drove which signup"
 * from inside her own Fly machine and surface it on Telegram.
 *
 * Cross-tenant safe: every row is filtered by BOTH agentId and accountId, and
 * the joined draft is verified to belong to the same account before its text
 * surfaces — exactly the fail-closed scoping recordConversion uses.
 *
 * Returns per-post rows { draftId, platform, title-or-url, clicks,
 * conversionsByKind, signups } sorted by signups desc then clicks desc, PLUS
 * totals. Empty arrays/zeros when there's nothing — callers must stay silent
 * rather than fabricate.
 */
export const listAgentPostAttribution = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    limit: v.optional(v.number()),
    // Optional rolling window in days. When set, clicks + conversions are counted
    // only within the last N days (by clickedAt / occurredAt) so callers can make
    // GROUNDED "last 24h" / "this week" claims. Omitted or 0 = lifetime. This is
    // the fix for the temporal-fabrication risk: a daily recap must not call a
    // 5-day-old post's lifetime clicks "today".
    windowDays: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    posts: Array<{
      draftId: Id<"gtmDraftedContent"> | null;
      platform: string | null;
      title: string;
      clicks: number;
      conversionsByKind: {
        signup: number;
        demo: number;
        feedback: number;
        revenue: number;
        activated: number;
      };
      signups: number;
      createdAt: number;
    }>;
    totals: {
      clicks: number;
      signups: number;
      demos: number;
      feedback: number;
      revenue: number;
      // Returning/value-reached customers — proof a signup STUCK, not just landed.
      activated: number;
      // Signups recorded WITHOUT a wrapped link — real, but un-attributable to a
      // specific post. Callers report these honestly ("N signups, couldn't trace
      // which post") instead of fabricating a source, and never drop them.
      untiedSignups: number;
    };
    windowDays: number | null;
  }> => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const windowDays =
      args.windowDays && args.windowDays > 0 ? args.windowDays : null;
    const cutoff = windowDays ? Date.now() - windowDays * 86_400_000 : 0;

    // All wraps for THIS agent (by_agent index keeps it tenant-scoped).
    const wraps = await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(limit);

    // Pull this agent's conversions once, then bucket by linkWrapId in memory
    // (avoids an N+1 re-query of the whole conversions table per wrap).
    const convs = await ctx.db
      .query("gtmConversions")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    // Cross-tenant double-check (account must match) + window filter.
    const myConvs = convs.filter(
      (c) => c.accountId === args.accountId && c.occurredAt >= cutoff
    );

    const totals = {
      clicks: 0,
      signups: 0,
      demos: 0,
      feedback: 0,
      revenue: 0,
      activated: 0,
      untiedSignups: 0,
    };

    // Real signups with no wrapped link — surfaced as a separate honest total.
    for (const c of myConvs) {
      if (!c.linkWrapId && c.kind === "signup") totals.untiedSignups += c.count;
    }

    const allPosts = await Promise.all(
      wraps
        .filter((w) => w.accountId === args.accountId)
        .map(async (w) => {
          const clickRows = await ctx.db
            .query("gtmLinkClicks")
            .withIndex("by_link_wrap", (q) => q.eq("linkWrapId", w._id))
            .collect();
          const clicks = clickRows.filter((r) => r.clickedAt >= cutoff).length;

          const linked = myConvs.filter((c) => c.linkWrapId === w._id);
          const conversionsByKind = {
            signup: 0,
            demo: 0,
            feedback: 0,
            revenue: 0,
            activated: 0,
          };
          for (const c of linked) conversionsByKind[c.kind] += c.count;

          // Title: prefer the draft text (verified same-account), else the URL.
          // This is the link/draft Maya prepared — callers must frame it as
          // "the link you shared", not assert it was published verbatim.
          let title = w.destinationUrl;
          let draftId: Id<"gtmDraftedContent"> | null = null;
          if (w.draftId) {
            const draft = await ctx.db.get(w.draftId);
            if (draft && draft.accountId === args.accountId) {
              draftId = draft._id;
              const text = draft.draftText.trim();
              if (text.length > 0) {
                title = text.length > 120 ? `${text.slice(0, 117)}…` : text;
              }
            }
          }

          return {
            draftId,
            platform: w.platform ?? null,
            title,
            clicks,
            conversionsByKind,
            signups: conversionsByKind.signup,
            createdAt: w.createdAt,
          };
        })
    );

    // Only surface posts with real activity in the window — a zero-activity wrap
    // is noise, and prevents "your post drove 0 clicks" filler.
    const posts = allPosts.filter(
      (p) =>
        p.clicks > 0 ||
        p.conversionsByKind.signup > 0 ||
        p.conversionsByKind.demo > 0 ||
        p.conversionsByKind.feedback > 0 ||
        p.conversionsByKind.revenue > 0 ||
        p.conversionsByKind.activated > 0
    );

    for (const p of posts) {
      totals.clicks += p.clicks;
      totals.signups += p.conversionsByKind.signup;
      totals.demos += p.conversionsByKind.demo;
      totals.feedback += p.conversionsByKind.feedback;
      totals.revenue += p.conversionsByKind.revenue;
      totals.activated += p.conversionsByKind.activated;
    }

    posts.sort((a, b) =>
      b.signups !== a.signups ? b.signups - a.signups : b.clicks - a.clicks
    );

    return { posts, totals, windowDays };
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
  // Closed-loop handoff: pass the wrap token to the destination so the
  // founder's site (via the conversion pixel) can persist it and echo it back
  // on signup — the missing link that ties a signup to THIS specific post.
  dest.searchParams.set("lc_ref", token);
  return new Response(null, {
    status: 302,
    headers: { Location: dest.toString() },
  });
});

// CORS for the public pixel — it's called cross-origin from the founder's own
// website, so it must allow any origin. sendBeacon with text/plain is a
// "simple" request (no preflight), but we answer OPTIONS anyway for fetch.
const PIXEL_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

export const conversionPixelOptionsHttp = httpAction(async () => {
  return new Response(null, { status: 204, headers: PIXEL_CORS_HEADERS });
});

interface PixelConversionPayload {
  ref?: string;
  kind?: string;
  idempotencyKey?: string;
  /** Optional "how did you hear about us" answer, captured as a note. */
  source?: string;
}

/**
 * PUBLIC conversion pixel — POST /p/conversion, NO hookToken (a pixel on the
 * founder's website can't hold the agent secret). The wrap token IS the
 * capability: it resolves to exactly one agent/account, so a conversion can
 * only ever be attributed to the founder who shared that link. Worst-case
 * abuse is inflating one's OWN proof number, which Maya cross-checks against
 * real clicks — low stakes. count is forced to 1 (a pixel fires once per
 * signup event); idempotencyKey dedupes refreshes. We answer 204 on every
 * bad/odd input — a beacon must never see an error.
 */
export const conversionPixelHttp = httpAction(async (ctx, request) => {
  let body: PixelConversionPayload;
  try {
    body = (await request.json()) as PixelConversionPayload;
  } catch {
    // sendBeacon sends a Blob — try text → JSON before giving up.
    try {
      body = JSON.parse(await request.text()) as PixelConversionPayload;
    } catch {
      return new Response(null, { status: 204, headers: PIXEL_CORS_HEADERS });
    }
  }

  const token = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!token) {
    return new Response(null, { status: 204, headers: PIXEL_CORS_HEADERS });
  }
  const validKinds = ["signup", "demo", "feedback", "revenue", "activated"];
  // Founder-facing kinds (install/waitlist/...) all roll up to "signup" — the
  // pixel's job is "a customer converted", and signup is the canonical bucket.
  // "activated" (a returning/value-reached user) is kept distinct so Maya can
  // report a customer who STUCK, not just a first signup.
  const kind = validKinds.includes(body.kind ?? "")
    ? (body.kind as "signup" | "demo" | "feedback" | "revenue" | "activated")
    : "signup";
  // Optional self-reported source ("how did you hear about us") rides along as a
  // note so a tracked conversion also records what the customer SAID drove them.
  const selfSource =
    typeof body.source === "string" && body.source.trim().length > 0
      ? body.source.trim().slice(0, 120)
      : "";

  const wrap = await ctx.runQuery(
    internal.gtmMaya.attribution.getLinkWrapByToken,
    { token }
  );
  if (!wrap) {
    // Unknown token — nothing to attribute. 204, never error.
    return new Response(null, { status: 204, headers: PIXEL_CORS_HEADERS });
  }

  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0
      ? body.idempotencyKey
      : `pixel:${token}:${kind}`;
  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: wrap.agentId,
      accountId: wrap.accountId,
      kind: "record_conversion",
      idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response(null, { status: 204, headers: PIXEL_CORS_HEADERS });
  }

  await ctx.runMutation(internal.gtmMaya.attribution.recordConversion, {
    accountId: wrap.accountId,
    agentId: wrap.agentId,
    kind,
    count: 1,
    source: "pixel",
    linkWrapToken: token,
    note: selfSource ? `conversion pixel · heard via: ${selfSource}` : "conversion pixel",
  });
  // Mark the automatic path live so Maya can stop asking for self-reports.
  await ctx.runMutation(
    internal.gtmMaya.attribution.markPixelInstalled,
    { agentId: wrap.agentId }
  );
  return new Response(null, { status: 204, headers: PIXEL_CORS_HEADERS });
});

interface RecordConversionPayload {
  idempotencyKey: string;
  kind: "signup" | "demo" | "feedback" | "revenue" | "activated";
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
  const validKinds = ["signup", "demo", "feedback", "revenue", "activated"];
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

/**
 * Read-back endpoint Maya hits from her runtime (hookToken auth, like the other
 * get_my_* GET routes) to pull per-post clicks → signups so closed-loop
 * attribution can surface on Telegram — not just the web receipt. Scoped to the
 * calling agent only. ?limit optional. GET /lc_gtm/get_my_attribution.
 */
export const getMyAttributionHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;
  const windowParam = url.searchParams.get("windowDays");
  const windowDays = windowParam ? parseInt(windowParam, 10) : undefined;

  const attribution = await ctx.runQuery(
    internal.gtmMaya.attribution.listAgentPostAttribution,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      limit: Number.isFinite(limit) ? limit : undefined,
      windowDays: Number.isFinite(windowDays) ? windowDays : undefined,
    }
  );
  return new Response(JSON.stringify({ attribution }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/**
 * Build the copy-paste conversion pixel for THIS founder. hookToken auth — Maya
 * calls it (get_conversion_setup) when she hands the founder the automatic
 * tracking, usually in the first week. The snippet captures `lc_ref` (which our
 * redirect appends to the destination), persists it across pages, and exposes
 * `window.lcMaya.signup()` for the founder to fire from their signup-success
 * handler. Zero-code fallback is always self-report (Maya asks).
 */
export const getConversionSetupHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const setup = await ctx.runQuery(
    internal.gtmMaya.attribution.getConversionSetupForAgent,
    { agentId: auth.agentId }
  );
  const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
  const endpoint = `${site}/p/conversion`;
  const pixelSnippet =
    `<!-- HeyMaya conversion pixel — paste in your site <head> -->\n` +
    `<script>(function(){try{` +
    `var r=new URLSearchParams(location.search).get('lc_ref');` +
    `if(r){try{localStorage.setItem('lc_ref',r);}catch(e){}}` +
    `function send(kind,source){` +
    `var v;try{v=localStorage.getItem('lc_ref');}catch(e){}if(!v)return;` +
    `var k='lc_done_'+v+'_'+(kind||'signup');` +
    `try{if(localStorage.getItem(k))return;localStorage.setItem(k,'1');}catch(e){}` +
    `navigator.sendBeacon('${endpoint}',new Blob([JSON.stringify(` +
    `{ref:v,kind:kind||'signup',source:source||'',idempotencyKey:k})],{type:'text/plain'}));` +
    `}` +
    // signup(kind, source?) — fire when someone signs up. Optional `source` is
    // the "how did you hear about us" answer. activated() — fire when that user
    // comes BACK / reaches the aha moment (proves the signup stuck).
    `window.lcMaya={signup:function(kind,source){send(kind||'signup',source);},` +
    `activated:function(source){send('activated',source);}};` +
    `}catch(e){}})();</script>`;

  return new Response(
    JSON.stringify({
      ok: true,
      signupUrl: setup.signupUrl,
      conversionKind: setup.conversionKind,
      pixelInstalled: setup.pixelInstalled,
      endpoint,
      pixelSnippet,
      // MVP: Maya does NOT hand this snippet to founders — she asks for signup
      // numbers (self-report) and wraps links to signupUrl for click tracking.
      // The snippet + this text stay for the deferred automatic-tracker roadmap.
      instructions:
        "Just tell me when someone signs up (and roughly how many came back) and " +
        "I'll log it and tie it to the post that drove it. No code, no setup.",
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});
