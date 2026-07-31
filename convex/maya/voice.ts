/**
 * Voice from edits (§6.1, source 4) — the sharpest signal there is.
 *
 * > The diff between what she wrote and what they actually sent is
 * > unambiguous, high-density training data. Feed the last N edits back as
 * > few-shot examples on every Write and Critique call.
 *
 * Five sources feed the voice profile; two of them are free and continuous,
 * and both are handled here:
 *
 *   **Source 4 — their edits.** Highest signal per token. An edit is a
 *   correction with no ambiguity about whether it's a correction.
 *
 *   **Source 2 — their Telegram messages to Maya.** Free, already stored, and
 *   never stops growing. Every message the founder types is an authentic,
 *   unedited sample from exactly the person she's imitating. §6.1 notes that
 *   nobody uses this; it costs nothing because the rows already exist.
 *
 * ## What this module does and doesn't decide
 *
 * It extracts *observations* — deterministic, countable facts about what
 * changed. It does NOT decide what they mean. "They removed three em-dashes"
 * is a fact; "they dislike em-dashes" is a judgment that needs more than one
 * edit behind it, which is why `neverSaysCandidates` requires repetition
 * before promoting anything.
 *
 * One edit is an edit. Three of the same edit is a rule.
 */

/* -------------------------------------------------------------------------- */
/* Observations from a single edit                                             */
/* -------------------------------------------------------------------------- */

export interface EditSignals {
  /** Negative = they cut it down. Characters. */
  lengthDelta: number;
  /** They cut more than a third — a rhythm signal, not just a trim. */
  substantiallyShortened: boolean;
  /** Phrases present before and gone after. `neverSays` candidates. */
  removedPhrases: string[];
  /** Phrases they added. Vocabulary they actually use. */
  addedPhrases: string[];
  /** Punctuation they stripped out, by character. */
  removedPunctuation: string[];
  /** True when they took the emoji out. */
  removedEmoji: boolean;
  /** True when they lowercased an opener she capitalized. */
  loweredOpener: boolean;
}

const PUNCTUATION_OF_INTEREST = ["—", "!", ";", "…", "?"] as const;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** Content words, lowercased. Short words carry no voice information. */
function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []);
}

function countChar(text: string, char: string): number {
  return text.split(char).length - 1;
}

/**
 * What one edit tells us.
 *
 * Deliberately word-level rather than character-level: a character diff of
 * prose produces noise ("the" moved), while a set difference over content
 * words produces the two things worth knowing — what they refused to say, and
 * what they said instead.
 */
export function diffSignals(before: string, after: string): EditSignals {
  const beforeWords = new Set(contentWords(before));
  const afterWords = new Set(contentWords(after));

  const removedPhrases = [...beforeWords].filter((w) => !afterWords.has(w)).sort();
  const addedPhrases = [...afterWords].filter((w) => !beforeWords.has(w)).sort();

  const removedPunctuation = PUNCTUATION_OF_INTEREST.filter(
    (char) => countChar(before, char) > countChar(after, char)
  );

  const lengthDelta = after.length - before.length;

  const firstBefore = before.trimStart()[0] ?? "";
  const firstAfter = after.trimStart()[0] ?? "";

  return {
    lengthDelta,
    // A third is the line between "tightened a sentence" and "this was too
    // long" — the latter is a durable fact about their rhythm.
    substantiallyShortened:
      before.length > 0 && lengthDelta < 0 && Math.abs(lengthDelta) / before.length > 0.33,
    removedPhrases,
    addedPhrases,
    removedPunctuation: [...removedPunctuation],
    removedEmoji: EMOJI.test(before) && !EMOJI.test(after),
    loweredOpener:
      firstBefore !== "" &&
      firstBefore === firstBefore.toUpperCase() &&
      firstBefore.toLowerCase() === firstAfter &&
      firstAfter !== "",
  };
}

/* -------------------------------------------------------------------------- */
/* Promoting observations into rules                                           */
/* -------------------------------------------------------------------------- */

/** How many times a phrase must be cut before it becomes a rule. */
export const NEVER_SAYS_THRESHOLD = 3;

