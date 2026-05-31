// maya-gtm-tools — typed OpenClaw tools for the ClawLaunch GTM agent.
//
// WHY THIS EXISTS
// ---------------
// Until now Maya (and her research subagents) reached the Convex `/lc_gtm/*`
// persistence endpoints and the external research APIs (ScrapeCreators /
// TwitterAPI.io / Algolia HN) by HAND-WRITING `curl` through the `exec` tool.
// That is the OpenClaw *fallback* path, and it is brittle for exactly the
// reasons we observed on the live machine:
//   - missing required JSON fields  -> Convex 400 "missing required fields"
//   - shell-quoting / heredoc errors -> `/usr/bin/sh: Syntax error: "(" unexpected`
//   - small-model research workers never even attempt the curls -> they `ls`,
//     find nothing, and FABRICATE a research report.
//
// OpenClaw's intended design is TYPED PLUGIN TOOLS: the model emits a clean,
// schema-validated function call and the plugin runs the real HTTP request
// server-side. No shell, no escaping, no missing fields. A research worker
// either gets REAL data back from `research_*` or an error — it can no longer
// fabricate, because the data only exists if the typed call actually ran.
//
// Every tool reads `CONVEX_SITE_URL` + `HOOK_TOKEN` (and the research API keys)
// from the machine environment — the same Fly secrets the curls used. Subagents
// inherit the parent's plugin tools (OpenClaw subagent tool-policy: full catalog
// minus message/session/system tools), so these reach the research workers too.
//
// Authored as plain ESM JS (no TS build step). Loaded via `openclaw plugins
// install npm-pack:<tgz>` at machine boot; activates onStartup so every tool is
// registered live before the gateway serves the first turn.

import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

// ---------------------------------------------------------------------------
// Environment + transport helpers
// ---------------------------------------------------------------------------

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function lcBase() {
  const base = readEnv("CONVEX_SITE_URL", "CONVEX_URL");
  return base ? base.replace(/\/+$/, "") : undefined;
}

function hookToken() {
  return readEnv("HOOK_TOKEN");
}

function missingEnvError() {
  const base = lcBase();
  const token = hookToken();
  const missing = [];
  if (!base) missing.push("CONVEX_SITE_URL");
  if (!token) missing.push("HOOK_TOKEN");
  return missing.length
    ? `cannot reach Convex — missing env: ${missing.join(", ")}`
    : undefined;
}

// Drop undefined values so we never send a key the validator treats as "present
// but empty". The typed schema already guarantees required fields are present.
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// POST to a /lc_gtm/* endpoint. Returns a short model-facing string describing
// the outcome (HTTP status + parsed ok/reason), because the model needs to know
// whether the write actually landed and, if not, why — so it can fix and retry.
async function postLc(endpoint, body, signal) {
  const envErr = missingEnvError();
  if (envErr) return `ERROR ${endpoint}: ${envErr}`;
  const url = `${lcBase()}/lc_gtm/${endpoint}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hookToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(compact(body)),
      signal,
    });
  } catch (err) {
    return `ERROR ${endpoint}: network failure — ${err?.message ?? String(err)}`;
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  // Some endpoints (send_update, memory_written) return 200 {ok:false,reason}
  // for a soft rejection — surface that, don't report a phantom success.
  if (parsed && typeof parsed === "object" && parsed.ok === false) {
    return `BLOCKED ${endpoint} (HTTP ${res.status}): ${parsed.reason ?? "rejected"}${
      parsed.details ? ` — ${JSON.stringify(parsed.details)}` : ""
    }`;
  }
  if (!res.ok) {
    return `FAILED ${endpoint} (HTTP ${res.status}): ${text.slice(0, 400)}`;
  }
  const tail =
    parsed && typeof parsed === "object"
      ? ` ${JSON.stringify(parsed).slice(0, 300)}`
      : text
        ? ` ${text.slice(0, 200)}`
        : "";
  return `OK ${endpoint} (HTTP ${res.status})${tail}`;
}

// GET a /lc_gtm/* read endpoint. Returns parsed JSON (the model needs the data).
async function getLc(endpoint, query, signal) {
  const envErr = missingEnvError();
  if (envErr) return `ERROR ${endpoint}: ${envErr}`;
  const qs = query
    ? "?" +
      Object.entries(compact(query))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const url = `${lcBase()}/lc_gtm/${endpoint}${qs}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${hookToken()}` },
      signal,
    });
    const text = await res.text();
    if (!res.ok) return `FAILED ${endpoint} (HTTP ${res.status}): ${text.slice(0, 400)}`;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    return `ERROR ${endpoint}: ${err?.message ?? String(err)}`;
  }
}

function key(params) {
  return params.idempotencyKey ?? randomUUID();
}

// ---------------------------------------------------------------------------
// Research transport — ScrapeCreators / TwitterAPI.io / Algolia HN.
// Each fetch runs server-side and BEST-EFFORT logs its cost to /lc_gtm/log_cost
// so we have provable, grounded evidence the call happened (no fabrication).
// ---------------------------------------------------------------------------

async function logCostBestEffort(provider, operation, reason, signal) {
  try {
    await postLc(
      "log_cost",
      {
        idempotencyKey: randomUUID(),
        provider,
        operation,
        reason,
        costUsd: 0,
        cacheStatus: "called",
      },
      signal
    );
  } catch {
    /* logging is best-effort; never block research on it */
  }
}

async function scrapeCreatorsGet(path, query, signal) {
  const apiKey = readEnv("SCRAPECREATORS_API_KEY", "SCRAPE_CREATORS_API_KEY");
  if (!apiKey) return `ERROR scrapecreators: missing SCRAPECREATORS_API_KEY`;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const qs = query
    ? "?" +
      Object.entries(compact(query))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const url = `https://api.scrapecreators.com${cleanPath}${qs}`;
  try {
    const res = await fetch(url, { headers: { "x-api-key": apiKey }, signal });
    const text = await res.text();
    await logCostBestEffort("scrapecreators", cleanPath, `GET ${cleanPath}`, signal);
    if (!res.ok) return `FAILED scrapecreators ${cleanPath} (HTTP ${res.status}): ${text.slice(0, 400)}`;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    return `ERROR scrapecreators ${cleanPath}: ${err?.message ?? String(err)}`;
  }
}

