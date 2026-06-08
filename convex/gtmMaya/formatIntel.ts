/**
 * Format intelligence — "what's working in the niche."
 *
 * The comment miner (mineCommentTrees.ts) grounds channels in buyer PAIN — it
 * ranks by painMatch. That tells us WHO buys and WHAT they complain about, but
 * not HOW to post. For the visual channels (TikTok / Instagram / YouTube),
 * format is most of the game: the hook, the structure, the length, the on-trend
 * shape. A founder needs "post THIS kind of video," not just "buyers are here."
 *
 * This module ranks the niche's video posts by ENGAGEMENT (views/likes — what
 * actually performed, which is a different axis than pain) and LLM-extracts the
 * 2-4 content FORMATS that are working, with a real exemplar + hook to emulate.
 * For TikTok it also pulls the transcript of the top performers so the format
 * read is grounded in what the video actually says, not just the caption.
 *
 * Output is persisted per channel (gtmChannelScores.workingFormatsJson) and
 * surfaced into the synthesis plan + the daily cron so "how to post" is
 * grounded in winning formats, not invented.
 *
 * Per [[feedback-trust-llm-judgment-no-hardcoded-rules]] — the LLM names the
 * formats from the real top performers; we only rank by engagement and feed it
 * the evidence.
 */

import { callOpenRouter } from "../agents/modelRouter/openRouterClient";
import { ScrapeCreatorsClient } from "../integrations/scrapeCreators/client";
import { tiktokVideoTranscript } from "./scrapeCreatorsGtmResearch";
import { synthesizeViaWorker } from "../integrations/videoSynthWorker/client";

export const FORMAT_INTEL_MODEL = "google/gemini-3.1-flash-lite";
export const VIDEO_FORMAT_SOURCES = ["tiktok", "youtube", "instagram"] as const;
export type VideoFormatSource = (typeof VIDEO_FORMAT_SOURCES)[number];
/** How many top-engagement posts per channel feed the format read. */
export const DEFAULT_TOP_PERFORMERS = 6;
/** TikTok-only: pull transcripts for the top performers (richer than caption). */
export const TRANSCRIPT_TOP_N = 3;
/** How many top performers per channel to actually WATCH (Gemini vision via the
 * video-synth-worker). Bounded for cost/latency — the visual format read is the
 * highest-signal, the rest ride on the watched read. */
export const WATCH_TOP_N = 3;
/** A channel needs at least this many video cards to bother extracting. */
export const MIN_CARDS_FOR_EXTRACTION = 2;

export interface WorkingFormat {
  /** Short name for the format, e.g. "Plant-death confession → app rescue POV". */
  formatName: string;
  /** What the post structurally does (hook → body → payoff). */
  description: string;
  /** Why it works here, grounded in engagement + comments. */
  whyItWorks: string;
  /** The single highest-performing example URL. */
  exemplarUrl: string;
  /** The opening line / hook of the exemplar, to emulate. */
  exemplarHook: string;
  /** Human-readable engagement of the exemplar, e.g. "281k views · 18k likes". */
  engagementSignal: string;
}

export interface FormatExtractionInput {
  id: string;
  source: string;
  url: string;
  title?: string;
  snippet: string;
  engagement: {
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    views?: number | null;
  };
  /** From the comment miner, if this card was mined. */
  commentInsights?: { summary?: string } | null;
}

interface FormatProduct {
  productName: string;
  productUrl: string;
}

/** Views dominate the "what's working" signal; likes are a strong secondary. */
function engagementScore(e: FormatExtractionInput["engagement"]): number {
  return (e.views ?? 0) + (e.likes ?? 0) * 5;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function engagementLabel(e: FormatExtractionInput["engagement"]): string {
  const parts: string[] = [];
  if (e.views) parts.push(`${compact(e.views)} views`);
  if (e.likes) parts.push(`${compact(e.likes)} likes`);
  if (e.comments) parts.push(`${compact(e.comments)} comments`);
  return parts.join(" · ") || "no engagement data";
}

function extractTikTokAwemeId(url: string): string | null {
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1]! : null;
}

