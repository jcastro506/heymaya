/**
 * The last thing between her machinery and the founder's chat.
 *
 * ## Why a guard at all, when the prompt is primary
 *
 * The standing rule is prompt-first: outbound discipline lives in SOUL.md, and
 * non-catastrophic drift is **logged, never dropped**. That rule is right, and
 * this module deliberately does not relitigate it — there is no vocabulary
 * police here, no "sounds too formal" heuristic, no rewriting of her voice.
 *
 * What this catches is the class a prompt structurally *cannot*: strings she
 * never wrote. An exception message, a vendor's name, a bucket error, an id.
 * Those don't arrive because she drifted — they arrive because some code path
 * interpolated a variable into a sentence.
 *
 * That happened. `ingestFromTelegram` returned `error.message` and
 * `telegramFiles` put it straight into a Telegram body, so an R2 failure would
 * have reached a founder as *"The specified bucket does not exist"*. It was
 * fixed at the source. **This is the backstop for the next one**, because there
 * will be a next one — every founder-facing string built with a `${}` is a
 * candidate, and no amount of prompt tuning reaches them.
 *
 * ## Redact, never drop
 *
 * §2.5: nothing fails silently. A message swallowed because it tripped a
 * denylist is exactly the silent failure the principle forbids — and the
 * messages most likely to trip it are *error reports*, the ones the founder
 * most needs. So this strips the offending span and sends the rest; only if
 * nothing survives does it substitute a plain sentence. The original always
 * reaches the log.
 */

/**
 * ⭐ Strings that can ONLY be internal.
 *
 * Every entry is a proper noun of our stack or an artefact of a runtime. The
 * bar is deliberately high: a word a founder might plausibly use themselves —
 * "post", "account", "video", "link", even "API" if they're technical — is NOT
 * here. False positives cost the founder a mangled message, which is worse
 * than the leak this prevents.
 *
 * Telegram is absent on purpose: they are literally reading this in Telegram.
 * So is TikTok, Instagram, YouTube and X — those are their channels.
 */
export const INTERNAL_NAMES = [
  // Vendors. The founder bought a social media manager, not an integration
  // stack; naming one is confusing at best and a competitor's name at worst.
  "Zernio",
  "getlate",
  "Creatify",
  "ScrapeCreators",
  "twitterapi.io",
  "OpenClaw",
  "OpenRouter",
  "Convex",
  "Cloudflare",
  "Fly.io",
  "Clerk",
  // Runtime nouns that only ever describe our own plumbing.
  "internalAction",
  "internalMutation",
  "internalQuery",
  "storageKey",
  "dedupeKey",
  "idempotency",
  "webhook",
  "stack trace",
] as const;

/**
 * Machine-shaped fragments. These are patterns rather than names because the
 * damaging part is the SHAPE — an exception, a status code, an id.
 */
