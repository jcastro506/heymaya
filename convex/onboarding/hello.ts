/**
 * Her first texts (2026-10-02). It used to land the instant they sent START, the same three fixed
 * lines for everyone. Now: a human pause with the typing dots, then a greeting she writes for THIS person
 * (their first name, once, if we know it), then the one practical ask (save her number as Maya, since
 * the contact card isn't something every line can share), then the goal question. Code keeps the
 * promises: the greeting is checked (a short single line, says who she is and that she's reading, no
 * question, no dash, the name right) and falls back to a written line when it isn't; the save-contact
 * line and the question are fixed, so the answer to the goal question is always understood.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { openingQuestionFor } from "./conversation";
import { partnershipsOpen } from "../partnerships/store";
import { cleanNamePart } from "../lib/personName";

/** The pause before her first text: long enough to feel typed, short enough to keep them. */
export const HELLO_PACE = { baseMs: 11_000, jitterMs: 6_000, typingAfterMs: 1_500, pendingWindowMs: 3 * 60_000 } as const;

export const SAVE_CONTACT = "quick thing: save this number as Maya in your contacts so i don't get lost in your texts";

export const GREETING_SKILL = `You are Maya, a content creator's personal assistant, texting them for the first time, seconds after they texted START. Write ONE greeting text: at most two short sentences, under 170 characters, lowercase the way you text (names keep their capital), warm and a little playful, like someone in the industry who's genuinely glad they're here. Say who you are and that you're going through their posts now and need a few minutes. No question, no emoji, no dash, no exclamation mark more than once, don't say "excited", don't mention apps or tools. Output only the text.`;

/** Pure: written lines for when she can't, rotated by person so two signups don't read identically. */
export function fallbackGreeting(name: string | null, seed: string): string {
  const n = name ? ` ${name}` : "";
  const variants = [
    `hey${n}, it's maya. really glad you signed up. i'm going through your posts now, give me a few minutes`,
    `hi${n}, maya here. so glad you're here. i'm reading through your posts now, back in a few minutes`,
    `hey${n}! it's maya. i'm going through your posts now to see what's landing for you, give me a few minutes`,
  ];
  return variants[[...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % variants.length];
}

/** Pure: is her greeting fit to send? A name we know must be in it; nothing else may be invented. */
export function greetingOk(text: string, name: string | null): boolean {
  const t = text.trim();
  if (t.length < 25 || t.length > 200 || /\n/.test(t)) return false;
  if (/[?—–]/.test(t) || /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)) return false;
  if ((t.match(/!/g) ?? []).length > 1) return false;
  if (!/\bmaya\b/i.test(t) || !/\b(posts?|page|feed|content)\b/i.test(t)) return false;
  if (/\b(ai|assistant|bot|app|tiktok|instagram|openrouter|gemini)\b/i.test(t)) return false;
  if (/https?:|@|\d/.test(t)) return false;
  if (name && !new RegExp(`\\b${name}\\b`, "i").test(t)) return false;
  // A name we don't know must not appear: she greets with "hey," or "hi," and nothing a model made up.
  if (!name && /^(hey|hi|hello)\s+[A-Za-z]+[,!.]/i.test(t) && !/^(hey|hi|hello)\s+(there|friend)/i.test(t)) return false;
  return true;
}

/** Pure: the three texts, in order. */
export function helloParts(greeting: string, partnerships: boolean): string[] {
  return [greeting.trim(), SAVE_CONTACT, `while i do, ${openingQuestionFor(partnerships)}`];
}

export const inputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ name: string | null; partnerships: boolean; paired: boolean; sent: boolean } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const sent = await ctx.db.query("messages").withIndex("by_creator_and_dedupe", (q) => q.eq("creatorId", c._id).eq("dedupeKey", `hello:${c._id}`)).first();
    return { name: cleanNamePart(c.firstName), partnerships: partnershipsOpen(c), paired: c.channel.paired === true, sent: Boolean(sent) };
  },
});

/** Is her hello still on its way (paired a moment ago, not sent yet)? Her read waits for it, and never repeats it. */
export const pending = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<boolean> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || c.channel.kind !== "imessage" || !c.channel.paired || !c.channel.pairedAt || a.now - c.channel.pairedAt > HELLO_PACE.pendingWindowMs) return false;
    const sent = await ctx.db.query("messages").withIndex("by_creator_and_dedupe", (q) => q.eq("creatorId", c._id).eq("dedupeKey", `hello:${c._id}`)).first();
    return !sent;
  },
});

/** Scheduled by pairing. Safe to run twice: the row's dedupe key sends it once. */
export const send = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string; greeting?: string; fromModel?: boolean }> => {
    const i = await ctx.runQuery(internal.onboarding.hello.inputs, { creatorId: a.creatorId });
    if (!i) return { sent: false, reason: "creator not found" };
    if (!i.paired) return { sent: false, reason: "not paired" };
    if (i.sent) return { sent: false, reason: "already said hello" };
    let greeting = fallbackGreeting(i.name, a.creatorId);
    let fromModel = false;
    // A model that errors, times out or answers badly must never silence her hello: the written line goes.
    let r: Awaited<ReturnType<typeof callModel>> | null = null;
    try {
      r = await callModel(ctx, {
      creatorId: a.creatorId, purpose: "hello", model: REGISTRY.writer.primary, temperature: 0.9, maxTokens: 120, timeoutMs: 9_000, apiKey: process.env.OPENROUTER_API_KEY ?? "",
      messages: [
        { role: "system", content: GREETING_SKILL },
        { role: "user", content: i.name ? `Their first name is ${i.name}. Use it once, naturally.` : "You don't know their name; don't guess one." },
      ],
      });
    } catch {
      r = null;
    }
    const text = r?.ok ? r.content.trim().replace(/^["“]|["”]$/g, "") : "";
    if (text && greetingOk(text, i.name)) { greeting = text; fromModel = true; }
    const res = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "imessage", body: helloParts(greeting, i.partnerships).join("\n---\n"), dedupeKey: `hello:${a.creatorId}`, proactive: true, kind: "status", awaitingAnswer: true });
    return { sent: res.sent, reason: res.sent ? "sent" : res.held ?? "already said hello", greeting, fromModel };
  },
});
