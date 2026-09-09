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
- A name they give, especially in answer to "what should i call you" (a bare "Josh", "call me kev", "it's Vanessa"), is a "fact" note, written as "call them Josh". No expiry.
- Otherwise nothing. Questions, opinions on a post, small talk, thanks, one-off logistics: nothing.
If they explicitly correct a stored fact, include supersedesNoteId with the exact existing note id. Only supersede a direct contradiction about the same fact, not a new topic or a guess. A temporary experiment does not replace their identity. Use recent conversation only to resolve a short answer (such as a name); never extract the assistant's claims as user facts.
Also capture one "experience" when they explicitly express creative preference, effort/repeatability, a decision/rejection, or a commitment. kind: preference|effort|decision|commitment. quote must be an exact passage from THEIR message, <=400 chars. reason is an exact quote of their reason if stated, never invented. blockId may only be an existing block id in their plan that clearly corresponds to this commitment; otherwise null. Do not mistake a question, suggestion, or Maya's words for consent or completion.
Output ONLY JSON: {"note": {"text": "", "kind": "life|fact|bit", "expiresDays": 30, "supersedesNoteId": null} | null, "rule": "" | null, "experience": {"kind":"decision", "quote":"", "reason":null, "blockId":null} | null}`;

export const afterTurn = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages") },
  handler: async (ctx, a): Promise<{ note: boolean; rule: boolean }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId: a.messageId });
    if (!g?.target || g.target.direction !== "in" || g.target.creatorId !== a.creatorId || g.target.memoryExcludedAt || g.target.memoryProcessedAt) return { note: false, rule: false };
    const text = g.target.body.replace(/^\(voice\)\s*/, "").trim();
    if (!text || /^https?:\/\//.test(text)) return { note: false, rule: false };
    const r = await callModel(ctx, {
      creatorId: a.creatorId,
      purpose: "remember",
      model: REGISTRY.screener.primary,
      messages: [
        { role: "system", content: REMEMBER_PROMPT },
        { role: "user", content: `Their existing plan (ids may link an explicit commitment, never manufacture one): ${g.personal}` },
        { role: "user", content: `Recent context: ${JSON.stringify(g.recent.filter((m) => m.ts < g.target!.ts).slice(-3).map((m) => ({ who: m.direction === "in" ? "creator" : "assistant", text: m.body.slice(0, 400) })))}\nTheir message: ${text.slice(0, 800)}\n\nThings already kept: ${JSON.stringify((g.creator.notes ?? []).filter((n) => !n.tombstonedAt).map((n) => ({ id: n.id, text: n.text })))}\nRules already kept: ${JSON.stringify(g.directives.map((d) => d.verbatim))}` },
      ],
      temperature: 0,
      maxTokens: 500,
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });
    if (!r.ok) return { note: false, rule: false };
    let out: { note?: { text?: string; kind?: string; expiresDays?: number | null; supersedesNoteId?: string | null } | null; rule?: string | null; experience?: { kind?: string; quote?: string; reason?: string; blockId?: string } } = {};
    try {
      const m = r.content.match(/\{[\s\S]*\}/);
      out = JSON.parse(m ? m[0] : "{}") as typeof out;
    } catch {
      return { note: false, rule: false };
    }
    let note = false, rule = false;
    let epoch = g.creator.memoryEpoch ?? 0;
    if (out.experience && typeof out.experience.quote === "string" && ["preference", "effort", "decision", "commitment"].includes(out.experience.kind ?? "")) {
      await ctx.runMutation(internal.agent.remember.recordExperience, { creatorId: a.creatorId, sourceMessageId: a.messageId, kind: out.experience.kind as "preference" | "effort" | "decision" | "commitment", quote: out.experience.quote.slice(0, 400), reason: typeof out.experience.reason === "string" ? out.experience.reason.slice(0, 300) : undefined, blockId: typeof out.experience.blockId === "string" ? out.experience.blockId : undefined, epoch });
    }
    if (typeof out.note?.text === "string" && out.note.text.trim()) {
      const kind = out.note.kind === "fact" || out.note.kind === "bit" ? out.note.kind : "life";
      const res = await ctx.runMutation(internal.agent.remember.addNote, { creatorId: a.creatorId, text: out.note.text.trim().slice(0, 200), kind, sourceMessageId: a.messageId, expiresDays: typeof out.note.expiresDays === "number" ? out.note.expiresDays : undefined, supersedesNoteId: typeof out.note.supersedesNoteId === "string" ? out.note.supersedesNoteId : undefined, epoch });
      note = res.added;
      epoch = res.epoch ?? epoch;
    }
    if (typeof out.rule === "string" && out.rule.trim()) {
      const res = await ctx.runMutation(internal.agent.remember.addRule, { creatorId: a.creatorId, verbatim: out.rule.trim().slice(0, 200), sourceMessageId: a.messageId, epoch });
      rule = res.added;
    }
    await ctx.runMutation(internal.agent.remember.markProcessed, { creatorId: a.creatorId, messageId: a.messageId, epoch });
    return { note, rule };
  },
});

export const markProcessed = internalMutation({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), epoch: v.number() },
  handler: async (ctx, a) => {
    const c = await ctx.db.get(a.creatorId);
    const m = await ctx.db.get(a.messageId);
    if (c && (c.memoryEpoch ?? 0) === a.epoch && m?.creatorId === c._id && !m.memoryExcludedAt) await ctx.db.patch(m._id, { memoryProcessedAt: Date.now() });
  },
});

/** A note is appended once; a near-duplicate (same text, case-insensitive) refreshes the old one instead. */
export const addNote = internalMutation({
  args: { creatorId: v.id("creators"), text: v.string(), kind: v.union(v.literal("fact"), v.literal("bit"), v.literal("life")), sourceMessageId: v.optional(v.id("messages")), expiresDays: v.optional(v.number()), supersedesNoteId: v.optional(v.string()), epoch: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ added: boolean; epoch?: number }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || c.plan.status === "deleting" || (a.epoch ?? 0) !== (c.memoryEpoch ?? 0)) return { added: false };
    if (a.sourceMessageId) {
      const source = await ctx.db.get(a.sourceMessageId);
      if (!source || source.creatorId !== c._id || source.direction !== "in" || source.memoryExcludedAt) return { added: false };
      if (c.notes.some((n) => n.sourceMessageId === a.sourceMessageId && n.tombstonedAt)) return { added: false };
    }
    const now = Date.now();
    const norm = a.text.toLowerCase().replace(/\s+/g, " ").trim();
    const notes = [...(c.notes ?? [])];
    const superseded = a.supersedesNoteId && a.sourceMessageId ? notes.find((n) => n.id === a.supersedesNoteId && !n.tombstonedAt) : undefined;
    if (superseded) {
      superseded.tombstonedAt = now;
      const records = await ctx.db.query("personalRecords").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect();
      for (const record of records) if (record.sourceNoteIds.includes(superseded.id) || (superseded.sourceMessageId && record.sourceMessageIds.includes(superseded.sourceMessageId))) await ctx.db.patch(record._id, { active: false, invalidatedAt: now });
      await ctx.db.patch(c._id, { memoryEpoch: (c.memoryEpoch ?? 0) + 1, dossier: undefined, dossierPrevious: undefined, dossierDiff: undefined, taste: undefined, growthPlan: undefined });
    }
    const dup = notes.find((n) => !n.tombstonedAt && n.text.toLowerCase().replace(/\s+/g, " ").trim() === norm);
    if (dup) {
      dup.at = now;
      dup.confirmedAt = now; // they said it again: confirmed
      await ctx.db.patch(c._id, { notes, updatedAt: now });
      return { added: false, ...(superseded ? { epoch: (c.memoryEpoch ?? 0) + 1 } : {}) };
    }
    const id = `n_${now}_${Math.floor(Math.random() * 1e6)}`;
    notes.push({ id, text: a.text, kind: a.kind, sourceMessageId: a.sourceMessageId, at: now, expiresHint: a.expiresDays ? now + a.expiresDays * 86_400_000 : undefined });
    await ctx.db.patch(c._id, { notes: notes.slice(-60), updatedAt: now }); // a bounded memory; the oldest fall off, the dossier keeps what mattered
    await ctx.scheduler.runAfter(0, internal.agent.memory.index, { creatorId: c._id, kind: "note", refId: id, text: a.text });
    return { added: true, ...(superseded ? { epoch: (c.memoryEpoch ?? 0) + 1 } : {}) };
  },
});

/** A rule in their words, once; the same words twice is not two rules. */
export const addRule = internalMutation({
  args: { creatorId: v.id("creators"), verbatim: v.string(), sourceMessageId: v.optional(v.id("messages")), epoch: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ added: boolean }> => {
    const creator = await ctx.db.get(a.creatorId);
    if (!creator || creator.plan.status === "deleting" || (a.epoch ?? 0) !== (creator.memoryEpoch ?? 0)) return { added: false };
    if (a.sourceMessageId) { const source = await ctx.db.get(a.sourceMessageId); if (!source || source.creatorId !== a.creatorId || source.direction !== "in" || source.memoryExcludedAt) return { added: false }; }
    const active = (await ctx.db.query("directives").withIndex("by_creator_and_active", (q) => q.eq("creatorId", a.creatorId).eq("active", true)).collect()) as Doc<"directives">[];
    const norm = a.verbatim.toLowerCase().replace(/\s+/g, " ").trim();
    if (active.some((d) => d.verbatim.toLowerCase().replace(/\s+/g, " ").trim() === norm)) return { added: false };
    await ctx.db.insert("directives", { creatorId: a.creatorId, kind: "rule", verbatim: a.verbatim, active: true, source: "chat", sourceMessageId: a.sourceMessageId, createdAt: Date.now() });
    return { added: true };
  },
});

export const recordExperience = internalMutation({
  args: { creatorId: v.id("creators"), sourceMessageId: v.id("messages"), kind: v.union(v.literal("preference"), v.literal("effort"), v.literal("decision"), v.literal("commitment")), quote: v.string(), reason: v.optional(v.string()), blockId: v.optional(v.string()), epoch: v.number() },
  handler: async (ctx, a): Promise<boolean> => {
    const c = await ctx.db.get(a.creatorId);
    const source = await ctx.db.get(a.sourceMessageId);
    if (!c || c.plan.status === "deleting" || (c.memoryEpoch ?? 0) !== a.epoch || !source || source.creatorId !== c._id || source.direction !== "in" || source.memoryExcludedAt) return false;
    const quote = a.quote.trim();
    if (!quote || !source.body.toLowerCase().includes(quote.toLowerCase()) || (a.reason && !source.body.toLowerCase().includes(a.reason.toLowerCase()))) return false;
    const key = `experience:${source._id}:${a.kind}`;
    if (await ctx.db.query("personalRecords").withIndex("by_creator_key", (q) => q.eq("creatorId", c._id).eq("key", key)).first()) return false;
    const id = a.blockId ? ctx.db.normalizeId("calendarBlocks", a.blockId) : null;
    const block = id ? await ctx.db.get(id) : null;
    if (a.blockId && (!block || block.creatorId !== c._id)) return false;
    await ctx.db.insert("personalRecords", { creatorId: c._id, key, kind: a.kind, text: quote, reason: a.reason, blockId: block?._id, sourceMessageIds: [source._id], sourcePostIds: [], sourceNoteIds: [], active: true, at: source.ts });
    return true;
  },
});