const FORMAT_PROMPT = `\
You are a short-form content strategist. You are looking at the TOP-PERFORMING \
posts (ranked by engagement) in a product's niche on ONE platform. Your job is \
to name the content FORMATS that are working here, so a founder can emulate \
them — NOT to summarize the topics.

A "format" is a repeatable structural pattern, e.g. "before/after transformation \
reveal", "POV: you just discovered X", "talking-head myth-bust", "satisfying \
process / oddly-satisfying loop", "day-in-the-life", "duet/stitch reaction". \
Focus on the HOOK and the STRUCTURE, grounded in what these specific posts do.

Return JSON: { "formats": [ up to 4 objects ] }. Each format object:
  - formatName: short, specific (≤60 chars)
  - description: the structure — hook → body → payoff (≤220 chars)
  - whyItWorks: grounded in the engagement + comments you see (≤180 chars)
  - exemplarUrl: the URL of the single best example from the list
  - exemplarHook: the opening line/hook to emulate (≤140 chars; infer from \
    caption/transcript if not explicit)
  - engagementSignal: copy the engagement label of the exemplar

Extract 2-4 DISTINCT formats. Do not invent formats not represented in the \
posts. If the posts are too sparse/low-signal to identify a real format, \
return { "formats": [] }. Return ONLY the JSON object, no prose, no fence.`;

const WATCH_PROMPT = `\
You are a short-form content strategist WATCHING the top-performing videos (by \
engagement) in a product's niche on ONE platform. You can see the actual video \
— the visual hook, the editing, the on-screen text, the pacing, the payoff. \
Your job is to name the repeatable content FORMATS that are working so a founder \
can emulate them — grounded in what you SAW, not just what was said.

A "format" is a repeatable structural pattern, e.g. "before/after transformation \
reveal", "POV: you just discovered X", "talking-head myth-bust", "oddly- \
satisfying process loop", "day-in-the-life", "text-overlay tutorial". Describe \
the VISUAL structure: how the first 0-3 seconds look, what's on screen, the cut \
rhythm, where the payoff lands.

Return JSON: { "formats": [ up to 4 objects ] }. Each format object:
  - formatName: short, specific (≤60 chars)
  - description: the VISUAL structure — what's on screen, hook → body → payoff (≤220 chars)
  - whyItWorks: grounded in what you saw + the engagement (≤180 chars)
  - exemplarUrl: the URL of the single best example (from the provided list)
  - exemplarHook: the opening visual/line to emulate (≤140 chars — describe what's on screen in the first seconds)
  - engagementSignal: copy the engagement label of the exemplar

Extract 2-4 DISTINCT formats actually represented in the videos you watched. If \
the videos failed to load or are too sparse, return { "formats": [] }. Return \
ONLY the JSON object, no prose, no fence.`;

function parseFormats(raw: string): WorkingFormat[] {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1]!.trim();
  const start = s.indexOf("{");
  if (start > 0) s = s.slice(start);
  const end = s.lastIndexOf("}");
  if (end >= 0 && end < s.length - 1) s = s.slice(0, end + 1);
  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch {
    return [];
  }
  if (!obj || typeof obj !== "object") return [];
  const arr = (obj as Record<string, unknown>).formats;
  if (!Array.isArray(arr)) return [];
  const out: WorkingFormat[] = [];
  for (const f of arr.slice(0, 4)) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    if (typeof r.formatName !== "string" || !r.formatName.trim()) continue;
    const str = (v: unknown, max: number): string =>
      typeof v === "string" ? v.slice(0, max) : "";
    out.push({
      formatName: str(r.formatName, 60),
      description: str(r.description, 240),
      whyItWorks: str(r.whyItWorks, 200),
      exemplarUrl: str(r.exemplarUrl, 400),
      exemplarHook: str(r.exemplarHook, 160),
      engagementSignal: str(r.engagementSignal, 80),
    });
  }
  return out;
}

