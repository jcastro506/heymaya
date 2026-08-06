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
 * Free, already stored, and growing.
 *
 * ## Superseded `corpusFromMessages`
 *
 * That took the most recent N by content-word count. This adds two things it
 * lacked, and both are load-bearing:
 *
 * **An explicit instruction filter.** *"post it"*, *"yes"*, *"go ahead"* are
 * how they operate the product; a corpus of those teaches her to write like a
 * remote control. Matched in FULL rather than by substring, so *"yes but make
 * it way shorter, the last one read like a press release"* still counts —
 * those are the most useful samples there are.
 *
 * **Spread across days.** §7.5.2: *variance is where humanity hides.* Twelve
 * samples from one afternoon capture one mood, and a corpus that is all one
 * register teaches exactly the flatness the anti-slop system exists to
 * prevent. Recency-sorting produces precisely that.
 */

/** Below this it's an instruction or an acknowledgement, not writing. */
export const MIN_SAMPLE_CHARS = 40;
/** Above this they're pasting something, usually not their own prose. */
export const MAX_SAMPLE_CHARS = 600;
/** What SOUL.md carries. Ten real sentences is the spec's own number. */
export const MAX_EXCERPTS = 12;

const PURE_INSTRUCTIONS = new Set([
  "post it", "post", "yes", "no", "yep", "nope", "go", "go ahead", "do it",
  "skip", "skip it", "ok", "okay", "sure", "sounds good", "approved",
  "approve", "reject", "stop", "pause", "resume", "thanks", "thank you",
  "perfect", "nice", "great", "cool", "hold off", "not yet", "later",
]);

/**
 * ⭐ The judge that decides what is actually their VOICE.
 *
 * `isVoiceSample` below is a pre-filter, not the decision. It removes "ok" and
 * "post it" for free, and it cannot tell an instruction from a sentence — a
 * long, well-punctuated *"do the daily placement now, take the strongest thing
 * from this morning's scroll and publish it to X"* passes every rule in it.
 *
 * That distinction is semantic, so the model makes it.
 */
export const VOICE_JUDGE_SYSTEM = `You are given messages a founder sent to their social media manager.

Some are them TALKING TO HER about her work — instructions, questions about what she did, approvals, corrections. Some are them SAYING SOMETHING — explaining, objecting, describing, complaining, telling a story, making a point.

Only the second kind is a voice sample. We are learning how this person writes to an audience, and someone giving instructions to an assistant writes nothing like they do to their customers.

Return STRICT JSON, no prose:
{ "keep": [0, 3, 7] }

"keep" is the INDEX of every message that is the second kind. Judge each one on its own.

Keep it if they are expressing a thought, an opinion, a frustration, a story, or an explanation — even a short one, and even if it also contains an instruction.
Drop it if it is only about what she should do, what she did, or whether something worked. A question about her work is not a voice sample no matter how well written.

If none qualify, return an empty array. That is a real answer — a corpus of instructions is worse than no corpus, because it teaches her to write like a remote control.`;

/** The prompt body. Indexed, so the judge returns positions rather than text. */
export function buildVoiceJudgePrompt(candidates: ReadonlyArray<string>): string {
  return [
    "MESSAGES:",
    ...candidates.map((c, i) => `${i}. ${c.replace(/\s+/g, " ").slice(0, 400)}`),
    "",
    "Which of these is this person SAYING something, rather than instructing her? Strict JSON only.",
  ].join("\n");
}

/**
 * Parse the judge's verdict into the excerpts to keep.
 *
 * Fails OPEN — an unreadable answer returns every candidate rather than none.
 * A corpus built by the old heuristic is worse than one the model filtered, but
 * it is far better than an empty "no writing samples yet", which is what she
 * shipped with for weeks.
 */
export function applyVoiceJudge(
  candidates: ReadonlyArray<string>,
  raw: string
): string[] {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [...candidates];
    const parsed = JSON.parse(match[0]) as { keep?: unknown };
    if (!Array.isArray(parsed.keep)) return [...candidates];
    const keep = parsed.keep
      .filter((i): i is number => typeof i === "number")
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length);
    // An empty keep-list is a REAL answer: everything they sent was an
    // instruction. Only a malformed response falls back to everything.
    return keep.map((i) => candidates[i]);
  } catch {
    return [...candidates];
  }
}

export function isVoiceSample(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_SAMPLE_CHARS || t.length > MAX_SAMPLE_CHARS) return false;

  const normalized = t.toLowerCase().replace(/[.!?,]+$/, "");
  if (PURE_INSTRUCTIONS.has(normalized)) return false;

  // A pasted URL with a few words around it is a reference, not a sentence —
  // and without stripping it, its length alone would qualify.
  const withoutLinks = t.replace(/https?:\/\/\S+/g, "").trim();
  if (withoutLinks.length < MIN_SAMPLE_CHARS) return false;
  if (withoutLinks.split(/\s+/).length < 8) return false;

  return true;
}

/**
 * ⭐ `direction` IS FILTERED HERE, NOT BY THE CALLER.
 *
 * The corpus is what THEY write. Feeding her own output back would make her
 * converge on herself — the same failure as a critic running on the writer's
 * model, one layer up. Leaving that to the caller means one forgetful call site
 * silently poisons the voice profile, so the guarantee lives with the logic.
 */
export function selectExcerpts(
  messages: ReadonlyArray<{ body: string; ts: number; direction: string }>,
  limit = MAX_EXCERPTS
): string[] {
  const samples = messages
    .filter((m) => m.direction === "in")
    .filter((m) => isVoiceSample(m.body));
  if (samples.length <= limit) return samples.map((m) => m.body.trim());

  const byDay = new Map<string, Array<{ body: string; ts: number }>>();
  for (const m of samples) {
    const day = new Date(m.ts).toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? [];
    bucket.push(m);
    byDay.set(day, bucket);
  }

  // Round-robin across days, newest day first.
  const days = [...byDay.keys()].sort().reverse();
  const picked: string[] = [];
  let depth = 0;
  while (picked.length < limit) {
    let added = false;
    for (const day of days) {
      const bucket = byDay.get(day)!;
      if (depth >= bucket.length) continue;
      picked.push(bucket[depth].body.trim());
      added = true;
      if (picked.length >= limit) break;
    }
    if (!added) break;
    depth += 1;
  }
  return picked;
}
