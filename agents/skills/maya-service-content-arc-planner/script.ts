/**
 * maya-service-content-arc-planner — multi-day, multi-platform content arc.
 *
 * LOCAL-HOOK HARD RULE (§ 7): ≥80% of posts in any returned arc must
 * reference a local hook from `businessPicture.localPositioning`. The
 * implementation enforces this BEFORE returning — if the LLM produces an
 * arc below the threshold, we either re-tag posts that match locally OR
 * throw `ArcLocalHookDensityError` so the orchestrator can retry / fall back.
 *
 * Per § 3 routing matrix: Gemini 3 Flash, HIGH thinking — multi-day,
 * multi-platform synthesis. The LLM produces structured JSON; we audit it
 * post-call against the local-hook list.
 */

export type ArcPlatform = "gbp" | "facebook" | "instagram" | "tiktok";

export type ArcSeedKind =
  | "weather"
  | "season"
  | "local-event"
  | "milestone"
  | "competitor-move";

export interface ArcSeedEvent {
  kind: ArcSeedKind;
  description: string;
  startDate: number;
  endDate?: number;
}

export interface ArcLocalPositioning {
  servedZips: ReadonlyArray<string>;
  servedNeighborhoods: ReadonlyArray<string>;
  namedCompetitors: ReadonlyArray<{
    name: string;
    reputationalNote?: string;
  }>;
  recurringLocalHooks: ReadonlyArray<{
    kind: "weather" | "event" | "landmark" | "sport" | "season" | "community";
    text: string;
  }>;
}

export interface ArcPlannerInputs {
  seedEvent: ArcSeedEvent;
  businessPicture: {
    serviceType: string;
    brandVoice: string;
    localPositioning: ArcLocalPositioning;
  };
  platforms: ReadonlyArray<ArcPlatform>;
  lookAheadDays: number;
}

export interface ArcDay {
  dayOffset: number;
  platform: ArcPlatform;
  hookOptions: ReadonlyArray<string>;
  captionDraft: string;
  postingTimeLocal: string;
  rationale: string;
  localHookUsed: {
    kind: string;
    text: string;
    sourcedFrom: string;
  } | null;
}

export interface ArcPlannerOutput {
  arc: ReadonlyArray<ArcDay>;
  rationale: string;
  localHooksWoven: ReadonlyArray<{ dayOffset: number; hook: string }>;
  localHookDensity: number;
  citationFirewall: { passed: true };
}

export interface LlmCaller {
  (prompt: { system: string; user: string }): Promise<string>;
}

export class ArcLocalHookDensityError extends Error {
  constructor(
    public readonly density: number,
    public readonly required: number = 0.8
  ) {
    super(
      `content-arc-planner: localHookDensity ${density.toFixed(2)} below required ${required} — arc rejected per § 7 hard rule`
    );
    this.name = "ArcLocalHookDensityError";
  }
}

const MIN_LOCAL_HOOK_DENSITY = 0.8;

function isPositioningEmpty(p: ArcLocalPositioning): boolean {
  return (
    p.servedNeighborhoods.length === 0 &&
    p.namedCompetitors.length === 0 &&
    p.recurringLocalHooks.length === 0
  );
}

function buildPrompt(inputs: ArcPlannerInputs): {
  system: string;
  user: string;
} {
  const lp = inputs.businessPicture.localPositioning;
  const hookList = lp.recurringLocalHooks
    .map((h, i) => `${i}. [${h.kind}] ${h.text}`)
    .join("\n");
  const neighborhoodList = lp.servedNeighborhoods.map((n) => `- ${n}`).join("\n");
  const competitorList = lp.namedCompetitors
    .map((c) => `- ${c.name}${c.reputationalNote ? ` (${c.reputationalNote})` : ""}`)
    .join("\n");

  const system = [
    "You plan a multi-day content arc for a service-business operator.",
    "",
    "HARD RULES (non-negotiable):",
    `1. ≥80% of posts MUST reference at least one of: a served neighborhood by name, a named competitor by name, or a recurring local hook by EXACT text. Generic phrasing ("in your area", "in our community") is forbidden.`,
    "2. Every post's `localHookUsed.text` must be the verbatim string from the lists below — DO NOT paraphrase.",
    "3. Brand voice is mandatory — match the operator's voice in every caption.",
    "4. Output must be a valid JSON object matching the schema. No markdown fences, no preamble.",
    "",
    "JSON output schema:",
    `{"arc": [{"dayOffset": number, "platform": "gbp"|"facebook"|"instagram"|"tiktok", "hookOptions": string[], "captionDraft": string, "postingTimeLocal": "HH:MM", "rationale": string, "localHookUsed": null | {"kind": string, "text": string, "sourcedFrom": "neighborhood"|"competitor"|"recurringHook"}}], "rationale": string}`,
  ].join("\n");

  const user = [
    `Service type: ${inputs.businessPicture.serviceType}`,
    `Brand voice: ${inputs.businessPicture.brandVoice}`,
    `Seed event: [${inputs.seedEvent.kind}] ${inputs.seedEvent.description}`,
    `Look-ahead days: ${inputs.lookAheadDays}`,
    `Platforms: ${inputs.platforms.join(", ")}`,
    "",
    `Served neighborhoods (use exact names):`,
    neighborhoodList || "(none)",
    "",
    `Named competitors (use exact names):`,
    competitorList || "(none)",
    "",
    `Recurring local hooks (use exact text):`,
    hookList || "(none)",
    "",
    "Return the JSON object now.",
  ].join("\n");

  return { system, user };
}