export interface FormatChannelOpts {
  scrapeClient?: ScrapeCreatorsClient;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  topN?: number;
  /** WATCH the top performers with Gemini vision (download → Files API) via the
   * video-synth-worker, instead of reading transcripts/captions. Default true;
   * falls back to the text path if the worker is unavailable or fails. */
  watch?: boolean;
  /** Required for the worker call (cost attribution). */
  accountId?: string;
}

/**
 * Result of a per-channel extraction. `groundedIn` records HOW the formats were
 * derived — "watched" (Gemini saw the videos) vs "read" (transcript/caption).
 */
export interface ChannelFormatResult {
  formats: WorkingFormat[];
  costUsd: number;
  groundedIn: "watched" | "read" | "none";
  skipReason?: string;
}

/**
 * WATCH the top performers via the video-synth-worker (yt-dlp download → Gemini
 * Files API → multimodal generateContent). This is the real "what does the
 * winning video look like" read — the visual hook, editing, on-screen text,
 * pacing — not just what was said. Returns null on any worker failure so the
 * caller falls back to the text path.
 */
async function watchTopPerformers(
  channel: VideoFormatSource,
  top: ReadonlyArray<FormatExtractionInput>,
  product: FormatProduct,
  accountId: string
): Promise<{ formats: WorkingFormat[] } | null> {
  const watchTargets = top.slice(0, WATCH_TOP_N);
  const userPayload = {
    task: "extract-working-formats",
    platform: channel,
    product: `${product.productName} (${product.productUrl})`,
    posts: watchTargets.map((c, i) => ({
      n: i + 1,
      url: c.url,
      engagement: engagementLabel(c.engagement),
      caption: (c.title ? `${c.title} — ` : "") + c.snippet,
    })),
  };
  try {
    const result = await synthesizeViaWorker({
      creatorId: accountId,
      systemPrompt: WATCH_PROMPT,
      userPayloadJson: JSON.stringify(userPayload),
      posts: watchTargets.map((c) => ({
        postId: c.id,
        platform: channel,
        videoUrl: c.url,
        kind: "video" as const,
      })),
      thinkingBudget: "medium",
    });
    // Honest proof we actually watched: the worker only uploads to Gemini after
    // a successful download. Zero uploads → we didn't see anything → fall back.
    if (result.diagnostics.videosUploaded === 0) return null;
    const formats = parseFormats(result.content);
    return formats.length > 0 ? { formats } : null;
  } catch {
    return null;
  }
}

