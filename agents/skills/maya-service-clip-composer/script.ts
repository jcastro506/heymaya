/**
 * maya-service-clip-composer — Wave C.6 implementation, corrected per
 * operator rule (2026-04-27, third correction): no vendoring of low-level
 * binaries; ClawHub-installed cloud video composer instead.
 *
 * JUDGMENT wrapper. Per `agents/skills/maya-service-clip-composer/SKILL.md`
 * AND the operator's install-first + no-vendoring directive: this skill
 * OWNS composition judgment (which clips, hook, aspect ratio, duration,
 * music vibe). It DELEGATES rendering mechanics to a ClawHub-installed
 * cloud video composer skill (NemoVideo / Free Video Generator (CapCut) /
 * operator-selected equivalent) — installed via OpenClaw's runtime skill
 * download, NOT vendored on disk. See `docs/spikes/video-clip-skill-decision.md`.
 *
 * Plan-tier: Studio-only initial gate. The orchestrator that invokes this
 * wrapper MUST check `planFeaturesService(business).mayaVideoEditing` and
 * fail closed before this script runs.
 *
 * Routing: Gemini 3 Flash MEDIUM thinking for the composition judgment.
 * Cloud rendering consumes no local compute and no LLM budget.
 *
 * Test seam: the LLM seam is `llmCaller`. The cloud composer seam is
 * `cloudVideoComposerInvoker`. Both are injectable; both have safe
 * deterministic fallbacks.
 */

export const SKILL_METADATA = {
  name: "maya-service-clip-composer" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "medium" as const,
  routedReason:
    "video composition judgment (clip selection + hook + music vibe + cut points) over multi-clip cataloger metadata. Cloud rendering delegated to ClawHub-installed video composer skill — no LLM thinking on the pipeline itself.",
  planTier: ["studio"] as const, // initial gate per § 12.5.7
} as const;

export type TargetPlatform =
  | "gbp"
  | "instagram-reel"
  | "tiktok"
  | "facebook";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type MusicVibe =
  | "none"
  | "upbeat-energetic"
  | "calm-confident"
  | "warm-friendly";

export interface ClipInput {
  assetId: string;
  storageUrl: string;
  durationSec: number;
  visualQuality: "excellent" | "good" | "fair" | "poor";
  primarySubject: string;
  serviceCategory: string;
  framingNotes: string;
}

export interface BusinessContext {
  businessId: string;
  serviceTypes: ReadonlyArray<string>;
  brandVoice: string;
}

export interface ComposerInputs {
  business: BusinessContext;
  clips: ReadonlyArray<ClipInput>;
  targetPlatform: TargetPlatform;
  approvedCaption: string;
  sourceGbpPostId?: string;
}

export interface SelectedClip {
  assetId: string;
  sourceStartSec: number;
  sourceEndSec: number;
  compositionOrder: number;
}

export interface CompositionPlan {
  aspectRatio: AspectRatio;
  maxDurationSec: number;
  selectedClips: ReadonlyArray<SelectedClip>;
  hookText: string | null;
  musicVibe: MusicVibe;
  captionTextOverlay: string | null;
}

export interface ComposerOutput {
  compositionPlan: CompositionPlan;
  rationale: string;
  derivedFromAssetIds: ReadonlyArray<string>;
  enqueuedForRender: boolean;
}

export interface LlmCaller {
  (prompt: { system: string; user: string }): Promise<string>;
}

/**
 * Cloud video composer seam. Production wires this to the OpenClaw
 * skill-invocation surface for whichever ClawHub video-editor skill the
 * operator approved at deploy (NemoVideo / Free Video Generator (CapCut) /
 * etc.). Returns true on a successful render-job enqueue; false when no
 * video composer skill is reachable (graceful degrade — operator sees
 * "no video composer skill installed; Maya can install one from ClawHub
 * via the maya-skill-installer meta-skill on your approval").
 *
 * The seam is intentionally generic over which ClawHub skill is wired —
 * we don't lock to a single skill ID at code time. The deploy bundle's
 * skill manifest decides; the maya-skill-installer can swap at runtime
 * with operator approval. Keeping the seam abstract avoids re-coding the
 * wrapper if we change vendors.
 */
export interface CloudVideoComposerInvoker {
  (plan: CompositionPlan & { sourceClips: ReadonlyArray<ClipInput> }): Promise<{
    enqueued: boolean;
  }>;
}

/* -------------------------------------------------------------------------- */
/* Platform constraints (real bounds, not operator-tunable rules)             */
/* -------------------------------------------------------------------------- */

interface PlatformBounds {
  aspectRatio: AspectRatio;
  maxDurationSec: number;
  preferredHookSec: number;
}

