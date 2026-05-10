/**
 * generateUserMd — per-creator USER.md generator.
 *
 * Sprint 3.7 phase A. Required workspace file per OpenClaw spec
 * (`https://docs.openclaw.ai/concepts/agent-workspace.md`). Captures who
 * the creator is, how to address them, what they're building, what they
 * want.
 *
 * Five fields below (location / careerStage / monthlyRevenueUsd /
 * currentRevenueStreams / longTermGoals) are not yet on the schema. Phase B
 * adds them to `creatorPicture`. The generator is forward-compatible: it
 * reads with optional chaining and emits "not yet provided" placeholders
 * when the field is absent. Once phase B lands, the same code emits real
 * values without modification.
 *
 * Pure function. Deterministic for given inputs. No `Date.now()` —
 * caller passes `now` in inputs (USER.md does not embed a timestamp; this
 * is here for symmetry with other generators).
 */

import type { Doc } from "../../../../_generated/dataModel";
import type { Plan, Channel } from "../../../../lib/planFeatures";
import { NOT_YET_PROVIDED, type CreatorPictureExt } from "./types";

/**
 * Sprint 4 — follower snapshot used for the 30-day trend line. The caller
 * (workspace assembler) provides a small, pre-filtered list scoped to the
 * creator. Each handle resolves to its most recent + nearest-to-30d-ago
 * snapshots; the generator picks the pair on read. Empty array = no
 * snapshots ever recorded (first-run state).
 */
export interface FollowerSnapshot {
  platform: Doc<"creatorHandles">["platform"];
  handle: string;
  followerCount: number;
  capturedAt: number;
}