async function twitterApiGet(path, query, signal) {
  const apiKey = readEnv("TWITTERAPI_IO_KEY", "TWITTERAPI_KEY");
  if (!apiKey) return `ERROR twitterapi: missing TWITTERAPI_IO_KEY`;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const qs = query
    ? "?" +
      Object.entries(compact(query))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const url = `https://api.twitterapi.io${cleanPath}${qs}`;
  try {
    const res = await fetch(url, { headers: { "x-api-key": apiKey }, signal });
    const text = await res.text();
    await logCostBestEffort("x_api", cleanPath, `GET ${cleanPath}`, signal);
    if (!res.ok) return `FAILED twitterapi ${cleanPath} (HTTP ${res.status}): ${text.slice(0, 400)}`;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    return `ERROR twitterapi ${cleanPath}: ${err?.message ?? String(err)}`;
  }
}

async function algoliaHnGet(url, signal) {
  try {
    const res = await fetch(url, { signal });
    const text = await res.text();
    await logCostBestEffort("other", "algolia_hn", `GET ${url}`, signal);
    if (!res.ok) return `FAILED algolia_hn (HTTP ${res.status}): ${text.slice(0, 400)}`;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    return `ERROR algolia_hn: ${err?.message ?? String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// Reusable TypeBox fragments
// ---------------------------------------------------------------------------

const IdemKey = Type.Optional(
  Type.String({
    description:
      "Optional idempotency key. Leave unset — the tool mints a UUID. Pass a stable value only if you intend a retry to dedupe.",
  })
);

const PLATFORM_7 = ["reddit", "x", "hn", "linkedin", "instagram", "tiktok", "youtube"];
const RELATIONSHIP_PLATFORM = ["reddit", "x", "hn", "linkedin", "instagram", "tiktok", "threads"];
const CHANNEL_11 = [
  "reddit", "x", "hn", "linkedin", "tiktok", "instagram",
  "threads", "podcasts", "newsletters", "discord", "blog",
];
const PUBLISHED_PLATFORM_6 = ["reddit", "x", "hn", "linkedin", "instagram", "tiktok"];

function Enum(values, description) {
  return Type.Unsafe({ type: "string", enum: values, ...(description ? { description } : {}) });
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

export default defineToolPlugin({
  id: "maya-gtm-tools",
  name: "Maya GTM Tools",
  description:
    "Typed persistence + research tools for the ClawLaunch GTM agent. Replaces hand-written curl: every call is schema-validated and runs server-side against Convex /lc_gtm/* and the social research APIs.",
  tools: (tool) => [
    // =====================================================================
    // RESEARCH (read) — kills fabrication: data exists only if the call ran.
    // =====================================================================
    tool({
      name: "research_reddit",
      label: "Research Reddit",
      description:
        "Search Reddit for threads via ScrapeCreators. Returns real posts (title, url, id, subreddit, metrics). Use this INSTEAD of curling reddit.com (which is anti-scraped). For a specific subreddit, pass `subreddit`.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query (buyer-pain language works best)." }),
        subreddit: Type.Optional(Type.String({ description: "Restrict to one subreddit (omit the r/)." })),
        sort: Type.Optional(Enum(["relevance", "hot", "top", "new", "comments"], "Sort order; default relevance.")),
      }),
      execute: async ({ query, subreddit, sort }, _cfg, ctx) => {
        if (subreddit) {
          return scrapeCreatorsGet(
            "/v1/reddit/subreddit/search",
            { subreddit, query, sort: sort ?? "relevance" },
            ctx.signal
          );
        }
        return scrapeCreatorsGet("/v1/reddit/search", { query, sort: sort ?? "relevance" }, ctx.signal);
      },
    }),
    tool({
      name: "research_reddit_comments",
      label: "Research Reddit Comments",
      description:
        "Fetch the comment tree for a Reddit post (the buyer language lives in the replies). Pass the post URL.",
      parameters: Type.Object({
        url: Type.String({ description: "Full Reddit post URL." }),
      }),
      execute: async ({ url }, _cfg, ctx) =>
        scrapeCreatorsGet("/v1/reddit/post/comments", { url }, ctx.signal),
    }),
    tool({
      name: "research_x",
      label: "Research X/Twitter",
      description:
        "TwitterAPI.io advanced search. X's value is the REPLIES (~80% of pre-1K acquisition is reply-driven). Use query operators (min_faves:, since:, conversation_id:) and go deep, not one page.",
      parameters: Type.Object({
        query: Type.String({ description: "advanced_search query string (supports operators)." }),
        queryType: Type.Optional(Enum(["Latest", "Top"], "Latest or Top; default Latest.")),
        cursor: Type.Optional(Type.String({ description: "Pagination cursor from a prior page." })),
      }),
      execute: async ({ query, queryType, cursor }, _cfg, ctx) =>
        twitterApiGet(
          "/twitter/tweet/advanced_search",
          { query, queryType: queryType ?? "Latest", cursor },
          ctx.signal
        ),
    }),
    tool({
      name: "research_hn",
      label: "Research Hacker News",
      description:
        "Search Hacker News via Algolia (free, no key). Then use research_hn_item to descend the comment tree — the sharpest buyer language + competitor mentions sit deep in the replies.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query." }),
        tags: Type.Optional(Enum(["story", "comment", "show_hn", "ask_hn", "front_page"], "Filter; default story.")),
      }),
      execute: async ({ query, tags }, _cfg, ctx) =>
        algoliaHnGet(
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=${tags ?? "story"}`,
          ctx.signal
        ),
    }),
    tool({
      name: "research_hn_item",
      label: "Research HN Item",
      description: "Fetch the full nested comment tree for an HN story/comment by objectID. Recurse children[].",
      parameters: Type.Object({
        objectId: Type.String({ description: "HN objectID (from research_hn results)." }),
      }),
      execute: async ({ objectId }, _cfg, ctx) =>
        algoliaHnGet(`https://hn.algolia.com/api/v1/items/${encodeURIComponent(objectId)}`, ctx.signal),
    }),
    tool({
      name: "scrape_creators",
      label: "ScrapeCreators (generic)",
      description:
        "Escape hatch for any ScrapeCreators endpoint not covered by research_reddit/x/hn — TikTok, Instagram, YouTube, LinkedIn, profiles, transcripts, comments. Pass the path (e.g. /v1/tiktok/search/keyword) and a query object. Runs server-side with the API key; never curl scrapecreators.com by hand.",
      parameters: Type.Object({
        path: Type.String({
          description:
            "ScrapeCreators path, e.g. /v1/tiktok/search/keyword, /v2/instagram/reels/search, /v1/youtube/video/comments, /v1/twitter/profile, /v1/linkedin/company/posts.",
        }),
        query: Type.Optional(
          Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
            description: "Query params object, e.g. { query: 'bug reporting', hashtag: 'devtools' }.",
          })
        ),
      }),
      execute: async ({ path, query }, _cfg, ctx) => scrapeCreatorsGet(path, query ?? {}, ctx.signal),
    }),

    // =====================================================================
    // PERSIST (write) — kills the empty DB: schema-validated, server-side.
    // =====================================================================

    // --- Demand / target discovery ---
    tool({
      name: "save_target_thread",
      label: "Save Target Thread",
      description:
        "Persist a found thread worth engaging. REQUIRED: platform, url, externalId. This is how a research worker hands a real thread to the DB — returning it as text loses the work.",
      parameters: Type.Object({
        platform: Enum(PLATFORM_7),
        url: Type.String(),
        externalId: Type.String({ description: "Stable platform id (post id / tweet id / HN objectID)." }),
        title: Type.Optional(Type.String()),
        excerpt: Type.Optional(Type.String()),
        author: Type.Optional(Type.String()),
        subredditOrCommunity: Type.Optional(Type.String()),
        whyItFits: Type.Optional(Type.String()),
        recommendedAction: Type.Optional(Enum(["reply", "lurk", "upvote_only", "avoid"])),
        priorityScore: Type.Optional(Type.Number({ description: "0..1" })),
        researchJobId: Type.Optional(Type.String()),
        currentMetrics: Type.Optional(
          Type.Object({
            upvotes: Type.Optional(Type.Number()),
            comments: Type.Optional(Type.Number()),
            likes: Type.Optional(Type.Number()),
            shares: Type.Optional(Type.Number()),
            views: Type.Optional(Type.Number()),
          })
        ),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("target_thread", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "save_target_account",
      label: "Save Target Account",
      description: "Persist an account worth engaging/following. REQUIRED: platform, handle.",
      parameters: Type.Object({
        platform: Enum(PLATFORM_7),
        handle: Type.String(),
        profileUrl: Type.Optional(Type.String()),
        displayName: Type.Optional(Type.String()),
        bio: Type.Optional(Type.String()),
        followerCount: Type.Optional(Type.Number()),
        voiceAnalysis: Type.Optional(Type.String()),
        whyItFits: Type.Optional(Type.String()),
        recommendedAction: Type.Optional(Enum(["follow_and_engage", "lurk", "dm", "avoid"])),
        priorityScore: Type.Optional(Type.Number({ description: "0..1" })),
        researchJobId: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("target_account", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),

    // --- Actionable layer: drafts + calendar (NEVER persisted before) ---
    tool({
      name: "save_draft",
      label: "Save Drafted Content",
      description:
        "Persist a drafted reply/post/thread/comment/dm. REQUIRED: kind, platform, draftText (<=12000 chars). This is the actionable output — drafting in chat without calling this means nothing reaches the operator's queue.",
      parameters: Type.Object({
        kind: Enum(["reply", "thread", "post", "comment", "dm"]),
        platform: Enum(PLATFORM_7),
        draftText: Type.String({ description: "<= 12000 chars." }),
        targetThreadId: Type.Optional(Type.String()),
        targetAccountId: Type.Optional(Type.String()),
        researchJobId: Type.Optional(Type.String()),
        draftSegments: Type.Optional(Type.Array(Type.String())),
        attributes: Type.Optional(
          Type.Object({
            hookType: Type.Optional(Type.String()),
            format: Type.Optional(Type.String()),
            tone: Type.Optional(Type.String()),
            lengthBucket: Type.Optional(Type.String()),
            hasFace: Type.Optional(Type.Boolean()),
            captionStyle: Type.Optional(Type.String()),
            postingWindow: Type.Optional(Type.String()),
          })
        ),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("drafted_content", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "propose_calendar",
      label: "Propose Calendar Events",
      description:
        "Persist proposed calendar events for the week. REQUIRED: researchJobId, events[] each with title + startsAtMs + endsAtMs (epoch ms). This is the plan the operator approves.",
      parameters: Type.Object({
        researchJobId: Type.String(),
        events: Type.Array(
          Type.Object({
            title: Type.String(),
            startsAtMs: Type.Number({ description: "Epoch ms." }),
            endsAtMs: Type.Number({ description: "Epoch ms." }),
            description: Type.Optional(Type.String({ description: "Full hands-off recipe." })),
          }),
          { minItems: 1 }
        ),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("calendar_proposal", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "approve_calendar",
      label: "Approve Calendar",
      description: "Push approved calendar drafts to the connected calendar. Only idempotencyKey needed.",
      parameters: Type.Object({ idempotencyKey: IdemKey }),
      execute: async (p, _cfg, ctx) => postLc("approve_calendar", { idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "approval_decision",
      label: "Record Approval Decision",
      description: "Record the operator's decision on a draft. REQUIRED: draftId, decision.",
      parameters: Type.Object({
        draftId: Type.String(),
        decision: Enum(["approved", "rejected", "revise"]),
        reviseNotes: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("approval_decision", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),

    // --- Foundation / strategy ---
    tool({
      name: "save_foundation_buyer_map",
      label: "Foundation: Buyer Map",
      description: "Persist the ICP / buyer map. REQUIRED: icpDescription (non-empty).",
      parameters: Type.Object({
        icpDescription: Type.String(),
        buyerJourneyStages: Type.Optional(
          Type.Array(
            Type.Object({
              stage: Type.String(),
              whereTheyHangOut: Type.String(),
              intentLanguage: Type.String(),
            })
          )
        ),
        intentPhrases: Type.Optional(Type.Array(Type.String())),
        trustedVoices: Type.Optional(
          Type.Array(
            Type.Object({ handle: Type.String(), platform: Type.String(), whyTrusted: Type.String() })
          )
        ),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("foundation_buyer_map", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "save_foundation_competitor",
      label: "Foundation: Competitor",
      description: "Persist one competitor. REQUIRED: competitorName, kind (direct|adjacent|substitute), positioning.",
      parameters: Type.Object({
        competitorName: Type.String(),
        kind: Enum(["direct", "adjacent", "substitute"]),
        positioning: Type.String(),
        competitorKey: Type.Optional(Type.String()),
        url: Type.Optional(Type.String()),
        pricing: Type.Optional(Type.String()),
        complaints: Type.Optional(
          Type.Array(Type.Object({ quote: Type.String(), sourceUrl: Type.String() }))
        ),
        vulnerabilities: Type.Optional(Type.Array(Type.String())),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("foundation_competitor", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "save_foundation_channel_scorecard",
      label: "Foundation: Channel Scorecard",
      description:
        "Persist a channel scorecard row. REQUIRED: channel (one of the 11), uniqueUnlock. NOTE: youtube is NOT a valid channel here.",
      parameters: Type.Object({
        channel: Enum(CHANNEL_11),
        uniqueUnlock: Type.String(),
        audienceFit: Type.Optional(Type.Number({ description: "0..1, default 0.5" })),
        cadenceFit: Type.Optional(Type.Number({ description: "0..1, default 0.5" })),
        bet: Type.Optional(Type.Boolean()),
        notes: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("foundation_channel_scorecard", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "save_foundation_content_angle",
      label: "Foundation: Content Angle",
      description: "Persist a content angle. REQUIRED: angle, hookVariants[] (>=1).",
      parameters: Type.Object({
        angle: Type.String(),
        hookVariants: Type.Array(Type.String(), { minItems: 1 }),
        angleKey: Type.Optional(Type.String()),
        painCitation: Type.Optional(Type.Object({ quote: Type.String(), sourceUrl: Type.String() })),
        voiceCheck: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("foundation_content_angle", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "save_foundation_relationship_target",
      label: "Foundation: Relationship Target",
      description:
        "Persist a relationship target. REQUIRED: platform (incl. threads, NOT youtube), handle, whyThem.",
      parameters: Type.Object({
        platform: Enum(RELATIONSHIP_PLATFORM),
        handle: Type.String(),
        whyThem: Type.String(),
        displayName: Type.Optional(Type.String()),
        profileUrl: Type.Optional(Type.String()),
        engagementPlan: Type.Optional(Type.String()),
        cadence: Type.Optional(Enum(["weekly", "monthly", "as_they_post"])),
        status: Type.Optional(Enum(["prospect", "warming", "engaged", "reciprocal", "dropped"])),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("foundation_relationship_target", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "set_north_star",
      label: "Set North Star",
      description:
        "Set the agent's north star. REQUIRED: at least one of entryMode | northStarMetric | northStarTarget | northStarDeadlineMs | archetype.",
      parameters: Type.Object({
        entryMode: Type.Optional(Enum(["launch", "manager"])),
        northStarMetric: Type.Optional(Type.String()),
        northStarTarget: Type.Optional(Type.Number()),
        northStarDeadlineMs: Type.Optional(Type.Number()),
        archetype: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("set_north_star", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "set_strategy_approval",
      label: "Set Strategy Approval",
      description: "Set strategy approval state. REQUIRED: state (proposed|approved|iterating).",
      parameters: Type.Object({
        state: Enum(["proposed", "approved", "iterating"]),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("set_strategy_approval", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),

    // --- Operator comms + progress ---
    tool({
      name: "send_update",
      label: "Send Update to Operator",
      description:
        "Send a message to the operator (Telegram). REQUIRED: text (1..1500). For strategic messages set messageClass:'strategic', criticPassed:true, and claims[] (>=1 with evidence_ids) — otherwise it is soft-blocked. Tactical messages need none of that.",
      parameters: Type.Object({
        text: Type.String({ description: "1..1500 chars." }),
        messageClass: Type.Optional(Enum(["strategic", "tactical", "accountability"])),
        criticPassed: Type.Optional(Type.Boolean()),
        criticReasons: Type.Optional(Type.Array(Type.String())),
        claims: Type.Optional(
          Type.Array(Type.Object({ claim: Type.String(), evidence_ids: Type.Array(Type.String()) }))
        ),
      }),
      execute: async (p, _cfg, ctx) => postLc("send_update", p, ctx.signal),
    }),
    tool({
      name: "log_message",
      label: "Log Inbound Message (transcript)",
      description:
        "Persist the operator's inbound message to the conversation transcript. Call this as the FIRST action of every inbound turn, BEFORE you reason or reply. Pass the verbatim operator text as body, plus a fresh turnId you will reuse on the send_update reply so the message and your answer group as one turn. REQUIRED: turnId, body.",
      parameters: Type.Object({
        turnId: Type.String({ description: "Stable id for this turn; reuse on the matching send_update." }),
        body: Type.String({ description: "Verbatim inbound operator text (1..8000)." }),
        channel: Type.Optional(Enum(["telegram", "claw-messenger", "sms", "web", "unknown"])),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("log_message", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "post_activity",
      label: "Post Activity (Mission Control)",
      description:
        "Log a short activity line for the operator's live Mission Control view. REQUIRED: kind, summary. Call these freely as you work.",
      parameters: Type.Object({
        kind: Enum(["researching", "found", "drafted", "plan_changed", "posted", "thinking", "status"]),
        summary: Type.String(),
        detail: Type.Optional(Type.String()),
        linkedRef: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("post_activity", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "validate_outbound",
      label: "Validate Outbound Text",
      description: "Run the outbound text through the slop/voice firewall before posting. REQUIRED: text (1..10000).",
      parameters: Type.Object({ text: Type.String() }),
      execute: async ({ text }, _cfg, ctx) => postLc("validate_outbound", { text }, ctx.signal),
    }),

    // --- Research-job lifecycle ---
    tool({
      name: "research_callback",
      label: "Research Callback",
      description: "Mark a research-job phase. REQUIRED: researchJobId, phase.",
      parameters: Type.Object({
        researchJobId: Type.String(),
        phase: Type.String(),
        note: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("research_callback", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "phase_1_announce",
      label: "Announce Phase 1",
      description: "Announce how many subagents a research job spawned. REQUIRED: researchJobId, subagentsExpected (0..50).",
      parameters: Type.Object({
        researchJobId: Type.String(),
        subagentsExpected: Type.Number({ description: "0..50" }),
      }),
      execute: async (p, _cfg, ctx) => postLc("phase_1_announce", p, ctx.signal),
    }),
    tool({
      name: "subagent_complete",
      label: "Subagent Complete",
      description: "Signal a research subagent finished. REQUIRED: researchJobId.",
      parameters: Type.Object({
        researchJobId: Type.String(),
        platform: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) => postLc("subagent_complete", p, ctx.signal),
    }),

    // --- Continuous intelligence + learning ---
    tool({
      name: "save_competitor_move",
      label: "Save Competitor Move",
      description:
        "Persist an observed competitor move. REQUIRED: competitorName, moveKind, sourceUrl.",
      parameters: Type.Object({
        competitorName: Type.String(),
        moveKind: Enum(["feature_ship", "campaign", "milestone", "pricing_change", "partnership", "incident"]),
        sourceUrl: Type.String(),
        summary: Type.Optional(Type.String()),
        observedAt: Type.Optional(Type.Number()),
        recommendedCounter: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("competitor_move", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "save_niche_pulse_signal",
      label: "Save Niche Pulse Signal",
      description: "Persist a niche-pulse signal. REQUIRED: pulseKind, name, evidenceUrl.",
      parameters: Type.Object({
        pulseKind: Enum(["new_community", "rising_account", "rising_keyword", "rising_topic", "declining_signal"]),
        name: Type.String(),
        evidenceUrl: Type.String(),
        platform: Type.Optional(Type.String()),
        momentumSignal: Type.Optional(Type.String()),
        observedAt: Type.Optional(Type.Number()),
        relevance: Type.Optional(Enum(["act_now", "monitor", "noise"])),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("niche_pulse_signal", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "log_action",
      label: "Log Action",
      description: "Log a completed agent action (briefs, recaps, alerts). REQUIRED: kind, summary.",
      parameters: Type.Object({
        kind: Enum([
          "morning_brief", "evening_recap", "weekly_review", "monthly_reset", "hot_alert",
          "inbound_triage", "calendar_event_created", "draft_proposed", "foundation_complete",
          "competitor_move_alert", "niche_pulse_alert", "other",
        ]),
        summary: Type.String(),
        sentAt: Type.Optional(Type.Number()),
        userResponse: Type.Optional(Enum(["pending", "acknowledged", "acted", "ignored", "dismissed"])),
        linkedEntities: Type.Optional(
          Type.Array(Type.Object({ entityKind: Type.String(), entityId: Type.String() }))
        ),
        outcomeNotes: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("action_logged", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "save_learning",
      label: "Save Learning",
      description: "Persist an extracted learning. REQUIRED: learningKind, learning.",
      parameters: Type.Object({
        learningKind: Enum([
          "timing", "channel_priority", "voice_angle", "community_quality",
          "format_preference", "hook_pattern", "other",
        ]),
        learning: Type.String(),
        learningKey: Type.Optional(Type.String()),
        confidenceScore: Type.Optional(Type.Number({ description: "0..1" })),
        evidenceCount: Type.Optional(Type.Number()),
        retired: Type.Optional(Type.Boolean()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("learning_extracted", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "propose_skill_improvement",
      label: "Propose Skill Improvement",
      description:
        "Propose an improvement to one of Maya's own skills, grounded in an outcome. REQUIRED: targetSkill, proposal, groundedInOutcome.",
      parameters: Type.Object({
        targetSkill: Type.String(),
        proposal: Type.String(),
        groundedInOutcome: Type.String(),
        archetype: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("propose_skill_improvement", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),

    // --- Publishing + outcomes ---
    tool({
      name: "publish_draft",
      label: "Publish Draft",
      description: "Publish an approved draft. REQUIRED: draftId. Inspect the returned ok flag.",
      parameters: Type.Object({ draftId: Type.String(), idempotencyKey: IdemKey }),
      execute: async (p, _cfg, ctx) => postLc("publish_draft", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "update_draft_voice_match",
      label: "Update Draft Voice Match",
      description:
        "Record a draft's voice-match score + slop-critic verdict. REQUIRED: draftId, voiceMatchScore (0..1), slopCriticPassed.",
      parameters: Type.Object({
        draftId: Type.String(),
        voiceMatchScore: Type.Number({ description: "0..1" }),
        slopCriticPassed: Type.Boolean(),
        slopCriticFailures: Type.Optional(Type.Array(Type.String())),
        approvalStateUpdate: Type.Optional(Enum(["pending_approval", "rejected"])),
        userFeedback: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("update_draft_voice_match", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "save_post_result",
      label: "Save Post Result Snapshot",
      description:
        "Snapshot a published post's metrics. REQUIRED: draftId, platform, providerPostId, metrics (object).",
      parameters: Type.Object({
        draftId: Type.String(),
        platform: Enum(PLATFORM_7),
        providerPostId: Type.String(),
        metrics: Type.Object({
          likes: Type.Optional(Type.Number()),
          comments: Type.Optional(Type.Number()),
          shares: Type.Optional(Type.Number()),
          views: Type.Optional(Type.Number()),
          upvotes: Type.Optional(Type.Number()),
          downvotes: Type.Optional(Type.Number()),
        }),
        notes: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("post_result_snapshot", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "record_published",
      label: "Record Published",
      description:
        "Record that a draft was published. REQUIRED: draftId, providerPostId, platform (6-value, NO youtube).",
      parameters: Type.Object({
        draftId: Type.String(),
        providerPostId: Type.String(),
        platform: Enum(PUBLISHED_PLATFORM_6),
        permalink: Type.Optional(Type.String()),
        postedAtMs: Type.Optional(Type.Number()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("record_published", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "record_conversion",
      label: "Record Conversion",
      description: "Record a conversion (signup/demo/feedback/revenue). REQUIRED: kind.",
      parameters: Type.Object({
        kind: Enum(["signup", "demo", "feedback", "revenue"]),
        count: Type.Optional(Type.Number({ description: "default 1, must be > 0" })),
        source: Type.Optional(Enum(["self_report", "pixel"])),
        linkWrapToken: Type.Optional(Type.String()),
        note: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("record_conversion", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "wrap_link",
      label: "Wrap Link (attribution)",
      description: "Wrap a destination URL in a tracked redirect for signup attribution. REQUIRED: destinationUrl (http/https).",
      parameters: Type.Object({
        destinationUrl: Type.String(),
        platform: Type.Optional(Type.String()),
        draftId: Type.Optional(Type.String()),
        utmSource: Type.Optional(Type.String()),
        utmMedium: Type.Optional(Type.String()),
        utmCampaign: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) => postLc("wrap_link", p, ctx.signal),
    }),
    tool({
      name: "review_media",
      label: "Review Media",
      description: "Send a video/image to Gemini for multimodal review. REQUIRED: mediaUrl, kind (video|image).",
      parameters: Type.Object({
        mediaUrl: Type.String(),
        kind: Enum(["video", "image"]),
        operatorAsk: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) => postLc("review_media", p, ctx.signal),
    }),
    tool({
      name: "log_cost",
      label: "Log Cost",
      description:
        "Log a cost event. REQUIRED: provider (openrouter|openclaw|scrapecreators|x_api|composio|gemini|other), operation, reason, costUsd (>=0).",
      parameters: Type.Object({
        provider: Enum(["openrouter", "openclaw", "scrapecreators", "x_api", "composio", "gemini", "other"]),
        operation: Type.String(),
        reason: Type.String(),
        costUsd: Type.Number({ description: ">= 0" }),
        units: Type.Optional(Type.Number()),
        cacheStatus: Type.Optional(Enum(["hit", "miss", "called", "skipped", "failed"])),
        metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("log_cost", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "record_memory_written",
      label: "Record Memory Written",
      description:
        "Record a memory-ledger write. REQUIRED: target (daily_memory|dreams|memory_index), op (append|replace_section|strike), triggeredBy.",
      parameters: Type.Object({
        target: Enum(["daily_memory", "dreams", "memory_index"]),
        op: Enum(["append", "replace_section", "strike"]),
        triggeredBy: Type.String(),
        dateSlot: Type.Optional(Type.String({ description: "YYYY-MM-DD (for daily_memory)." })),
        section: Type.Optional(Type.String()),
        bytes: Type.Optional(Type.Number()),
        summary: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("memory_written", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),

    // =====================================================================
    // READ-BACK (GET) — let Maya inspect her own persisted state.
    // =====================================================================
    tool({
      name: "get_my_foundation",
      label: "Get My Foundation",
      description: "Read back all 5 foundation outputs (buyer map, competitors, channels, angles, relationships).",
      parameters: Type.Object({}),
      execute: async (_p, _cfg, ctx) => getLc("get_my_foundation", undefined, ctx.signal),
    }),
    tool({
      name: "get_my_target_threads",
      label: "Get My Target Threads",
      description: "Read back saved target threads. Optional filters: status, platform.",
      parameters: Type.Object({
        status: Type.Optional(Enum(["queued", "replied", "dropped", "expired"])),
        platform: Type.Optional(Enum(PUBLISHED_PLATFORM_6)),
      }),
      execute: async (p, _cfg, ctx) => getLc("get_my_target_threads", p, ctx.signal),
    }),
    tool({
      name: "get_my_recent_post_results",
      label: "Get My Recent Post Results",
      description: "Read back recent post-result snapshots. Optional: limit.",
      parameters: Type.Object({ limit: Type.Optional(Type.Number()) }),
      execute: async (p, _cfg, ctx) => getLc("get_my_recent_post_results", p, ctx.signal),
    }),
    tool({
      name: "get_my_competitor_moves",
      label: "Get My Competitor Moves",
      description: "Read back observed competitor moves. Optional: since_ms, limit.",
      parameters: Type.Object({
        since_ms: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
      }),
      execute: async (p, _cfg, ctx) => getLc("get_my_competitor_moves", p, ctx.signal),
    }),
    tool({
      name: "get_my_niche_pulse",
      label: "Get My Niche Pulse",
      description: "Read back niche-pulse signals. Optional: since_ms, limit, relevance.",
      parameters: Type.Object({
        since_ms: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
        relevance: Type.Optional(Enum(["act_now", "monitor", "noise"])),
      }),
      execute: async (p, _cfg, ctx) => getLc("get_my_niche_pulse", p, ctx.signal),
    }),
    tool({
      name: "get_my_action_log",
      label: "Get My Action Log",
      description: "Read back the action log. Optional: since_ms, limit, kind.",
      parameters: Type.Object({
        since_ms: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
        kind: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) => getLc("get_my_action_log", p, ctx.signal),
    }),
    tool({
      name: "get_my_niche_learnings",
      label: "Get My Niche Learnings",
      description: "Read back extracted niche learnings. Optional: include_retired.",
      parameters: Type.Object({ include_retired: Type.Optional(Type.Boolean()) }),
      execute: async (p, _cfg, ctx) =>
        getLc("get_my_niche_learnings", p.include_retired ? { include_retired: "true" } : undefined, ctx.signal),
    }),
  ],
});
