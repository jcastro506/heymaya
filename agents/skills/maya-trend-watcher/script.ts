/**
 * maya-trend-watcher — pure-logic helpers.
 *
 * Sprint 5. Heartbeat check #5 (cooldown 6h, per HEARTBEAT.md).
 *
 * The Convex action that wires this skill to ScrapeCreators + callMaya +
 * `trendObservations` lives in `convex/agents/skills/trendWatcher.ts`
 * (lead pushes). This module is the pure logic the action composes:
 *
 *   - `buildScoringPrompt`: prompt that asks Maya to score fit-to-creator
 *     1-10 for each candidate, with explicit instructions to LOWER scores
 *     for candidates that conflict with `voiceFingerprint` or `boundaries`.
 *   - `parseScoringResponse`: strict JSON parser. Uncited entries dropped.
 *   - `citationFirewall`: structural check — `citation.ref` must look like
 *     a real ScrapeCreators-shaped URL/id. Hallucinated refs rejected.
 *   - `dedupeAgainstBaseline`: drop observations seen in the trailing 7-day
 *     baseline so Maya doesn't ping the same trend twice.
 *
 * No Convex imports. No network. Pure TypeScript.
 *
 * Voice rules (locked, see SKILL.md):
 *   - Anti-sycophancy.
 *   - No "AI" in prose this skill emits.
 *   - Trust the model's judgment on fit; no hardcoded TS thresholds.
 */

export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x";

export type CandidateKind = "hashtag" | "sound" | "video" | "creator";

/** A real, grounded citation. The Convex action populates `ref` from the
 *  ScrapeCreators response (URL or id). The skill never fabricates these. */
export interface Citation {
  /** ScrapeCreators URL or platform id (e.g. tiktok video URL, hashtag id). */
  readonly ref: string;
  /** The literal evidence string this citation grounds. */
  readonly fact: string;
}

export interface CreatorBoundaries {
  /** Creator-stated topics Maya must NOT push (e.g. "politics", "alcohol"). */
  readonly banned_topics?: ReadonlyArray<string>;
  /** Creator-stated formats Maya must NOT push (e.g. "thirst-traps", "dance-trends"). */
  readonly banned_formats?: ReadonlyArray<string>;
}

export interface CreatorPictureSubset {
  readonly niche: string;
  readonly voiceFingerprint: string;
  readonly audience: {
    readonly interestTags: ReadonlyArray<string>;
    readonly topGeos: ReadonlyArray<string>;
  };
  readonly boundaries?: CreatorBoundaries;
}

export interface TrendCandidate {
  readonly kind: CandidateKind;
  /** The hashtag, sound title, video title, or creator handle. */
  readonly pattern: string;
  /** Mandatory citation. Action populates from ScrapeCreators response. */
  readonly citation: Citation;
  /** Handles of creators already on the trend (optional — sometimes empty). */
  readonly sampleCreatorsRiding?: ReadonlyArray<string>;
  /** Verbatim momentum hint from the upstream (e.g. "3.2× 24h growth"). */
  readonly momentum?: string;
  /** Platform the candidate was sourced from. */
  readonly platform: Platform;
}