export interface UserMdInputs {
  creator: Doc<"creators">;
  picture: CreatorPictureExt | null;
  handles: ReadonlyArray<Doc<"creatorHandles">>;
  plan: Plan;
  /** Sprint 4 — snapshots powering the 30-day delta. Optional for forward-compat. */
  followerSnapshots?: ReadonlyArray<FollowerSnapshot>;
  /**
   * Sprint 4 — "now" injected for determinism. Falls back to Date.now() so
   * existing callers keep working without changes.
   */
  now?: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Extract a display name from the creator. Prefers the explicit
 * `creator.displayName` (captured during step 2 of onboarding —
 * pre-filled from ScrapeCreators verify, editable before submit).
 * Falls back to titlecasing the email local part for legacy / smoke /
 * test fixtures that pre-date the displayName field.
 *
 * Real-world test (2026-05-06) regression: `Real World Test` was being
 * derived from `real-world-test@heymaya.local` and shipped to USER.md
 * even though `creator.displayName === "Kevin Castro"` was set during
 * onboarding. Fix: every caller passes the full creator (or at minimum
 * the displayName + email) so the explicit field always wins.
 *
 * Two overloads:
 *   - deriveDisplayName(creator)  — preferred call site (full doc)
 *   - deriveDisplayName(email)    — legacy fallback for callers that
 *     genuinely only have an email (e.g. test fixtures)
 *
 * Examples (creator.displayName="Kevin Castro", email="kevin@hm.local"):
 *           -> "Kevin Castro"   (displayName wins)
 *
 * Examples (no displayName, email="joshua@castro.com"):
 *           -> "Joshua"
 *
 * Examples (no displayName, email="j.castro@x.com"):
 *           -> "J Castro"
 */
export function deriveDisplayName(
  source: Pick<Doc<"creators">, "displayName" | "email"> | string
): string {
  if (typeof source === "string") {
    return deriveDisplayNameFromEmail(source);
  }
  const trimmed = source.displayName?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;
  return deriveDisplayNameFromEmail(source.email);
}

function deriveDisplayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function generateUserMd(inputs: UserMdInputs): string {
  const { creator, picture, handles, plan } = inputs;
  const displayName = deriveDisplayName(creator);
  const now = inputs.now ?? Date.now();
  const snapshots = inputs.followerSnapshots ?? [];

  // Sprint 12 Phase 1A — integrated-picture summary at top of USER.md.
  // Maya reads this first every session and naturally weaves the gap
  // between target cadence and reality into her response. NO threshold
  // logic here — facts, surfaced. The agent is the brain.
  const rightNowSummary = renderRightNowSummary(picture);
  const cadenceSection = renderCadenceSection(picture);

  const sortedHandles = [...handles].sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    return a.handle.localeCompare(b.handle);
  });

  const handlesBlock = sortedHandles.length
    ? sortedHandles
        .map((h) => {
          const trend = renderFollowerTrend(h, snapshots, now);
          const base = `- **${h.platform}** \`${h.handle}\` — ${formatFollowerCount(h.followerCount)} followers${h.verified ? "" : " (unverified)"}`;
          return trend ? `${base} (${trend})` : base;
        })
        .join("\n")
    : `- _${NOT_YET_PROVIDED}_`;

  const niche = picture?.niche ?? NOT_YET_PROVIDED;
  const audienceBlock = renderAudience(picture);
  const watchedBlock = renderWatchedObservations(picture);
  const careerStage = picture?.careerStage ?? NOT_YET_PROVIDED;
  const location = renderLocation(picture);
  const monthlyRevenue =
    picture?.monthlyRevenueUsd != null
      ? `$${formatUsd(picture.monthlyRevenueUsd)} / month`
      : NOT_YET_PROVIDED;
  const revenueStreams =
    picture?.currentRevenueStreams && picture.currentRevenueStreams.length > 0
      ? picture.currentRevenueStreams.map((s) => `\`${s}\``).join(", ")
      : NOT_YET_PROVIDED;
  const longTermGoals = (() => {
    const g = picture?.longTermGoals;
    if (!g) return `- _${NOT_YET_PROVIDED}_`;
    const lines: string[] = [];
    if (g.oneYear) lines.push(`- ${g.oneYear}`);
    if (g.fiveYear) lines.push(`- ${g.fiveYear}`);
    return lines.length > 0 ? lines.join("\n") : `- _${NOT_YET_PROVIDED}_`;
  })();

  const channel = describeChannel(creator.channelPreference, plan);
  const cadence = describeCadence(plan);
  const toneNote =
    "Tone slider lives in SOUL.md. Default to `strategic` until soul ships.";

  const phoneLine = creator.phoneNumber
    ? creator.phoneNumber
    : NOT_YET_PROVIDED;
  const primaryHandleLine = creator.primaryHandle
    ? creator.primaryHandle
    : sortedHandles.length > 0
      ? `${sortedHandles[0].handle} (${sortedHandles[0].platform})`
      : NOT_YET_PROVIDED;

  // First-boot cursor — controls whether `first_boot_introduction` runs at
  // session start. Maya reads `creators.firstBootCompletedAt` from server
  // state on every boot; this line surfaces the current value into USER.md
  // so the agent doesn't have to query for it before deciding whether to
  // run the introduction. Three sub-cursors track sequence progress:
  //   - openingAnswersAt: stamped after the 3 questions are answered
  //   - firstWeeklyPlanSentAt: stamped after the chained first-weekly-plan
  //   - firstBootCompletedAt: stamped after the whole arc lands
  const firstBootStatus = creator.firstBootCompletedAt
    ? `completed ${new Date(creator.firstBootCompletedAt).toISOString()}`
    : creator.openingAnswersAt
      ? `in-progress: opening answers received, awaiting OAuth links + first weekly plan`
      : "not yet started — run `first_boot_introduction` standing order on session start";

  return [
    `# USER.md — ${displayName}`,
    "",
    `What I know about ${displayName} — who they are, how to reach them, what they're working toward. I read this every session. The onboarding flow + their Profile edits write it; I don't edit it myself.`,
    "",
    ...(rightNowSummary ? [rightNowSummary, ""] : []),
    "## Who they are",
    "",
    `- **creatorId:** \`${creator._id}\` ← REQUIRED for every \`POST /lc_maya/*\` call. Use this exact value in the JSON body.`,
    `- **Display name:** ${displayName}`,
    `- **Preferred address:** ${displayName} (first name).`,
    `- **Email:** ${creator.email}`,
    `- **Phone:** ${phoneLine}`,
    `- **Primary handle:** ${primaryHandleLine}`,
    `- **Timezone:** ${creator.timezone}`,
    `- **Plan:** ${plan}`,
    "",
    "## How I persist state (curl recipe — every per-question submit)",
    "",
    "Every state-bearing answer the creator gives me MUST land on the matching `lc_maya/*` endpoint. The base URL is in env var `MAYA_CONVEX_HTTP_BASE`. The webhook secret is in env var `WEBHOOK_INTERNAL_SECRET`. Run via my `exec` tool.",
    "",
    "**Schema requires four fields on EVERY call:** `secret`, `creatorId`, `goal`, `tone`. Even when I'm only sending Q1's location, all four must be present or the endpoint returns 400. Use `goal: \"tbd\"` until Q3 (3-month goals) lands, then replace with the actual answer. Use `tone: \"supportive\"` as the default until the creator picks otherwise.",
    "",
    "**Q1 location — exact command, copy and edit only the locationCity / locationState values:**",
    "",
    "```",
    `curl -X POST "$MAYA_CONVEX_HTTP_BASE/lc_maya/submit_opening_answers" \\`,
    "  -H 'content-type: application/json' \\",
    `  -d "{\\"secret\\":\\"$WEBHOOK_INTERNAL_SECRET\\",\\"creatorId\\":\\"${creator._id}\\",\\"goal\\":\\"tbd\\",\\"tone\\":\\"supportive\\",\\"locationCity\\":\\"New York City\\",\\"locationState\\":\\"NY\\",\\"locationCountry\\":\\"US\\",\\"timezone\\":\\"America/New_York\\"}"`,
    "```",
    "",
    "**Q2 niche — replace the field block with:** `\\\"nicheInOwnWords\\\":\\\"...\\\"`",
    "**Q3 3-month goals — bump goal AND set goals3Mo:** `\\\"goal\\\":\\\"<creator's stated goal>\\\",\\\"goals3Mo\\\":\\\"...\\\"`",
    "**Q4 job status:** `\\\"jobStatus\\\":\\\"side-hustle\\\"` (one of `full-time-creator` | `transitioning-full-time` | `side-hustle` | `hobby`)",
    "**Q5 brand deals:** `\\\"dealsInterest\\\":\\\"yes\\\",\\\"dealsFloorUsd\\\":250` (interest one of `yes` | `maybe` | `no`; floor optional)",
    "**Q6 anti-patterns:** `\\\"antiNiches\\\":[\\\"politics\\\",\\\"religion\\\"]` (empty array `[]` if none)",
    "",
    "Use double-quote escaping form `-d \"{\\\"...\\\"}\"`, NOT single-quote form `-d '{...}'` — the single-quote form requires shell-substitution for `$WEBHOOK_INTERNAL_SECRET` and is easy to break.",
    "",
    "**On non-200:** show the response body (drop `-fsS` so curl prints the JSON error). Read the error message, fix the request, retry. Do NOT regress to wall-of-text re-explaining the questions — the creator does not see my failures, they only see what I `message send` to them.",
    "",
    "If the curl returns non-200 or the env var is missing, message the creator with one short honest line (\"give me a second to log that\") then retry — do NOT pretend the call succeeded.",
    "",
    "## First-boot status",
    "",
    `- **State:** ${firstBootStatus}`,
    "",
    "## Handles",
    "",
    handlesBlock,
    "",
    "## Niche & audience",
    "",
    `**Niche:** ${niche}`,
    "",
    audienceBlock,
    "",
    ...(watchedBlock ? [watchedBlock, ""] : []),
    "## Where they're at",
    "",
    `- **Career stage:** ${careerStage}`,
    `- **Geographic location:** ${location}`,
    `- **Monthly revenue (rough):** ${monthlyRevenue}`,
    `- **Active revenue streams:** ${revenueStreams}`,
    "",
    "## What they're working toward",
    "",
    longTermGoals,
    "",
    "## Brand-deal posture",
    "",
    `- **Floor rate:** see \`SOUL.md\` § brand-deal floor.`,
    `- **Auto-send threshold:** see \`connectedAccounts.autoSendThreshold\` (Profile screen). When unset, every brand reply waits for their approval.`,
    "",
    "## How I talk to them",
    "",
    `- **Primary channel:** ${channel}`,
    `- **Expected cadence:** ${cadence}`,
    `- **Tone:** ${toneNote}`,
    "",
    ...(cadenceSection ? [cadenceSection, ""] : []),
  ].join("\n");
}