const PLATFORM_BOUNDS: Record<TargetPlatform, PlatformBounds> = {
  gbp: { aspectRatio: "16:9", maxDurationSec: 30, preferredHookSec: 2 },
  "instagram-reel": {
    aspectRatio: "9:16",
    maxDurationSec: 90,
    preferredHookSec: 1,
  },
  tiktok: { aspectRatio: "9:16", maxDurationSec: 60, preferredHookSec: 1 },
  facebook: { aspectRatio: "16:9", maxDurationSec: 60, preferredHookSec: 2 },
};

/* -------------------------------------------------------------------------- */
/* Safety + composition primitives                                             */
/* -------------------------------------------------------------------------- */

const QUALITY_RANK: Record<ClipInput["visualQuality"], number> = {
  poor: 0,
  fair: 1,
  good: 2,
  excellent: 3,
};

function eligibleClips(clips: ReadonlyArray<ClipInput>): ClipInput[] {
  // Drop poor-quality clips — even if it leaves us with nothing.
  return clips.filter((c) => QUALITY_RANK[c.visualQuality] >= QUALITY_RANK.fair);
}

function neutralizeInjection(text: string): string {
  return text
    .replace(/\bignore (?:all )?(?:previous|prior|above) instructions?\b/gi, "[redacted]")
    .replace(/\b(system|assistant)\s*:\s*/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .trim();
}

/**
 * Validate the proposed hook is grounded in the approved caption. Hooks
 * MUST be a (case-insensitive) substring of the operator-approved caption,
 * else they're invented and dropped.
 */
function hookIsGrounded(
  hook: string | null,
  approvedCaption: string
): boolean {
  if (hook === null) return true;
  if (!hook.trim()) return false;
  return approvedCaption.toLowerCase().includes(hook.toLowerCase().trim());
}

/* -------------------------------------------------------------------------- */
/* Music vibe — small judgment table                                           */
/* -------------------------------------------------------------------------- */

function inferMusicVibe(
  brandVoice: string,
  selectedClips: ReadonlyArray<ClipInput>
): MusicVibe {
  const voice = brandVoice.toLowerCase();
  const hasAction = selectedClips.some((c) =>
    /action|live|in[-\s]?progress|on[-\s]?site/i.test(c.framingNotes)
  );
  if (hasAction) return "upbeat-energetic";
  if (/friendly|neighborhood|warm/.test(voice)) return "warm-friendly";
  if (/professional|efficient|authoritative|expert/.test(voice)) {
    return "calm-confident";
  }
  return "none";
}

/* -------------------------------------------------------------------------- */
/* Deterministic clip selection (test seam — LLM polishes; doesn't override)   */
/* -------------------------------------------------------------------------- */

interface ClipPick {
  clip: ClipInput;
  trimStart: number;
  trimEnd: number;
}

/**
 * Deterministic baseline: pick best-quality clips, in receivedAt-ish order
 * (caller passes ordered), trim each to a fixed budget (4-6 sec for short
 * platforms; 8 sec for longer), stop when total budget reached.
 */
function deterministicSelection(
  clips: ReadonlyArray<ClipInput>,
  bounds: PlatformBounds
): ClipPick[] {
  const sorted = [...clips].sort(
    (a, b) =>
      QUALITY_RANK[b.visualQuality] - QUALITY_RANK[a.visualQuality]
  );
  const perClipMaxSec = bounds.maxDurationSec <= 30 ? 4 : 6;
  const out: ClipPick[] = [];
  let totalSec = 0;
  for (const c of sorted) {
    if (totalSec >= bounds.maxDurationSec) break;
    const remaining = bounds.maxDurationSec - totalSec;
    const trimEnd = Math.min(c.durationSec, perClipMaxSec, remaining);
    if (trimEnd <= 0) break;
    out.push({ clip: c, trimStart: 0, trimEnd });
    totalSec += trimEnd;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* LLM polish — proposes a hook from approvedCaption                           */
/* -------------------------------------------------------------------------- */

async function proposeHook(
  approvedCaption: string,
  selectedClips: ReadonlyArray<ClipInput>,
  llmCaller: LlmCaller | null | undefined
): Promise<string | null> {
  if (!llmCaller) {
    // Deterministic fallback — first 6-8 words of caption, if short enough.
    const words = approvedCaption.trim().split(/\s+/).slice(0, 7).join(" ");
    if (words.length > 0 && words.length <= 60) return words;
    return null;
  }
  try {
    const cleanCaption = neutralizeInjection(approvedCaption);
    const cleanClips = selectedClips.map((c) => ({
      primarySubject: neutralizeInjection(c.primarySubject).slice(0, 80),
      framingNotes: neutralizeInjection(c.framingNotes).slice(0, 120),
    }));
    const raw = await llmCaller({
      system:
        "You are Maya, a service-business AI manager. Pick a hook (≤60 chars) for a short-form video at second 0. The hook MUST be a substring of the operator-approved caption — do not invent. Output STRICT JSON: {\"hook\":\"<= 60 chars\"} or {\"hook\":null}.",
      user: JSON.stringify({ approvedCaption: cleanCaption, clips: cleanClips }),
    });
    const stripped = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(stripped) as { hook?: unknown };
    if (parsed.hook === null) return null;
    if (typeof parsed.hook !== "string") return null;
    const candidate = parsed.hook.trim().slice(0, 60);
    if (!hookIsGrounded(candidate, approvedCaption)) {
      // Hallucinated; fall back to deterministic first-words.
      return proposeHook(approvedCaption, selectedClips, null);
    }
    return candidate;
  } catch {
    return proposeHook(approvedCaption, selectedClips, null);
  }
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

export interface ComposeOptions {
  llmCaller?: LlmCaller | null;
  cloudVideoComposerInvoker?: CloudVideoComposerInvoker | null;
}

export class ClipComposerError extends Error {
  constructor(
    public readonly reason: string,
    detail?: string
  ) {
    super(detail ? `clip-composer: ${reason} — ${detail}` : `clip-composer: ${reason}`);
    this.name = "ClipComposerError";
  }
}

export async function composeClipDraft(
  inputs: ComposerInputs,
  options: ComposeOptions = {}
): Promise<ComposerOutput> {
  if (!inputs.approvedCaption || !inputs.approvedCaption.trim()) {
    throw new ClipComposerError("missing approvedCaption");
  }
  if (!inputs.business.brandVoice || !inputs.business.brandVoice.trim()) {
    throw new ClipComposerError("missing business.brandVoice");
  }
  const bounds = PLATFORM_BOUNDS[inputs.targetPlatform];
  if (!bounds) {
    throw new ClipComposerError(
      "unsupported targetPlatform",
      inputs.targetPlatform
    );
  }

  const eligible = eligibleClips(inputs.clips);
  if (eligible.length === 0) {
    return {
      compositionPlan: {
        aspectRatio: bounds.aspectRatio,
        maxDurationSec: bounds.maxDurationSec,
        selectedClips: [],
        hookText: null,
        musicVibe: "none",
        captionTextOverlay: null,
      },
      rationale:
        "no eligible clips — every clip provided was poor-quality. cataloger should re-evaluate before re-running.",
      derivedFromAssetIds: [],
      enqueuedForRender: false,
    };
  }

  const picks = deterministicSelection(eligible, bounds);
  const selectedClipInputs = picks.map((p) => p.clip);
  const selectedClips: SelectedClip[] = picks.map((p, i) => ({
    assetId: p.clip.assetId,
    sourceStartSec: p.trimStart,
    sourceEndSec: p.trimEnd,
    compositionOrder: i,
  }));

  // Hard duration enforcement post-pick — defense in depth.
  let runningTotal = 0;
  for (const sc of selectedClips) {
    runningTotal += sc.sourceEndSec - sc.sourceStartSec;
  }
  if (runningTotal > bounds.maxDurationSec) {
    throw new ClipComposerError(
      "deterministic-selection exceeded max duration",
      `${runningTotal} > ${bounds.maxDurationSec}`
    );
  }

  const hookText = await proposeHook(
    inputs.approvedCaption,
    selectedClipInputs,
    options.llmCaller
  );
  const musicVibe = inferMusicVibe(inputs.business.brandVoice, selectedClipInputs);

  const captionTextOverlay =
    inputs.targetPlatform === "instagram-reel" ||
    inputs.targetPlatform === "tiktok"
      ? inputs.approvedCaption.slice(0, 80)
      : null;

  const plan: CompositionPlan = {
    aspectRatio: bounds.aspectRatio,
    maxDurationSec: bounds.maxDurationSec,
    selectedClips,
    hookText,
    musicVibe,
    captionTextOverlay,
  };

  // Delegate rendering to the ClawHub-installed cloud video composer.
  // Graceful degrade on unavailability (operator sees a clear "no video
  // composer skill installed; install one from ClawHub via maya-skill-installer").
  let enqueuedForRender = false;
  if (options.cloudVideoComposerInvoker) {
    try {
      const result = await options.cloudVideoComposerInvoker({
        ...plan,
        sourceClips: selectedClipInputs,
      });
      enqueuedForRender = result.enqueued;
    } catch {
      enqueuedForRender = false;
    }
  }

  const rationale = `selected ${selectedClips.length} of ${inputs.clips.length} clips for ${inputs.targetPlatform} (${bounds.aspectRatio}, ${bounds.maxDurationSec}s cap). hook: ${hookText ? `"${hookText}"` : "(none)"}. music: ${musicVibe}.`;

  return {
    compositionPlan: plan,
    rationale: rationale.slice(0, 300),
    derivedFromAssetIds: selectedClipInputs.map((c) => c.assetId),
    enqueuedForRender,
  };
}
