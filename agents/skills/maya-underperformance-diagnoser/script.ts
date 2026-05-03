/**
 * maya-underperformance-diagnoser — LLM plumbing only.
 *
 * Sprint 3.5c. The intelligence lives in SKILL.md prose that Maya reads
 * when she needs to diagnose a post. This file is the data-marshaling
 * + prompt construction + structured-output parsing layer.
 *
 * Pure logic, deterministic, no Convex imports. The Convex action at
 * `convex/agents/skills/underperformanceDiagnoser.ts` (lead pushes that
 * file) wires this to `callMaya` + `maya-citation-firewall` + persistence
 * to the new `postPostmortems` table.
 *
 * What this file does NOT do (by design):
 *   - regex-match hooks against bottomHooks (Maya does that reasoning)
 *   - compute hour-of-week or off-peak detection (Maya reads the data)
 *   - compute topic-fatigue Jaccard or token overlap (Maya judges)
 *   - hardcode P25 / 30%-baseline thresholds (described in prose, Maya checks)
 *
 * Per the operator's mid-sprint course-correction: "I'm not saying we
 * write functions for all of this stuff. We're working with OpenClaws."
 */

export type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";
export type MediaType = "video" | "image" | "carousel" | "text";
export type Severity = "mild" | "significant" | "severe";

export interface PostInput {
  readonly id: string;
  readonly platform: Platform;
  readonly caption: string;
  readonly mediaType: MediaType;
  readonly postedAt: number;
  readonly hookPattern?: string;
}

export interface PostMetricsRow {
  readonly ts: number;
  readonly viewCount?: number;
  readonly likeCount?: number;
  readonly commentCount?: number;
  readonly shareCount?: number;
  readonly saveCount?: number;
}

export interface CreatorTrailingBaseline {
  readonly medianViews: number;
  readonly medianEngagementRate: number;
  readonly p25Views: number;
  readonly p75Views: number;
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
  readonly bottomHooks: ReadonlyArray<BottomHookEntry>;
  readonly postingCadence: {
    readonly perPlatform: ReadonlyArray<PostingCadenceEntry>;
  };
  readonly audience: {
    readonly interestTags: ReadonlyArray<string>;
    readonly topGeos: ReadonlyArray<string>;
  };
}

export interface RecentPostLite {
  readonly id: string;
  readonly platform: string;
  readonly caption: string;
  readonly mediaType: string;
  readonly postedAt: number;
  readonly medianEngagementRate?: number;
}

export interface DiagnoserInput {
  readonly post: PostInput;
  readonly postMetrics: ReadonlyArray<PostMetricsRow>;
  readonly creatorTrailingBaseline: CreatorTrailingBaseline;
  readonly creatorPicture: CreatorPictureSubset;
  readonly recentPosts: ReadonlyArray<RecentPostLite>;
  readonly recentPlatformAlgoNotes?: string;
  readonly creatorTimezone: string;
  readonly creatorId: string;
}

export interface DiagnosisCitation {
  readonly kind: "post" | "metric" | "audience" | "cache";
  readonly id: string;
  readonly fact: string;
}

export interface DiagnosisOutput {
  readonly severity: Severity;
  readonly diagnosis: {
    readonly hookFromBottomList: boolean;
    readonly offPeakPostingTime: boolean;
    readonly formatMismatch: boolean;
    readonly topicFatigue: { readonly detected: boolean; readonly similarPostsLast7d: number };
    readonly audienceMismatch: boolean;
    readonly recentAlgoChangeImpact?: string;
  };
  readonly primaryCause: string;
  readonly secondaryCauses: ReadonlyArray<string>;
  readonly recommendedNextMove: string;
  readonly lessonForNextPost: string;
  readonly citations: ReadonlyArray<DiagnosisCitation>;
}

/**
 * Build a one-line baseline hint Maya can read in the prompt without doing
 * arithmetic herself. We do the formatting, not the judgment.
 */
export function formatBaselineHint(
  baseline: CreatorTrailingBaseline,
  postMetrics: ReadonlyArray<PostMetricsRow>
): string {
  const latest = postMetrics.length > 0 ? postMetrics[postMetrics.length - 1] : undefined;
  const views = latest?.viewCount ?? 0;
  const med = baseline.medianViews;
  const p25 = baseline.p25Views;
  const p75 = baseline.p75Views;
  const ratio = med > 0 ? Math.round((views / med) * 100) / 100 : 0;
  return `post latest views: ${views}; trailing-30 median: ${med} (P25 ${p25} / P75 ${p75}); current run = ${ratio}× median`;
}

/**
 * Format the bottom-hooks list for the prompt. Maya reads this and
 * compares it to the post's hook herself — we do not pre-match.
 */
function formatBottomHooks(hooks: ReadonlyArray<BottomHookEntry>): string {
  if (hooks.length === 0) return "(no bottom-hook history yet — new creator)";
  return hooks
    .slice(0, 8)
    .map((h) => `${h.pattern} (platform: ${h.platform}, example: ${h.examplePostId})`)
    .join("; ");
}

