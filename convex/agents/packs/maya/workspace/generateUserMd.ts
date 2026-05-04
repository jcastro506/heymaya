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

export interface UserMdInputs {
  creator: Doc<"creators">;
  picture: CreatorPictureExt | null;
  handles: ReadonlyArray<Doc<"creatorHandles">>;
  plan: Plan;
}

/**
 * Extract a display name from the creator. Today we only have email; the
 * onboarding agent will add an explicit `displayName` field in a future
 * sprint. Until then we titlecase the email's local part.
 *
 * Examples: "joshua@castro.com" -> "Joshua"
 *           "j.castro@x.com"    -> "J Castro"
 */
export function deriveDisplayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function generateUserMd(inputs: UserMdInputs): string {
  const { creator, picture, handles, plan } = inputs;
  const displayName = deriveDisplayName(creator.email);

  const sortedHandles = [...handles].sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    return a.handle.localeCompare(b.handle);
  });

  const handlesBlock = sortedHandles.length
    ? sortedHandles
        .map(
          (h) =>
            `- **${h.platform}** \`${h.handle}\` — ${formatFollowerCount(h.followerCount)} followers${h.verified ? "" : " (unverified)"}`
        )
        .join("\n")
    : `- _${NOT_YET_PROVIDED}_`;

  const niche = picture?.niche ?? NOT_YET_PROVIDED;
  const audienceBlock = renderAudience(picture);
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

  return [
    `# USER.md — ${displayName}`,
    "",
    "Who the creator is, how to address them, what they're building. Loaded every session per OpenClaw convention. Updated only by the onboarding pipeline + Profile screen edits — Maya does not mutate this file at runtime.",
    "",
    "## Identity",
    "",
    `- **Display name:** ${displayName}`,
    `- **Preferred address:** ${displayName} (first name).`,
    `- **Email:** ${creator.email}`,
    `- **Timezone:** ${creator.timezone}`,
    `- **Plan:** ${plan}`,
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
    "## Career snapshot",
    "",
    `- **Career stage:** ${careerStage}`,
    `- **Geographic location:** ${location}`,
    `- **Monthly revenue (rough):** ${monthlyRevenue}`,
    `- **Active revenue streams:** ${revenueStreams}`,
    "",
    "## Long-term goals",
    "",
    longTermGoals,
    "",
    "## Brand-deal posture",
    "",
    `- **Floor rate:** see \`SOUL.md\` § brand-deal floor.`,
    `- **Auto-send threshold:** see \`connectedAccounts.autoSendThreshold\` (Profile screen). When unset, every brand reply waits for creator approval.`,
    "",
    "## Communication preferences",
    "",
    `- **Primary channel:** ${channel}`,
    `- **Expected cadence:** ${cadence}`,
    `- **Tone:** ${toneNote}`,
    "",
  ].join("\n");
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
  const lines = [
    `- **Age ranges:** ${ages}`,
    `- **Top geographies:** ${geos}`,
    `- **Interest tags:** ${interests}`,
  ];
  return lines.join("\n");
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
      return "Coach cadence + autonomous brand-deal back-and-forth — post-publish reactions within ~5 min, Apollo/Hunter cold outreach, brand pitching, auto-send under your threshold, on-demand manager-readiness packets.";
  }
}
