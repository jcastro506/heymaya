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
  | { intent: "manage"; action: "quiet_hours"; start: string; end: string }
  | { intent: "manage"; action: "tone"; tone: "coach" | "friend" | "blunt" }
  | { intent: "manage"; action: "add_admired"; platform: "tiktok" | "instagram"; handle: string }
  | { intent: "manage"; action: "stop_watching"; handle: string }
  | { intent: "manage"; action: "niche"; text: string }
  | { intent: "recall" }
  | { intent: "opinion_ask" }
  | { intent: "calendar_answer" }
  | { intent: "text" };

export const CLASSIFY_PROMPT = `You label one message a content creator sent to their assistant. Pick exactly one label:
- "profile_ask": they are asking about a specific OTHER account by handle (why it's growing, what it's doing, whether to copy it). Give the handle without @ and the platform (instagram if they say ig/insta/reels or the handle style suggests it, else tiktok). Never their own handle.
- "recall": they want something from earlier: an idea she sent, something they saved, a thing she said or they told her.
- "opinion_ask": they are asking for her judgment on a plan or a hook in words (no link, no file), e.g. "should i post at 7", "is this hook good: …".
- "calendar_answer": they are answering a question she asked about a filming block or a date.
- "manage": they are telling her how to run things. Give "action" and its fields:
  - "quiet_hours": when NOT to text them; give "start" and "end" as 24h HH:MM on their clock ("nothing before 9" → start "22:00" end "09:00" if they only gave one edge, keep the other from the current quiet hours you were given).
  - "tone": "coach" | "friend" | "blunt" (be blunter → blunt; be nicer/softer → friend; push me → coach).
  - "add_admired": watch an account: "handle" without @, "platform".
  - "stop_watching": stop watching an account: "handle".
  - "niche": they are redefining what they make ("i do gear reviews now"): "text" in their words.
- "text": anything else.
Output ONLY JSON: {"intent": "profile_ask|recall|opinion_ask|calendar_answer|manage|text", "handle": "", "platform": "tiktok|instagram", "action": "", "start": "", "end": "", "tone": "", "text": ""}`;

export async function classifyText(ctx: ActionCtx, input: { creatorId: Id<"creators">; text: string; ownHandles: { tiktok?: string; instagram?: string }; lastOutbound?: string; quietHours?: { start: string; end: string } }): Promise<Intent> {
  const r = await callModel(ctx, {
    creatorId: input.creatorId,
    purpose: "classify",
    model: REGISTRY.screener.primary,
    messages: [
      { role: "system", content: CLASSIFY_PROMPT },
      { role: "user", content: `Their own handles (never a profile_ask): ${JSON.stringify(input.ownHandles)}\nCurrent quiet hours: ${JSON.stringify(input.quietHours ?? { start: "22:00", end: "07:00" })}\nHer last message to them: ${JSON.stringify((input.lastOutbound ?? "").slice(0, 300))}\n\nTheir message: ${input.text.slice(0, 600)}` },
    ],
    temperature: 0,
    maxTokens: 120,
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
  });
  if (!r.ok) return { intent: "text" };
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : "{}") as { intent?: string; handle?: string; platform?: string; action?: string; start?: string; end?: string; tone?: string; text?: string };
    if (j.intent === "manage") {
      const handle = String(j.handle ?? "").replace(/^@/, "").trim().toLowerCase();
      const platform = j.platform === "instagram" ? "instagram" : "tiktok";
      if (j.action === "quiet_hours" && j.start && j.end) return { intent: "manage", action: "quiet_hours", start: String(j.start), end: String(j.end) };
      if (j.action === "tone" && (j.tone === "coach" || j.tone === "friend" || j.tone === "blunt")) return { intent: "manage", action: "tone", tone: j.tone };
      if (j.action === "add_admired" && handle) return { intent: "manage", action: "add_admired", platform, handle };
      if (j.action === "stop_watching" && handle) return { intent: "manage", action: "stop_watching", handle };
      if (j.action === "niche" && j.text?.trim()) return { intent: "manage", action: "niche", text: String(j.text) };
      return { intent: "text" };
    }
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
