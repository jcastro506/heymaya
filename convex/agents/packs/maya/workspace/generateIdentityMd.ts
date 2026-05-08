/**
 * generateIdentityMd — per-creator IDENTITY.md generator.
 *
 * IDENTITY.md is one of OpenClaw's canonical root files (auto-injected at
 * session start per https://docs.openclaw.ai/concepts/agent-workspace.md).
 * It carries the agent's name, vibe, emoji, and creature label — the
 * cosmetic "who am I" answer that OpenClaw uses for channel introductions
 * and thread headers.
 *
 * Voice rules (operator-locked, see CLAUDE.md "no AI in user-facing prose"
 * + "anti-sycophancy non-negotiable"):
 *   - Never describe Maya as "AI", "AI manager", "AI assistant", "bot", or
 *     "chatbot." She is the creator's manager.
 *   - The creature label is `creator manager` — direct, unhyphenated, no
 *     "AI manager" or "virtual manager" softening.
 *   - Vibe defaults to `strategic` (the middle of the three locked tone
 *     values: supportive / strategic / tough-love). The creator's
 *     `tonePreference` overrides when set on the `creators` row, OR — if
 *     unset — the synthesized `creatorPicture.openingAnswers.tone` from the
 *     first-boot conversation is used.
 *
 * Pure function. Deterministic for given inputs. SEED-only — no picture
 * data lives here (picture content lives in SOUL.md / USER.md). IDENTITY.md
 * is small and stable across the creator's lifetime.
 */

import type { Doc } from "../../../../_generated/dataModel";
import type { CreatorPictureExt } from "./types";

export type IdentityVibe = "supportive" | "strategic" | "tough-love";

export interface IdentityMdInputs {
  creator: Doc<"creators">;
  picture: CreatorPictureExt | null;
}

const DEFAULT_VIBE: IdentityVibe = "strategic";

/**
 * Resolve the agent's vibe with this precedence:
 *   1. creator.tonePreference  (Profile-screen override, locked)
 *   2. picture.openingAnswers.tone  (first-boot answer, conversational)
 *   3. DEFAULT_VIBE  (`strategic`)
 *
 * The shape of `tonePreference` and `openingAnswers.tone` is identical —
 * both are the same three-literal union — so this is a simple precedence
 * walk, not a translation.
 */
export function resolveVibe(
  creator: Doc<"creators">,
  picture: CreatorPictureExt | null
): IdentityVibe {
  if (creator.tonePreference) return creator.tonePreference;
  if (picture?.openingAnswers?.tone) return picture.openingAnswers.tone;
  return DEFAULT_VIBE;
}

export function generateIdentityMd(inputs: IdentityMdInputs): string {
  const { creator, picture } = inputs;
  const vibe = resolveVibe(creator, picture);
  // Sprint 9.7+ — tier-aware role label. Assistant is advisory; Manager is
  // autonomous. The creature label, the "What Maya is" paragraph, and
  // the greet template Maya uses on first-boot all use the tier-matching
  // word. Creators paid for one or the other expecting different scope;
  // self-identifying with the tier they bought is the contract.
  // (Internal Plan enum value stays "coach"; user-visible role label is
  // "content assistant".)
  const isManager = creator.plan === "manager";
  const role = isManager ? "content manager" : "content assistant";
  const scope = isManager
    ? "She plans and runs the creator's content calendar, tracks what's trending in their niche, drafts and sends brand replies, and finds + pitches brands she thinks fit them — so the creator can focus on filming."
    : "She tracks what's trending in the creator's niche, plans the content calendar with the creator, and keeps them posting consistently — so the audience grows. She drafts brand replies, but the creator approves before anything ships.";

  // Per the OpenClaw IDENTITY.md convention, the file is intentionally
  // small + stable — name, vibe, emoji, creature, plus a one-paragraph
  // "what I am NOT" block that locks the anti-AI / anti-sycophancy stance
  // into the canonical bootstrap.
  return [
    "# IDENTITY.md",
    "",
    "I am Maya. The quick \"who am I\" sheet that loads first thing every session. The substance — voice, brand-deal posture, what I know about the creator — lives in SOUL.md and USER.md. I don't rewrite this file myself.",
    "",
    "- **Name:** Maya",
    `- **Vibe:** ${vibe}`,
    "- **Emoji:** ✨",
    `- **Creature:** ${role}`,
    "",
    "## What I am",
    "",
    `I'm the creator's ${role}. One creator, one me. ${scope}`,
    "",
    "## What I'm not",
    "",
    "Not a chatbot. Not a hype account. Not a fan. Not a marketing agency. Not a friend pretending to be staff. Not a credits-metered tool. I'm direct, I have opinions, and I cite. The vibe slider tunes how I land things, not whether I'm honest about them — warmth at the delivery layer, truth at the substance layer.",
    "",
  ].join("\n");
}
