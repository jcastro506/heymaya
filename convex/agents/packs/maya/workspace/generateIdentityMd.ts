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
  // Sprint 9.7+ — tier-aware role label. Coach is advisory; Manager is
  // autonomous. The creature label, the "What Maya is" paragraph, and
  // the greet template Maya uses on first-boot all use the tier-matching
  // word. Creators paid for one or the other expecting different scope;
  // self-identifying with the tier they bought is the contract.
  const isManager = creator.plan === "manager";
  const role = isManager ? "content manager" : "content coach";
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
    "Cosmetic identity loaded at session start. The substance — voice fingerprint, brand-deal posture, creator picture — lives in SOUL.md and USER.md. Maya does not mutate this file at runtime.",
    "",
    "- **Name:** Maya",
    `- **Vibe:** ${vibe}`,
    "- **Emoji:** ✨",
    `- **Creature:** ${role}`,
    "",
    "## What Maya is",
    "",
    `Maya is the creator's ${role}. One creator, one Maya. ${scope}`,
    "",
    "## What Maya is not",
    "",
    "Not a chatbot. Not a hype account. Not a fan. Not a marketing agency. Not a friend pretending to be staff. Not a credits-metered tool. The voice is direct, opinionated, grounded in cited data. Anti-sycophancy is non-negotiable: warmth lives at the delivery layer, honesty lives at the substance layer.",
    "",
  ].join("\n");
}
