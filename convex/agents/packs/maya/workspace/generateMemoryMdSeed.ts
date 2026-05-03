/**
 * generateMemoryMdSeed — initial MEMORY.md seed for a fresh Maya workspace.
 *
 * Sprint 3.7 phase A. OpenClaw owns mutation of MEMORY.md after first
 * boot — via dreaming, the `memory-core` plugin, and direct agent edits.
 * We seed structured anchor sections with `<!-- section:NAME:start -->` /
 * `<!-- section:NAME:end -->` comments so OpenClaw's edit tool has
 * deterministic targets for in-place section rewrites.
 *
 * Per OpenClaw spec, MEMORY.md is "Author"-owned for the initial seed,
 * "Runtime"-owned thereafter. The seed is the only thing this generator
 * produces; runtime mutation is out of scope.
 *
 * `now` is captured into the `created` field as the only non-deterministic
 * element; the caller pins it for tests.
 */

import type { Doc } from "../../../../_generated/dataModel";
import { NOT_YET_PROVIDED, type CreatorPictureExt } from "./types";

export interface MemoryMdSeedInputs {
  creator: Doc<"creators">;
  picture: CreatorPictureExt | null;
  handles: ReadonlyArray<Doc<"creatorHandles">>;
  now: number;
}

export function generateMemoryMdSeed(inputs: MemoryMdSeedInputs): string {
  const { creator, picture, handles, now } = inputs;

  const primaryPlatforms = handles.length
    ? [...new Set(handles.map((h) => h.platform))].sort().join(", ")
    : NOT_YET_PROVIDED;
  const followerCount = sumFollowers(handles);
  const niche = picture?.niche ?? NOT_YET_PROVIDED;
  const monthlyRevenue =
    picture?.monthlyRevenueUsd != null
      ? `~$${picture.monthlyRevenueUsd.toLocaleString("en-US")} / month`
      : NOT_YET_PROVIDED;
  const brandFloor = "see SOUL.md § brand-deal floor"; // populated by Sprint 2 generateSoul

  const voiceAnchors = renderVoiceAnchors(picture);
  const audienceAnchors = renderAudienceAnchors(picture);

  return [
    "# MEMORY.md",
    "",
    `Curated long-term memory for Maya. Initial seed produced at workspace bootstrap (\`created: ${now}\`). OpenClaw mutates this file after first boot via dreaming + agent edits — section anchors below are the deterministic edit targets.`,
    "",
    "<!-- section:business_facts:start -->",
    "## Business facts",
    "",
    `- **Niche:** ${niche}`,
    `- **Primary platforms:** ${primaryPlatforms}`,
    `- **Total follower count (sum across handles):** ${followerCount}`,
    `- **Monthly revenue (rough):** ${monthlyRevenue}`,
    `- **Brand-deal floor:** ${brandFloor}`,
    "<!-- section:business_facts:end -->",
    "",
    "<!-- section:voice_anchors:start -->",
    "## Voice anchors",
    "",
    voiceAnchors,
    "<!-- section:voice_anchors:end -->",
    "",
    "<!-- section:audience_anchors:start -->",
    "## Audience anchors",
    "",
    audienceAnchors,
    "<!-- section:audience_anchors:end -->",
    "",
    "<!-- section:brand_deal_posture:start -->",
    "## Brand-deal posture",
    "",
    `- **Exclusivity comfort:** ${NOT_YET_PROVIDED}`,
    `- **FTC disclosure preferences:** default to \`#ad\` in caption + verbal disclosure in first 3 seconds of video unless creator says otherwise.`,
    `- **Categories the creator declines outright:** ${NOT_YET_PROVIDED}`,
    "<!-- section:brand_deal_posture:end -->",
    "",
    "<!-- section:open_commitments:start -->",
    "## Open commitments",
    "",
    "_(none yet — Maya appends here as commitments accumulate; entries are removed when followed-through.)_",
    "<!-- section:open_commitments:end -->",
    "",
    "---",
    "",
    `_Seed created at unix ms ${now}. Email: ${creator.email}._`,
    "",
  ].join("\n");
}

function sumFollowers(handles: ReadonlyArray<Doc<"creatorHandles">>): string {
  let total = 0;
  let any = false;
  for (const h of handles) {
    if (h.followerCount != null) {
      total += h.followerCount;
      any = true;
    }
  }
  if (!any) return NOT_YET_PROVIDED;
  if (total < 1_000) return String(total);
  if (total < 1_000_000) return `${(total / 1_000).toFixed(1)}K`;
  return `${(total / 1_000_000).toFixed(2)}M`;
}

function renderVoiceAnchors(picture: CreatorPictureExt | null): string {
  if (!picture || !picture.voiceFingerprint) {
    return `- _${NOT_YET_PROVIDED}_`;
  }
  // voiceFingerprint is a freeform string in the schema (Sprint 2 generator
  // produces structured signature phrases). For the seed we extract the
  // first 3 sentences as a bootstrap proxy.
  const sentences = picture.voiceFingerprint
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (sentences.length === 0) return `- _${NOT_YET_PROVIDED}_`;
  return sentences.map((s) => `- ${s}`).join("\n");
}

function renderAudienceAnchors(picture: CreatorPictureExt | null): string {
  if (!picture || picture.audience.interestTags.length === 0) {
    return `- _${NOT_YET_PROVIDED}_`;
  }
  return picture.audience.interestTags
    .slice(0, 3)
    .map((t) => `- ${t}`)
    .join("\n");
}
