/**
 * maya-hook-extractor — pattern classification + prompt builder.
 *
 * Sprint 3.5. The Pro+ multimodal video read happens in the calling Convex
 * action (which routes through `convex/agents/modelRouter/maya.ts` with the
 * post_publish_reaction task tag). This file owns:
 *   1. Caption-only classification (the Starter fallback path)
 *   2. The multimodal prompt assembly (Pro+ path — caller passes the result
 *      to callMaya).
 *
 * Pure logic, deterministic, no Convex imports.
 */

export type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";
export type Plan = "starter" | "pro" | "studio";

export interface TopComment {
  readonly author: string;
  readonly text: string;
  readonly likeCount: number;
}

export interface HookExtractorInput {
  readonly postId: string;
  readonly videoUrl: string | null;
  readonly caption: string;
  readonly topComments: ReadonlyArray<TopComment>;
  readonly platform: Platform;
  readonly plan: Plan;
}

export type HookPattern =
  | "pov-bait"
  | "specific-number-lead"
  | "bold-claim"
  | "wait-for-it"
  | "listicle-opener"
  | "question-opener"
  | "story-tease"
  | "pattern-interrupt"
  | "unknown";

export interface ExtractorCitation {
  readonly kind: "post" | "audience";
  readonly id: string;
  readonly fact: string;
}

export interface HookExtractorResult {
  readonly hook: { readonly pattern: HookPattern; readonly firstSeconds: string };
  readonly whyItWorked: string;
  readonly retentionScore: number;
  readonly applicabilityToNiche: string;
  readonly citations: ReadonlyArray<ExtractorCitation>;
  readonly mode: "multimodal" | "caption-only";
}

interface PatternRule {
  readonly pattern: HookPattern;
  readonly test: RegExp;
}

const CAPTION_PATTERNS: ReadonlyArray<PatternRule> = [
  { pattern: "pov-bait", test: /^\s*POV[:,]?/i },
  {
    pattern: "specific-number-lead",
    test: /^\s*\d[\d,]*\s+(?:ways|reasons|things|tips|mistakes|tricks|hacks|steps)/i,
  },
  { pattern: "wait-for-it", test: /\bwait for it\b/i },
  { pattern: "listicle-opener", test: /^\s*\d+\.\s/ },
  { pattern: "question-opener", test: /^[^.!?]*\?/ },
  {
    pattern: "bold-claim",
    test: /^\s*(?:I |you )?(?:made|lost|earned|gained|quit|became)\b/i,
  },
  {
    pattern: "story-tease",
    test: /\b(?:happened|story time|let me tell you|you won't believe)\b/i,
  },
];

function firstSentence(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length === 0) return "";
  const m = trimmed.match(/^[^.!?]+[.!?]?/);
  return (m ? m[0] : trimmed).trim();
}

export function classifyHookFromCaption(
  caption: string,
  topComments: ReadonlyArray<TopComment>,
  platform: Platform
): { pattern: HookPattern; firstSeconds: string } {
  const opener = firstSentence(caption);
  if (opener.length === 0 && topComments.length === 0) {
    return { pattern: "unknown", firstSeconds: "" };
  }
  for (const rule of CAPTION_PATTERNS) {
    if (rule.test.test(opener)) {
      return { pattern: rule.pattern, firstSeconds: opener };
    }
  }
  // Platform-specific fallback bias.
  if (platform === "tiktok" || platform === "instagram") {
    return { pattern: "pattern-interrupt", firstSeconds: opener };
  }
  return { pattern: "unknown", firstSeconds: opener };
}

/**
 * Comment-density retention proxy. Not the real retention curve (we don't have
 * it on caption-only), but a signal: high engagement comments-per-100-words-of-
 * caption suggests the hook landed.
 */
function commentRetentionProxy(
  topComments: ReadonlyArray<TopComment>
): number {
  if (topComments.length === 0) return 0.2;
  const totalLikes = topComments.reduce((s, c) => s + Math.max(0, c.likeCount), 0);
  // Squash: each 1000 likes = +0.1, capped at 1.0.
  const score = Math.min(1, 0.3 + totalLikes / 10000);
  return Math.round(score * 100) / 100;
}