export interface VoiceObservations {
  /** Phrases cut often enough to be a rule, most-cut first. */
  neverSaysCandidates: Array<{ phrase: string; timesRemoved: number }>;
  /** Punctuation they consistently strip. */
  dislikedPunctuation: string[];
  /** They cut length more often than they add it. */
  prefersShorter: boolean;
  /** They take emoji out more often than they leave them. */
  dislikesEmoji: boolean;
  /** Sample size behind all of the above. */
  editsSeen: number;
}

/**
 * Fold many edits into observations that are safe to act on.
 *
 * The threshold is the whole point. Promoting a phrase after one removal turns
 * an ordinary rewrite into a permanent ban, and a `neverSays` list built that
 * way gets long, wrong, and unfalsifiable — every future draft quietly
 * constrained by a decision nobody made. One edit is an edit; three of the
 * same edit is a rule.
 */
export function foldEdits(
  edits: ReadonlyArray<{ before: string; after: string }>
): VoiceObservations {
  const removalCounts = new Map<string, number>();
  const punctuationCounts = new Map<string, number>();
  let shortened = 0;
  let lengthened = 0;
  let emojiRemoved = 0;
  let emojiKept = 0;

  for (const edit of edits) {
    const signals = diffSignals(edit.before, edit.after);
    for (const phrase of signals.removedPhrases) {
      removalCounts.set(phrase, (removalCounts.get(phrase) ?? 0) + 1);
    }
    for (const punctuation of signals.removedPunctuation) {
      punctuationCounts.set(
        punctuation,
        (punctuationCounts.get(punctuation) ?? 0) + 1
      );
    }
    if (signals.lengthDelta < 0) shortened += 1;
    if (signals.lengthDelta > 0) lengthened += 1;
    if (signals.removedEmoji) emojiRemoved += 1;
    else if (EMOJI.test(edit.after)) emojiKept += 1;
  }

  const neverSaysCandidates = [...removalCounts.entries()]
    .filter(([, count]) => count >= NEVER_SAYS_THRESHOLD)
    .map(([phrase, timesRemoved]) => ({ phrase, timesRemoved }))
    .sort(
      (a, b) => b.timesRemoved - a.timesRemoved || a.phrase.localeCompare(b.phrase)
    );

  return {
    neverSaysCandidates,
    dislikedPunctuation: [...punctuationCounts.entries()]
      .filter(([, count]) => count >= NEVER_SAYS_THRESHOLD)
      .map(([char]) => char)
      .sort(),
    prefersShorter: shortened > lengthened,
    dislikesEmoji: emojiRemoved > emojiKept && emojiRemoved > 0,
    editsSeen: edits.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Few-shot material                                                           */
/* -------------------------------------------------------------------------- */

export interface FewShotExample {
  before: string;
  after: string;
}

/**
 * The last N edits, newest first, as few-shot examples for Write and Critique.
 *
 * Newest first because voice drifts and the recent correction is the one that
 * still applies. Edits where nothing actually changed are dropped — a no-op
 * pair teaches nothing and spends context, and the workspace prompt budget has
 * historically sat at zero headroom.
 */
export function buildFewShot(
  edits: ReadonlyArray<{ before: string; after: string; decidedAt: number }>,
  limit = 10
): FewShotExample[] {
  return [...edits]
    .filter((e) => e.before.trim() !== e.after.trim())
    .sort((a, b) => b.decidedAt - a.decidedAt)
    .slice(0, limit)
    .map(({ before, after }) => ({ before, after }));
}

/**
 * Voice excerpts from the founder's own messages (§6.1, source 2).
 *
 * Free, already stored, and growing. Filters to substantive inbound messages:
 * "ok", "yes", "post it" are approvals, not writing samples, and a corpus full
 * of them teaches her to write like a switch.
 */
export function corpusFromMessages(
  messages: ReadonlyArray<{ direction: string; body: string; ts: number }>,
  limit = 20
): string[] {
  return messages
    .filter((m) => m.direction === "in")
    .filter((m) => contentWords(m.body).length >= 5)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((m) => m.body);
}
