/**
 * B4: when someone may not be okay (audit §5 capability 8). Three paths, the classifier's judgment
 * picks: content frustration → normal Maya; ambiguous → `checkIn` (light, her voice, no hotline);
 * clearly about them → `respond`. The classifier's judgment decides
 * that it's distress; this path then keeps the promises in code, because prompts drift:
 * - the reply is short, warm, asks if they're safe, and ALWAYS carries a crisis resource
 *   (appended by code if the model left it out, a fixed message if the model fails);
 * - proactive texts pause for 24 h (checkRails reads careUntil);
 * - the operator is alerted at once.
 * No content advice, no growth talk, no diagnosis. Baseline failure this fixes (B0,
 * 2026-09-23): "i don't see the point anymore… of any of it" got "close the app and take a
 * break… go do a normal run".
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { callModel } from "../core/llm";
import { REGISTRY } from "./registry";
import { deliverNow } from "../core/scheduler";
import { resolveTelegramBotIdentity, sendTelegramMessage } from "../integrations/telegram/client";

export const CARE_HOURS = 24;

/** Where to reach someone now. US first (launch market); a clear fallback elsewhere. Pure. */
export function resourceLine(timezone: string): string {
  const us = /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Indiana|Kentucky|Boise|Juneau|Sitka|Menominee|North_Dakota)|^Pacific\/Honolulu/.test(timezone);
  if (us) return "if you're in the US you can call or text 988 any time, day or night, and talk to someone right now.";
  if (/^Australia\//.test(timezone)) return "in Australia you can call Lifeline on 13 11 14 any time, day or night.";
  if (/^Europe\/London/.test(timezone)) return "in the UK you can call Samaritans on 116 123 any time, day or night.";
  return "if you're in danger or thinking about hurting yourself, please call your local emergency number or a crisis line where you are, right now.";
}

/** Does the text already point them to real help? Pure. */
export function hasResource(text: string): boolean {
  return /\b988\b|13 11 14|116 123|crisis line|emergency number|lifeline|samaritans/i.test(text);
}

export const CARE_SKILL = `care
They just made it clear they may not be okay as a person, not about content. Drop everything else: no ideas, no posts, no numbers, no growth, no "take a break from the app" framing. You're still you (lowercase, the way you always text them), just gentle: say you're glad they told you, ask plainly whether they're safe right now, and that they don't have to go through it alone. Two or three short sentences, one question, no advice lists, no therapy language, no diagnosing. Include a way to reach someone right now; the prompt gives you the right line for where they are. Output only the message text.`;

/**
 * The middle path (operator, 2026-09-23): "i'm giving up" is usually about posting. Maya stays
 * herself, answers lightly, and asks which it is. No hotline, no pause, no alert. If they say it's
 * more than posting, the classifier reads that reply (with this message as her last) as distress.
 */
export const CHECK_IN_SKILL = `check-in
They said something that could be about their content or about them as a person, and you can't tell which. Stay completely yourself: warm, casual, a little funny if it fits. One or two short lines: react like a friend would, then ask lightly which it is, making both answers easy to give ("giving up on posting, or is it a rough patch more generally? either's fine to say"). No crisis language, no hotline, no advice yet, no numbers. Output only the message text.`;

export const CHECK_IN_FALLBACK = "wait, giving up on posting, or is it a rough patch more generally? either's fine to say.";

export const setCare = internalMutation({
  args: { creatorId: v.id("creators"), until: v.number() },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.patch(a.creatorId, { careUntil: a.until });
    return null;
  },
});

export const checkIn = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId: a.messageId });
    if (!g?.target) return { ok: false };
    const r = await callModel(ctx, {
      creatorId: a.creatorId, purpose: "check_in", model: REGISTRY.writer.primary,
      messages: [
        { role: "system", content: CHECK_IN_SKILL },
        { role: "user", content: `What they said: ${JSON.stringify(g.target.body.slice(0, 1000))}` },
      ],
      temperature: 0.5, maxTokens: 200, apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    const raw = r.ok ? r.content.trim() : "";
    const text = raw && !raw.startsWith("{") ? raw : CHECK_IN_FALLBACK;
    await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: text, dedupeKey: `checkin:${a.messageId}`, proactive: false, kind: "reply" });
    await deliverNow(ctx as never);
    return { ok: true };
  },
});

export const respond = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages") },
  handler: async (ctx, a): Promise<{ ok: boolean; alerted: boolean }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId: a.messageId });
    if (!g?.target) return { ok: false, alerted: false };
    const resource = resourceLine(g.creator.timezone);
    const r = await callModel(ctx, {
      creatorId: a.creatorId, purpose: "care", model: REGISTRY.writer.primary,
      messages: [
        { role: "system", content: `${CARE_SKILL}\n\nThe line for where they are: "${resource}"` },
        { role: "user", content: `What they said: ${JSON.stringify(g.target.body.slice(0, 1000))}` },
      ],
      temperature: 0.4, maxTokens: 300, apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    let text = r.ok ? r.content.trim() : "";
    if (!text) text = "i'm really glad you told me. are you safe right now? you don't have to carry this alone.";
    if (!hasResource(text)) text = `${text}\n\n${resource}`; // the promise, kept by code
    await ctx.runMutation(internal.agent.care.setCare, { creatorId: a.creatorId, until: Date.now() + CARE_HOURS * 3_600_000 });
    await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: text, dedupeKey: `care:${a.messageId}`, proactive: false, kind: "care" });
    await deliverNow(ctx as never);
    // The operator hears about it now, with the message, not at the next hourly alert.
    let alerted = false;
    const operator = process.env.TELEGRAM_OPERATOR_CHAT_ID;
    const identity = resolveTelegramBotIdentity();
    if (operator && identity) {
      const who = g.creator.handles.tiktok ? `@${g.creator.handles.tiktok}` : g.creator.handles.instagram ? `@${g.creator.handles.instagram}` : g.creator.email;
      const res = await sendTelegramMessage(identity, { chatId: operator, text: `🟠 care: ${who} (creator ${g.creator._id}) may not be okay. They said: "${g.target.body.slice(0, 400)}". Maya checked in and gave a crisis line; proactive texts are paused for ${CARE_HOURS}h.` }).catch(() => null);
      alerted = Boolean(res && res.ok);
    }
    return { ok: true, alerted };
  },
});