/** TEXT-signal fallback: transcript (TikTok) + caption + comments → text LLM. */
async function extractFromTextSignals(
  channel: VideoFormatSource,
  top: ReadonlyArray<FormatExtractionInput>,
  product: FormatProduct,
  opts: FormatChannelOpts
): Promise<{ formats: WorkingFormat[]; costUsd: number; skipReason?: string }> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { formats: [], costUsd: 0, skipReason: "no OPENROUTER_API_KEY" };

  // TikTok: pull transcripts for the top few so the format read is grounded in
  // what the video says, not just the caption. Best-effort.
  const transcripts = new Map<string, string>();
  if (channel === "tiktok" && opts.scrapeClient) {
    await Promise.all(
      top.slice(0, TRANSCRIPT_TOP_N).map(async (c) => {
        const awemeId = extractTikTokAwemeId(c.url);
        if (!awemeId) return;
        try {
          const wr = await tiktokVideoTranscript(opts.scrapeClient!, awemeId);
          const text = wr.items[0]?.excerpt;
          if (text && text.trim()) transcripts.set(c.url, text.slice(0, 800));
        } catch {
          /* transcript is a bonus; caption + comments still carry the format */
        }
      })
    );
  }

  const postsBlock = top
    .map((c, i) => {
      const lines = [
        `${i + 1}. [${engagementLabel(c.engagement)}] ${c.url}`,
        `   caption: ${(c.title ? `${c.title} — ` : "") + c.snippet}`.slice(0, 320),
      ];
      const t = transcripts.get(c.url);
      if (t) lines.push(`   transcript: ${t}`);
      if (c.commentInsights?.summary)
        lines.push(`   comments: ${c.commentInsights.summary.slice(0, 200)}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const userMsg = `Product: ${product.productName} (${product.productUrl})
Platform: ${channel}

Top-performing posts in this niche (ranked by engagement):
${postsBlock}`;

  let completion;
  try {
    completion = await callOpenRouter({
      model: FORMAT_INTEL_MODEL,
      messages: [
        { role: "system", content: FORMAT_PROMPT },
        { role: "user", content: userMsg },
      ],
      thinkingBudget: "none",
      maxOutputTokens: 1400,
      apiKey,
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    return { formats: [], costUsd: 0, skipReason: `LLM failed: ${(err as Error).message}` };
  }
  return {
    formats: parseFormats(completion.content),
    costUsd: completion.usage.costUsd ?? 0,
  };
}

/**
 * Extract working formats for ONE channel from its top-engagement video cards.
 * WATCH-FIRST: actually watches the top performers via Gemini vision (the
 * video-synth-worker), and only falls back to reading transcripts/captions if
 * the worker is unavailable or returns nothing. Soft-fails to an empty list on
 * any error (never blocks the research job).
 */
export async function extractWorkingFormatsForChannel(
  channel: VideoFormatSource,
  cards: ReadonlyArray<FormatExtractionInput>,
  product: FormatProduct,
  opts: FormatChannelOpts
): Promise<ChannelFormatResult> {
  const top = cards
    .filter((c) => c.source === channel)
    .sort((a, b) => engagementScore(b.engagement) - engagementScore(a.engagement))
    .slice(0, opts.topN ?? DEFAULT_TOP_PERFORMERS);
  if (top.length < MIN_CARDS_FOR_EXTRACTION) {
    return { formats: [], costUsd: 0, groundedIn: "none", skipReason: `only ${top.length} cards` };
  }

  // WATCH-FIRST — the real visual read.
  if (opts.watch !== false && opts.accountId) {
    const watched = await watchTopPerformers(channel, top, product, opts.accountId);
    if (watched) {
      return { formats: watched.formats, costUsd: 0, groundedIn: "watched" };
    }
  }

  // Fallback — read transcripts + captions + comments.
  const read = await extractFromTextSignals(channel, top, product, opts);
  return {
    formats: read.formats,
    costUsd: read.costUsd,
    groundedIn: read.formats.length > 0 ? "read" : "none",
    skipReason: read.skipReason,
  };
}

/**
 * Extract working formats across every video channel present in the card set.
 * Returns a per-channel map (only channels that yielded ≥1 format) + total cost.
 * Bounded concurrency; channels are independent so one failing never blocks
 * the others.
 */
export async function extractWorkingFormats(
  cards: ReadonlyArray<FormatExtractionInput>,
  product: FormatProduct,
  opts: FormatChannelOpts
): Promise<{
  byChannel: Partial<Record<VideoFormatSource, WorkingFormat[]>>;
  costUsd: number;
  /** Per channel: how the formats were grounded — "watched" vs "read". */
  groundedIn: Partial<Record<VideoFormatSource, "watched" | "read" | "none">>;
}> {
  const byChannel: Partial<Record<VideoFormatSource, WorkingFormat[]>> = {};
  const groundedIn: Partial<
    Record<VideoFormatSource, "watched" | "read" | "none">
  > = {};
  let costUsd = 0;
  // Channels are independent; run them in parallel (≤3 channels, cheap).
  const results = await Promise.all(
    VIDEO_FORMAT_SOURCES.map(async (channel) => {
      const res: ChannelFormatResult = await extractWorkingFormatsForChannel(
        channel,
        cards,
        product,
        opts
      ).catch((err) => ({
        formats: [] as WorkingFormat[],
        costUsd: 0,
        groundedIn: "none" as const,
        skipReason: `unexpected: ${(err as Error).message}`,
      }));
      return { channel, res };
    })
  );
  for (const { channel, res } of results) {
    costUsd += res.costUsd;
    if (res.formats.length > 0) {
      byChannel[channel] = res.formats;
      groundedIn[channel] = res.groundedIn;
    }
  }
  return { byChannel, costUsd, groundedIn };
}
