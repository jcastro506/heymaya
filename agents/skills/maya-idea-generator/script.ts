/**
 * maya-idea-generator — pure-logic library for ideation prompts + parsing.
 *
 * Sprint 5. The intelligence (which ideas to generate, how to anchor them
 * to voice + trends) lives in the prompt and the model. This file is the
 * data-marshaling + prompt assembly + structured-output parsing layer +
 * the citation gate that keeps hallucinated post IDs from leaking through.
 *
 * No Convex imports, no I/O. The Convex action wires the prompt to
 * `callMaya` and the parsed output to `maya-citation-firewall`. The
 * action is also responsible for plan-tier trimming of the result set;
 * this skill returns every idea that passes the citation gate.
 *
 * Per the operator's locked rules:
 *   - "Trust LLM judgment, no hardcoded rules" — the only mechanical
 *     gate here is the ≥2-citation count. Fit-scoring, voice-match
 *     scoring, novelty are all in the prompt.
 *   - "No 'AI' in marketing copy" — runtime/agent context only; this
 *     file is plumbing so the rule still applies to any user-facing
 *     strings (none here).
 *   - Anti-sycophancy — the prompt instructs the model to drop
 *     uncertain ideas rather than inflate confidence.
 */

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";

export type PostFormat =
  | "tiktok-post"
  | "ig-reel"
  | "ig-carousel"
  | "ig-post"
  | "yt-short"
  | "yt-long"
  | "linkedin-post"
  | "x-thread"
  | "x-single";

export interface Post {
  readonly id: string;
  readonly platform: Platform;
  readonly caption: string;
  readonly mediaType: string;
  readonly postedAt: number;
  readonly medianEngagementRate?: number;
  readonly medianViews?: number;
}

export interface HookEntry {
  readonly pattern: string;
  readonly firstSeconds: string;
  readonly whyItWorked: string;
  readonly examplePostIds: ReadonlyArray<string>;
  readonly avgPerformanceLift?: number;
}

export interface TrendObservation {
  readonly id: string;
  readonly source: "niche-scan" | "platform-wide" | "industry-intel" | "competitor-watch";
  readonly observation: string;
  readonly relevanceScore: number;
  readonly observedAt: number;
  readonly evidence: ReadonlyArray<{
    readonly kind: "post" | "hashtag" | "sound" | "article" | "metric";
    readonly ref: string;
    readonly fact: string;
  }>;
}

export interface CreatorPicture {
  readonly creatorId: string;
  readonly niche: string;
  readonly voiceFingerprint: string;
  /**
   * Tactics the creator's voice says they DO NOT use. Set by the picture
   * synthesizer (Sprint 2) and editable on the Profile screen.
   * Examples: "no exclamation points", "never opens with rhetorical questions",
   * "no cliffhangers", "no all-caps".
   */
  readonly antiPatterns: ReadonlyArray<string>;
  readonly audience: {
    readonly interestTags: ReadonlyArray<string>;
    readonly topGeos: ReadonlyArray<string>;
  };
  readonly platforms: ReadonlyArray<Platform>;
}

export interface IdeationCitationVoice {
  readonly postIds: ReadonlyArray<string>;
  readonly fact: string;
}

export interface IdeationCitationTrend {
  readonly trendId: string | null;
  readonly fact: string;
}

