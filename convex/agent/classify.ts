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
  | { intent: "moment" }
  | { intent: "edit_idea"; field: "hook" | "lengthSec" | "onScreenText" | "sound" | "shotList" | "caption"; value: string }
  | { intent: "drop_idea" }
  | { intent: "recall" }
  | { intent: "opinion_ask" }
  | { intent: "calendar_answer" }
  | { intent: "distress" }
  | { intent: "check_in" }
  | { intent: "text" };

/**
 * Pure: does their message actually name this account? An @handle, a profile link, or a handle-shaped
 * token (with . or _) written as-is. A brand said in words ("research arcadia socks", "what about
 * northline?") is a deals question, not an account lookup (deals sim, 2026-09-24).
 */
export function namesAnAccount(text: string, handle: string): boolean {
  const t = text.toLowerCase();
  const h = handle.toLowerCase().replace(/^@/, "");
  if (t.includes(`@${h}`) || new RegExp(`(tiktok\\.com/@|instagram\\.com/)${h.replace(/[.]/g, "\\.")}`).test(t)) return true;
  return /[._]/.test(h) && new RegExp(`(^|[^a-z0-9._])${h.replace(/[.]/g, "\\.")}($|[^a-z0-9._])`).test(t);
}

export const CLASSIFY_PROMPT = `You label one message a content creator sent to their assistant. Pick exactly one label:
- "profile_ask": they are asking about a specific OTHER creator's account by its @handle (not a brand or company they want to research, pitch, work with or get paid by: that is "text") (why it's growing, what it's doing, whether to copy it). Give the handle without @ and the platform (instagram if they say ig/insta/reels or the handle style suggests it, else tiktok). Never their own handle.
- "recall": they want something from earlier: an idea she sent, something they saved, a thing she said or they told her.
- "opinion_ask": they are asking for her judgment on a plan or a hook in words (no link, no file), e.g. "should i post at 7", "is this hook good: …".
- "calendar_answer": they are answering a question she asked about a filming block or a date.
- "manage": they are telling her how to run things. Give "action" and its fields:
  - "quiet_hours": when NOT to text them; give "start" and "end" as 24h HH:MM on their clock ("nothing before 9" → start "22:00" end "09:00" if they only gave one edge, keep the other from the current quiet hours you were given).
  - "tone": "coach" | "friend" | "blunt" (be blunter → blunt; be nicer/softer → friend; push me → coach).
  - "add_admired": watch an account: "handle" without @, "platform".
  - "stop_watching": stop watching an account: "handle".
  - "niche": they are redefining WHAT THEY MAKE ("i do gear reviews now", "going all in on travel"): "text" in their words. NOT a rule about how she should behave ("never suggest talking heads", "don't text me mornings", "i hate skits") and NOT a taste statement: those are "text"; she keeps them as rules herself.
- "moment": they are somewhere or something is happening NOW and they want to make content about it ("i'm at this ramen place, want to do something", "we're at the start line, ideas?", "just got the medal").
- "edit_idea": they want to change the idea she JUST sent (her last message), not one they describe from earlier ("the humidity one", "the one from tuesday" → "text": she finds it herself): give "field" (hook | lengthSec | onScreenText | sound | shotList | caption) and "text" (the new value, or the instruction in their words if it is a rewrite like "make the hook meaner").
- "drop_idea": scrap the idea she JUST sent ("scrap that", "nah not that one", "kill it"). Scrapping, saving, restoring or planning an EARLIER idea they describe is "text".
- "distress": they CLEARLY mean themselves as a person, not their content: not wanting to be here, self-harm, feeling unsafe, hopelessness about life itself ("i don't see the point anymore, of any of it", "i don't want to be here"). Also distress: her last message asked lightly whether it was about posting or more than that, and they say it's more ("honestly it's not just posting", "no, everything's a lot").
- "check_in": it COULD be about them as a person or just about content, and nothing in the message or her last message settles it ("i'm giving up", "i'm done", "what's even the point", "i can't do this anymore" with no content words around it).
- Frustration about content is "text", never these two: "i'm giving up on tiktok", "i'm so over posting", "this flopped and i'm done", "i want to quit posting", "what's the point if nobody watches". When unsure between "text" and "check_in", decide from THEIR message: content words in it (posting, tiktok, views, a video) make it "text"; her last message is almost always about content, so it settles nothing unless it was her asking whether they meant posting or more. When unsure between "check_in" and "distress", choose "check_in".
- "text": anything else, including answers about goals ("brand deals", "just staying consistent", "I already have 100k, I want better partnerships"), motivation, or uncertainty. These are conversation, not niche changes or calendar consent. Follow a new concrete request normally even during onboarding.
Examples: "i'm at a rooftop bar with the whole run club, what do i shoot" → moment · "make it 15 seconds" → edit_idea lengthSec "15" · "change the hook to 'nobody trains for this part'" → edit_idea hook · "scrap that" → drop_idea · "add @runwithcarly to the list" → manage/add_admired handle runwithcarly · "watch @gymgirl on insta" → manage/add_admired instagram · "be blunter with me" → manage/tone blunt · "go easier on me" → manage/tone friend · "don't text me before 9am" → manage/quiet_hours end 09:00 (start from current) · "stop watching @x" → manage/stop_watching · "i only do gear reviews now" → manage/niche · "why is @x blowing up" → profile_ask · "what was that shoe rack idea" → recall · "should i post at 7 or 9" → opinion_ask.
Output ONLY JSON: {"intent": "profile_ask|recall|opinion_ask|calendar_answer|manage|moment|edit_idea|drop_idea|distress|check_in|text", "handle": "", "platform": "tiktok|instagram", "action": "", "start": "", "end": "", "tone": "", "field": "", "text": ""}`;

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
    const j = JSON.parse(m ? m[0] : "{}") as { intent?: string; handle?: string; platform?: string; action?: string; start?: string; end?: string; tone?: string; text?: string; field?: string; value?: string };
    if (j.intent === "distress") return { intent: "distress" };
    if (j.intent === "check_in") return { intent: "check_in" };
    if (j.intent === "moment") return { intent: "moment" };
    if (j.intent === "drop_idea") return { intent: "drop_idea" };
    if (j.intent === "edit_idea") {
      const field = (["hook", "lengthSec", "onScreenText", "sound", "shotList", "caption"] as const).find((f) => f === j.field);
      const value = String(j.text ?? j.value ?? "").trim();
      if (field && value) return { intent: "edit_idea", field, value };
      return { intent: "text" };
    }
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
      if (!handle || mine.includes(handle) || !namesAnAccount(input.text, handle)) return { intent: "text" };
      return { intent: "profile_ask", platform: j.platform === "instagram" ? "instagram" : "tiktok", handle };
    }
    if (j.intent === "recall" || j.intent === "opinion_ask" || j.intent === "calendar_answer") return { intent: j.intent };
    return { intent: "text" };
  } catch {
    return { intent: "text" };
  }
}