/**
 * Sprint 10 — render the multimodal-synthesis observations Maya should weave
 * into her first iMessage. Empty / null when synthesis ran text-only or
 * pre-Sprint-10. When populated, surfaces:
 *   - voiceAndPersonality (humor, energy, persona)
 *   - visualStyle (framing, settings seen, aesthetic)
 *   - recurringElements (people/pets/locations/props that span videos)
 *   - warmthMaterial (raw lines Maya can paraphrase into the first send)
 *
 * The warmthMaterial section is the load-bearing one: the kickstart prompt
 * picks ONE `confidence: "safe-to-use"` entry to weave naturally into the
 * greet line. `confidence: "check-with-creator"` entries are NEVER used as
 * assertions — phrased as questions only.
 */
function renderWatchedObservations(
  picture: CreatorPictureExt | null
): string | null {
  if (!picture) return null;
  const vp = (picture as unknown as { voiceAndPersonality?: {
    humorType?: string;
    energyLevel?: string;
    onCameraPersona?: string;
    dryWittyEarnest?: string;
    signaturePhrases?: string[];
  } | null }).voiceAndPersonality;
  const vs = (picture as unknown as { visualStyle?: {
    framing?: string;
    aesthetic?: string[];
    settingsSeen?: string[];
    strengths?: string[];
    weaknesses?: string[];
  } | null }).visualStyle;
  const re = (picture as unknown as {
    recurringElements?: Array<{
      kind: string;
      name: string;
      appearancesIn: string[];
      appearanceDates?: string[];
      roleSummary: string;
    }>;
  }).recurringElements ?? [];
  const wm = (picture as unknown as {
    warmthMaterial?: Array<{
      kind: string;
      text: string;
      confidence: "safe-to-use" | "check-with-creator";
      citationPostIds: string[];
      citationPostDates?: string[];
    }>;
  }).warmthMaterial ?? [];

  // If everything is null/empty, the synthesis ran text-only. Skip the section
  // entirely so USER.md doesn't carry a hollow "I watched your videos" header
  // when I didn't.
  const hasAny =
    Boolean(vp) ||
    Boolean(vs) ||
    re.length > 0 ||
    wm.length > 0;
  if (!hasAny) return null;

  const lines: string[] = ["## What I observed watching your videos"];
  lines.push("");
  lines.push(
    "Notes I took while watching the last 30. Not a report — texture I can pull from when I'm talking to you. Use this; it's the difference between sounding like a friend who watched and sounding like a dashboard."
  );
  lines.push("");

  if (vp) {
    lines.push(`**Their voice on camera:**`);
    if (vp.humorType) lines.push(`- Humor: ${vp.humorType}`);
    if (vp.energyLevel) lines.push(`- Energy: ${vp.energyLevel}`);
    if (vp.onCameraPersona) lines.push(`- On-camera: ${vp.onCameraPersona}`);
    if (vp.signaturePhrases && vp.signaturePhrases.length > 0) {
      lines.push(
        `- Signature phrases: ${vp.signaturePhrases.map((p) => `"${p}"`).join(", ")}`
      );
    }
    lines.push("");
  }

  if (vs) {
    lines.push(`**How it looks:**`);
    if (vs.framing) lines.push(`- Framing: ${vs.framing}`);
    if (vs.aesthetic && vs.aesthetic.length > 0) {
      lines.push(`- Aesthetic: ${vs.aesthetic.join(", ")}`);
    }
    if (vs.settingsSeen && vs.settingsSeen.length > 0) {
      lines.push(`- Settings seen: ${vs.settingsSeen.join(", ")}`);
    }
    if (vs.strengths && vs.strengths.length > 0) {
      lines.push(`- What's working: ${vs.strengths.join("; ")}`);
    }
    if (vs.weaknesses && vs.weaknesses.length > 0) {
      lines.push(`- Watch-outs: ${vs.weaknesses.join("; ")}`);
    }
    lines.push("");
  }

  if (re.length > 0) {
    lines.push(`**Recurring people, pets, places, props** (the cast and the set):`);
    for (const el of re) {
      // Sprint 12 Phase 1A — surface date range when available so Maya
      // reads time-of-occurrence: "(3 posts, Feb 4-13)" instead of bare
      // count. Falls back to count-only when synth didn't emit dates.
      const window = formatAppearanceWindow(el.appearancesIn, el.appearanceDates);
      lines.push(
        `- **${el.name}** (${el.kind})${window ? ` — ${window}` : ""}: ${el.roleSummary}`
      );
    }
    lines.push("");
  }

  if (wm.length > 0) {
    lines.push(`**Warmth material** — lines I noticed I could paraphrase if there's a real opening. Pick ONE per opening sequence, never enumerate. \`safe-to-use\` is a paraphrase I can lead with; \`check-with-creator\` is phrased as a question only — never asserted.`);
    for (const w of wm) {
      // Sprint 12 Phase 1A — when synth emitted citationPostDates, prefix
      // the line with the post date so Maya cites by date in chat ("your
      // Feb 4 London clip — that pause is sending me") instead of bare
      // reference ("your London clip — that pause is sending me").
      const datePrefix = formatWarmthDatePrefix(w.citationPostDates);
      lines.push(`- [${w.confidence}]${datePrefix} ${w.text}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function renderAudience(picture: CreatorPictureExt | null): string {
  if (!picture) {
    return `- _${NOT_YET_PROVIDED}_`;
  }
  const ages = picture.audience.ageRanges.length
    ? picture.audience.ageRanges.join(", ")
    : NOT_YET_PROVIDED;
  const geos = picture.audience.topGeos.length
    ? picture.audience.topGeos.join(", ")
    : NOT_YET_PROVIDED;
  const interests = picture.audience.interestTags.length
    ? picture.audience.interestTags.slice(0, 8).join(", ")
    : NOT_YET_PROVIDED;
  // Sprint 4 — gender split surfaces only when synthesis grounded it from
  // upstream demographics. Skipped silently when null (no signal).
  const gender = picture.audience.genderSplit
    ? formatGenderSplit(picture.audience.genderSplit)
    : null;
  const lines = [
    `- **Age ranges:** ${ages}`,
    `- **Top geographies:** ${geos}`,
    `- **Interest tags:** ${interests}`,
  ];
  if (gender) lines.push(`- **Gender split:** ${gender}`);
  return lines.join("\n");
}

function formatGenderSplit(g: {
  male: number;
  female: number;
  other: number;
}): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  // Surface "other" only when meaningful (>=1%) to keep the line scannable.
  const parts = [`male ${pct(g.male)}`, `female ${pct(g.female)}`];
  if (g.other >= 0.01) parts.push(`other ${pct(g.other)}`);
  return parts.join(" / ");
}

/**
 * Sprint 4 — render a 30-day follower delta for a handle. Returns null when
 * there's nothing to say (no snapshots yet), so the caller can skip the
 * suffix entirely. Returns "no prior snapshot" on first run, "+X / month"
 * (or "-X / month") thereafter.
 *
 * Algorithm: among snapshots for this (platform, handle) older than `now`,
 * pick the one whose age is closest to 30 days. Compare to current
 * `h.followerCount`. If no qualifying snapshot exists, emit "no prior
 * snapshot" so the agent knows the data is too fresh for a delta.
 *
 * Edge case: same-day snapshots only (operator just onboarded). The window
 * is "anything older than 7 days, prefer ~30d". 7-day floor avoids
 * meaningless delta-from-an-hour-ago noise on first-run.
 */
function renderFollowerTrend(
  handle: Doc<"creatorHandles">,
  snapshots: ReadonlyArray<FollowerSnapshot>,
  now: number
): string | null {
  if (handle.followerCount == null) return null;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const candidates = snapshots
    .filter((s) => s.platform === handle.platform && s.handle === handle.handle)
    .filter((s) => now - s.capturedAt >= SEVEN_DAYS_MS);
  if (candidates.length === 0) {
    return "no prior snapshot";
  }
  // Pick the snapshot whose age is CLOSEST to 30 days.
  const target = now - THIRTY_DAYS_MS;
  let best = candidates[0];
  let bestDist = Math.abs(best.capturedAt - target);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(c.capturedAt - target);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  const delta = handle.followerCount - best.followerCount;
  const ageDays = Math.round((now - best.capturedAt) / (24 * 60 * 60 * 1000));
  const sign = delta >= 0 ? "+" : "−";
  const magnitude = formatFollowerCount(Math.abs(delta));
  return `${sign}${magnitude} in ${ageDays}d`;
}

function renderLocation(picture: CreatorPictureExt | null): string {
  if (!picture?.locationSoul) return NOT_YET_PROVIDED;
  const { city, state, country } = picture.locationSoul;
  const parts = [city, state, country].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : NOT_YET_PROVIDED;
}

function formatFollowerCount(n: number | undefined | null): string {
  if (n == null) return "unknown";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function describeChannel(channel: Channel, _plan: Plan): string {
  switch (channel) {
    case "imessage":
      return "iMessage (rich media + tapback reactions, via Claw Messenger relay)";
    case "whatsapp":
      return "WhatsApp";
    case "sms":
      return "SMS";
    case "telegram":
      return "Telegram (rich media + inline buttons)";
    case "web":
      return "web chat (Creator HQ)";
  }
}

function describeCadence(plan: Plan): string {
  switch (plan) {
    case "coach":
      return "full daily cadence — morning brief, 2h performance pings during waking hours, evening recap, Sunday plan + review, post-publish reactions within ~10 min, brand-email triage that stops at draft. Advisory only — Maya never auto-sends, never pitches cold, never calls Apollo/Hunter.";
    case "manager":
      return "Assistant cadence + autonomous brand-deal back-and-forth — post-publish reactions within ~5 min, Apollo/Hunter cold outreach, brand pitching, auto-send under your threshold, on-demand manager-readiness packets.";
  }
}

/* -------------------------------------------------------------------------- */
/* Sprint 12 Phase 1A — integrated-picture summary + cadence                    */
/* -------------------------------------------------------------------------- */

/**
 * Sprint 12 Phase 1A — top-of-USER.md "Right now" section. Maya reads this
 * first every session and weaves the picture into her response naturally.
 *
 * The integrated facts (last post / cadence target / open commitments / etc.)
 * are surfaced as a snapshot, not as actionable rules. Maya — the brain —
 * reads target + reality and notices the gap. NO threshold logic here.
 *
 * Returns null when there's nothing to say (no picture or no anchors yet —
 * pre-onboarding-complete state).
 */
function renderRightNowSummary(
  picture: CreatorPictureExt | null
): string | null {
  if (!picture) return null;
  const dslp = (picture as unknown as { daysSinceLastPost?: number })
    .daysSinceLastPost;
  const target = picture.openingAnswers?.targetPostsPerWeek;

  // If neither the cadence anchor nor a posting timestamp exist, the
  // section would be empty — skip it.
  if (dslp === undefined && target === undefined) return null;

  const lines: string[] = ["## Right now"];
  lines.push("");
  lines.push(
    "Snapshot Maya reads first every session. I respond to what's in here, I don't run a checklist over it. When the target cadence and the actual gap are far apart, the question is obvious — I ask it the way a friend would, not the way a coach would."
  );
  lines.push("");

  if (dslp !== undefined) {
    lines.push(`- **Last post:** ${formatDaysSinceLastPost(dslp)}`);
  }
  if (target !== undefined) {
    lines.push(
      `- **Target cadence:** ${target}× per week (their answer during onboarding)`
    );
  }
  // Open commitments / pending decisions / recently completed are read off
  // the live `commitments` + `mayaActionLog` tables at runtime — Maya
  // queries them directly when she boots a session. We don't denormalize
  // them into USER.md (would go stale immediately). The header here cues
  // her to look at those signals alongside cadence.
  lines.push(
    `- **Open commitments / pending decisions / recently completed:** read live from \`commitments\` + recent \`chatMessages\` + \`brandDeals\` at session start. Surface anything there alongside this snapshot.`
  );

  return lines.join("\n");
}

/**
 * Sprint 12 Phase 1A — Cadence section. Surfaces the creator's stated target
 * + the observed reality (days-since-last-post) side by side. Maya reads the
 * gap. No "if days > N then ping" — just facts.
 *
 * Returns null when neither anchor exists (nothing to say).
 */
function renderCadenceSection(
  picture: CreatorPictureExt | null
): string | null {
  if (!picture) return null;
  const dslp = (picture as unknown as { daysSinceLastPost?: number })
    .daysSinceLastPost;
  const target = picture.openingAnswers?.targetPostsPerWeek;
  if (dslp === undefined && target === undefined) return null;

  const lines: string[] = ["## Cadence"];
  lines.push("");
  if (target !== undefined) {
    lines.push(`- **Target:** ${target}× per week (their answer)`);
  } else {
    lines.push(
      `- **Target:** _not yet provided — they didn't lock a cadence in onboarding_`
    );
  }
  if (dslp !== undefined) {
    lines.push(`- **Reality so far:** ${formatDaysSinceLastPost(dslp)}`);
  } else {
    lines.push(
      `- **Reality so far:** _no datable post timestamps yet — wait for the next pull_`
    );
  }
  return lines.join("\n");
}

/**
 * Render the days-since-last-post number as natural language. Maya prefers
 * "yesterday" / "3 days ago" / "about a month ago" / "85 days ago" depending
 * on the magnitude. We DON'T paraphrase aggressively — Maya should see the
 * actual number for her own reasoning. The natural-language framing is a
 * hint, not a mask.
 */
function formatDaysSinceLastPost(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday (1 day ago)";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return `${days} days ago (about a week back)`;
  if (days < 35) return `${days} days ago (~${Math.round(days / 7)} weeks)`;
  if (days < 90) return `${days} days ago (~${Math.round(days / 30)} months)`;
  return `${days} days ago (over 3 months)`;
}

/**
 * Format an appearance window like "(3 posts, Feb 4-13)" or "(2 posts, Feb 4)"
 * or null when no parseable dates. Used inline in the recurringElements list.
 */
function formatAppearanceWindow(
  postIds: ReadonlyArray<string>,
  dates: ReadonlyArray<string> | undefined
): string | null {
  const count = postIds.length;
  if (!dates || dates.length === 0) {
    // No date signal — fall back to count-only.
    return count > 0 ? `${count} posts` : null;
  }
  const sortedIso = [...dates].sort();
  const first = sortedIso[0];
  const last = sortedIso[sortedIso.length - 1];
  const firstHuman = humanShortDate(first);
  const lastHuman = humanShortDate(last);
  if (!firstHuman) return `${count} posts`;
  if (first === last || !lastHuman) {
    return `${count} posts, ${firstHuman}`;
  }
  return `${count} posts, ${firstHuman}–${lastHuman}`;
}

/**
 * Format an inline date prefix for a warmth-material entry like
 * "Feb 4 — " (returned with trailing whitespace included for direct
 * concatenation). Returns "" when no dates available so the prefix slot
 * disappears cleanly.
 */
function formatWarmthDatePrefix(
  dates: ReadonlyArray<string> | undefined
): string {
  if (!dates || dates.length === 0) return "";
  // Always use the first cited post's date — the warmth line speaks to
  // a specific moment, and the first citation is the canonical anchor.
  const human = humanShortDate(dates[0]);
  return human ? ` ${human} —` : "";
}

/**
 * Convert "YYYY-MM-DD" → "Feb 4". Returns null when the input doesn't
 * parse (defensive — synth validators reject malformed dates upstream,
 * but we tolerate a stray bad string rather than crashing USER.md).
 */
function humanShortDate(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isFinite(day) ||
    day < 1 ||
    day > 31
  )
    return null;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${MONTHS[month - 1]} ${day}`;
}
