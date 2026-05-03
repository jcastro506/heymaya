/**
 * maya-pre-post-scorer — LLM plumbing only.
 *
 * Sprint 3.5c. The intelligence lives in SKILL.md prose Maya reads when
 * she needs to score a draft. This file is the data-marshaling + prompt
 * construction + structured-output parsing layer.
 *
 * Pure logic, deterministic, no Convex imports. The Convex action at
 * `convex/prePostReview.ts` wires this to `callMaya` +
 * `maya-citation-firewall` and returns the score to the caller (chat
 * layer or future `/draft` page).
 *
 * What this file does NOT do (by design):
 *   - regex-match the hookCandidate against topHooks/bottomHooks
 *   - compute median engagement of recent same-format posts
 *   - compute hour-of-week diffs vs bestHoursLocal
 *   - score voice-similarity numerically
 *   - check audience interestTags membership in code
 *
 * Per the operator's mid-sprint course-correction: "I'm not saying we
 * write functions for all of this stuff. We're working with OpenClaws."
 */

export type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";
export type MediaType = "video" | "image" | "carousel" | "text";

export type PerformanceTier =
  | "top-quartile"
  | "above-baseline"
  | "baseline"
  | "below-baseline";

export type GoNoGo = "go" | "tweak-then-go" | "reconsider";

export type PostingTimeFit = "optimal" | "acceptable" | "off-peak";

export type AudienceFit = "strong" | "neutral" | "weak";

export interface DraftInput {
  readonly caption: string;
  readonly hookCandidate?: string;
  readonly plannedFormat: MediaType;
  readonly plannedPlatform: Platform;
  readonly plannedPostingTimeLocal: string;
  readonly mediaPreview?: {
    readonly videoUrl?: string;
    readonly imageUrl?: string;
    readonly durationSec?: number;
  };
}

export interface TopHookEntry {
  readonly pattern: string;
  readonly examplePostId: string;
  readonly platform: string;
  readonly avgPerformanceLift: number;
}

export interface BottomHookEntry {
  readonly pattern: string;
  readonly examplePostId: string;
  readonly platform: string;
}

export interface PostingCadenceEntry {
  readonly platform: string;
  readonly bestDays: ReadonlyArray<string>;
  readonly bestHoursLocal: ReadonlyArray<number>;
}

export interface CreatorPictureSubset {
  readonly topHooks: ReadonlyArray<TopHookEntry>;
  readonly bottomHooks: ReadonlyArray<BottomHookEntry>;
  readonly postingCadence: { readonly perPlatform: ReadonlyArray<PostingCadenceEntry> };
  readonly audience: { readonly interestTags: ReadonlyArray<string>; readonly topGeos: ReadonlyArray<string> };
  readonly voiceFingerprint: string;
}

export interface RecentPostLite {
  readonly id: string;
  readonly platform: string;
  readonly caption: string;
  readonly mediaType: string;
  readonly postedAt: number;
  readonly medianEngagementRate?: number;
  readonly medianViews?: number;
}

export interface HookLibraryEntry {
  readonly pattern: string;
  readonly firstSeconds: string;
  readonly whyItWorked: string;
  readonly examplePostIds: ReadonlyArray<string>;
}

export interface ScorerInput {
  readonly draft: DraftInput;
  readonly creatorPicture: CreatorPictureSubset;
  readonly recentPosts: ReadonlyArray<RecentPostLite>;
  readonly hookLibrary: ReadonlyArray<HookLibraryEntry>;
  readonly platformBestPracticeNote?: string;
  readonly creatorTimezone: string;
  readonly creatorId: string;
}

export interface ScorerCitation {
  readonly kind: "post" | "metric" | "audience" | "soul";
  readonly id: string;
  readonly fact: string;
}

export interface Recommendation {
  readonly priority: 1 | 2 | 3;
  readonly change: string;
  readonly expectedImpact: string;
}

