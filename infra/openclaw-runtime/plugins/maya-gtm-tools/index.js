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
  "reddit", "x", "hn", "linkedin", "tiktok", "instagram", "youtube",
  "threads", "podcasts", "newsletters", "discord", "blog",
];
const PUBLISHED_PLATFORM_6 = ["reddit", "x", "hn", "linkedin", "instagram", "tiktok"];
// Channels that carry a per-channel warmth state (ban-safety arc). Mirrors the
// bet channels plus tiktok (the original warmup channel kept as back-compat).
const WARMTH_CHANNEL = ["reddit", "x", "hn", "linkedin", "instagram", "tiktok", "youtube"];
// Per-channel warmth state. Reuses the tiktokWarmupState enum values; warm|ready
// means skip-warmup for that channel.
const WARMTH_STATE = ["unknown", "new_needs_warmup", "warming", "ready", "warm", "restricted"];

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
      name: "search_web",
      label: "Search Web",
      description:
        "Search the OPEN WEB (Google-grounded) and read any page — competitor pricing/positioning/changelog pages, a founder's own landing page, reviews, blogs, docs. Use this when I need something OFF the social platforms (research_reddit/x/hn cover social). REQUIRED: query (a question or 'read <url>'-style ask). Optional: limit (default 8). Returns { ok, results:[{url, title, excerpt, domain}], statusDetail }. Cited — I quote the page, never invent. Costs ~$0.04/query: log it with log_cost (provider gemini). Empty/blocked returns ok:false with statusDetail, never an error.",
      parameters: Type.Object({
        query: Type.String({ description: "What to find on the web, or a site to read." }),
        limit: Type.Optional(Type.Number()),
      }),
      execute: async (p, _cfg, ctx) => getLc("search_web", p, ctx.signal),
    }),
    tool({
      name: "search_demand",
      label: "Search Demand",
      description:
        "Real Google SEARCH DEMAND for buyer phrasing — which terms people actually search, with volume + CPC + competition. Use it in foundation research to validate WHERE demand is (vs guessing from threads) and to find which buyer language to target. REQUIRED: seeds (terms derived from the buyer map / intent phrases — pass ALL of them in ONE call, it's billed per-call ~$0.075 not per-keyword, up to ~200). Optional: locationCode (default 2840 = US), languageCode (default 'en'). Returns { ok, keywords:[{keyword, volume, cpc, competition}] sorted by volume } — volume null = ~no search demand for that phrasing (a dead end). On ok:false reason 'needs_verification'/'no_creds', the demand add-on isn't ready — say so plainly. Log the ~$0.075 with log_cost (provider other, operation search_demand).",
      parameters: Type.Object({
        seeds: Type.Array(Type.String()),
        locationCode: Type.Optional(Type.Number()),
        languageCode: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) => postLc("search_demand", p, ctx.signal),
    }),
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
        "Persist today's proposed calendar event(s). REQUIRED: researchJobId, events[] each with title + startsAtMs + endsAtMs (epoch ms). This is the plan the operator approves. For any reply_window / soft_launch_post / hard_launch_anchor event, make it TURN-KEY: openUrl (one-tap OPEN/LINK; wrap_link any product URL first) + draftText (verbatim paste block) so the operator acts in one tap.",
      parameters: Type.Object({
        researchJobId: Type.String(),
        events: Type.Array(
          Type.Object({
            title: Type.String(),
            startsAtMs: Type.Number({ description: "Epoch ms." }),
            endsAtMs: Type.Number({ description: "Epoch ms." }),
            description: Type.Optional(Type.String({ description: "Full hands-off recipe." })),
            openUrl: Type.Optional(
              Type.String({ description: "One-tap OPEN/LINK target (wrap_link any product URL first)." })
            ),
            draftText: Type.Optional(
              Type.String({ description: "Verbatim 'YOUR REPLY'/paste block the operator copies." })
            ),
            sourceNote: Type.Optional(
              Type.String({ description: "Why this event exists — the grounded source/thread it came from." })
            ),
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
              nativeStyleExemplars: Type.Optional(
                Type.Array(Type.String(), {
                  description: "Verbatim native phrasing buyers use at this stage / in this venue.",
                })
              ),
              complaints: Type.Optional(
                Type.Array(Type.String(), {
                  description: "Pain/complaints heard at this stage (their words).",
                })
              ),
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
        "Persist a channel scorecard row. REQUIRED: channel (one of the 11), uniqueUnlock. For any BET channel, populate icpKnowledge (venues + watch + complaints[quote+URL] + topics + nativeStyle) — a bet channel with empty icpKnowledge is an incomplete scorecard. styleExemplars holds 5-10 verbatim native posts that anchor maya-voice-matcher Anchor B (or use save_style_exemplars).",
      parameters: Type.Object({
        channel: Enum(CHANNEL_11),
        uniqueUnlock: Type.String(),
        audienceFit: Type.Optional(Type.Number({ description: "0..1, default 0.5" })),
        cadenceFit: Type.Optional(Type.Number({ description: "0..1, default 0.5" })),
        bet: Type.Optional(Type.Boolean()),
        notes: Type.Optional(Type.String()),
        icpKnowledge: Type.Optional(
          Type.Union(
            [
              Type.Object({
                venues: Type.Optional(
                  Type.Array(
                    Type.Object({
                      name: Type.String(),
                      kind: Type.Optional(Enum(["subreddit", "hashtag", "community", "account"])),
                      url: Type.Optional(Type.String()),
                      whyHere: Type.Optional(Type.String()),
                    })
                  )
                ),
                watch: Type.Optional(Type.Array(Type.String())),
                complaints: Type.Optional(
                  Type.Array(Type.Object({ quote: Type.String(), sourceUrl: Type.String() }))
                ),
                topics: Type.Optional(Type.Array(Type.String())),
                nativeStyle: Type.Optional(
                  Type.Object({
                    exemplars: Type.Optional(
                      Type.Array(Type.Object({ quote: Type.String(), sourceUrl: Type.String() }))
                    ),
                    cadenceNotes: Type.Optional(Type.String()),
                    vocab: Type.Optional(Type.Array(Type.String())),
                  })
                ),
              }),
              Type.String({ description: "Or a pre-serialized JSON string of the same shape." }),
            ],
            {
              description:
                "Per-channel ICP knowledge: where the buyer lives, what to watch, their complaints (quote+URL), topics, and native style. Pass the object OR a JSON string.",
            }
          )
        ),
        styleExemplars: Type.Optional(
          Type.Array(
            Type.Object({
              platform: Type.Optional(Type.String()),
              community: Type.Optional(Type.String()),
              verbatim: Type.String({ description: "The native post, copied verbatim." }),
              why: Type.Optional(Type.String()),
              capturedAt: Type.Optional(Type.Number()),
            }),
            { description: "5-10 verbatim native posts for this channel (voice-matcher Anchor B)." }
          )
        ),
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

    // --- Voice + per-channel warmth (Phase 0 + ban-safety arc) ---
    tool({
      name: "save_voice_profile",
      label: "Save Voice Profile",
      description:
        "Persist the founder's voice fingerprint (Phase 0 — built from their own posts/videos before any niche research). REQUIRED: voiceProfile (the fingerprint object, or a pre-serialized JSON string of it). A voice profile you describe but never save does not exist — maya-voice-matcher Anchor A reads it back. If the user has NO handles, build from 2-3 sentences they give and set confidence:'low'/'none'.",
      parameters: Type.Object({
        voiceProfile: Type.Union(
          [
            Type.Object({
              builtAt: Type.Optional(Type.Number()),
              sources: Type.Optional(
                Type.Array(
                  Type.Object({
                    platform: Type.String(),
                    url: Type.Optional(Type.String()),
                    sampleCount: Type.Optional(Type.Number()),
                    kind: Type.Optional(Enum(["text", "video"])),
                  })
                )
              ),
              features: Type.Optional(
                Type.Object({
                  avgSentenceLen: Type.Optional(Type.Number()),
                  burstiness: Type.Optional(Type.Number()),
                  contractionUse: Type.Optional(Type.String()),
                  emojiFreq: Type.Optional(Type.String()),
                  register: Type.Optional(Type.String()),
                  openings: Type.Optional(Type.Array(Type.String())),
                  signoffs: Type.Optional(Type.Array(Type.String())),
                  characteristicPhrases: Type.Optional(Type.Array(Type.String())),
                  emDashHabit: Type.Optional(Type.String()),
                  profanityTolerance: Type.Optional(Type.String()),
                })
              ),
              perPlatform: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
              verbatimSamples: Type.Optional(
                Type.Array(
                  Type.Object({
                    platform: Type.String(),
                    text: Type.Optional(Type.String()),
                    videoSummary: Type.Optional(Type.String()),
                    url: Type.Optional(Type.String()),
                  })
                )
              ),
              confidence: Type.Optional(Enum(["high", "medium", "low", "none"])),
            }),
            Type.String({ description: "Or a pre-serialized JSON string of the same shape." }),
          ],
          {
            description:
              "Voice fingerprint: sources, cadence/vocab/openings/signoffs/emoji features, per-platform variants, verbatim samples, and confidence. Pass the object OR a JSON string.",
          }
        ),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("save_voice_profile", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "save_style_exemplars",
      label: "Save Style Exemplars",
      description:
        "Persist 5-10 verbatim native posts for one channel — they anchor maya-voice-matcher Anchor B (native-community style). REQUIRED: channel, styleExemplars[] (>=1). Skip it and drafts default to generic LLM-tone. Saved onto that channel's scorecard row.",
      parameters: Type.Object({
        channel: Enum(CHANNEL_11),
        styleExemplars: Type.Array(
          Type.Object({
            platform: Type.Optional(Type.String()),
            community: Type.Optional(Type.String()),
            verbatim: Type.String({ description: "The native post, copied verbatim." }),
            why: Type.Optional(Type.String({ description: "What makes it native to the community." })),
            capturedAt: Type.Optional(Type.Number()),
          }),
          { minItems: 1 }
        ),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("save_style_exemplars", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "set_channel_warmth",
      label: "Set Channel Warmth",
      description:
        "Set/advance one channel's warmth state in the ban-safety arc (new_needs_warmup -> warming -> warm). REQUIRED: channel, state. warm|ready = skip-warmup (real posting unlocked); cold channels stay warmup_block + substantive engagement only (no promo/links). Merges into channelWarmthJson and stamps lastUpdatedMs — idempotent. Call when a channel's Phase-1 floor is met.",
      parameters: Type.Object({
        channel: Enum(WARMTH_CHANNEL),
        state: Enum(WARMTH_STATE),
        accountAgeDays: Type.Optional(Type.Number()),
        baselineKarma: Type.Optional(Type.Number()),
        baselineFollowers: Type.Optional(Type.Number()),
        baselinePostCount: Type.Optional(Type.Number()),
        warmTargetMs: Type.Optional(Type.Number({ description: "Epoch ms the channel is expected to be warm." })),
        note: Type.Optional(Type.String()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("set_channel_warmth", { ...p, idempotencyKey: key(p) }, ctx.signal),
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
      name: "log_turn_telemetry",
      label: "Log Turn Telemetry (tokens/cost)",
      description:
        "After a conversation turn completes, report the model usage that produced my reply so per-turn cost/latency joins to the transcript. Pass the SAME turnId I used on log_message/send_update, plus whatever usage stats I have (tokensIn, tokensOut, latencyMs, costUsd, model, thinkingBudget). Best-effort — skip fields I don't have. REQUIRED: turnId.",
      parameters: Type.Object({
        turnId: Type.String({ description: "Same turnId as log_message/send_update for this turn." }),
        model: Type.Optional(Type.String()),
        tokensIn: Type.Optional(Type.Number()),
        tokensOut: Type.Optional(Type.Number()),
        cacheReadTokens: Type.Optional(Type.Number()),
        latencyMs: Type.Optional(Type.Number()),
        costUsd: Type.Optional(Type.Number()),
        thinkingBudget: Type.Optional(Type.Number()),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("log_turn_telemetry", { ...p, idempotencyKey: key(p) }, ctx.signal),
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
      description: "Persist an extracted learning. REQUIRED: learningKind, learning. Confidence is auto-clamped to the evidence server-side (can't claim 0.95 off 1 point). Pass `structured` ({venue,hook,format,timeBucket,outcome}) when the learning is a converting pattern — it feeds the cross-tenant archetype brain so it makes the NEXT founder like this one smarter.",
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
        structured: Type.Optional(Type.Object({
          venue: Type.Optional(Type.String()),
          hook: Type.Optional(Type.String()),
          format: Type.Optional(Type.String()),
          timeBucket: Type.Optional(Type.String()),
          outcome: Type.Optional(Type.String()),
        })),
        idempotencyKey: IdemKey,
      }),
      execute: async (p, _cfg, ctx) => postLc("learning_extracted", { ...p, idempotencyKey: key(p) }, ctx.signal),
    }),
    tool({
      name: "get_archetype_playbook",
      label: "Get Archetype Playbook",
      description: "At synthesis (after I tag the app archetype), fetch the cross-tenant prior for this archetype — what's converted for OTHER founders like this one ('dev-tool founders convert best in r/X with the founder-story hook'). Returns { archetype, playbook:[{kind, learning, supportingTenantCount, evidenceCount, confidence}] }. PII-FREE — only patterns + how many tenants back them, never any other founder's identity. Empty until an archetype has ≥5 attributed founders; then I fold it in as a SOFT prior my own research confirms or overrides, never as fact.",
      parameters: Type.Object({}),
      execute: async (p, _cfg, ctx) => getLc("get_archetype_playbook", p, ctx.signal),
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
      description: "Record a conversion. REQUIRED: kind. 'activated' = a signed-up user who came BACK / reached value (proves they stuck, not just signed up). For self-reported 'how did you hear about us' answers on an organic signup, put the channel in note.",
      parameters: Type.Object({
        kind: Enum(["signup", "demo", "feedback", "revenue", "activated"]),
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
    tool({
      name: "get_my_attribution",
      label: "Get My Attribution",
      description:
        "Read back per-post closed-loop attribution: which post/reply drove clicks → signups. Returns posts[] (draftId, platform, title, clicks, conversionsByKind, signups) sorted by signups then clicks, plus totals. Empty when nothing — stay silent, never fabricate. Optional: limit; windowDays (rolling window — 1 = last ~24h for a daily recap, 7 = last week, omit = lifetime).",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number()),
        windowDays: Type.Optional(
          Type.Number({
            description:
              "Rolling lookback window in days. 1 = last ~24h (daily recap), 7 = last week; omit for lifetime.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => getLc("get_my_attribution", p, ctx.signal),
    }),
    tool({
      name: "get_attribute_outcomes",
      label: "Get Attribute Outcomes",
      description:
        "Which VALUE of a content attribute actually converts — real Beta-Bernoulli math, not a guess. dimension is one of hookType/format/tone/lengthBucket/captionStyle/postingWindow. Returns { dimension, arms:[{label,trials(clicks),conversions(signups)}], verdict:{ winner, leader, pBestLeader, verdict('winner'|'leaning'|'not_enough_data'), reason, conversionsNeeded } }. Use the verdict.reason verbatim-ish in plain language: 'lowercase hooks: 3 signups / 12 vs polished 0 / 9 — 84% likely better' or 'not enough data yet — need N more signups to call it'. Optional windowDays.",
      parameters: Type.Object({
        dimension: Enum([
          "hookType",
          "format",
          "tone",
          "lengthBucket",
          "captionStyle",
          "postingWindow",
        ]),
        windowDays: Type.Optional(Type.Number()),
      }),
      execute: async (p, _cfg, ctx) =>
        getLc("get_attribute_outcomes", p, ctx.signal),
    }),
    tool({
      name: "get_experiment_verdict",
      label: "Get Experiment Verdict",
      description:
        "Pure stats verdict for ANY arms I'm comparing (channels, CTAs, hooks — anything), when I already have the counts. Pass arms:[{label, trials, conversions}]. Returns { verdict:{ arms:[{label,mean,ci80,pBest}], winner, leader, pBestLeader, verdict, reason, conversionsNeeded } }. A winner needs BOTH P(best)>=0.85 AND >=5 conversions — never P(best) alone. Lets me say honestly 'I can't call this yet, need N more conversions' instead of overfitting.",
      parameters: Type.Object({
        arms: Type.Array(
          Type.Object({
            label: Type.String(),
            trials: Type.Number(),
            conversions: Type.Number(),
          })
        ),
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("get_experiment_verdict", p, ctx.signal),
    }),
    tool({
      name: "save_experiment",
      label: "Save Experiment",
      description:
        "Register a systematic experiment so I test ONE thing at a time on purpose. Pass { hypothesis, dimension (hookType/format/tone/lengthBucket/captionStyle/postingWindow), arms:[two+ value labels], metric }. At most TWO dimensions may run at once (server-enforced) — I don't test six things and learn nothing. To conclude one, pass { concludeId, verdict } instead. Returns { ok, experimentId } or { ok:false, reason }.",
      parameters: Type.Object({
        hypothesis: Type.Optional(Type.String()),
        dimension: Type.Optional(Type.String()),
        arms: Type.Optional(Type.Array(Type.String())),
        metric: Type.Optional(Type.String()),
        concludeId: Type.Optional(Type.String()),
        verdict: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) => postLc("save_experiment", p, ctx.signal),
    }),
    tool({
      name: "assign_arm",
      label: "Assign Arm",
      description:
        "Thompson-allocate the next draft to an arm of a running experiment, based on each arm's REAL converting outcomes so far (explore/exploit, not vibes). Pass { experimentId }. Returns { ok, experimentId, dimension, armLabel, reason }. I stamp the draft's attributes with { experimentId, armLabel, [dimension]: armLabel } and say WHY in the brief ('giving the explainer arm a fair shot' / 'leaning on lowercase — current best bet').",
      parameters: Type.Object({
        experimentId: Type.String(),
      }),
      execute: async (p, _cfg, ctx) => postLc("assign_arm", p, ctx.signal),
    }),
    tool({
      name: "save_diagnosis",
      label: "Save Strategic Diagnosis",
      description:
        "Record this week's strategic read when reach is real but conversion is flat. category ∈ messaging/positioning/pmf_suspected/pricing/distribution; tier ∈ hunch/lean/strong. Returns { tier (PMF & pricing are AUTO-CAPPED to 'lean' server-side — I can't assert what I can't see from outside), cappedFrom?, weeksPersisted, shouldHardTruthPing }. I only deliver a hard-truth PING when shouldHardTruthPing is true (a STRONG non-distribution verdict that's persisted ≥2 weeks, throttled). For pmf_suspected/pricing I ALWAYS pair the read with 'here's what I can't see — run this survey'. Method in maya-strategic-diagnostician.",
      parameters: Type.Object({
        category: Enum([
          "messaging",
          "positioning",
          "pmf_suspected",
          "pricing",
          "distribution",
        ]),
        tier: Enum(["hunch", "lean", "strong"]),
        reason: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) => postLc("save_diagnosis", p, ctx.signal),
    }),
    tool({
      name: "propose_pmf_survey",
      label: "Propose PMF Survey",
      description:
        "Turn an honest 'I can't see retention from out here' into a real instrument: the Sean-Ellis 40% PMF survey. Returns { ok, survey:{ questions, scoring } } or { ok:false, reason:'throttled' } (offered ≤ once/~3 weeks). I hand the founder the questions in plain language and offer to score the result. Optional productName.",
      parameters: Type.Object({ productName: Type.Optional(Type.String()) }),
      execute: async (p, _cfg, ctx) => postLc("propose_pmf_survey", p, ctx.signal),
    }),
    tool({
      name: "propose_pricing_test",
      label: "Propose Pricing Test",
      description:
        "Turn an honest 'I can't see willingness-to-pay' into a real instrument: the van Westendorp 4-question price-sensitivity test. Returns { ok, survey:{ questions, scoring } } or { ok:false, reason:'throttled' } (≤ once/~3 weeks). Optional productName.",
      parameters: Type.Object({ productName: Type.Optional(Type.String()) }),
      execute: async (p, _cfg, ctx) => postLc("propose_pricing_test", p, ctx.signal),
    }),
    tool({
      name: "build_intent_watch",
      label: "Build Intent Watch",
      description:
        "Compile my real-time intent-strike watchlist from my buyer map's intent phrases + my bet channels, so the Convex-owned poller can catch a buyer the MOMENT they ask 'is there a tool that does X'. Pass { phrases:[buyer intent phrases], channels:[bet channels], dailyStrikeBudget? }. I do NOT poll myself — the watcher lives in Convex; I just keep the watchlist fresh (re-run when my foundation/bets change). Returns { ok, phrases, channels, dailyStrikeBudget }.",
      parameters: Type.Object({
        phrases: Type.Array(Type.String()),
        channels: Type.Array(Type.String()),
        dailyStrikeBudget: Type.Optional(Type.Number()),
      }),
      execute: async (p, _cfg, ctx) => postLc("build_intent_watch", p, ctx.signal),
    }),
    tool({
      name: "record_strike",
      label: "Record Strike",
      description:
        "After I strike a hot intent thread I was handed (drafted + posted via post_to_channel / send_confirm_card), call this to fold it back into the watch: { struckThreadIds:[ids I struck], seenThreadIds?:[ids I saw but skipped] }. This decrements today's strike budget and prevents ever re-striking the same thread. Returns { ok, strikesToday, budget }.",
      parameters: Type.Object({
        struckThreadIds: Type.Array(Type.String()),
        seenThreadIds: Type.Optional(Type.Array(Type.String())),
      }),
      execute: async (p, _cfg, ctx) => postLc("record_strike", p, ctx.signal),
    }),
    tool({
      name: "get_platform_algo",
      label: "Get Platform Algo",
      description:
        "Read the SHARED, monthly-refreshed platform-algorithm intelligence — what's working RIGHT NOW on each channel (cadence, formats, timing, what's losing reach), researched centrally so I never have to. Returns platforms[] = { platform, whatsHotNow, sources, ageDays }. I consult this BEFORE choosing a format/length/posting-window/hook for a channel so my drafts reflect this month's reality, not stale advice. If ageDays is high or empty, fall back to PLATFORM_ALGO.md.",
      parameters: Type.Object({}),
      execute: async (p, _cfg, ctx) =>
        getLc("get_platform_algo", p, ctx.signal),
    }),
    tool({
      name: "get_conversion_setup",
      label: "Get Conversion Setup",
      description:
        "Get this founder's conversion setup so I can close the loop on the SIGNUP side (clicks are already tracked). Returns { signupUrl (I wrap links to THIS so clicks→signups join), conversionKind (what counts as a win), pixelInstalled, pixelSnippet, instructions }. MVP: I just read signupUrl + ASK the founder when someone signs up / comes back and log it via record_conversion — I do NOT hand them code to paste (automatic tracker is roadmap), and never to a mobile-only founder. (pixelSnippet/instructions are for that future path — ignore for now.)",
      parameters: Type.Object({}),
      execute: async (p, _cfg, ctx) =>
        getLc("get_conversion_setup", p, ctx.signal),
    }),

    // =====================================================================
    // SLIDESHOW CLUSTER — media library + grounded slide generation.
    // The moat is grounding: every slide frames the user's REAL screenshot,
    // never a stock image. Check the library before asking; ask once.
    // =====================================================================
    tool({
      name: "save_media",
      label: "Save Media",
      description:
        "Save a screenshot/recording the USER texted me into my media library. REQUIRED: mediaUrl (the downloadable Telegram file URL I resolved via getFile — see maya-content-reviewer for the file_id→URL flow). Optional: label (what the screen IS, e.g. 'paywall screen', 'empty state', 'main dashboard'), kind (screenshot|screen_recording|image). Dedupes by content hash. Returns { ok, assetId, deduped }.",
      parameters: Type.Object({
        mediaUrl: Type.String(),
        label: Type.Optional(Type.String()),
        kind: Type.Optional(Enum(["screenshot", "screen_recording", "image"])),
      }),
      execute: async (p, _cfg, ctx) => postLc("save_media", p, ctx.signal),
    }),
    tool({
      name: "search_my_media",
      label: "Search My Media",
      description:
        "List what's already in my media library BEFORE I ask the user for a visual or build a slideshow. Optional: kind (screenshot|screen_recording|image|slide|video) to filter; limit. Returns assets[] (id, kind, source, label, createdAt). Empty = I have nothing yet.",
      parameters: Type.Object({
        kind: Type.Optional(
          Enum(["screenshot", "screen_recording", "image", "slide", "video"])
        ),
        limit: Type.Optional(Type.Number()),
      }),
      execute: async (p, _cfg, ctx) => getLc("search_my_media", p, ctx.signal),
    }),
    tool({
      name: "request_media",
      label: "Request Media",
      description:
        "Text the user asking for ONE specific missing asset I need for a post — only after search_my_media shows I don't already have it. REQUIRED: label (the exact screen/asset I need, e.g. 'a screenshot of your onboarding screen'). Optional: reason (one line on why, in my voice). Guarded: if I already have a matching asset it returns alreadyHave:true and does NOT text the user. Never double-ask.",
      parameters: Type.Object({
        label: Type.String(),
        reason: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) => postLc("request_media", p, ctx.signal),
    }),
    tool({
      name: "generate_slide_image",
      label: "Generate Slide Image",
      description:
        "Generate ONE TikTok/IG slide grounded in the user's REAL screenshot(s). For any slide that shows the product, pass referenceAssetIds (from search_my_media) — the model places that screenshot UNCHANGED and only frames/captions around it (no fabricated UI). REQUIRED: prompt (the slide's intent — hook, feature, before/after, CTA). Optional: referenceAssetIds, slideText (caption to overlay), platform (tiktok|instagram). A carousel = call this once per slide. Returns { ok, assetId, grounded }. COGS ~$0.07/image (Gemini 3.1 Flash Image / nano-banana 2, via OpenRouter) — log it with log_cost (provider openrouter).",
      parameters: Type.Object({
        prompt: Type.String(),
        referenceAssetIds: Type.Optional(Type.Array(Type.String())),
        slideText: Type.Optional(Type.String()),
        platform: Type.Optional(Enum(["tiktok", "instagram"])),
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("generate_slide_image", p, ctx.signal),
    }),
    tool({
      name: "send_media_to_user",
      label: "Send Media To User",
      description:
        "Deliver finished slides/assets to the user on Telegram (auto-posting to TikTok/IG is not wired yet — I hand the user the images to post). REQUIRED: assetIds (from search_my_media / generate_slide_image, in carousel order). Optional: caption (one message of context, my voice — shown on the first image). Returns { ok, delivered, requested }.",
      parameters: Type.Object({
        assetIds: Type.Array(Type.String()),
        caption: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("send_media_to_user", p, ctx.signal),
    }),
    tool({
      name: "check_already_engaged",
      label: "Check Already Engaged",
      description:
        "BEFORE drafting a reply to a thread/comment, check whether you have already engaged it. Pass platform + externalId (the thread/post id), and commentId if replying to a specific comment. Returns { engaged, threadEngaged, commentEngaged }. The server enforces one-reply-per-thread/comment regardless, but calling this first avoids wasted drafting. NEVER reply twice to the same thing.",
      parameters: Type.Object({
        platform: Enum(PLATFORM_7),
        externalId: Type.String({ description: "The thread/post's stable platform id." }),
        commentId: Type.Optional(Type.String({ description: "The specific comment id, if replying to a comment." })),
      }),
      execute: async (p, _cfg, ctx) => getLc("check_already_engaged", p, ctx.signal),
    }),
    tool({
      name: "post_to_channel",
      label: "Post To Channel",
      description:
        "Auto-post content to a CONNECTED channel via Zernio (X / LinkedIn / Instagram / YouTube). The server runs every gate (ban-safety, plan, voice/slop/safety, dedup) and either publishes or returns { outcome: 'needs_confirm', reasons }. REDDIT and TIKTOK are ALWAYS manual-confirm: this returns needs_confirm for them, never auto-publishes (post those via a one-tap card instead). REQUIRED: channel, content. Put the app link in `url` (it is appended; X meters link-posts so ration them). For a reply, pass targetExternalId (+ targetCommentId). scheduleAtMs schedules it; omit to publish now. Returns { action, reasons, zernioPostId }.",
      parameters: Type.Object({
        channel: Enum(["x", "linkedin", "instagram", "youtube", "reddit", "tiktok"]),
        content: Type.String(),
        url: Type.Optional(Type.String({ description: "Wrapped app link (appended to content). Ration on X." })),
        targetExternalId: Type.Optional(Type.String({ description: "Thread/post id when this is a reply." })),
        targetCommentId: Type.Optional(Type.String({ description: "Specific comment id when replying to a comment." })),
        intentionalFollowUp: Type.Optional(Type.Boolean({ description: "Set true to deliberately reply again to an already-engaged target." })),
        scheduleAtMs: Type.Optional(Type.Number({ description: "Epoch ms to schedule; omit to publish now." })),
        draftId: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) => postLc("zernio_post", p, ctx.signal),
    }),

    // =====================================================================
    // DURABLE LIFECYCLE (#15) — the re-doing-loop fix.
    // The agent's lifecycle (hello sent? foundation done? lease held?) lives
    // in CONVEX, not MEMORY.md (which is wiped on every Fly restart). BOOT and
    // HEARTBEAT gate on these tools, never on MEMORY.md markers. This is what
    // stops the foundation watchdog from re-running onboarding forever.
    // =====================================================================
    tool({
      name: "get_agent_lifecycle",
      label: "Get Agent Lifecycle",
      description:
        "Read my DURABLE lifecycle from Convex (the source of truth — NOT MEMORY.md, which is wiped on restart). Returns lifecycle: { phase (fresh|hello_sent|foundation_in_progress|active), helloSent, foundationStarted, foundationComplete, foundationCompletedAt, lastMorningBriefAt, leaseActive, leaseHeldUntil, hasVoiceProfile, targetThreadCount, draftCount, calendarEventCount }. CALL THIS FIRST on every boot and heartbeat tick. If foundationComplete is true, onboarding is DONE — never re-run it.",
      parameters: Type.Object({}),
      execute: async (_p, _cfg, ctx) =>
        getLc("get_agent_lifecycle", undefined, ctx.signal),
    }),
    tool({
      name: "acquire_foundation_lease",
      label: "Acquire Foundation Lease",
      description:
        "Check-and-set lease I MUST acquire before running the foundation/onboarding pass. Prevents two heartbeat ticks (or two machines) from re-running onboarding at once. Returns { acquired, alreadyComplete, leaseActive, leaseUntil }. If alreadyComplete:true → foundation is DONE, stop, do NOT run it. If acquired:false & leaseActive:true → another tick owns it, tick silent. Only run the pass when acquired:true. Optional ttlMs (default 15min).",
      parameters: Type.Object({
        ttlMs: Type.Optional(Type.Number()),
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("acquire_foundation_lease", p, ctx.signal),
    }),
    tool({
      name: "mark_lifecycle",
      label: "Mark Lifecycle",
      description:
        "Set a DURABLE lifecycle marker in Convex (replaces appending to MEMORY.md). marker = 'hello_sent' AFTER the intro is sent (idempotent — safe to call twice); 'foundation_complete' ONLY after the synthesis + the single day-1 move have actually landed in the DB; 'morning_brief' after each 7am brief; 'release_lease' if I yield the foundation pass mid-way for the next tick to resume.",
      parameters: Type.Object({
        marker: Enum([
          "hello_sent",
          "foundation_complete",
          "morning_brief",
          "release_lease",
        ]),
      }),
      execute: async (p, _cfg, ctx) => postLc("mark_lifecycle", p, ctx.signal),
    }),

    // =====================================================================
    // ZERNIO READ + ENGAGEMENT (S5) — analytics, follower stats, connection
    // health, comment inbox, and comment replies across connected channels.
    // Analytics + inbox need the operator's Zernio add-ons; these return a
    // clean { ok:false, addonRequired } when the add-on is off (not an error).
    // (DMs are deliberately not handled.)
    // =====================================================================
    tool({
      name: "list_connected_accounts",
      label: "List Connected Accounts",
      description:
        "Which channels the founder has connected and in what mode (auto-post for X/LinkedIn/IG/YouTube; one-tap-confirm for Reddit/TikTok). Call this BEFORE promising to post on a channel — never say 'I'll post X for you' on a channel that isn't connected. Returns { ok, accounts:[{platform, mode, isActive}] }.",
      parameters: Type.Object({}),
      execute: async (_p, _cfg, ctx) =>
        getLc("list_connected_accounts", undefined, ctx.signal),
    }),
    tool({
      name: "get_connection_health",
      label: "Get Connection Health",
      description:
        "Per-channel connection health (can the account still post? token expiring/revoked?). Check before a posting run; on a bad state, hand the founder a reconnect link in plain words (never 'token expired'). Returns { ok, health }.",
      parameters: Type.Object({}),
      execute: async (_p, _cfg, ctx) =>
        getLc("get_connection_health", undefined, ctx.signal),
    }),
    tool({
      name: "get_account_analytics",
      label: "Get Account Analytics",
      description:
        "Zernio post/account analytics (impressions, reach, engagement) — the SLOWER ground-truth that confirms which channel + format drove reach. NEVER overrides the faster wrapped-link click signal (get_my_attribution stays primary). Optional: postId, platform, accountId, fromDate, toDate, limit. Returns { ok, analytics } — or { ok:false, addonRequired:'analytics' } if the operator hasn't enabled the Zernio Analytics add-on (say so plainly; attribution still works). Stale/empty numbers get said plainly, never fabricated.",
      parameters: Type.Object({
        postId: Type.Optional(Type.String()),
        platform: Type.Optional(Type.String()),
        accountId: Type.Optional(Type.String()),
        fromDate: Type.Optional(Type.String()),
        toDate: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number()),
      }),
      execute: async (p, _cfg, ctx) =>
        getLc("get_account_analytics", p, ctx.signal),
    }),
    tool({
      name: "get_follower_stats",
      label: "Get Follower Stats",
      description:
        "Follower/subscriber counts + growth over time per connected channel, for the warmth + growth read. Optional: platform, fromDate, toDate, granularity. Returns { ok, stats } — or { ok:false, addonRequired:'analytics' } if the add-on is off. Grounded-or-silent on staleness.",
      parameters: Type.Object({
        platform: Type.Optional(Type.String()),
        fromDate: Type.Optional(Type.String()),
        toDate: Type.Optional(Type.String()),
        granularity: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) =>
        getLc("get_follower_stats", p, ctx.signal),
    }),
    tool({
      name: "list_inbox",
      label: "List Inbox (comments)",
      description:
        "New COMMENTS on the founder's posts across connected channels — the highest-intent inbound (a buyer asking 'how does this work?' under a post). Triage these, then reply in the founder's voice with reply_to_comment. Optional: platform, since (ISO), limit. Returns { ok, comments } — or { ok:false, addonRequired:'inbox' } if the operator hasn't enabled the Zernio Inbox add-on. (DMs are not handled — comments only.)",
      parameters: Type.Object({
        platform: Type.Optional(Type.String()),
        since: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number()),
      }),
      execute: async (p, _cfg, ctx) => getLc("list_inbox", p, ctx.signal),
    }),
    tool({
      name: "reply_to_comment",
      label: "Reply To Comment",
      description:
        "Post a voice-matched reply to a comment on one of the founder's connected-channel posts (from list_inbox). REQUIRED: channel, postId, text. Optional: commentId (the specific comment to reply under). The server runs the SAME fail-closed ban-safety gate as post_to_channel before anything ships. Returns { ok, id } — or { ok:false, blocked, reasons } if the safety gate held it, or { ok:false, addonRequired:'inbox' } if the add-on is off.",
      parameters: Type.Object({
        channel: Enum(["x", "linkedin", "instagram", "youtube", "reddit"]),
        postId: Type.String(),
        text: Type.String(),
        commentId: Type.Optional(Type.String()),
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("reply_to_comment", p, ctx.signal),
    }),
    tool({
      name: "send_confirm_card",
      label: "Send Confirm Card",
      description:
        "Send the founder a ONE-TAP Telegram card to approve a Reddit/TikTok post (the ban-safety channels that always need their tap). REQUIRED: eventId (a needs_confirm gtmCalendarEvents row I already created via propose_calendar/post_to_channel). Optional: mediaAssetIds (storage ids from generate_slide_image — for a TikTok slideshow, so the founder SEES the slides in Telegram before tapping). They tap '✅ Post it' and I publish it for them via Zernio — they never leave Telegram or open the app. Returns { ok, messageId }. This is how the 'needs your tap' items in the morning brief actually get posted.",
      parameters: Type.Object({
        eventId: Type.String(),
        mediaAssetIds: Type.Optional(Type.Array(Type.String())),
      }),
      execute: async (p, _cfg, ctx) =>
        postLc("send_confirm_card", p, ctx.signal),
    }),
  ],
});