interface RawArcDay {
  dayOffset?: number;
  platform?: string;
  hookOptions?: string[];
  captionDraft?: string;
  postingTimeLocal?: string;
  rationale?: string;
  localHookUsed?: {
    kind?: string;
    text?: string;
    sourcedFrom?: string;
  } | null;
}

function parseLlmOutput(raw: string): { arc: RawArcDay[]; rationale: string } {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) {
      throw new Error("content-arc-planner: LLM returned non-JSON output");
    }
    parsed = JSON.parse(m[0]);
  }
  const obj = parsed as Record<string, unknown>;
  const arc = Array.isArray(obj.arc) ? (obj.arc as RawArcDay[]) : [];
  const rationale = typeof obj.rationale === "string" ? obj.rationale : "";
  return { arc, rationale };
}

const VALID_PLATFORMS: ReadonlySet<ArcPlatform> = new Set([
  "gbp",
  "facebook",
  "instagram",
  "tiktok",
]);

function validatePlatform(s: string | undefined): ArcPlatform {
  if (s && (VALID_PLATFORMS as Set<string>).has(s)) return s as ArcPlatform;
  return "gbp";
}

function findLocalHookSource(
  text: string | undefined,
  lp: ArcLocalPositioning
): { kind: string; text: string; sourcedFrom: string } | null {
  if (!text) return null;
  const lc = text.toLowerCase();
  // 1) recurring hooks
  for (const h of lp.recurringLocalHooks) {
    if (h.text && lc.includes(h.text.toLowerCase())) {
      return { kind: h.kind, text: h.text, sourcedFrom: "recurringHook" };
    }
  }
  // 2) neighborhoods
  for (const n of lp.servedNeighborhoods) {
    if (n && lc.includes(n.toLowerCase())) {
      return { kind: "neighborhood", text: n, sourcedFrom: "neighborhood" };
    }
  }
  // 3) competitors
  for (const c of lp.namedCompetitors) {
    if (c.name && lc.includes(c.name.toLowerCase())) {
      return { kind: "competitor", text: c.name, sourcedFrom: "competitor" };
    }
  }
  return null;
}

function postReferencesLocally(
  caption: string,
  lp: ArcLocalPositioning
): { kind: string; text: string; sourcedFrom: string } | null {
  return findLocalHookSource(caption, lp);
}

export async function planContentArc(
  inputs: ArcPlannerInputs,
  callLlm: LlmCaller
): Promise<ArcPlannerOutput> {
  if (isPositioningEmpty(inputs.businessPicture.localPositioning)) {
    throw new Error(
      "content-arc-planner: empty localPositioning — skill cannot run without local context (§ 7 hard rule)"
    );
  }
  if (inputs.lookAheadDays < 1 || inputs.lookAheadDays > 14) {
    throw new Error(
      `content-arc-planner: lookAheadDays must be 1-14, got ${inputs.lookAheadDays}`
    );
  }
  if (inputs.platforms.length === 0) {
    throw new Error("content-arc-planner: at least one platform required");
  }

  const prompt = buildPrompt(inputs);
  const raw = await callLlm(prompt);
  const { arc: rawArc, rationale } = parseLlmOutput(raw);

  if (rawArc.length === 0) {
    throw new Error("content-arc-planner: LLM produced empty arc");
  }

  const lp = inputs.businessPicture.localPositioning;
  const arc: ArcDay[] = [];
  const localHooksWoven: { dayOffset: number; hook: string }[] = [];

  for (const r of rawArc) {
    // Re-derive the local hook from the caption text (audit step). If the
    // LLM claimed a hook but the caption doesn't actually contain it, we
    // strip the claim — preventing fabricated `localHookUsed` entries.
    const captionDraft = typeof r.captionDraft === "string" ? r.captionDraft : "";
    const auditedHook = postReferencesLocally(captionDraft, lp);

    arc.push({
      dayOffset: typeof r.dayOffset === "number" ? r.dayOffset : 0,
      platform: validatePlatform(r.platform),
      hookOptions: Array.isArray(r.hookOptions)
        ? r.hookOptions.filter((h): h is string => typeof h === "string")
        : [],
      captionDraft,
      postingTimeLocal:
        typeof r.postingTimeLocal === "string" ? r.postingTimeLocal : "10:00",
      rationale: typeof r.rationale === "string" ? r.rationale : "",
      localHookUsed: auditedHook,
    });

    if (auditedHook) {
      localHooksWoven.push({
        dayOffset: typeof r.dayOffset === "number" ? r.dayOffset : 0,
        hook: auditedHook.text,
      });
    }
  }

  const withHook = arc.filter((d) => d.localHookUsed !== null).length;
  const localHookDensity = arc.length > 0 ? withHook / arc.length : 0;

  if (localHookDensity < MIN_LOCAL_HOOK_DENSITY) {
    throw new ArcLocalHookDensityError(localHookDensity);
  }

  return {
    arc,
    rationale,
    localHooksWoven,
    localHookDensity,
    citationFirewall: { passed: true },
  };
}

export const SKILL_METADATA = {
  name: "maya-service-content-arc-planner" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "high" as const,
  planTier: ["pro", "studio"] as const,
  /** Hard rule per § 7 — arc local-hook density >= 0.8. */
  localHookRequired: true as const,
  minLocalHookDensity: 0.8 as const,
};

export const __test__ = {
  buildPrompt,
  parseLlmOutput,
  postReferencesLocally,
  isPositioningEmpty,
};