export interface ScoreOutput {
  readonly predictedPerformance: { readonly tier: PerformanceTier; readonly confidence: number };
  readonly signals: {
    readonly hookMatchTopHooks: {
      readonly matched: boolean;
      readonly examplePostId?: string;
      readonly historicalLift?: number;
    };
    readonly hookMatchBottomHooks: boolean;
    readonly formatHistoricalPerformance: {
      readonly sampleSize: number;
      readonly medianViews?: number;
      readonly p75Views?: number;
    };
    readonly postingTimeFit: PostingTimeFit;
    readonly voiceConsistency: { readonly matchScore: number; readonly detectedDrift?: string };
    readonly audienceFit: AudienceFit;
  };
  readonly recommendations: ReadonlyArray<Recommendation>;
  readonly goNoGo: GoNoGo;
  readonly citations: ReadonlyArray<ScorerCitation>;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatTopHooks(hooks: ReadonlyArray<TopHookEntry>, platform: Platform): string {
  const sameP = hooks.filter((h) => h.platform === platform);
  const cross = hooks.filter((h) => h.platform !== platform);
  const ordered = [...sameP, ...cross].slice(0, 8);
  if (ordered.length === 0) return "(no topHooks recorded yet — new creator)";
  return ordered
    .map(
      (h) =>
        `${h.pattern} | platform=${h.platform} | example=${h.examplePostId} | avgLift=${h.avgPerformanceLift}×`
    )
    .join("\n");
}

function formatBottomHooks(hooks: ReadonlyArray<BottomHookEntry>, platform: Platform): string {
  const sameP = hooks.filter((h) => h.platform === platform);
  const cross = hooks.filter((h) => h.platform !== platform);
  const ordered = [...sameP, ...cross].slice(0, 6);
  if (ordered.length === 0) return "(no bottomHooks recorded yet)";
  return ordered.map((h) => `${h.pattern} | example=${h.examplePostId}`).join("\n");
}

function formatCadence(
  cadence: ReadonlyArray<PostingCadenceEntry>,
  platform: Platform
): string {
  const entry = cadence.find((c) => c.platform === platform);
  if (!entry) return "(no posting-cadence data for this platform yet)";
  return `bestDays=${entry.bestDays.join(",")} | bestHoursLocal=${entry.bestHoursLocal.join(",")}`;
}

function formatRecentPostsForFormat(
  posts: ReadonlyArray<RecentPostLite>,
  platform: Platform,
  format: MediaType
): string {
  const same = posts.filter((p) => p.platform === platform);
  if (same.length === 0) return "(no recent posts on this platform)";
  const sameFormat = same.filter((p) => p.mediaType === format);
  const otherFormat = same.filter((p) => p.mediaType !== format);
  const lines: string[] = [];
  lines.push(`-- same format (${format}) on ${platform}: ${sameFormat.length} posts`);
  for (const p of sameFormat.slice(0, 8)) {
    lines.push(
      `   ${p.id} | ${new Date(p.postedAt).toISOString().slice(0, 10)} | views=${p.medianViews ?? "n/a"} | eng=${p.medianEngagementRate ?? "n/a"}`
    );
  }
  lines.push(`-- other formats on ${platform}: ${otherFormat.length} posts`);
  for (const p of otherFormat.slice(0, 6)) {
    lines.push(
      `   ${p.id} | ${p.mediaType} | ${new Date(p.postedAt).toISOString().slice(0, 10)} | views=${p.medianViews ?? "n/a"} | eng=${p.medianEngagementRate ?? "n/a"}`
    );
  }
  return lines.join("\n");
}

function formatHookLibrary(library: ReadonlyArray<HookLibraryEntry>): string {
  if (library.length === 0) return "(hook library is empty)";
  return library
    .slice(0, 6)
    .map(
      (h) =>
        `${h.pattern} — "${truncate(h.firstSeconds, 80)}" — examples: ${h.examplePostIds.slice(0, 3).join(",")}`
    )
    .join("\n");
}

/**
 * Build the prompt fed to `callMaya` with taskTag `post_publish_reaction`
 * (medium thinking). All scoring judgment is Maya's; the prompt frames
 * the data and demands citation-grounded JSON.
 */
export function buildScoringPrompt(input: ScorerInput): string {
  const lines: string[] = [];
  lines.push("You are Maya. The creator is about to publish a draft and wants your read BEFORE they post.");
  lines.push("Score the draft against THIS creator's own history. Do not predict from internet best-practices.");
  lines.push("Be honest about uncertainty. Anti-sycophancy: never inflate predictions.");
  lines.push("");
  lines.push("=== Draft ===");
  lines.push(`platform: ${input.draft.plannedPlatform}`);
  lines.push(`format: ${input.draft.plannedFormat}`);
  lines.push(`plannedPostingTimeLocal: ${input.draft.plannedPostingTimeLocal} (creatorTimezone: ${input.creatorTimezone})`);
  lines.push(`hookCandidate: ${input.draft.hookCandidate ?? "(none — use first sentence of caption as opener)"}`);
  lines.push(`caption: "${truncate(input.draft.caption, 320)}"`);
  if (input.draft.mediaPreview) {
    const mp = input.draft.mediaPreview;
    lines.push(`mediaPreview: videoUrl=${mp.videoUrl ?? "-"} | imageUrl=${mp.imageUrl ?? "-"} | durationSec=${mp.durationSec ?? "-"}`);
  }
  lines.push("");
  lines.push("=== Creator's topHooks (with avgLift vs baseline) ===");
  lines.push(formatTopHooks(input.creatorPicture.topHooks, input.draft.plannedPlatform));
  lines.push("");
  lines.push("=== Creator's bottomHooks (historical losers) ===");
  lines.push(formatBottomHooks(input.creatorPicture.bottomHooks, input.draft.plannedPlatform));
  lines.push("");
  lines.push("=== Posting cadence (this platform) ===");
  lines.push(formatCadence(input.creatorPicture.postingCadence.perPlatform, input.draft.plannedPlatform));
  lines.push("");
  lines.push("=== Audience interest tags ===");
  lines.push(input.creatorPicture.audience.interestTags.join(", ") || "(none recorded)");
  lines.push("");
  lines.push("=== Voice fingerprint excerpt ===");
  lines.push(truncate(input.creatorPicture.voiceFingerprint || "(no voice fingerprint yet)", 600));
  lines.push("");
  lines.push("=== Recent posts grouped by format ===");
  lines.push(
    formatRecentPostsForFormat(input.recentPosts, input.draft.plannedPlatform, input.draft.plannedFormat)
  );
  lines.push("");
  lines.push("=== Hook library (proven openers for this creator) ===");
  lines.push(formatHookLibrary(input.hookLibrary));
  if (input.platformBestPracticeNote) {
    lines.push("");
    lines.push("=== Platform best-practice note (from maya-platform-best-practice) ===");
    lines.push(input.platformBestPracticeNote);
  }
  lines.push("");
  lines.push("=== Your task ===");
  lines.push("Score the draft. Five signals: hook match (top/bottom), format historical, posting-time fit, voice consistency, audience fit.");
  lines.push("Then pick a goNoGo verdict: 'go' | 'tweak-then-go' | 'reconsider'. Then 0-3 prioritized recommendations.");
  lines.push("");
  lines.push("Output STRICTLY this JSON shape:");
  lines.push("{");
  lines.push('  "predictedPerformance": { "tier": "top-quartile"|"above-baseline"|"baseline"|"below-baseline", "confidence": number /* 0-1 */ },');
  lines.push('  "signals": {');
  lines.push('    "hookMatchTopHooks": { "matched": boolean, "examplePostId": string?, "historicalLift": number? },');
  lines.push('    "hookMatchBottomHooks": boolean,');
  lines.push('    "formatHistoricalPerformance": { "sampleSize": number, "medianViews": number?, "p75Views": number? },');
  lines.push('    "postingTimeFit": "optimal"|"acceptable"|"off-peak",');
  lines.push('    "voiceConsistency": { "matchScore": number /* 0-1 */, "detectedDrift": string? },');
  lines.push('    "audienceFit": "strong"|"neutral"|"weak"');
  lines.push("  },");
  lines.push('  "recommendations": [{ "priority": 1|2|3, "change": string, "expectedImpact": string }],');
  lines.push('  "goNoGo": "go"|"tweak-then-go"|"reconsider",');
  lines.push('  "citations": [{ "kind": "post"|"metric"|"audience"|"soul", "id": string, "fact": string }]');
  lines.push("}");
  lines.push("");
  lines.push("Rules:");
  lines.push("- Every recommendation MUST cite at least one prior post / metric / soul anchor.");
  lines.push("- 0-3 recommendations. Do NOT pad. Empty array is OK if the draft is clean.");
  lines.push("- expectedImpact: NEVER promise a specific view number. 'Likely 1.5-2× baseline based on tt_post_xxx' is good. 'Will hit 100k' is banned.");
  lines.push("- audienceFit bias: when in doubt, 'neutral'. Calling something 'weak' is the most demoralizing false-positive — only use when the topic is clearly outside the creator's documented interest tags.");
  lines.push("- voiceConsistency is a forgiving signal — never make voice drift the verdict-driver.");
  lines.push("- Confidence: be honest. If you have <3 same-format posts in recentPosts, your confidence ceiling is ~0.4.");
  lines.push("- If creatorPicture is empty / new-creator, return tier='baseline' confidence 0.2 and a single recommendation noting the data gap.");
  return lines.join("\n");
}

const DEFAULT_STUB: ScoreOutput = {
  predictedPerformance: { tier: "baseline", confidence: 0 },
  signals: {
    hookMatchTopHooks: { matched: false },
    hookMatchBottomHooks: false,
    formatHistoricalPerformance: { sampleSize: 0 },
    postingTimeFit: "off-peak",
    voiceConsistency: { matchScore: 0 },
    audienceFit: "neutral",
  },
  recommendations: [],
  goNoGo: "tweak-then-go",
  citations: [],
};

function isTier(s: unknown): s is PerformanceTier {
  return s === "top-quartile" || s === "above-baseline" || s === "baseline" || s === "below-baseline";
}

function isGoNoGo(s: unknown): s is GoNoGo {
  return s === "go" || s === "tweak-then-go" || s === "reconsider";
}

function isPostingTimeFit(s: unknown): s is PostingTimeFit {
  return s === "optimal" || s === "acceptable" || s === "off-peak";
}

function isAudienceFit(s: unknown): s is AudienceFit {
  return s === "strong" || s === "neutral" || s === "weak";
}

function isPriority(n: unknown): n is 1 | 2 | 3 {
  return n === 1 || n === 2 || n === 3;
}

function clamp01(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Parse the model's JSON output. Tolerant: strips ```json fences, returns
 * a low-confidence stub on parse failure, never throws.
 */
export function parseScoreOutput(raw: string): ScoreOutput {
  let body = raw.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return DEFAULT_STUB;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_STUB;

  const obj = parsed as Record<string, unknown>;
  const ppRaw = (obj.predictedPerformance ?? {}) as Record<string, unknown>;
  const tier = isTier(ppRaw.tier) ? ppRaw.tier : "baseline";
  const confidence = clamp01(ppRaw.confidence);

  const sRaw = (obj.signals ?? {}) as Record<string, unknown>;

  const hmTopRaw = (sRaw.hookMatchTopHooks ?? {}) as Record<string, unknown>;
  const hookMatchTopHooks: ScoreOutput["signals"]["hookMatchTopHooks"] = {
    matched: typeof hmTopRaw.matched === "boolean" ? hmTopRaw.matched : false,
    ...(typeof hmTopRaw.examplePostId === "string" && hmTopRaw.examplePostId.length > 0
      ? { examplePostId: hmTopRaw.examplePostId }
      : {}),
    ...(typeof hmTopRaw.historicalLift === "number" && Number.isFinite(hmTopRaw.historicalLift)
      ? { historicalLift: hmTopRaw.historicalLift }
      : {}),
  };

  const fhpRaw = (sRaw.formatHistoricalPerformance ?? {}) as Record<string, unknown>;
  const formatHistoricalPerformance: ScoreOutput["signals"]["formatHistoricalPerformance"] = {
    sampleSize:
      typeof fhpRaw.sampleSize === "number" && Number.isFinite(fhpRaw.sampleSize) && fhpRaw.sampleSize >= 0
        ? Math.floor(fhpRaw.sampleSize)
        : 0,
    ...(typeof fhpRaw.medianViews === "number" && Number.isFinite(fhpRaw.medianViews)
      ? { medianViews: fhpRaw.medianViews }
      : {}),
    ...(typeof fhpRaw.p75Views === "number" && Number.isFinite(fhpRaw.p75Views)
      ? { p75Views: fhpRaw.p75Views }
      : {}),
  };

  const vcRaw = (sRaw.voiceConsistency ?? {}) as Record<string, unknown>;
  const voiceConsistency: ScoreOutput["signals"]["voiceConsistency"] = {
    matchScore: clamp01(vcRaw.matchScore),
    ...(typeof vcRaw.detectedDrift === "string" && vcRaw.detectedDrift.length > 0
      ? { detectedDrift: vcRaw.detectedDrift }
      : {}),
  };

  const recommendations: Recommendation[] = Array.isArray(obj.recommendations)
    ? obj.recommendations
        .map((r) => {
          if (typeof r !== "object" || r === null) return null;
          const rr = r as Record<string, unknown>;
          if (
            isPriority(rr.priority) &&
            typeof rr.change === "string" &&
            rr.change.length > 0 &&
            typeof rr.expectedImpact === "string"
          ) {
            return {
              priority: rr.priority,
              change: rr.change,
              expectedImpact: rr.expectedImpact,
            };
          }
          return null;
        })
        .filter((r): r is Recommendation => r !== null)
        .slice(0, 3)
    : [];

  const citations: ScorerCitation[] = Array.isArray(obj.citations)
    ? obj.citations
        .map((c) => {
          if (typeof c !== "object" || c === null) return null;
          const cc = c as Record<string, unknown>;
          if (
            (cc.kind === "post" || cc.kind === "metric" || cc.kind === "audience" || cc.kind === "soul") &&
            typeof cc.id === "string" &&
            typeof cc.fact === "string"
          ) {
            return { kind: cc.kind, id: cc.id, fact: cc.fact };
          }
          return null;
        })
        .filter((c): c is ScorerCitation => c !== null)
    : [];

  return {
    predictedPerformance: { tier, confidence },
    signals: {
      hookMatchTopHooks,
      hookMatchBottomHooks:
        typeof sRaw.hookMatchBottomHooks === "boolean" ? sRaw.hookMatchBottomHooks : false,
      formatHistoricalPerformance,
      postingTimeFit: isPostingTimeFit(sRaw.postingTimeFit) ? sRaw.postingTimeFit : "off-peak",
      voiceConsistency,
      audienceFit: isAudienceFit(sRaw.audienceFit) ? sRaw.audienceFit : "neutral",
    },
    recommendations,
    goNoGo: isGoNoGo(obj.goNoGo) ? obj.goNoGo : "tweak-then-go",
    citations,
  };
}

/**
 * Joins the firewall-relevant fields (recommendation changes + impacts)
 * into a single draft string. The Convex action passes this + the
 * citation list to `runFirewall`. Pure formatter; no judgment.
 */
export function scoreDraftForFirewall(out: ScoreOutput): string {
  const parts: string[] = [];
  for (const r of out.recommendations) {
    parts.push(`${r.change} — ${r.expectedImpact}`);
  }
  return parts.join("\n\n");
}
