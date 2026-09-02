/**
 * remember (plan §11.3, §15.7 layer 2): what they say in passing becomes a row without
 * being asked. After each text turn a cheap screener reads their message and answers
 * whether it carried a fact about their life or plans worth keeping (a note, ≤ 200
 * chars, with an expiry hint) or a standing instruction (a house rule, verbatim).
 * Notes show in Settings and expire or get confirmed; rules are directives, revocable.
 * Neither is ever invented: the screener quotes, it does not infer.
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";

export const REMEMBER_PROMPT = `You read one message a content creator sent to their assistant. Decide, strictly:
- "note": a concrete fact about their life, plans, schedule, people, or situation that would matter to someone planning content with them later (e.g. "training for Chicago in October", "filming with my sister from now on", "off for two weeks in July"). Quote it in their words, ≤ 200 chars. Give expiresDays if it is time-bound (an event, a trip), else null. kind: "life" (plans, events), "fact" (stable facts), "bit" (a running joke or recurring bit they reference).
- "rule": a standing instruction to the assistant about what to do or never do ("never suggest dance trends", "don't text before 9", "always give me two options"). Verbatim, ≤ 200 chars.
- Otherwise nothing. Questions, opinions on a post, small talk, thanks, one-off logistics: nothing.
Output ONLY JSON: {"note": {"text": "", "kind": "life|fact|bit", "expiresDays": 30} | null, "rule": "" | null}`;

export const afterTurn = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages") },
  handler: async (ctx, a): Promise<{ note: boolean; rule: boolean }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId: a.messageId });
    if (!g?.target || g.target.direction !== "in") return { note: false, rule: false };
    const text = g.target.body.replace(/^\(voice\)\s*/, "").trim();
    if (text.length < 12 || /^https?:\/\//.test(text)) return { note: false, rule: false };
    const r = await callModel(ctx, {
      creatorId: a.creatorId,
      purpose: "remember",
      model: REGISTRY.screener.primary,
      messages: [
        { role: "system", content: REMEMBER_PROMPT },
        { role: "user", content: `Their message: ${text.slice(0, 800)}\n\nThings already kept: ${JSON.stringify((g.creator.notes ?? []).filter((n) => !n.tombstonedAt).map((n) => n.text).slice(-10))}\nRules already kept: ${JSON.stringify(g.directives.map((d) => d.verbatim))}` },
      ],
      temperature: 0,
      maxTokens: 200,
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    if (!r.ok) return { note: false, rule: false };
    let out: { note?: { text?: string; kind?: string; expiresDays?: number | null } | null; rule?: string | null } = {};
    try {
      const m = r.content.match(/\{[\s\S]*\}/);
      out = JSON.parse(m ? m[0] : "{}") as typeof out;
    } catch {
      return { note: false, rule: false };
    }
    let note = false, rule = false;
    if (out.note?.text?.trim()) {
      const kind = out.note.kind === "fact" || out.note.kind === "bit" ? out.note.kind : "life";
      const res = await ctx.runMutation(internal.agent.remember.addNote, { creatorId: a.creatorId, text: out.note.text.trim().slice(0, 200), kind, sourceMessageId: a.messageId, expiresDays: typeof out.note.expiresDays === "number" ? out.note.expiresDays : undefined });
      note = res.added;
    }
    if (out.rule?.trim()) {
      const res = await ctx.runMutation(internal.agent.remember.addRule, { creatorId: a.creatorId, verbatim: out.rule.trim().slice(0, 200), sourceMessageId: a.messageId });
      rule = res.added;
    }
    return { note, rule };
  },
});

/** A note is appended once; a near-duplicate (same text, case-insensitive) refreshes the old one instead. */
export const addNote = internalMutation({
  args: { creatorId: v.id("creators"), text: v.string(), kind: v.union(v.literal("fact"), v.literal("bit"), v.literal("life")), sourceMessageId: v.optional(v.id("messages")), expiresDays: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ added: boolean }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { added: false };
    const now = Date.now();
    const norm = a.text.toLowerCase().replace(/\s+/g, " ").trim();
    const notes = [...(c.notes ?? [])];
    const dup = notes.find((n) => !n.tombstonedAt && n.text.toLowerCase().replace(/\s+/g, " ").trim() === norm);
    if (dup) {
      dup.at = now;
      dup.confirmedAt = now; // they said it again: confirmed
      await ctx.db.patch(c._id, { notes, updatedAt: now });
      return { added: false };
    }
    const id = `n_${now}_${Math.floor(Math.random() * 1e6)}`;
    notes.push({ id, text: a.text, kind: a.kind, sourceMessageId: a.sourceMessageId, at: now, expiresHint: a.expiresDays ? now + a.expiresDays * 86_400_000 : undefined });
    await ctx.db.patch(c._id, { notes: notes.slice(-60), updatedAt: now }); // a bounded memory; the oldest fall off, the dossier keeps what mattered
    await ctx.scheduler.runAfter(0, internal.agent.memory.index, { creatorId: c._id, kind: "note", refId: id, text: a.text });
    return { added: true };
  },
});

/** A rule in their words, once; the same words twice is not two rules. */
export const addRule = internalMutation({
  args: { creatorId: v.id("creators"), verbatim: v.string(), sourceMessageId: v.optional(v.id("messages")) },
  handler: async (ctx, a): Promise<{ added: boolean }> => {
    const active = (await ctx.db.query("directives").withIndex("by_creator_and_active", (q) => q.eq("creatorId", a.creatorId).eq("active", true)).collect()) as Doc<"directives">[];
    const norm = a.verbatim.toLowerCase().replace(/\s+/g, " ").trim();
    if (active.some((d) => d.verbatim.toLowerCase().replace(/\s+/g, " ").trim() === norm)) return { added: false };
    await ctx.db.insert("directives", { creatorId: a.creatorId, kind: "rule", verbatim: a.verbatim, active: true, source: "chat", sourceMessageId: a.sourceMessageId, createdAt: Date.now() });
    return { added: true };
  },
});
