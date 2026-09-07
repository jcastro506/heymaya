/**
 * The critic (plan §15.5): a second model, on a different family from the writer,
 * reads every proactive artifact with the dossier voice block, the directives and
 * the evidence it cites. Fail → one rewrite with the problems → second fail → drop.
 * Nothing proactive is sent that failed twice. The deterministic leak check runs
 * before this and cannot be bypassed (it lives in messages.send).
 */

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "./registry";

export type Problem = "no_reaction" | "slop" | "invented_number" | "leak" | "off_voice" | "unsafe" | "no_link" | "no_action" | "directive_violation" | "too_long" | "generic_line" | "vague_sound" | "invented_sound" | "mixed_basis";

export interface CritiqueResult {
  pass: boolean;
  problems: Problem[];
  note: string;
  skipped?: boolean; // the critic vendor was unavailable; the artifact went out flagged, not unchecked-and-silent
}

/**
 * How long the critic gets, per attempt, before failing over.
 *
 * ⚠️ TUNED THE HARD WAY, TWICE. The shared 45s default meant 45 seconds of silence on the
 * reply path before the fallback even started. I cut it to 12s and BOTH models then missed
 * it, so a live reply went out ungated carrying the exact vague sound ("low-key trending
 * audio") the critic exists to reject. A gate that never runs is worse than a slow one.
 *
 * 25s is what the fallback was actually measured completing in. Raise it if the skip rate
 * on `criticSkipped` climbs; do not lower it without measuring that rate first.
 */
export const CRITIC_TIMEOUT_MS = 25_000;

const CRITIC_PROMPT = `You are the critic for a creator's assistant named Maya. Read one outbound message and judge it against the standard below. Return ONLY JSON: {"pass": true|false, "problems": ["no_reaction"|"slop"|"invented_number"|"leak"|"off_voice"|"unsafe"|"no_link"|"no_action"|"directive_violation"|"too_long"|"generic_line"|"vague_sound"|"invented_sound"|"mixed_basis"], "note": "≤160 chars, what to fix"}.

Fail it if ANY of these is true:
- no_reaction: a message about one of THEIR posts (a read, an opinion, a scout idea) that opens on a number, a multiple or a metric word instead of what got her as a viewer. The first line is the moment, named from the evidence; the numbers come after.
- slop: generic praise, "great question", "I'd be happy to", coaching clichés, bullet lists, headers, ANY markdown (asterisks for bold, ### headings, backticks), a row of emoji (one emoji that adds something is fine, and so is an exclamation mark she means), restating what they said, a compliment to soften a critique. This is a text message, not a document. A specific reaction to a named moment of THEIR post ("the face at 0:03 killed me", "the line under the pan is the whole joke") is NOT slop and NOT a softening compliment; it is the read. Generic praise with no moment named is.
- generic_line: any caption, hook or on-screen text she proposes that ANY creator in this niche could post word for word. Tells: it explains its own joke ("...and convincing myself it was pure discipline"); it leans on an abstract noun (discipline, motivation, journey, mindset, grind, era); it opens with a borrowed format ("pov:", "nobody: / me:", "the way I", "it's giving", "tell me why", "that one friend who", "main character"); or it carries no concrete noun from THIS creator's actual life. Compare it to their own quoted lines in the prefix: if it does not sound like the same person wrote it, fail.
- mixed_basis: a TikTok number and a watch-time, retention or skip-rate figure in the same claim. TikTok exposes no retention to anyone; a Reels figure may explain a TikTok ONLY when the message says it is the same video cross-posted.
- vague_sound: a suggested sound that names nothing — "a trending sound", "whatever is on your fyp", "an upbeat track". Saying "your own audio" passes.
- invented_sound: a NAMED track or artist when the evidence's toolsUsedThisTurn contains no sound lookup and the candidate post's own sound is not in the evidence. A real song title she remembered is still a fact nobody checked. "your own audio" is always available and always honest.
- invented_number: a metric, view count, multiple, date or trend that is not in the evidence given.
- leak: vendor names, model names, "endpoint", "scrape", "prompt", ids, stack traces, "as an AI".
- off_voice: it does not read like a friend who works in the industry texting; it lectures; two questions; more than one question when none was needed.
- unsafe: medical, legal, financial claims; anything that would get the creator's account flagged; targeting a private person.
- no_link: a scout message about someone else's post with no link to it.
- no_action: a proactive message with nothing they can do today.
- directive_violation: it breaks a house rule quoted below.
- too_long: over 900 characters, or over 120 words when nothing asked for detail.

Pass it if it is specific, evidenced, in voice, and short.`;

export async function critique(
  ctx: ActionCtx,
  input: { creatorId: Id<"creators">; kind: string; text: string; evidence: unknown; voice: unknown; directives: string[] },
): Promise<CritiqueResult> {
  const spec = REGISTRY.critic;
  const user = `Kind: ${input.kind}\n\nHouse rules:\n${input.directives.map((d) => `- ${d}`).join("\n") || "- none"}\n\nCreator voice block:\n${JSON.stringify(input.voice ?? {})}\n\nEvidence the message may cite:\n${JSON.stringify(input.evidence ?? {})}\n\nMessage:\n"""\n${input.text}\n"""`;
  let result = await callModel(ctx, { creatorId: input.creatorId, purpose: "critic", model: spec.primary, timeoutMs: CRITIC_TIMEOUT_MS, messages: [{ role: "system", content: CRITIC_PROMPT }, { role: "user", content: user }], temperature: 0, maxTokens: spec.maxTokens, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
  if (!result.ok) result = await callModel(ctx, { creatorId: input.creatorId, purpose: "critic_fallback", model: spec.fallback, timeoutMs: CRITIC_TIMEOUT_MS, messages: [{ role: "system", content: CRITIC_PROMPT }, { role: "user", content: user }], temperature: 0, maxTokens: spec.maxTokens, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
  if (!result.ok) return { pass: true, problems: [], note: `critic unavailable: ${result.reason}`, skipped: true };
  try {
    const m = result.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : "{}") as Partial<CritiqueResult>;
    return { pass: Boolean(parsed.pass), problems: (parsed.problems ?? []) as Problem[], note: String(parsed.note ?? "") };
  } catch {
    return { pass: true, problems: [], note: "critic returned no JSON", skipped: true };
  }
}

/** Deterministic length rule, applied before the model so a long message never costs a critic call. */
export function tooLong(text: string, detailRequested = false): boolean {
  if (text.length > 900) return true;
  const words = text.trim().split(/\s+/).length;
  return !detailRequested && words > 140;
}
