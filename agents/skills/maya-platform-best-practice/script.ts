/**
 * maya-platform-best-practice — per-platform consultant.
 *
 * Sprint 3.5. Pure logic over a static knowledge body + an optional cache
 * (cache rows are passed in by the calling Convex action; this file does not
 * read Convex directly).
 *
 * The static body matches the prose in SKILL.md § "Static knowledge body"
 * paragraph-for-paragraph. If you edit one, edit both.
 */

export type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";

export type ContentType =
  | "short-form-video"
  | "long-form-video"
  | "carousel"
  | "photo"
  | "text"
  | "thread"
  | "story";

export interface PlatformBestPracticeInput {
  readonly platform: string; // accepts unknowns; we validate
  readonly contentType: string;
  readonly question: string;
}

export interface CacheRow {
  readonly platform: Platform;
  readonly contentType: ContentType;
  readonly fetchedAt: number; // unix ms
  readonly summary: string;
}

export interface CitedExample {
  readonly source: "static-body" | "platform-algo-cache";
  readonly reference: string;
}

export interface PlatformBestPracticeResult {
  readonly answer: string;
  readonly citedExamples: ReadonlyArray<CitedExample>;
  readonly confidenceLevel: "low" | "medium" | "high";
}

const SUPPORTED_PLATFORMS: ReadonlyArray<Platform> = [
  "tiktok",
  "instagram",
  "youtube",
  "linkedin",
  "x",
];

function isPlatform(p: string): p is Platform {
  return (SUPPORTED_PLATFORMS as readonly string[]).includes(p);
}

const STATIC_BODY: Record<Platform, string> = {
  tiktok:
    "TikTok: the first 1.5 seconds is the entire post. Hook patterns that work: pattern interrupt (visual or audio), bold claim, specific number, 'wait for it,' POV. Watch-time and completion drive distribution; saves and shares drive the second push. The comment section is its own content layer — engage early. Sound matters; native trending sounds get a distribution lift if they fit organically. Captions are short — 1–2 lines, hook reinforcement, no link salad. Posting cadence matters more than posting time within reason; consistency over precision. Common pitfalls: cross-posting watermarked content (downranked), opening with a logo card (kills first-second hook), captions longer than 2 lines (no one reads).",
  instagram:
    "Instagram: Reels for reach, carousels for saves, photos for vibe. The Reels algorithm rewards saves and sends MORE than likes — track save rate as the primary metric. Carousels with 10 slides have outsized save behavior because they're educational. The first frame of a Reel must work as a static thumbnail (it's the cover). Captions are longer than TikTok — 3–6 sentences with a hook line, a story, a CTA. Stories drive existing-audience retention; they don't acquire. Hashtags are nearly dead — 3–5 relevant ones, not 30. Common pitfalls: posting at the 'optimal time' but ignoring cover-frame craft; using all 30 hashtags (signals spam).",
  youtube:
    "YouTube: retention curve is the entire game. The first 30 seconds determines whether the video ships to more viewers; the 50%-mark determines whether they finish. Thumbnail and title together drive CTR; the video drives retention; both compound. Long-form (8–20 min) and Shorts are DIFFERENT products — different hook style, different rhythm, different audience signal. Chapters help retention. End-screens that pitch the next video matter more than subscribe-asks. Track click-through rate, average view duration, and 30-second retention as the three metrics that matter. Common pitfalls: mixing Shorts and long-form on the same channel without a clear identity; obsessing over subs vs watch-time.",
  linkedin:
    "LinkedIn: voice register is professional-but-personal — first-person stories with a business takeaway. The algorithm rewards comments more than any other engagement; reply to every comment within the first hour. Plain text outperforms images for reach (counterintuitive but persistent). Posts under 1,300 characters fit without 'see more'; consider whether the cut helps or hurts. PDF carousels (documents) get strong dwell time. Hashtags work, 3–5 niche. Don't post on weekends. Common pitfalls: corporate-press-release tone (kills reach); posting at 8am ET (oversaturated window); auto-cross-posting from Twitter (downranked).",
  x:
    "X: threads beat single posts for non-newsy content; single posts beat threads for hot-take or news. The first post of a thread has to function as a standalone. Replies in your own thread within the first 5 minutes signal 'this is alive' to the algorithm. Quote-tweet engagement compounds. Avoid links in the original post — put them in a reply (the platform downranks outbound links). Image and video posts outperform text-only by ~40% on engagement. Don't autopost from other platforms — the cross-post signature gets downranked. Common pitfalls: thread-leading post that requires the next tweet for context (won't get the algo lift); links in the OP.",
};

const CACHE_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function answerQuestion(
  input: PlatformBestPracticeInput,
  cacheRows?: ReadonlyArray<CacheRow>,
  now: number = Date.now()
): PlatformBestPracticeResult {
  if (!isPlatform(input.platform)) {
    return {
      answer: `'${input.platform}' is not in HeyMaya v0's supported platform set (TikTok / Instagram / YouTube / LinkedIn / X). I don't have grounded best-practice data for it. If this matters, ask in chat — we may add it post-beta.`,
      citedExamples: [],
      confidenceLevel: "low",
    };
  }

  const platform = input.platform;
  const cacheHit = cacheRows?.find(
    (r) =>
      r.platform === platform &&
      r.contentType === input.contentType &&
      now - r.fetchedAt < CACHE_FRESHNESS_MS
  );

  if (cacheHit) {
    return {
      answer: cacheHit.summary,
      citedExamples: [
        {
          source: "platform-algo-cache",
          reference: `platformAlgoCache: ${platform}/${input.contentType} fetched ${new Date(cacheHit.fetchedAt).toISOString()}`,
        },
      ],
      confidenceLevel: "high",
    };
  }

  const staleCacheRow = cacheRows?.find(
    (r) =>
      r.platform === platform &&
      r.contentType === input.contentType &&
      now - r.fetchedAt >= CACHE_FRESHNESS_MS
  );

  const staleNote = staleCacheRow
    ? " (Note: the platform-algo-cache row for this combo is stale — older than 7 days. Treat as background context, not fresh signal.)"
    : "";

  return {
    answer: STATIC_BODY[platform] + staleNote,
    citedExamples: [
      {
        source: "static-body",
        reference: `SKILL.md § Static knowledge body → ${platform}`,
      },
    ],
    confidenceLevel: staleCacheRow ? "medium" : "medium",
  };
}