const MACHINE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // "Error: ...", "TypeError: ...", "AbortError". The single most likely leak,
  // because `catch (e) { return e.message }` is the default thing to write.
  { name: "exception", re: /\b[A-Z][a-zA-Z]*Error\b:?/g },
  // Node/network failures that surface verbatim from fetch.
  { name: "errno", re: /\bE[A-Z]{3,}\b/g },
  /**
   * ⚠️ A status code ONLY counts when something says it's a status code.
   *
   * The obvious pattern — a bare `[45]\d{2}` — is a trap, and it shipped in
   * the first draft of this file. She sends metrics constantly, so
   * *"your post got 512 views"* and *"we're at 499 followers"* both matched,
   * and the guard would have eaten the number out of her best news.
   *
   * A number is only machine-shaped when a machine word is next to it.
   */
  {
    name: "status-code",
    re: /\b(?:HTTP|status(?:\s+code)?|error\s+code)\s*[:=]?\s*\(?[45]\d{2}\)?/gi,
  },
  /**
   * A failure verb next to the number — "returned a 502", "failed (403)".
   *
   * The lookahead is what makes this safe: *"that post returned 500 views"* is
   * the same shape and must survive. What follows the number is the thing that
   * actually tells them apart, so it's checked rather than guessed at.
   */
  {
    name: "status-code",
    re: /\b(?:failed|errored|rejected|returned|responded)(?:\s+(?:a|an|with))?\s*\(?\s*[45]\d{2}\s*\)?(?!\s*(?:views|likes|followers|impressions|clicks|people|replies|comments|shares|signups))/gi,
  },
  /**
   * ⭐ A TOOL ENVELOPE. She pasted one into a founder's chat, live:
   *
   *   **Draft tool said:**
   *   ```json
   *   {"ok":true,"data":{"draftId":"md7styc0db2spt2rn9btwg9fy58bwc02",…}}
   *
   * `{ok, data, next, why}` is our tool-response contract (§2.8) and rides in
   * every tool result on every turn, so it is *always* in her context and
   * quoting it is a small step from summarising it. Redacting only the id
   * inside would leave the blob, which is the part that reads like software.
   * The whole envelope goes.
   */
  { name: "tool-output", re: /```(?:json)?\s*\{[\s\S]*?\}\s*```/g },
  { name: "tool-output", re: /\{\s*"ok"\s*:\s*(?:true|false)[\s\S]*?\}\s*\}?/g },
  /**
   * A Convex id: 32 chars of lowercase alphanum. Nothing a human types, and
   * she sent three of them live — one as "draft ID `md7tf0…`".
   *
   * The surrounding backticks, parens and the label go with it: *"Saved an X
   * post, draft ID ``."* is not an improvement on the leak.
   */
  {
    name: "id",
    re: /(?:,?\s*\b(?:draft|post|placement|asset|message|customer)?\s*ID:?\s*)?[([]?`?\b[a-z0-9]{32}\b`?[)\]]?/gi,
  },
  /**
   * ⭐ NAMING HER OWN TOOLS. "The update tool said:", "**Draft tool said:**".
   *
   * Four of thirty-nine live messages did this. It isn't an interpolated
   * variable — it's her narrating her own plumbing, which the SOUL block now
   * forbids. But the prompt fix is new and unproven, and a founder who reads
   * "the update tool said" has been shown a machine either way.
   *
   * Narrow on purpose: `<word> tool said/returned/reported` is a construction
   * no founder-facing sentence uses. "What tool do you use?" is untouched.
   */
  {
    name: "tool-narration",
    re: /\*{0,2}\b(?:the\s+)?\w+\s+tool\s+(?:said|says|returned|reported)\b:?\*{0,2}/gi,
  },
  // Module paths and function refs.
  { name: "code-path", re: /\b(?:convex|internal)[./][\w./]+/g },
  // The two words that mean "a variable was empty".
  { name: "empty-value", re: /\b(?:undefined|NaN)\b/g },
];

export interface PlainLanguageVerdict {
  /** What should actually be sent. */
  clean: string;
  /** Named reasons, for the log and the operator view. Empty means untouched. */
  redacted: string[];
  /** True when nothing was found — the overwhelmingly common case. */
  ok: boolean;
}

/**
 * What to say when redaction leaves nothing usable.
 *
 * Deliberately admits a problem rather than pretending success: a founder who
 * gets silence assumes it worked. It also can't be mistaken for her normal
 * voice, so an operator reading the log sees this and knows the source needs
 * fixing.
 */
export const PLAIN_FALLBACK =
  "Something went wrong on my end with that one — I'm on it.";

/**
 * ⭐ Check a founder-facing message.
 *
 * Cheap and synchronous: a few regexes on a short string, run on every outbound
 * message. No model call — a judge here would cost money on every message and
 * add a second of latency to catch something a regex catches exactly.
 */
export function checkPlainLanguage(body: string): PlainLanguageVerdict {
  const redacted: string[] = [];
  let clean = body;

  for (const { name, re } of MACHINE_PATTERNS) {
    if (re.test(clean)) {
      redacted.push(name);
      clean = clean.replace(new RegExp(re.source, re.flags), "").trim();
    }
  }

  for (const term of INTERNAL_NAMES) {
    // Word-boundary-ish, case-insensitive. Escaped because entries contain dots.
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (re.test(clean)) {
      redacted.push(term.toLowerCase());
      clean = clean.replace(re, "").trim();
    }
  }

  if (redacted.length === 0) return { clean: body, redacted: [], ok: true };

  // Tidy the wreckage: doubled spaces, a dangling dash where a clause was, an
  // orphaned punctuation run.
  clean = clean
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/[—–-]\s*([.!?]|$)/g, "$1")
    // NOT the hyphen: a leading "- " is a markdown bullet, and eating it
    // reformats her brief. Only em/en-dash wreckage gets trimmed.
    .replace(/^[\s—–,.:;]+/, "")
    .trim();

  /**
   * "Usable" means a real sentence survived, not a stub. `"— . Worth another
   * try?"` is technically non-empty and reads as broken, which is exactly the
   * impression this module exists to prevent.
   */
  const usable = clean.replace(/[^a-zA-Z]/g, "").length >= 15;
  return { clean: usable ? clean : PLAIN_FALLBACK, redacted, ok: false };
}
