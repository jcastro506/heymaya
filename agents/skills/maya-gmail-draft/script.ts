/**
 * maya-gmail-draft — pure-logic draft prompt + validator helpers.
 *
 * Sprint 7 Slice A. This script is pure: no Convex imports, no network. It
 * is called from Convex actions (which wrap `convex/integrations/composio/
 * actions/gmail.ts` createDraft / updateDraft) and from skill-bundle tests
 * directly.
 *
 * HARD RULE (MVP): this skill never produces a path that auto-sends email.
 * `runtimeGuard("send")` throws. The Convex action that consumes this skill
 * calls `createDraft` / `updateDraft` only — never `sendEmail`. The creator
 * approves a draft over iMessage; they then send it manually from Gmail.
 *
 * Three responsibilities:
 *   1. Build a single-tone draft prompt (`buildDraftPrompt`)
 *   2. Build all four tone variants in parallel (`buildAllFourVariants`)
 *   3. Validate a generated draft against banned voice terms, voice-anchor
 *      overlap, the first-contact ≤120-word cap, and auto-send hint
 *      phrases (`validateDraft`)
 *
 * Plus the runtime guard that backstops the "never auto-send" rule.
 */

import type { GmailThread } from "../maya-gmail-read/script";

export type { GmailThread };

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type ReplyTone =
  | "soft-accept"
  | "hold-for-info"
  | "decline-politely"
  | "ask-for-deck";

export const REPLY_TONES: ReadonlyArray<ReplyTone> = [
  "soft-accept",
  "hold-for-info",
  "decline-politely",
  "ask-for-deck",
];

export interface CreatorPicture {
  readonly niche: string;
  readonly voiceFingerprint: string;
  /** Soul-extracted tone preference. */
  readonly tonePreference?: "supportive" | "strategic" | "tough-love";
  /** Per-creator banned phrases — added to the global banned list. */
  readonly bannedPhrases?: ReadonlyArray<string>;
  /** When true, enforce the ≤120-word cap for first-contact replies. */
  readonly firstContact?: boolean;
}

export interface BuildDraftPromptArgs {
  readonly thread: GmailThread;
  readonly picture: CreatorPicture;
  readonly replyTone: ReplyTone;
}

export interface ValidateDraftResult {
  readonly ok: boolean;
  readonly reasons?: ReadonlyArray<string>;
}

export type RuntimeIntent = "draft" | "send";

/* -------------------------------------------------------------------------- */
/* runtimeGuard — the hard rule's mechanical enforcement                       */
/* -------------------------------------------------------------------------- */

/**
 * Throws iff `intent === "send"`. The Convex action that wraps this skill
 * calls `runtimeGuard("draft")` at the top of its handler — the throw is
 * the safety net for a future slice that forgets the rule.
 */
