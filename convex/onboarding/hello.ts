/**
 * Her first texts. A human pause with the typing dots (2026-10-02), then her intro (operator, 2026-10-09):
 * a greeting she writes for THIS person (their first name if we know it), who she is and what she does,
 * how to use her and that the app keeps everything, then the one practical ask (save her number as Maya)
 * and what she's doing with their posts. No survey question. Code keeps the promises: the greeting is
 * checked and falls back to a written line; the rest is fixed copy (onboarding/conversation).
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { introBody, saveContactLine } from "./conversation";
import { partnershipsOpen } from "../partnerships/store";
import { cleanNamePart } from "../lib/personName";

/** The pause before her first text: long enough to feel typed, short enough to keep them. */
export const HELLO_PACE = { baseMs: 11_000, jitterMs: 6_000, typingAfterMs: 1_500, pendingWindowMs: 3 * 60_000 } as const;


export const GREETING_SKILL = `You are Maya, texting a content creator for the first time, seconds after they texted START. Write ONE short greeting line: hi, their first name if you know it, and that it's you (Maya). Warm and simple, like a friend's first text ("hey Adina! it's Maya 👋"). Under 60 characters, one line, lowercase the way you text (names keep their capital), warm. At most one emoji. No question, no dash, don't say "excited", don't describe what you do (the next texts do). Output only the text.`;

/** Pure: written lines for when she can't, rotated by person so two signups don't read identically. */
export function fallbackGreeting(name: string | null, seed: string): string {
  const n = name ? ` ${name}` : "";
  const variants = [`hey${n}! it's Maya 👋`, `hi${n}, it's Maya!`, `hey${n}, Maya here 👋`];
  return variants[[...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % variants.length];
}

/** Pure: is her greeting fit to send? A name we know must be in it; nothing else may be invented. */
export function greetingOk(text: string, name: string | null): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 90 || /\n/.test(t)) return false;
  if (/[?—–]/.test(t) || (t.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length > 1) return false;
  if ((t.match(/!/g) ?? []).length > 1) return false;
  if (!/\bmaya\b/i.test(t)) return false;
  if (/\b(ai|assistant|bot|app|tiktok|instagram|openrouter|gemini)\b/i.test(t)) return false;
  if (/https?:|@|\d/.test(t)) return false;
  if (name && !new RegExp(`\\b${name}\\b`, "i").test(t)) return false;
  // A name we don't know must not appear: she greets with "hey," or "hi," and nothing a model made up.
  if (!name && /^(hey|hi|hello)\s+[A-Za-z]+[,!.]/i.test(t) && !/^(hey|hi|hello)\s+(there|friend)/i.test(t)) return false;
  return true;
}

/** Pure: her intro, four short texts in order. `readDone` when her read already happened (they paired late). */
export function helloParts(greeting: string, partnerships: boolean, readDone = false): string[] {
  return [greeting.trim(), ...introBody(partnerships, readDone), saveContactLine()];
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
    const res = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "imessage", body: helloParts(greeting, i.partnerships).join("\n---\n"), dedupeKey: `hello:${a.creatorId}`, proactive: true, kind: "hello", awaitingAnswer: false });
    return { sent: res.sent, reason: res.sent ? "sent" : res.held ?? "already said hello", greeting, fromModel };
  },
});