const PLATFORM_NOTES: Record<Platform, string> = {
  tiktok: "TikTok rewards pattern interrupt + first 1.5s of distinctive visual/audio.",
  instagram: "IG Reels reward saves more than likes; carousel hooks reward thumbnail.",
  youtube: "YouTube rewards retention curve; first 30s decides distribution.",
  linkedin: "LinkedIn rewards comments; plain-text personal-story hooks outperform.",
  x: "X rewards thread-opening posts that stand alone.",
};

export function runCaptionOnlyExtraction(
  input: HookExtractorInput
): HookExtractorResult {
  const hook = classifyHookFromCaption(
    input.caption,
    input.topComments,
    input.platform
  );
  const retentionScore = commentRetentionProxy(input.topComments);

  const whyItWorked =
    hook.pattern === "unknown"
      ? "Insufficient signal to extract a hook pattern from the caption alone."
      : `Caption uses '${hook.pattern}' opener. ${PLATFORM_NOTES[input.platform]} Comment engagement (${input.topComments.length} top comments) is a proxy for retention.`;

  const applicabilityToNiche =
    hook.pattern === "unknown"
      ? "No applicability assessment — pattern unclear."
      : `'${hook.pattern}' is a portable opener; consider variant on next post if it tracks.`;

  const citations: ExtractorCitation[] = [
    {
      kind: "post",
      id: input.postId,
      fact: `Post ${input.postId} caption begins: "${hook.firstSeconds}"`,
    },
  ];
  if (input.topComments.length > 0) {
    const top = input.topComments[0];
    citations.push({
      kind: "post",
      id: `${input.postId}:comment:0`,
      fact: `Top comment by ${top.author} (${top.likeCount} likes): "${top.text}"`,
    });
  }

  return {
    hook,
    whyItWorked,
    retentionScore,
    applicabilityToNiche,
    citations,
    mode: "caption-only",
  };
}

export interface ChatMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

/**
 * Builds the prompt the calling Convex action sends to the model router for
 * the Pro+ multimodal path. The action then takes the response and assembles
 * a HookExtractorResult.
 */
export function buildMultimodalPrompt(
  input: HookExtractorInput
): ReadonlyArray<ChatMessage> {
  if (input.plan === "starter") {
    throw new Error(
      "buildMultimodalPrompt: refusing to build multimodal prompt for starter plan; use runCaptionOnlyExtraction instead."
    );
  }
  if (!input.videoUrl) {
    throw new Error(
      "buildMultimodalPrompt: videoUrl is required for multimodal path."
    );
  }
  const system =
    "You are Maya's hook-extraction skill. Watch the first 3 seconds of the video. " +
    "Identify the hook pattern (one of: pov-bait, specific-number-lead, bold-claim, wait-for-it, listicle-opener, question-opener, story-tease, pattern-interrupt). " +
    "Explain why it worked using ONLY observable evidence (visual frames, caption, comment reactions). " +
    "Cite a specific frame timestamp or comment quote for every claim. " +
    "If you cannot ground a claim, do not make it. Output JSON: { pattern, firstSeconds, whyItWorked, retentionScore, applicabilityToNiche }.";
  const user =
    `Platform: ${input.platform}\n` +
    `Post ID: ${input.postId}\n` +
    `Video URL: ${input.videoUrl}\n` +
    `Caption: ${input.caption}\n` +
    `Top comments:\n` +
    input.topComments
      .slice(0, 10)
      .map(
        (c, i) =>
          `  ${i + 1}. @${c.author} (${c.likeCount} likes): ${c.text}`
      )
      .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Top-level dispatch. The Convex action calls this with the resolved plan;
 * the caption-only path returns synchronously, the multimodal path returns
 * a placeholder result + the prompt to call the model router with. The action
 * is responsible for the actual model round-trip.
 */
export type ExtractorDispatch =
  | { readonly mode: "caption-only"; readonly result: HookExtractorResult }
  | { readonly mode: "multimodal"; readonly prompt: ReadonlyArray<ChatMessage>; readonly hint: HookExtractorResult };

export function dispatch(input: HookExtractorInput): ExtractorDispatch {
  if (input.plan === "starter" || !input.videoUrl) {
    return { mode: "caption-only", result: runCaptionOnlyExtraction(input) };
  }
  return {
    mode: "multimodal",
    prompt: buildMultimodalPrompt(input),
    // Hint = caption-only result, used as a fallback if the multimodal call
    // fails (caller catches and surfaces the hint instead of failing silently).
    hint: runCaptionOnlyExtraction(input),
  };
}
