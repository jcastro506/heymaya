#!/usr/bin/env tsx
/**
 * Standalone E2E test: ScrapeCreators bulk pull → creator picture synth.
 *
 * Mirrors the production pipeline:
 *   - convex/integrations/scrapeCreators/runFullScrapePull.ts (the read layer)
 *   - convex/onboarding/maya/synthesizeCreatorPicture.ts     (the synth layer)
 *
 * Bypasses Convex entirely. Useful for measuring the read-layer latency,
 * inspecting the volume + shape of upstream data, and validating that the
 * picture synth produces a citation-grounded JSON for a real creator.
 *
 * Usage (run from repo root):
 *   npx tsx scripts/test-scrape-and-synth.ts <handle>
 *   npx tsx scripts/test-scrape-and-synth.ts kevin.castro9996
 *
 * Defaults to TikTok only (the v0 single-platform path). To extend, add
 * platform readers below.
 *
 * Env (read from .env.local):
 *   - SCRAPE_CREATORS_API_KEY  — required for the read layer
 *   - OPENROUTER_API_KEY       — required for the synth layer
 *   - MAYA_DEMO_MODEL          — defaults to google/gemini-3-flash-preview
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(): void {
  const envPath = resolve(REPO_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const src = readFileSync(envPath, "utf8");
  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotEnv();

const SCRAPE_KEY = process.env.SCRAPE_CREATORS_API_KEY;
const SCRAPE_BASE =
  process.env.SCRAPE_CREATORS_BASE_URL ?? "https://api.scrapecreators.com";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const SYNTH_MODEL =
  process.env.MAYA_DEMO_MODEL ??
  process.env.OPENROUTER_DEFAULT_MODEL ??
  "google/gemini-3-flash-preview";

if (!SCRAPE_KEY) {
  console.error("FATAL: SCRAPE_CREATORS_API_KEY missing in .env.local");
  process.exit(1);
}
if (!OPENROUTER_KEY) {
  console.error("FATAL: OPENROUTER_API_KEY missing in .env.local");
  process.exit(1);
}

const handle = process.argv[2];
if (!handle) {
  console.error("Usage: npx tsx scripts/test-scrape-and-synth.ts <handle>");
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Phase timing                                                                */
/* -------------------------------------------------------------------------- */

interface PhaseTiming {
  name: string;
  ms: number;
  ok: boolean;
  detail?: string;
}
const phases: PhaseTiming[] = [];
async function phase<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    const ms = Date.now() - t0;
    phases.push({ name, ms, ok: true });
    log(`✓ ${name.padEnd(40)} ${ms}ms`);
    return { ok: true, value };
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    phases.push({ name, ms, ok: false, detail: msg });
    log(`✗ ${name.padEnd(40)} ${ms}ms — ${msg.slice(0, 100)}`);
    return { ok: false, error: msg };
  }
}

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

/* -------------------------------------------------------------------------- */
/* ScrapeCreators readers                                                      */
/* -------------------------------------------------------------------------- */

async function scGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(SCRAPE_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "x-api-key": SCRAPE_KEY! },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface ProfileResponse {
  user?: {
    uniqueId?: string;
    nickname?: string;
    signature?: string;
    avatarLarger?: string;
    verified?: boolean;
  };
  stats?: {
    followerCount?: number;
    followingCount?: number;
    heart?: number;
    heartCount?: number;
    videoCount?: number;
  };
}

interface PostsResponse {
  aweme_list?: Array<{
    aweme_id?: string;
    desc?: string;
    create_time?: number;
    statistics?: {
      digg_count?: number;
      comment_count?: number;
      play_count?: number;
      share_count?: number;
    };
    video?: {
      duration?: number;
      play_addr?: { url_list?: string[] };
      cover?: { url_list?: string[] };
    };
  }>;
}

interface CommentsResponse {
  comments?: Array<{
    cid?: string;
    text?: string;
    digg_count?: number;
    user?: { unique_id?: string };
  }>;
}

interface TranscriptResponse {
  transcript?: string;
}

/* -------------------------------------------------------------------------- */
/* Run                                                                          */
/* -------------------------------------------------------------------------- */

const overallStart = Date.now();

