/**
 * The judge (plan Sprint 3c). A second-family model scores one message 0–3 on the
 * things a sharp friend in the industry would wince at. Its calibration is checked
 * against the operator's labels; it is a signal, not the verdict.
 */

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { CRITIC_TIMEOUT_MS } from "../agent/critic";
import { REGISTRY } from "../agent/registry";

export interface Judgement { corny: number; generic: number; flattering: number; toolSpeak: number; specific: number; wouldSend: number; soundsLikeThem: number; note: string; model: string }

export const JUDGE_PROMPT = `You judge one text message from Maya, a creator's assistant who is supposed to sound like a friend who works in the industry: warm without gushing, specific without lecturing, dry rather than bubbly, evidence before opinion. You are given the message, what it was for, and the evidence she had.
Score 0–3 each (0 = none, 3 = badly):
- corny: hype, clichés, motivational filler, emoji-brain
- generic: could be sent to any creator; nothing from THIS person's posts, numbers or life
- flattering: praise that isn't earned by a specific thing
- toolSpeak: sounds like software, a report, or a marketing deck (bullets, headers, "engagement", "leverage", apologies, "as an AI")
And 0–3 where 3 is best:
- specific: names their post, their number, their lane, their calendar
- wouldSend: would a sharp friend in the industry send exactly this
- soundsLikeThem: if the message proposes a caption, hook or on-screen text, could THIS creator have written that line, judged against their own quoted lines in the evidence. 3 = indistinguishable from their own writing. 0 = any creator in the niche could post it word for word, or it explains its own joke, or it leans on an abstract noun (discipline, motivation, journey, grind). Score 3 when the message proposes no line at all, so this never penalises a message that was not writing one.
Output ONLY JSON: {"corny": 0, "generic": 0, "flattering": 0, "toolSpeak": 0, "specific": 0, "wouldSend": 0, "soundsLikeThem": 0, "note": "≤120 chars, the one thing to fix"}`;

export async function judge(ctx: ActionCtx, input: { creatorId?: Id<"creators">; text: string; kind: string; evidence: unknown }): Promise<Judgement | null> {
  const spec = REGISTRY.critic; // a different family from the writer, by registry rule
  const messages = [
    { role: "system" as const, content: JUDGE_PROMPT },
    { role: "user" as const, content: `Purpose: ${input.kind}\n\nMessage:\n${input.text}\n\nEvidence she had:\n${JSON.stringify(input.evidence ?? null).slice(0, 4000)}` },
  ];
  /**
   * ⚠️ Same fallback and the same short timeout as the critic. The judge had neither, so
   * every time the primary timed out (which on this deployment is every time) it returned
   * null, the run scored "judged 0", and the gate went blind on exactly the dimensions a
   * voice change is about. A soul rewrite passed the gate with corny and generic unmeasured.
   */
  let r = await callModel(ctx, { creatorId: input.creatorId ?? ("" as Id<"creators">), purpose: "eval_judge", model: spec.primary, messages, temperature: 0, maxTokens: 300, timeoutMs: CRITIC_TIMEOUT_MS, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
  if (!r.ok) r = await callModel(ctx, { creatorId: input.creatorId ?? ("" as Id<"creators">), purpose: "eval_judge_fallback", model: spec.fallback, messages, temperature: 0, maxTokens: 300, timeoutMs: CRITIC_TIMEOUT_MS, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
  if (!r.ok) return null;
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : "{}") as Partial<Judgement>;
    const n = (x: unknown) => Math.max(0, Math.min(3, Number(x) || 0));
    // A judge that forgets the field must not read as "sounds like nobody": default to 3,
    // the same way a message that proposes no line at all scores 3.
    return { corny: n(j.corny), generic: n(j.generic), flattering: n(j.flattering), toolSpeak: n(j.toolSpeak), specific: n(j.specific), wouldSend: n(j.wouldSend), soundsLikeThem: j.soundsLikeThem === undefined ? 3 : n(j.soundsLikeThem), note: String(j.note ?? "").slice(0, 160), model: spec.primary };
  } catch {
    return null;
  }
}

/** A judged message passes when nothing is worse than mild and a friend would send it. */
export function judgePass(j: Judgement | null): boolean {
  if (!j) return true; // no judge is not a failure; the checks still ran
  return j.corny <= 1 && j.generic <= 1 && j.flattering <= 1 && j.toolSpeak <= 1 && j.wouldSend >= 2;
}