/** A single scored, cited observation. Multiple of these go into `trendObservations`. */
export interface TrendObservation {
  readonly platform: Platform;
  readonly kind: CandidateKind;
  readonly trendPattern: string;
  readonly citation: Citation;
  /** 1-10. The model is told to LOWER scores for boundary/voice conflicts. */
  readonly fitToCreatorScore: number;
  readonly sampleCreatorsRiding: ReadonlyArray<string>;
  readonly rationale: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Citation firewall — structural gate.
// ─────────────────────────────────────────────────────────────────────────

const ALLOWED_CITATION_HOSTS = [
  "scrapecreators.com",
  "tiktok.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "threads.net",
  "pinterest.com",
] as const;

/**
 * Recognizable bare-id prefixes from ScrapeCreators payloads. The trending
 * feed sometimes returns a bare clipId / hashtagId (no full URL). We accept
 * those when prefixed appropriately so the action can pass through compact
 * refs without inventing URLs.
 */
const ALLOWED_BARE_ID_PREFIXES = [
  "tt:hashtag:",
  "tt:sound:",
  "tt:video:",
  "tt:creator:",
  "ig:reel:",
  "ig:hashtag:",
  "ig:creator:",
  "yt:short:",
  "yt:hashtag:",
  "yt:channel:",
  "li:post:",
  "x:post:",
  "th:post:",
] as const;

function looksLikeScrapeCreatorsUrl(ref: string): boolean {
  let host: string;
  try {
    const u = new URL(ref);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    host = u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }
  for (const allowed of ALLOWED_CITATION_HOSTS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function looksLikeBareId(ref: string): boolean {
  for (const prefix of ALLOWED_BARE_ID_PREFIXES) {
    if (ref.startsWith(prefix) && ref.length > prefix.length) return true;
  }
  return false;
}

/**
 * Structural citation firewall. Returns `{ ok: true }` when the observation
 * carries a citation `ref` that looks like a real ScrapeCreators URL or id.
 * Returns `{ ok: false, reason }` otherwise.
 *
 * This is the structural gate. The Convex action layers `maya-citation-firewall`
 * on the rationale prose for full grounding.
 */
export function citationFirewall(
  observation: TrendObservation
): { ok: true } | { ok: false; reason: string } {
  const c = observation.citation;
  if (!c || typeof c !== "object") {
    return { ok: false, reason: "missing citation object" };
  }
  if (typeof c.ref !== "string" || c.ref.trim().length === 0) {
    return { ok: false, reason: "citation.ref is empty" };
  }
  if (typeof c.fact !== "string" || c.fact.trim().length === 0) {
    return { ok: false, reason: "citation.fact is empty" };
  }
  if (!looksLikeScrapeCreatorsUrl(c.ref) && !looksLikeBareId(c.ref)) {
    return {
      ok: false,
      reason: "citation.ref does not match ScrapeCreators URL/id shape",
    };
  }
  if (typeof observation.trendPattern !== "string" || observation.trendPattern.trim().length === 0) {
    return { ok: false, reason: "trendPattern is empty" };
  }
  if (typeof observation.rationale !== "string" || observation.rationale.trim().length === 0) {
    return { ok: false, reason: "rationale is empty" };
  }
  if (
    typeof observation.fitToCreatorScore !== "number" ||
    !Number.isFinite(observation.fitToCreatorScore) ||
    observation.fitToCreatorScore < 0 ||
    observation.fitToCreatorScore > 10
  ) {
    return { ok: false, reason: "fitToCreatorScore out of range" };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Dedupe — trailing 7d baseline.
// ─────────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    // Split camelCase boundaries first so "rehabFriendlyLifts" and
    // "Rehab Friendly Lifts!" both collapse to the same slug.
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalizeRef(ref: string): string {
  try {
    const u = new URL(ref);
    u.hash = "";
    u.search = "";
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
  } catch {
    return ref.trim().toLowerCase();
  }
}

/**
 * Build the dedupe key for an observation. Same `${platform}:${kind}:${slug(pattern)}`
 * paired with the canonicalized citation ref. Two cites of the same hashtag
 * on the same platform via different example URLs collapse to one key
 * because the slug-of-pattern dominates; the citation-ref tail catches
 * pattern-level collisions where the upstream returned the same canonical
 * pattern from different ScrapeCreators endpoints.
 */
export function dedupeKey(o: {
  readonly platform: Platform;
  readonly kind: CandidateKind;
  readonly trendPattern: string;
  readonly citation: { readonly ref: string };
}): string {
  return `${o.platform}:${o.kind}:${slugify(o.trendPattern)}`;
}

/**
 * Drop observations whose dedupe key already appears in `baseline`. Returns
 * a fresh array; never mutates inputs.
 */
export function dedupeAgainstBaseline(
  observations: ReadonlyArray<TrendObservation>,
  baseline: ReadonlyArray<TrendObservation>
): TrendObservation[] {
  const seen = new Set<string>();
  for (const b of baseline) {
    seen.add(dedupeKey(b));
  }
  const out: TrendObservation[] = [];
  const newlyAdded = new Set<string>();
  for (const o of observations) {
    const k = dedupeKey(o);
    if (seen.has(k)) continue;
    if (newlyAdded.has(k)) continue; // also dedupe within the new batch
    newlyAdded.add(k);
    out.push(o);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt construction.
// ─────────────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatBoundariesBlock(b: CreatorBoundaries | undefined): string {
  if (!b) return "(none stated)";
  const lines: string[] = [];
  if (b.banned_topics && b.banned_topics.length > 0) {
    lines.push(`banned_topics: ${b.banned_topics.join(", ")}`);
  }
  if (b.banned_formats && b.banned_formats.length > 0) {
    lines.push(`banned_formats: ${b.banned_formats.join(", ")}`);
  }
  if (lines.length === 0) return "(none stated)";
  return lines.join("\n");
}

function formatCandidate(c: TrendCandidate, idx: number): string {
  const sample =
    c.sampleCreatorsRiding && c.sampleCreatorsRiding.length > 0
      ? c.sampleCreatorsRiding.slice(0, 5).join(", ")
      : "(none recorded)";
  const lines: string[] = [
    `[${idx}] platform=${c.platform} kind=${c.kind} pattern="${truncate(c.pattern, 120)}"`,
    `     citation.ref: ${c.citation.ref}`,
    `     citation.fact: ${truncate(c.citation.fact, 240)}`,
    `     sampleCreatorsRiding: ${sample}`,
  ];
  if (c.momentum) lines.push(`     momentum: ${c.momentum}`);
  return lines.join("\n");
}

/**
 * Build the prompt fed to `callMaya` with `taskTag: "niche_scan"` (medium
 * thinking). The model returns structured JSON with one entry per candidate.
 *
 * The prompt is deliberately explicit about voice + boundary conflicts:
 * the model is told to LOWER fit scores when a candidate conflicts with the
 * voiceFingerprint or `boundaries`. We do not encode thresholds in TS — that
 * is Maya's judgment, not our code's.
 */
export function buildScoringPrompt(
  creatorPicture: CreatorPictureSubset,
  candidates: ReadonlyArray<TrendCandidate>
): string {
  const lines: string[] = [];
  lines.push("You are Maya scoring trend candidates for fit to ONE creator.");
  lines.push("Anti-sycophancy: do not inflate scores to surface more items. An empty result is correct when nothing fits.");
  lines.push("");
  lines.push("=== Creator ===");
  lines.push(`niche: ${creatorPicture.niche}`);
  lines.push(`audience.interestTags: ${creatorPicture.audience.interestTags.join(", ") || "(none recorded)"}`);
  lines.push(`audience.topGeos: ${creatorPicture.audience.topGeos.join(", ") || "(none recorded)"}`);
  lines.push("");
  lines.push("=== Voice fingerprint ===");
  lines.push(truncate(creatorPicture.voiceFingerprint || "(no voice fingerprint yet)", 800));
  lines.push("");
  lines.push("=== Boundaries (creator-stated no-go) ===");
  lines.push(formatBoundariesBlock(creatorPicture.boundaries));
  lines.push("");
  lines.push("=== Candidates ===");
  if (candidates.length === 0) {
    lines.push("(none — return an empty observations array)");
  } else {
    candidates.forEach((c, i) => {
      lines.push(formatCandidate(c, i));
    });
  }
  lines.push("");
  lines.push("=== Your task ===");
  lines.push("For each candidate, decide whether THIS creator could authentically ride this trend.");
  lines.push("Score fitToCreatorScore 1-10. Higher = stronger fit. Use the full range.");
  lines.push("");
  lines.push("Rules for scoring:");
  lines.push("- LOWER the score sharply when the candidate conflicts with the creator's voice fingerprint (different register, different identity, different relationship to the audience).");
  lines.push("- Set the score to 0 when the candidate matches a creator-stated banned_topic or banned_format. These are creator boundaries, not your call.");
  lines.push("- LOWER the score when the trend is virally hot but tangential to the niche or audience interest tags.");
  lines.push("- RAISE the score when the trend matches both the niche and the voice register, even if the trend is not yet at peak momentum — early-on-trend is the manager's edge.");
  lines.push("- Do not predict virality numerically; do not say a trend will hit a specific view count. That is fabrication.");
  lines.push("");
  lines.push("Output STRICTLY this JSON shape — no prose before or after:");
  lines.push("{");
  lines.push('  "observations": [');
  lines.push("    {");
  lines.push('      "candidateIdx": number,        // index into the Candidates list above');
  lines.push('      "trendPattern": string,        // copy candidate.pattern verbatim, or refine if a tighter pattern label fits');
  lines.push('      "citation": { "ref": string, "fact": string },  // copy candidate.citation verbatim — do NOT invent');
  lines.push('      "fitToCreatorScore": number,   // 0-10');
  lines.push('      "sampleCreatorsRiding": string[],  // copy candidate.sampleCreatorsRiding or []');
  lines.push('      "rationale": string            // ONE sentence: why this fits THIS creator (or 0 if banned)');
  lines.push("    }");
  lines.push("  ]");
  lines.push("}");
  lines.push("");
  lines.push("Hard rules:");
  lines.push("- Every observation MUST copy the candidate's citation verbatim. Do not invent URLs.");
  lines.push("- Drop a candidate by simply omitting it from observations. Do not include observations with no rationale.");
  lines.push("- The rationale is one sentence. No marketing-speak. No 'game-changing'. No 'incredible'.");
  lines.push("- Maya is a manager, not a hype account.");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Response parser.
// ─────────────────────────────────────────────────────────────────────────

function isCandidateKind(s: unknown): s is CandidateKind {
  return s === "hashtag" || s === "sound" || s === "video" || s === "creator";
}

function isPlatform(s: unknown): s is Platform {
  return s === "tiktok" || s === "instagram" || s === "youtube" || s === "linkedin" || s === "x";
}

function clampScore0to10(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 0 || n > 10) return null;
  return n;
}

function parseStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.trim().length > 0) out.push(x);
  }
  return out;
}

/**
 * Parse the model's JSON response. Strict: any entry without a citation,
 * without a rationale, with an out-of-range score, or referencing an
 * out-of-range candidate index is silently dropped.
 *
 * The parser fills `platform` + `kind` from the referenced candidate when
 * `candidateIdx` is in range, so the action does not have to re-join.
 */
export function parseScoringResponse(
  modelOutput: string,
  candidates: ReadonlyArray<TrendCandidate>
): TrendObservation[] {
  let body = modelOutput.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];

  const obj = parsed as Record<string, unknown>;
  const obs = obj.observations;
  if (!Array.isArray(obs)) return [];

  const out: TrendObservation[] = [];
  for (const entry of obs) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;

    // Resolve the source candidate. If candidateIdx is in range we use it;
    // otherwise we fall back to the entry's own platform/kind fields.
    const idxRaw = e.candidateIdx;
    let sourceCandidate: TrendCandidate | null = null;
    if (typeof idxRaw === "number" && Number.isInteger(idxRaw) && idxRaw >= 0 && idxRaw < candidates.length) {
      sourceCandidate = candidates[idxRaw];
    }

    const platform = sourceCandidate
      ? sourceCandidate.platform
      : isPlatform(e.platform)
        ? e.platform
        : null;
    const kind = sourceCandidate
      ? sourceCandidate.kind
      : isCandidateKind(e.kind)
        ? e.kind
        : null;
    if (!platform || !kind) continue;

    const trendPattern = typeof e.trendPattern === "string" ? e.trendPattern.trim() : "";
    if (trendPattern.length === 0) continue;

    const citationRaw = e.citation;
    if (typeof citationRaw !== "object" || citationRaw === null) continue;
    const cr = citationRaw as Record<string, unknown>;
    const ref = typeof cr.ref === "string" ? cr.ref.trim() : "";
    const fact = typeof cr.fact === "string" ? cr.fact.trim() : "";
    if (ref.length === 0 || fact.length === 0) continue;

    const score = clampScore0to10(e.fitToCreatorScore);
    if (score === null) continue;

    const rationale = typeof e.rationale === "string" ? e.rationale.trim() : "";
    if (rationale.length === 0) continue;

    const sampleCreatorsRiding = parseStringArray(e.sampleCreatorsRiding);

    out.push({
      platform,
      kind,
      trendPattern,
      citation: { ref, fact },
      fitToCreatorScore: score,
      sampleCreatorsRiding,
      rationale,
    });
  }

  return out;
}
