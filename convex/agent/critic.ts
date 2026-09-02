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

export type Problem = "slop" | "invented_number" | "leak" | "off_voice" | "unsafe" | "no_link" | "no_action" | "directive_violation" | "too_long";

export interface CritiqueResult {
  pass: boolean;
  problems: Problem[];
  note: string;
  skipped?: boolean; // the critic vendor was unavailable; the artifact went out flagged, not unchecked-and-silent
}

const CRITIC_PROMPT = `You are the critic for a creator's assistant named Maya. Read one outbound message and judge it against the standard below. Return ONLY JSON: {"pass": true|false, "problems": ["slop"|"invented_number"|"leak"|"off_voice"|"unsafe"|"no_link"|"no_action"|"directive_violation"|"too_long"], "note": "≤160 chars, what to fix"}.

Fail it if ANY of these is true:
- slop: generic praise, "great question", "I'd be happy to", coaching clichés, bullet lists, headers, emoji not used by the creator, restating what they said, a compliment to soften a critique.
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
  let result = await callModel(ctx, { creatorId: input.creatorId, purpose: "critic", model: spec.primary, messages: [{ role: "system", content: CRITIC_PROMPT }, { role: "user", content: user }], temperature: 0, maxTokens: spec.maxTokens, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
  if (!result.ok) result = await callModel(ctx, { creatorId: input.creatorId, purpose: "critic_fallback", model: spec.fallback, messages: [{ role: "system", content: CRITIC_PROMPT }, { role: "user", content: user }], temperature: 0, maxTokens: spec.maxTokens, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
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
