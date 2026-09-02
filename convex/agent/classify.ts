/**
 * The classifier (plan §15.3): one cheap screener call per text turn, a fixed label
 * set, and the two things the model is better at than a pattern: what they want, and
 * which account they named. Commands and links never come here (code decides those,
 * because "stop" must never be misread and a URL is not a judgment). On any failure
 * the answer is `text`, which is the safe default: converse handles it.
 */

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "./registry";

export type Intent =
  | { intent: "profile_ask"; platform: "tiktok" | "instagram"; handle: string }
  | { intent: "recall" }
  | { intent: "opinion_ask" }
  | { intent: "calendar_answer" }
  | { intent: "text" };

export const CLASSIFY_PROMPT = `You label one message a content creator sent to their assistant. Pick exactly one label:
- "profile_ask": they are asking about a specific OTHER account by handle (why it's growing, what it's doing, whether to copy it). Give the handle without @ and the platform (instagram if they say ig/insta/reels or the handle style suggests it, else tiktok). Never their own handle.
- "recall": they want something from earlier: an idea she sent, something they saved, a thing she said or they told her.
- "opinion_ask": they are asking for her judgment on a plan or a hook in words (no link, no file), e.g. "should i post at 7", "is this hook good: …".
- "calendar_answer": they are answering a question she asked about a filming block or a date.
- "text": anything else.
Output ONLY JSON: {"intent": "profile_ask|recall|opinion_ask|calendar_answer|text", "handle": "" , "platform": "tiktok|instagram"}`;

export async function classifyText(ctx: ActionCtx, input: { creatorId: Id<"creators">; text: string; ownHandles: { tiktok?: string; instagram?: string }; lastOutbound?: string }): Promise<Intent> {
  const r = await callModel(ctx, {
    creatorId: input.creatorId,
    purpose: "classify",
    model: REGISTRY.screener.primary,
    messages: [
      { role: "system", content: CLASSIFY_PROMPT },
      { role: "user", content: `Their own handles (never a profile_ask): ${JSON.stringify(input.ownHandles)}\nHer last message to them: ${JSON.stringify((input.lastOutbound ?? "").slice(0, 300))}\n\nTheir message: ${input.text.slice(0, 600)}` },
    ],
    temperature: 0,
    maxTokens: 120,
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
  });
  if (!r.ok) return { intent: "text" };
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : "{}") as { intent?: string; handle?: string; platform?: string };
    if (j.intent === "profile_ask") {
      const handle = String(j.handle ?? "").replace(/^@/, "").trim().toLowerCase();
      const mine = [input.ownHandles.tiktok, input.ownHandles.instagram].filter(Boolean).map((h) => h!.toLowerCase().replace(/^@/, ""));
      if (!handle || mine.includes(handle)) return { intent: "text" };
      return { intent: "profile_ask", platform: j.platform === "instagram" ? "instagram" : "tiktok", handle };
    }
    if (j.intent === "recall" || j.intent === "opinion_ask" || j.intent === "calendar_answer") return { intent: j.intent };
    return { intent: "text" };
  } catch {
    return { intent: "text" };
  }
}