export function runtimeGuard(intent: RuntimeIntent): void {
  if (intent === "send") {
    throw new Error(
      "maya-gmail-draft: MVP does not auto-send. Pass intent='draft' instead."
    );
  }
  if (intent !== "draft") {
    throw new Error(
      `maya-gmail-draft: unknown intent '${String(intent)}'. Pass intent='draft'.`
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Banned voice terms                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Phrases that violate the anti-sycophancy + grounded-or-silent rules
 * the platform playbook enforces. Matched case-insensitively as
 * substrings — these are user-visible prose, so partial-word matches are
 * fine.
 */
const GLOBAL_BANNED_PHRASES: ReadonlyArray<string> = [
  "loved your content",
  "love your content",
  "i love this opportunity",
  "i think you're amazing",
  "huge fan of your work",
  "huge fan of you",
  "absolutely love",
  "i'd be honored",
  "i would be honored",
  "thrilled to be considered",
  // marketing-banned token (operator-stated rule — no "AI" in user-facing prose)
  // — matched as a whole token elsewhere; left out of substring list to avoid
  // tripping on words like "fail" or "claim".
];

const AUTO_SEND_HINT_PHRASES: ReadonlyArray<string> = [
  "i'll send this now",
  "sent on your behalf",
  "sending this for you",
  "let me send this",
  "sent this for you",
  "i just sent",
  "i've sent",
  "ill send this",
  "i sent this on your behalf",
];

/* -------------------------------------------------------------------------- */
/* buildDraftPrompt                                                            */
/* -------------------------------------------------------------------------- */

const TONE_INSTRUCTIONS: Record<ReplyTone, string> = {
  "soft-accept":
    "Lean toward yes, but keep it conditional on rate + deliverable details. Do NOT commit to a specific number.",
  "hold-for-info":
    "Buy time without committing. Acknowledge receipt, ask one specific question that unlocks a real decision.",
  "decline-politely":
    "Decline cleanly. No long apology, no door-left-open language unless it is genuinely true. One sentence on the why if appropriate.",
  "ask-for-deck":
    "Ask for the campaign brief / deck / one-pager before any rate conversation. Specific about what you need.",
};

const TONE_HEADERS: Record<ReplyTone, string> = {
  "soft-accept": "TONE: soft-accept (lean yes, conditional)",
  "hold-for-info": "TONE: hold-for-info (buy time, one question)",
  "decline-politely": "TONE: decline-politely (clean no)",
  "ask-for-deck": "TONE: ask-for-deck (request the brief)",
};

export function buildDraftPrompt(args: BuildDraftPromptArgs): string {
  const { thread, picture, replyTone } = args;
  if (!REPLY_TONES.includes(replyTone)) {
    throw new Error(`buildDraftPrompt: unknown replyTone '${replyTone}'`);
  }

  const senderLabel = thread.from.name?.trim() || thread.from.email;
  const wordCap = picture.firstContact ? 120 : 200;

  const lines: string[] = [];
  lines.push(TONE_HEADERS[replyTone]);
  lines.push("");
  lines.push("You are drafting a reply on behalf of a creator to a brand inbound.");
  lines.push("Output ONLY the reply body — no subject line, no greeting metadata,");
  lines.push("no commentary. Plain text. The creator will paste-edit before sending.");
  lines.push("");
  lines.push("Hard rules:");
  lines.push(
    "- Anti-sycophancy: NO 'loved your content', 'huge fan', 'I'd be honored',"
  );
  lines.push(
    "  'absolutely love'. The reply earns the relationship; it does not flatter."
  );
  lines.push(
    "- Grounded or silent: do not assert any fact about the brand, the offer,"
  );
  lines.push(
    "  or the creator's own work that is not in the thread or the voice anchors below."
  );
  lines.push(
    "- NEVER write 'I'll send this now', 'sending this on your behalf', or any"
  );
  lines.push(
    "  phrase that suggests the reply has already been sent. The creator sends manually."
  );
  lines.push(`- Length: ≤${wordCap} words for the body. First contact stays tight.`);
  lines.push(
    "- Voice: thread at least one phrase that overlaps with the voice fingerprint"
  );
  lines.push(
    "  below — the creator's voice has to be detectable in the draft."
  );
  lines.push("");
  lines.push(`Tone instruction: ${TONE_INSTRUCTIONS[replyTone]}`);
  if (picture.tonePreference) {
    lines.push(`Creator's standing tone preference: ${picture.tonePreference}`);
  }
  lines.push("");
  lines.push("Inbound thread context (this is the only ground truth):");
  lines.push(`- From: ${senderLabel} <${thread.from.email}> (${thread.from.domain})`);
  lines.push(`- Subject: ${thread.subject}`);
  lines.push(`- Body:`);
  lines.push("```");
  lines.push(thread.bodyText);
  lines.push("```");
  lines.push("");
  lines.push("Voice anchors (cite at least one in the draft):");
  lines.push(`- Niche: ${picture.niche}`);
  lines.push(`- Voice fingerprint: ${picture.voiceFingerprint}`);
  if (picture.bannedPhrases && picture.bannedPhrases.length > 0) {
    lines.push("");
    lines.push("Per-creator banned phrases (do not use):");
    for (const p of picture.bannedPhrases) {
      lines.push(`- ${p}`);
    }
  }
  lines.push("");
  lines.push("Output the reply body now. Body only.");

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* buildAllFourVariants                                                        */
/* -------------------------------------------------------------------------- */

export type AllVariantsArgs = Omit<BuildDraftPromptArgs, "replyTone">;

export type AllVariantsResult = Record<ReplyTone, string>;

/**
 * Convenience wrapper that builds prompts for all four tones in parallel.
 * Each builder is synchronous, but the wrapper returns a Promise so the
 * call site shape matches the runtime path (where the prompts may, in a
 * future slice, be assembled with async voice-fingerprint resolution).
 */
export async function buildAllFourVariants(
  args: AllVariantsArgs
): Promise<AllVariantsResult> {
  const [softAccept, holdForInfo, declinePolitely, askForDeck] = await Promise.all([
    Promise.resolve(buildDraftPrompt({ ...args, replyTone: "soft-accept" })),
    Promise.resolve(buildDraftPrompt({ ...args, replyTone: "hold-for-info" })),
    Promise.resolve(buildDraftPrompt({ ...args, replyTone: "decline-politely" })),
    Promise.resolve(buildDraftPrompt({ ...args, replyTone: "ask-for-deck" })),
  ]);
  return {
    "soft-accept": softAccept,
    "hold-for-info": holdForInfo,
    "decline-politely": declinePolitely,
    "ask-for-deck": askForDeck,
  };
}

/* -------------------------------------------------------------------------- */
/* validateDraft                                                               */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "but",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "i",
  "we",
  "you",
  "they",
  "it",
  "this",
  "that",
  "with",
  "from",
  "your",
  "my",
  "our",
  "their",
  "his",
  "her",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    // Strip surrounding quote-apostrophes ('word' → word) but keep
    // contractions intact (don't, you're, what's).
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function hasBannedPhrase(
  draftLower: string,
  phrases: ReadonlyArray<string>
): string | null {
  for (const p of phrases) {
    const norm = p.trim().toLowerCase();
    if (norm.length === 0) continue;
    if (draftLower.includes(norm)) return p;
  }
  return null;
}

const AI_TOKEN_RE = /\bAI\b/;

export function validateDraft(
  draft: string,
  picture: CreatorPicture
): ValidateDraftResult {
  const reasons: string[] = [];
  if (typeof draft !== "string" || draft.trim().length === 0) {
    return { ok: false, reasons: ["empty draft"] };
  }
  const draftLower = draft.toLowerCase();

  // 1. Global + per-creator banned phrases
  const globalHit = hasBannedPhrase(draftLower, GLOBAL_BANNED_PHRASES);
  if (globalHit) {
    reasons.push(`banned voice term: "${globalHit}"`);
  }
  if (picture.bannedPhrases && picture.bannedPhrases.length > 0) {
    const perCreatorHit = hasBannedPhrase(draftLower, picture.bannedPhrases);
    if (perCreatorHit) {
      reasons.push(`per-creator banned phrase: "${perCreatorHit}"`);
    }
  }

  // 2. Auto-send hint phrases — these would mislead the creator into
  //    thinking Maya already sent something. Banned hard.
  const autoSendHit = hasBannedPhrase(draftLower, AUTO_SEND_HINT_PHRASES);
  if (autoSendHit) {
    reasons.push(`auto-send hint phrase: "${autoSendHit}"`);
  }

  // 3. The marketing-banned "AI" token (operator-stated rule). Matched as a
  //    whole-token regex so it doesn't trip on "claim", "fail", etc.
  if (AI_TOKEN_RE.test(draft)) {
    reasons.push("banned token: 'AI' must not appear in user-facing prose");
  }

  // 4. Voice anchor overlap — the draft must share at least one
  //    multi-character non-stopword token with the voice fingerprint.
  const voiceTokens = new Set(tokenize(picture.voiceFingerprint));
  const draftTokens = new Set(tokenize(draft));
  let overlap = 0;
  for (const t of draftTokens) {
    if (voiceTokens.has(t)) {
      overlap++;
      if (overlap >= 1) break;
    }
  }
  if (voiceTokens.size > 0 && overlap === 0) {
    reasons.push("no voice anchor overlap with voiceFingerprint");
  }

  // 5. First-contact length cap — ≤120 words for first contact replies.
  if (picture.firstContact === true) {
    const wc = countWords(draft);
    if (wc > 120) {
      reasons.push(`first-contact length cap exceeded (${wc} > 120 words)`);
    }
  }

  if (reasons.length === 0) return { ok: true };
  return { ok: false, reasons };
}