function formatCadence(
  cadence: ReadonlyArray<PostingCadenceEntry>,
  platform: Platform
): string {
  const entry = cadence.find((c) => c.platform === platform);
  if (!entry) return "(no posting-cadence data for this platform yet)";
  return `bestDays=${entry.bestDays.join(",")}; bestHoursLocal=${entry.bestHoursLocal.join(",")}`;
}

function formatRecentPosts(posts: ReadonlyArray<RecentPostLite>, platform: Platform): string {
  const same = posts.filter((p) => p.platform === platform).slice(0, 12);
  if (same.length === 0) return "(no recent same-platform posts)";
  return same
    .map(
      (p) =>
        `${p.id} | ${new Date(p.postedAt).toISOString().slice(0, 10)} | ${p.mediaType} | engagementRate=${p.medianEngagementRate ?? "n/a"} | "${truncate(p.caption, 80)}"`
    )
    .join("\n");
}

function formatLast7d(posts: ReadonlyArray<RecentPostLite>, postedAt: number): string {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const recent = posts.filter((p) => Math.abs(postedAt - p.postedAt) <= sevenDays).slice(0, 10);
  if (recent.length === 0) return "(no other posts in the last 7 days)";
  return recent.map((p) => `${p.id}: "${truncate(p.caption, 100)}"`).join("\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

/**
 * Construct the full prompt fed to `callMaya` with taskTag
 * `post_publish_reaction` (medium thinking). All causal reasoning is
 * Maya's; the prompt frames the data and demands citation-grounded JSON.
 */
export function buildDiagnosisPrompt(input: DiagnoserInput): string {
  const lines: string[] = [];
  lines.push("You are Maya. A creator's post underperformed against their trailing baseline.");
  lines.push("Read the data below and form a SINGLE causal judgment. Do not run a checklist; weigh the candidates and pick.");
  lines.push("");
  lines.push("=== Post under review ===");
  lines.push(`postId: ${input.post.id}`);
  lines.push(`platform: ${input.post.platform}`);
  lines.push(`mediaType: ${input.post.mediaType}`);
  lines.push(`postedAt (UTC ms): ${input.post.postedAt}`);
  lines.push(`creatorTimezone: ${input.creatorTimezone}`);
  lines.push(`hookPattern (extracted): ${input.post.hookPattern ?? "(none — fall back to first line of caption)"}`);
  lines.push(`caption: "${truncate(input.post.caption, 240)}"`);
  lines.push("");
  lines.push("=== Performance vs baseline ===");
  lines.push(formatBaselineHint(input.creatorTrailingBaseline, input.postMetrics));
  lines.push(`medianEngagementRate (trailing-30): ${input.creatorTrailingBaseline.medianEngagementRate}`);
  lines.push("");
  lines.push("=== Creator's bottom-hook history ===");
  lines.push(formatBottomHooks(input.creatorPicture.bottomHooks));
  lines.push("");
  lines.push("=== Creator's posting cadence (this platform) ===");
  lines.push(formatCadence(input.creatorPicture.postingCadence.perPlatform, input.post.platform));
  lines.push("");
  lines.push("=== Audience interest tags ===");
  lines.push(input.creatorPicture.audience.interestTags.join(", ") || "(none recorded)");
  lines.push("");
  lines.push("=== Recent posts on this platform (last 30d window) ===");
  lines.push(formatRecentPosts(input.recentPosts, input.post.platform));
  lines.push("");
  lines.push("=== Posts in the last 7 days (any platform) ===");
  lines.push(formatLast7d(input.recentPosts, input.post.postedAt));
  if (input.recentPlatformAlgoNotes) {
    lines.push("");
    lines.push("=== Recent platform-algo signals (whatsCoolingOff) ===");
    lines.push(input.recentPlatformAlgoNotes);
  }
  lines.push("");
  lines.push("=== Your task ===");
  lines.push("Diagnose this post. Severity buckets: 'mild' (one-σ noise), 'significant' (clearly under P25 OR engagement <50% of trailing median), 'severe' (well under P25 AND engagement <30%).");
  lines.push("Candidate causes (weigh, don't enumerate): hook from bottomList; off-peak posting time; format mismatch; topic fatigue (similar posts in last 7d); audience mismatch; recent algo cooling.");
  lines.push("If the data does not support a single cause, return primaryCause: 'unknown' and say so.");
  lines.push("");
  lines.push("Output STRICTLY this JSON shape:");
  lines.push("{");
  lines.push('  "severity": "mild" | "significant" | "severe",');
  lines.push('  "diagnosis": {');
  lines.push('    "hookFromBottomList": boolean,');
  lines.push('    "offPeakPostingTime": boolean,');
  lines.push('    "formatMismatch": boolean,');
  lines.push('    "topicFatigue": { "detected": boolean, "similarPostsLast7d": number },');
  lines.push('    "audienceMismatch": boolean,');
  lines.push('    "recentAlgoChangeImpact": string | undefined');
  lines.push("  },");
  lines.push('  "primaryCause": string,');
  lines.push('  "secondaryCauses": string[],');
  lines.push('  "recommendedNextMove": string,');
  lines.push('  "lessonForNextPost": string,');
  lines.push('  "citations": Array<{ "kind": "post"|"metric"|"audience"|"cache", "id": string, "fact": string }>');
  lines.push("}");
  lines.push("");
  lines.push("Rules:");
  lines.push("- Every claim in `recommendedNextMove`, `lessonForNextPost`, and `secondaryCauses` MUST cite a postId or metric or cache row.");
  lines.push("- 0-2 secondary causes. Do not pile on.");
  lines.push("- 'mild' severity = one cited sentence and stop. Do not write a paragraph for noise.");
  lines.push("- No false precision. 'Hook is in your bottom-five list' is good. 'You'd have hit 40k with POV' is invented and banned.");
  lines.push("- Never blame the audience. The audience is data, not the cause.");
  return lines.join("\n");
}

/**
 * Parse the model's JSON output. Tolerant: strips ```json fences, returns
 * a low-confidence stub on parse failure, never throws.
 */
export function parseDiagnosisOutput(raw: string): DiagnosisOutput {
  const stub: DiagnosisOutput = {
    severity: "mild",
    diagnosis: {
      hookFromBottomList: false,
      offPeakPostingTime: false,
      formatMismatch: false,
      topicFatigue: { detected: false, similarPostsLast7d: 0 },
      audienceMismatch: false,
    },
    primaryCause: "unknown",
    secondaryCauses: [],
    recommendedNextMove: "Insufficient signal to recommend a specific next move; keep posting on cadence.",
    lessonForNextPost: "No clear lesson available — model output could not be parsed.",
    citations: [],
  };

  let body = raw.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return stub;
  }
  if (typeof parsed !== "object" || parsed === null) return stub;

  const obj = parsed as Record<string, unknown>;
  const severity = isSeverity(obj.severity) ? obj.severity : "mild";

  const dRaw = (obj.diagnosis ?? {}) as Record<string, unknown>;
  const tfRaw = (dRaw.topicFatigue ?? {}) as Record<string, unknown>;
  const diagnosis = {
    hookFromBottomList: typeof dRaw.hookFromBottomList === "boolean" ? dRaw.hookFromBottomList : false,
    offPeakPostingTime: typeof dRaw.offPeakPostingTime === "boolean" ? dRaw.offPeakPostingTime : false,
    formatMismatch: typeof dRaw.formatMismatch === "boolean" ? dRaw.formatMismatch : false,
    topicFatigue: {
      detected: typeof tfRaw.detected === "boolean" ? tfRaw.detected : false,
      similarPostsLast7d:
        typeof tfRaw.similarPostsLast7d === "number" && Number.isFinite(tfRaw.similarPostsLast7d)
          ? tfRaw.similarPostsLast7d
          : 0,
    },
    audienceMismatch: typeof dRaw.audienceMismatch === "boolean" ? dRaw.audienceMismatch : false,
    ...(typeof dRaw.recentAlgoChangeImpact === "string" && dRaw.recentAlgoChangeImpact.length > 0
      ? { recentAlgoChangeImpact: dRaw.recentAlgoChangeImpact }
      : {}),
  };

  const secondaryCauses = Array.isArray(obj.secondaryCauses)
    ? obj.secondaryCauses.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

  const citations: DiagnosisCitation[] = Array.isArray(obj.citations)
    ? obj.citations
        .map((c) => {
          if (typeof c !== "object" || c === null) return null;
          const cc = c as Record<string, unknown>;
          if (
            (cc.kind === "post" || cc.kind === "metric" || cc.kind === "audience" || cc.kind === "cache") &&
            typeof cc.id === "string" &&
            typeof cc.fact === "string"
          ) {
            return { kind: cc.kind, id: cc.id, fact: cc.fact };
          }
          return null;
        })
        .filter((c): c is DiagnosisCitation => c !== null)
    : [];

  return {
    severity,
    diagnosis,
    primaryCause: typeof obj.primaryCause === "string" && obj.primaryCause.length > 0 ? obj.primaryCause : "unknown",
    secondaryCauses,
    recommendedNextMove:
      typeof obj.recommendedNextMove === "string" && obj.recommendedNextMove.length > 0
        ? obj.recommendedNextMove
        : stub.recommendedNextMove,
    lessonForNextPost:
      typeof obj.lessonForNextPost === "string" && obj.lessonForNextPost.length > 0
        ? obj.lessonForNextPost
        : stub.lessonForNextPost,
    citations,
  };
}

function isSeverity(s: unknown): s is Severity {
  return s === "mild" || s === "significant" || s === "severe";
}

/**
 * Joins the parts of the diagnosis that need to pass the citation
 * firewall into a single draft string. The Convex action passes this +
 * the citation list to `runFirewall`. Pure formatter; no judgment.
 */
export function diagnosisDraftForFirewall(out: DiagnosisOutput): string {
  const parts = [out.recommendedNextMove, out.lessonForNextPost, ...out.secondaryCauses];
  return parts.filter((p) => p && p.length > 0).join("\n\n");
}