async function main(): Promise<void> {
log(`Testing ScrapeCreators + synth for handle: @${handle}`);
log(`Synth model: ${SYNTH_MODEL}`);
log("");

const profileRes = await phase("scrape: profile", async () =>
  scGet<ProfileResponse>("/v1/tiktok/profile", { handle })
);
if (!profileRes.ok) {
  log("Cannot continue without profile.");
  process.exit(1);
}
const profile = profileRes.value;
const followerCount = profile.stats?.followerCount ?? 0;
const videoCount = profile.stats?.videoCount ?? 0;
const heartCount = profile.stats?.heart ?? profile.stats?.heartCount ?? 0;

log(
  `   profile: @${profile.user?.uniqueId} "${profile.user?.nickname ?? ""}" — ${followerCount} followers, ${videoCount} videos, ${heartCount} total hearts`
);
if (profile.user?.signature) {
  log(`   bio: ${profile.user.signature.slice(0, 120)}`);
}

const postsRes = await phase("scrape: last-30 posts", async () =>
  // v3 endpoint per the official scrapecreators-api skill — the v1 path 404s.
  scGet<PostsResponse>("/v3/tiktok/profile/videos", { handle })
);
if (!postsRes.ok) {
  log("Cannot continue without posts.");
  process.exit(1);
}
const posts = postsRes.value.aweme_list ?? [];
log(`   posts pulled: ${posts.length}`);

interface NormalizedPost {
  postId: string;
  caption: string | null;
  postedAt: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  videoUrl: string | null;
  videoDurationSec: number | null;
}

const normalized: NormalizedPost[] = posts.map((p) => ({
  postId: p.aweme_id ?? "",
  caption: p.desc ?? null,
  postedAt: p.create_time ? p.create_time * 1000 : null,
  views: p.statistics?.play_count ?? 0,
  likes: p.statistics?.digg_count ?? 0,
  comments: p.statistics?.comment_count ?? 0,
  shares: p.statistics?.share_count ?? 0,
  videoUrl: p.video?.play_addr?.url_list?.[0] ?? null,
  videoDurationSec: p.video?.duration ?? null,
}));

if (normalized.length > 0) {
  const totalViews = normalized.reduce((s, p) => s + p.views, 0);
  const avgViews = Math.round(totalViews / normalized.length);
  const top = [...normalized].sort((a, b) => b.views - a.views)[0];
  log(`   metrics: total ${totalViews} views, avg ${avgViews}/post`);
  log(
    `   top: ${top.postId} "${(top.caption ?? "").slice(0, 60)}" — ${top.views}v / ${top.likes}❤`
  );
}

const TOP_N_DEEP_DIVE = 3;
const topPosts = [...normalized]
  .sort((a, b) => b.views - a.views)
  .slice(0, Math.min(TOP_N_DEEP_DIVE, normalized.length));

const transcripts: Record<string, string | null> = {};
const commentsByPost: Record<
  string,
  Array<{ text: string; likeCount: number }>
> = {};

if (topPosts.length > 0) {
  log("");
  log(`scrape: deep-dive top ${topPosts.length} (transcript + comments parallel)...`);
  // v1/v2 single-video endpoints per the official scrapecreators-api skill
  // expect a public-share URL, not a bare aweme id. Build it from handle +
  // post id: https://www.tiktok.com/@<handle>/video/<aweme_id>.
  const cleanHandle = handle.replace(/^@/, "");
  const tiktokVideoUrl = (postId: string): string =>
    `https://www.tiktok.com/@${cleanHandle}/video/${postId}`;
  const deepDive = await Promise.allSettled(
    topPosts.flatMap((p) => [
      phase(`scrape: transcript[${p.postId}]`, async () =>
        scGet<TranscriptResponse>("/v1/tiktok/video/transcript", {
          url: tiktokVideoUrl(p.postId),
        })
      ).then((r) => ({
        kind: "transcript" as const,
        postId: p.postId,
        result: r,
      })),
      phase(`scrape: comments[${p.postId}]`, async () =>
        scGet<CommentsResponse>("/v1/tiktok/video/comments", {
          url: tiktokVideoUrl(p.postId),
        })
      ).then((r) => ({
        kind: "comments" as const,
        postId: p.postId,
        result: r,
      })),
    ])
  );
  for (const settled of deepDive) {
    if (settled.status !== "fulfilled") continue;
    const { kind, postId, result } = settled.value;
    if (!result.ok) continue;
    if (kind === "transcript") {
      transcripts[postId] = result.value.transcript ?? null;
    } else {
      const sorted = (result.value.comments ?? [])
        .map((c) => ({ text: c.text ?? "", likeCount: c.digg_count ?? 0 }))
        .sort((a, b) => b.likeCount - a.likeCount)
        .slice(0, 10);
      commentsByPost[postId] = sorted;
    }
  }
  for (const p of topPosts) {
    const tx = transcripts[p.postId];
    const cm = commentsByPost[p.postId] ?? [];
    log(
      `   ${p.postId}: transcript ${tx ? `${tx.length} chars` : "MISSING"}, top comments ${cm.length}`
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Picture synthesis (mirrors SYNTH_SYSTEM_PROMPT)                              */
/* -------------------------------------------------------------------------- */

const SYNTH_SYSTEM_PROMPT = `You are Maya's onboarding analyst.

You are given the raw social signal for ONE creator across all the platforms they're on. Your job is to produce a single JSON object — the "creator picture" — that Maya will use as her grounding for every future message to this creator.

Maya's tagline is "your AI creator manager". A generic picture kills the product. Be SPECIFIC. Cite the data. Avoid platitudes.

Anti-sycophancy rules:
- Do not call the creator "talented", "amazing", "great", or any synonym.
- Describe what they actually do — not what's nice about it.
- If you can't ground a claim in the data, drop the claim. Say less, mean it.

Hard rules:
- Output a SINGLE JSON object. No markdown fences, no preamble, no commentary.
- Every populated field must cite at least one post in sourceCitations[]. Format: { platform, postId, usedFor }.
- For top comments, use them as audience signal (who actually watches).
- If the data is THIN (e.g. <5 posts, near-zero engagement), say so honestly: "niche" can be tentative, "topHooks" can be fewer than 5, "bottomHooks" can be empty. Don't invent specificity that isn't there.

Required output schema (JSON):
{
  "niche": string,
  "audience": {
    "ageRanges": string[],
    "genderSplit": { "male": number, "female": number, "other": number } | null,
    "topGeos": string[],
    "interestTags": string[]
  },
  "voiceFingerprint": string,
  "topHooks": [{ "pattern": string, "examplePostId": string, "platform": string, "avgPerformanceLift": number }],
  "bottomHooks": [{ "pattern": string, "examplePostId": string, "platform": string }],
  "postingCadence": {
    "perPlatform": [{ "platform": string, "postsPerWeek": number, "bestDays": string[], "bestHoursLocal": number[] }]
  },
  "brandDealHistory": [{ "brand": string, "platform": string, "approxDate": string, "format": string }],
  "sourceCitations": [{ "platform": string, "postId": string, "usedFor": string }],
  "careerStage": "just-starting" | "building" | "monetizing" | "scaling",
  "careerStageReasoning": string,
  "dataConfidence": "high" | "medium" | "low",
  "dataConfidenceReasoning": string
}`;

const synthPayload = {
  platforms: [
    {
      platform: "tiktok" as const,
      profile: {
        handle: profile.user?.uniqueId ?? handle,
        displayName: profile.user?.nickname ?? null,
        bio: profile.user?.signature ?? null,
        followerCount,
        followingCount: profile.stats?.followingCount ?? null,
        postCount: videoCount,
        verified: profile.user?.verified ?? false,
        totalHearts: heartCount,
      },
      posts: normalized.map((p) => ({
        postId: p.postId,
        caption: p.caption,
        postedAt: p.postedAt
          ? new Date(p.postedAt).toISOString()
          : null,
        metrics: {
          views: p.views,
          likes: p.likes,
          comments: p.comments,
          shares: p.shares,
        },
        videoDurationSec: p.videoDurationSec,
        transcript: transcripts[p.postId] ?? null,
        topComments: commentsByPost[p.postId] ?? [],
      })),
    },
  ],
};

log("");
log(
  `synth payload: ${JSON.stringify(synthPayload).length} chars (~${Math.round(JSON.stringify(synthPayload).length / 4)} tokens text-only)`
);
log("");

const synthRes = await phase("synth: openrouter call (HIGH thinking)", async () => {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": "https://hey-maya.ai",
      "X-Title": "HeyMaya synth test",
    },
    body: JSON.stringify({
      model: SYNTH_MODEL,
      messages: [
        { role: "system", content: SYNTH_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Synthesize a creator picture from this data:\n\n${JSON.stringify(
            synthPayload,
            null,
            2
          )}`,
        },
      ],
      reasoning: { effort: "high" },
      response_format: { type: "json_object" },
      max_tokens: 8000,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("OpenRouter returned empty content");
  return { content, usage: data.usage ?? {} };
});

if (!synthRes.ok) {
  log("Synth failed.");
  printSummary();
  process.exit(1);
}

let picture: Record<string, unknown>;
try {
  picture = JSON.parse(synthRes.value.content) as Record<string, unknown>;
} catch (err) {
  log(`✗ JSON parse failed: ${(err as Error).message}`);
  log(`Raw response (first 800 chars): ${synthRes.value.content.slice(0, 800)}`);
  printSummary();
  process.exit(1);
}

log("");
log(
  `synth: ${synthRes.value.usage.prompt_tokens ?? "?"} in / ${synthRes.value.usage.completion_tokens ?? "?"} out tokens`
);
log("");

/* -------------------------------------------------------------------------- */
/* Picture quality report                                                      */
/* -------------------------------------------------------------------------- */

log("=== CREATOR PICTURE ===");
log(`niche: ${picture.niche ?? "(missing)"}`);
log(
  `voiceFingerprint: ${typeof picture.voiceFingerprint === "string" ? picture.voiceFingerprint.slice(0, 200) : "(missing)"}`
);
const audience = picture.audience as Record<string, unknown> | undefined;
log(
  `audience.ageRanges: ${JSON.stringify(audience?.ageRanges ?? null)}`
);
log(
  `audience.interestTags: ${JSON.stringify(audience?.interestTags ?? null)}`
);
log(`audience.topGeos: ${JSON.stringify(audience?.topGeos ?? null)}`);
const topHooks = (picture.topHooks ?? []) as Array<Record<string, unknown>>;
log(`topHooks (${topHooks.length}):`);
for (const h of topHooks.slice(0, 5)) {
  log(`   • [${h.platform}/${h.examplePostId}] (lift ${h.avgPerformanceLift}×) ${h.pattern}`);
}
const bottomHooks = (picture.bottomHooks ?? []) as Array<Record<string, unknown>>;
log(`bottomHooks (${bottomHooks.length}):`);
for (const h of bottomHooks.slice(0, 3)) {
  log(`   • [${h.platform}/${h.examplePostId}] ${h.pattern}`);
}
log(`careerStage: ${picture.careerStage} — ${picture.careerStageReasoning}`);
log(
  `dataConfidence: ${picture.dataConfidence} — ${picture.dataConfidenceReasoning}`
);

const cites = (picture.sourceCitations ?? []) as Array<Record<string, unknown>>;
log(`sourceCitations: ${cites.length} entries`);

// Audit: every postId in citations must exist in posts
const seenPostIds = new Set(normalized.map((p) => p.postId));
const ungrounded = cites.filter((c) => !seenPostIds.has(String(c.postId)));
if (ungrounded.length > 0) {
  log(
    `⚠ HALLUCINATED CITATIONS (${ungrounded.length}): ${ungrounded
      .map((c) => `${c.platform}/${c.postId}→${c.usedFor}`)
      .slice(0, 5)
      .join(", ")}`
  );
} else {
  log(`✓ all citations ground to real posts`);
}

// Audit: every populated field has at least one citation
const requiredFieldCites = ["niche", "voiceFingerprint", "audience"];
for (const field of requiredFieldCites) {
  const has = cites.some((c) =>
    String(c.usedFor ?? "").toLowerCase().includes(field.toLowerCase())
  );
  if (!has) log(`⚠ field "${field}" has no citation`);
}

// Save artifacts
const outPath = resolve(REPO_ROOT, `scripts/.test-output-${handle}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      handle,
      ranAt: new Date().toISOString(),
      profile: synthPayload.platforms[0].profile,
      postsCount: normalized.length,
      transcriptsCount: Object.values(transcripts).filter(Boolean).length,
      commentsCount: Object.values(commentsByPost).reduce(
        (s, c) => s + c.length,
        0
      ),
      phases,
      picture,
      synthUsage: synthRes.value.usage,
    },
    null,
    2
  ),
  "utf8"
);
log(`Artifact saved: ${outPath}`);

printSummary();
}

function printSummary(): void {
  const total = Date.now() - overallStart;
  log("");
  log("=== TIMING SUMMARY ===");
  for (const p of phases) {
    log(
      `   ${p.ok ? "✓" : "✗"} ${p.name.padEnd(38)} ${String(p.ms).padStart(6)}ms${p.detail ? ` — ${p.detail.slice(0, 60)}` : ""}`
    );
  }
  log(`   ${"total".padEnd(40)} ${String(total).padStart(6)}ms`);
}

main().catch((err) => {
  log(`✗ FATAL: ${err instanceof Error ? err.message : String(err)}`);
  printSummary();
  process.exit(1);
});