export interface ParsedIdea {
  readonly idea: string;
  readonly hook: string;
  readonly format: PostFormat;
  readonly citationToVoiceAnchor: IdeationCitationVoice;
  readonly citationToTrend: IdeationCitationTrend;
  readonly antiPatternFlag: ReadonlyArray<string>;
  readonly sortKey: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const MIN_CITATIONS_PER_IDEA = 2;

const VALID_FORMATS: ReadonlySet<PostFormat> = new Set<PostFormat>([
  "tiktok-post",
  "ig-reel",
  "ig-carousel",
  "ig-post",
  "yt-short",
  "yt-long",
  "linkedin-post",
  "x-thread",
  "x-single",
]);

/* -------------------------------------------------------------------------- */
/* Helpers (formatters used by buildIdeationPrompt)                            */
/* -------------------------------------------------------------------------- */

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatRecentPosts(posts: ReadonlyArray<Post>): string {
  if (posts.length === 0) return "(no recent posts — return [] in your output)";
  // Sort by postedAt desc so the most recent are easier to reference.
  const sorted = [...posts].sort((a, b) => b.postedAt - a.postedAt).slice(0, 30);
  return sorted
    .map((p) => {
      const date = new Date(p.postedAt).toISOString().slice(0, 10);
      const eng = p.medianEngagementRate !== undefined ? p.medianEngagementRate.toFixed(3) : "n/a";
      const views = p.medianViews !== undefined ? String(p.medianViews) : "n/a";
      return `  ${p.id} | ${p.platform} | ${p.mediaType} | ${date} | views=${views} | eng=${eng} | "${truncate(p.caption, 100)}"`;
    })
    .join("\n");
}

function formatTopHooks(hooks: ReadonlyArray<HookEntry>): string {
  if (hooks.length === 0) return "(hook library empty — new creator)";
  return hooks
    .slice(0, 8)
    .map((h) => {
      const lift = h.avgPerformanceLift !== undefined ? `${h.avgPerformanceLift}×` : "n/a";
      const ex = h.examplePostIds.slice(0, 3).join(",") || "(no examples)";
      return `  ${h.pattern} — "${truncate(h.firstSeconds, 80)}" — lift=${lift} — examples=${ex}`;
    })
    .join("\n");
}

function formatTrends(trends: ReadonlyArray<TrendObservation>): string {
  if (trends.length === 0) return "(no trend candidates this round — voice-only ideas are fine; set trendId to null)";
  return trends
    .slice(0, 12)
    .map((t) => {
      const ev = t.evidence
        .slice(0, 2)
        .map((e) => `${e.kind}:${e.ref}`)
        .join(",");
      return `  ${t.id} | source=${t.source} | rel=${t.relevanceScore.toFixed(2)} | "${truncate(t.observation, 140)}" | evidence=${ev}`;
    })
    .join("\n");
}

function formatAntiPatterns(antiPatterns: ReadonlyArray<string>): string {
  if (antiPatterns.length === 0) {
    return "(none recorded — creator hasn't surfaced any explicit anti-patterns yet)";
  }
  return antiPatterns.map((p) => `  - ${p}`).join("\n");
}

/* -------------------------------------------------------------------------- */
/* Prompt assembly                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Builds the prompt the calling Convex action sends to the model router.
 * High-thinking, weekly_content_plan task tag.
 */
export function buildIdeationPrompt(
  picture: CreatorPicture,
  recentPosts: ReadonlyArray<Post>,
  topHooks: ReadonlyArray<HookEntry>,
  trendCandidates: ReadonlyArray<TrendObservation>
): string {
  const lines: string[] = [];

  lines.push("You are Maya. The creator is asking for content ideas for the upcoming week.");
  lines.push("Generate ideas that fit THIS creator's voice and recent traction. Not internet best-practice.");
  lines.push("Anti-sycophancy: drop uncertain ideas rather than inflate them. Fewer real ideas beats many invented ones.");
  lines.push("Grounded or silent: every idea must cite real evidence from this creator's own work.");
  lines.push("");

  lines.push("=== Creator picture ===");
  lines.push(`niche: ${picture.niche}`);
  lines.push(`platforms: ${picture.platforms.join(", ")}`);
  lines.push(`audience interest tags: ${picture.audience.interestTags.join(", ") || "(none recorded)"}`);
  lines.push(`audience top geos: ${picture.audience.topGeos.join(", ") || "(none recorded)"}`);
  lines.push("");

  lines.push("=== Voice fingerprint (this is the creator's actual voice — anchor every idea here) ===");
  lines.push(truncate(picture.voiceFingerprint || "(no voice fingerprint yet)", 800));
  lines.push("");

  lines.push("=== Anti-patterns (tactics this creator's voice says they DO NOT use — avoid them) ===");
  lines.push(formatAntiPatterns(picture.antiPatterns));
  lines.push("");

  lines.push("=== Recent posts (last 30 days — your ONLY source of citation post IDs) ===");
  lines.push(formatRecentPosts(recentPosts));
  lines.push("");

  lines.push("=== Top hooks from this creator's hook library (proven openers) ===");
  lines.push(formatTopHooks(topHooks));
  lines.push("");

  lines.push("=== Trend candidates (optional — may inform but not required for every idea) ===");
  lines.push(formatTrends(trendCandidates));
  lines.push("");

  lines.push("=== Your task ===");
  lines.push("Generate 0-7 content ideas. Each idea must:");
  lines.push(`  1. Cite at least ${MIN_CITATIONS_PER_IDEA} specific real recent posts by ID (from the list above — do NOT invent IDs).`);
  lines.push("  2. Anchor to the voice fingerprint with a one-sentence reason.");
  lines.push("  3. Pick a format that fits the creator's connected platforms.");
  lines.push("  4. Optionally tie to one trend candidate (set trendId; null is fine if voice-only).");
  lines.push("  5. Flag any anti-pattern it brushes against (in antiPatternFlag[]). If none, return [].");
  lines.push("");
  lines.push("Drop any idea you can't ground in ≥2 real post IDs. Returning fewer ideas is better than inventing citations.");
  lines.push("");
  lines.push("Output STRICTLY this JSON shape (an array, no wrapping object):");
  lines.push("[");
  lines.push("  {");
  lines.push('    "idea": "one sentence describing the idea, in plain English",');
  lines.push('    "hook": "the proposed opening line",');
  lines.push('    "format": "tiktok-post"|"ig-reel"|"ig-carousel"|"ig-post"|"yt-short"|"yt-long"|"linkedin-post"|"x-thread"|"x-single",');
  lines.push('    "citationToVoiceAnchor": { "postIds": ["...", "..."], "fact": "why these anchor the voice claim" },');
  lines.push('    "citationToTrend": { "trendId": "..."|null, "fact": "why this trend fits, or empty if trendId is null" },');
  lines.push('    "antiPatternFlag": ["..."]');
  lines.push("  }");
  lines.push("]");
  lines.push("");
  lines.push("Rules:");
  lines.push(`- citationToVoiceAnchor.postIds MUST contain ≥${MIN_CITATIONS_PER_IDEA} real IDs from the recent-posts list. Inventing IDs is a hallucination — your idea will be dropped.`);
  lines.push("- The hook draft must avoid every listed anti-pattern. If you used one anyway, name it in antiPatternFlag.");
  lines.push("- No false-precision promises. 'Likely tracks like tt_post_xxx' is good. 'Will hit 100k' is banned.");
  lines.push("- Empty array is OK if you can't ground any idea. Do not pad.");
  lines.push("- Do not include any prose outside the JSON.");

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Output parsing + citation gate                                              */
/* -------------------------------------------------------------------------- */

function isFormat(s: unknown): s is PostFormat {
  return typeof s === "string" && VALID_FORMATS.has(s as PostFormat);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Tolerant JSON parse: strips ```json fences, returns null if the body
 * is not a JSON array.
 */
function parseRawArray(raw: string): unknown[] | null {
  let body = raw.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed : null;
}

/**
 * Verify every cited postId exists in the recentPosts input array.
 * This catches hallucinated IDs the model invented. Returns the list of
 * IDs that are NOT in the input set so the caller can drop the idea.
 */
export function validateCitations(
  idea: ParsedIdea,
  recentPosts: ReadonlyArray<Post>
): { ok: boolean; missingCitations: string[] } {
  const known = new Set(recentPosts.map((p) => p.id));
  const missing = idea.citationToVoiceAnchor.postIds.filter((id) => !known.has(id));
  return {
    ok: missing.length === 0 && idea.citationToVoiceAnchor.postIds.length >= MIN_CITATIONS_PER_IDEA,
    missingCitations: missing,
  };
}

/**
 * Parse the model's JSON output into validated ParsedIdea[]. Drops any
 * idea that:
 *   - is malformed
 *   - cites <2 post IDs
 *   - cites IDs not present in `recentPosts` (hallucinated)
 *
 * Returns [] on parse failure rather than throwing.
 *
 * Determinism: output is sorted by `sortKey` (stable lexicographic) so
 * same inputs → same idea ordering even if the model reshuffles.
 */
export function parseIdeasResponse(
  modelOutput: string,
  recentPosts: ReadonlyArray<Post>
): ParsedIdea[] {
  const arr = parseRawArray(modelOutput);
  if (arr === null) return [];

  const known = new Set(recentPosts.map((p) => p.id));
  const out: ParsedIdea[] = [];

  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i];
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;

    const idea = typeof r.idea === "string" ? r.idea.trim() : "";
    const hook = typeof r.hook === "string" ? r.hook.trim() : "";
    if (idea.length === 0 || hook.length === 0) continue;

    if (!isFormat(r.format)) continue;
    const format: PostFormat = r.format;

    const va = (r.citationToVoiceAnchor ?? {}) as Record<string, unknown>;
    const vaPostIds = asStringArray(va.postIds);
    const vaFact = typeof va.fact === "string" ? va.fact : "";

    // ───────── Citation gate ─────────
    // Drop if <2 cited IDs.
    if (vaPostIds.length < MIN_CITATIONS_PER_IDEA) continue;
    // Drop if any cited ID is not in the recent-posts set (hallucinated).
    const allKnown = vaPostIds.every((id) => known.has(id));
    if (!allKnown) continue;

    const tr = (r.citationToTrend ?? {}) as Record<string, unknown>;
    const trendId =
      typeof tr.trendId === "string" && tr.trendId.length > 0 ? tr.trendId : null;
    const trendFact = typeof tr.fact === "string" ? tr.fact : "";

    const antiPatternFlag = asStringArray(r.antiPatternFlag);

    // sortKey: stable across re-runs. We base it on the first cited post
    // ID + the format + the first 32 chars of the idea — this is enough
    // to disambiguate ideas while remaining identical for identical
    // structured content.
    const sortKey = [
      vaPostIds.slice().sort()[0] ?? "",
      format,
      idea.slice(0, 32).toLowerCase().replace(/\s+/g, " "),
    ].join("|");

    out.push({
      idea,
      hook,
      format,
      citationToVoiceAnchor: { postIds: vaPostIds, fact: vaFact },
      citationToTrend: { trendId, fact: trendFact },
      antiPatternFlag,
      sortKey,
    });
  }

  // Determinism: sort by sortKey.
  out.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Anti-pattern flagger (backstop — model should already catch these)         */
/* -------------------------------------------------------------------------- */

interface AntiPatternMatcher {
  readonly pattern: RegExp;
  /** Phrase fragments (lowercase) in the antiPattern label that this matcher fires on. */
  readonly labels: ReadonlyArray<string>;
}

/**
 * Mechanical regex-level checks for the small set of anti-patterns that
 * are surface-detectable. Trust LLM judgment for everything else; this
 * is just a safety net for obvious cases the model glossed over.
 */
const ANTI_PATTERN_MATCHERS: ReadonlyArray<AntiPatternMatcher> = [
  {
    pattern: /!/,
    labels: ["no exclamation", "no exclamation points", "never uses exclamation"],
  },
  {
    pattern: /\?\s*$/,
    labels: ["no rhetorical question", "rhetorical question opener", "no question opener"],
  },
  {
    pattern: /\b(?:wait for it|you won't believe|stay tuned)\b/i,
    labels: ["no cliffhanger", "no cliffhangers", "never uses cliffhanger"],
  },
  {
    pattern: /[A-Z]{4,}/,
    labels: ["no all-caps", "no caps", "lowercase only"],
  },
];

function antiPatternMatchesLabel(label: string, matcher: AntiPatternMatcher): boolean {
  const lower = label.toLowerCase();
  return matcher.labels.some((l) => lower.includes(l));
}

/**
 * Surface anti-patterns the idea's text brushes against. Used both as a
 * caller-side backstop and inside tests. Returns the list of matched
 * antiPattern labels (NOT idea text). An empty list means clean.
 */
export function flagAntiPatterns(
  idea: ParsedIdea,
  picture: CreatorPicture
): string[] {
  const flagged: string[] = [];
  const text = `${idea.idea} ${idea.hook}`;
  for (const ap of picture.antiPatterns) {
    for (const matcher of ANTI_PATTERN_MATCHERS) {
      if (antiPatternMatchesLabel(ap, matcher) && matcher.pattern.test(text)) {
        flagged.push(ap);
        break;
      }
    }
  }
  // Stable order — dedupe by lowercase + preserve first-seen casing.
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const f of flagged) {
    const k = f.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(f);
  }
  return dedup;
}

/* -------------------------------------------------------------------------- */
/* Convenience: end-to-end parse + flag                                        */
/* -------------------------------------------------------------------------- */

/**
 * Convenience wrapper: parses the model output, then folds in anti-pattern
 * flags from `flagAntiPatterns` on top of whatever the model already
 * surfaced. Returns ideas in deterministic sortKey order.
 *
 * The Convex action calls this and then passes the result to
 * `maya-citation-firewall` for a final grounding pass before persistence.
 */
export function parseAndAnnotate(
  modelOutput: string,
  recentPosts: ReadonlyArray<Post>,
  picture: CreatorPicture
): ParsedIdea[] {
  const ideas = parseIdeasResponse(modelOutput, recentPosts);
  return ideas.map((idea) => {
    const extra = flagAntiPatterns(idea, picture);
    if (extra.length === 0) return idea;
    // Merge model-surfaced + regex-detected, dedupe by lowercase.
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const x of [...idea.antiPatternFlag, ...extra]) {
      const k = x.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(x);
    }
    return { ...idea, antiPatternFlag: merged };
  });
}
