/**
 * The editor (2026-10-12, docs/CREATOR_REACH_OUT.md "one pick a day"). Her own finds used to be first come,
 * first served: whichever hourly job fired first took the day's slot, usually an idea at 9am. Now the paths
 * that find things (the scout's drafts, "thought of you", comments on their posts) write CANDIDATES, and once
 * a day, at the hour this person actually replies, she picks the single best one, or none.
 *
 *   code watches   candidates come from rows; code scores them (fresh, about them, the kinds they answer, variety)
 *   she judges     the top few go to her with what she sent this week and how it landed: one, or a quiet day
 *   she reads the room   mid-conversation it rides along in her reply ("oh also…") instead of a new text
 *   it learns      kinds they answer score up, kinds they ignore score down; three ignored in a row and she backs off
 *
 * Budgets stay in `messages.send` (core/reachOut): this decides WHAT, never whether the rails allow it.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";
import { laneFor } from "./reachOut";
import { localHourMinute } from "../scout/gate";
import { pairedRows } from "./schedule";
import { spreadDelays, HOURLY_SPREAD_MS } from "./fanout";
import { callModel } from "./llm";
import { REGISTRY } from "../agent/registry";
import { buildPrefix } from "../agent/context";
import { critique, tooLong } from "../agent/critic";
import { clip } from "../lib/clip";

export type Noticed = NonNullable<Doc<"creators">["noticed"]>[number];
export type CandidateKind = "idea" | "for_you" | "comment" | "deal";

export const EDITOR = {
  /** Below this nothing is worth a text today. */
  bar: 1.5,
  /** After three ignored in a row, only this good, and never two days running. */
  strong: 3,
  /** How many go to her to choose from. */
  shortlist: 4,
  /** Kept on the creator at most; the rest is in the app anyway. */
  max: 20,
  /** A reply this soon after her text counts as answering it (a day-later "yo" isn't an answer to it). */
  answeredWithinMs: 8 * 3_600_000,
  /** Backing off still allows one good find this often. */
  backOffEveryMs: 7 * 86_400_000,
  /** No new text of hers within this long of their last message: mid-conversation it rides along instead. */
  restAfterChatMs: 3 * 3_600_000,
  /** Picks happen from their hour until this hour on their clock. */
  lastHour: 20,
  defaultHour: 11,
} as const;

/** What the message row is sent as: its lane is "hers" (core/reachOut). */
export const SEND_KIND: Record<CandidateKind, string> = { idea: "scout", for_you: "for_you", comment: "comment", deal: "deal" };

/* ------------------------------------------------------------------ pure */

export interface Outcome { kind: string; ts: number; landed: boolean }

/** Pure: each text of hers in the window, and whether they answered it (any message, tap or reaction within 8 hours). */
export function outcomes(msgs: Array<Pick<Doc<"messages">, "direction" | "proactive" | "kind" | "ts">>, now: number): Outcome[] {
  const inbound = msgs.filter((m) => m.direction === "in").map((m) => m.ts).sort((a, b) => a - b);
  return msgs
    .filter((m) => m.direction === "out" && m.proactive === true && laneFor(m.kind, null) === "hers" && now - m.ts >= 0)
    .map((m) => ({ kind: m.kind ?? "", ts: m.ts, landed: inbound.some((t) => t > m.ts && t - m.ts < EDITOR.answeredWithinMs) }))
    .sort((a, b) => a.ts - b.ts);
}

/** Pure: 0.5 (always ignored) … 1.5 (always answered), 1.0 with nothing to go on. */
export function kindWeight(history: Outcome[], sendKind: string): number {
  const mine = history.filter((h) => h.kind === sendKind);
  return 0.5 + (mine.filter((h) => h.landed).length + 1) / (mine.length + 2);
}

/** Pure: three of hers ignored in a row (or more): she backs off. */
export function backingOff(history: Outcome[]): boolean {
  const last = history.slice(-3);
  return last.length === 3 && last.every((h) => !h.landed);
}

export interface Scored { c: Noticed; score: number }

/** Pure: rank what she noticed. Fresh beats stale, kinds they answer beat kinds they ignore, and the same kind twice running loses. */
export function rank(cands: Noticed[], history: Outcome[], now: number): Scored[] {
  const lastKinds = history.slice(-3).map((h) => h.kind);
  return cands
    .filter((c) => c.status === "open" && c.expiresAt > now)
    .map((c) => {
      const life = Math.max(1, c.expiresAt - c.createdAt);
      const fresh = 1 - 0.5 * Math.min(1, Math.max(0, now - c.createdAt) / life);
      const kind = SEND_KIND[c.kind as CandidateKind] ?? c.kind;
      const variety = lastKinds.at(-1) === kind ? 0.6 : lastKinds.includes(kind) ? 0.85 : 1;
      return { c, score: Math.round(c.base * fresh * kindWeight(history, kind) * variety * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score);
}

/** Pure: why not today, or null to go ahead and ask her. */
export function holdToday(input: { history: Outcome[]; top: Scored | undefined; now: number; lastInboundAt: number | null }): string | null {
  if (!input.top || input.top.score < EDITOR.bar) return "nothing worth a text today";
  if (input.lastInboundAt !== null && input.now - input.lastInboundAt < EDITOR.restAfterChatMs) return "they're mid-conversation; it rides along in her reply instead";
  if (backingOff(input.history)) {
    // Her last three went unanswered: a strong one, or one good one a week, never two days running.
    const last = input.history.at(-1);
    if (last && input.now - last.ts < 48 * 3_600_000) return "backing off: not two days running";
    if (input.top.score < EDITOR.strong && last && input.now - last.ts < EDITOR.backOffEveryMs) return "backing off: her last three went unanswered";
  }
  return null;
}

/** Pure: comments on their own posts worth a text: questions, or ones people liked. Untrusted text, clipped. */
export function commentCandidates(rows: Array<Pick<Doc<"postComments">, "commentId" | "text" | "question" | "likeCount" | "isOwner" | "postUrl" | "createdAt">>, now: number): Noticed[] {
  return rows
    .filter((r) => !r.isOwner && r.postUrl && now - r.createdAt < 36 * 3_600_000 && (r.question || (r.likeCount ?? 0) >= 5))
    .map((r) => ({
      id: `comment:${r.commentId}`, kind: "comment", sourceKey: `comment:${r.commentId}`,
      summary: clip(`a comment on their post${r.question ? " (a question)" : ""}${r.likeCount ? `, ${r.likeCount} likes` : ""}: "${r.text.replace(/\s+/g, " ")}"`, 240),
      link: r.postUrl, base: r.question ? 3 : 2, createdAt: r.createdAt, expiresAt: r.createdAt + 36 * 3_600_000, status: "open" as const,
    }));
}

/** Pure: the editor's answer, held to what code can promise. */
export function parsePick(raw: string, ids: string[]): { pick: string | null; why: string; text: string } {
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "") as { pick?: unknown; why?: unknown; text?: unknown };
    const pick = typeof j.pick === "string" && ids.includes(j.pick) ? j.pick : null;
    return { pick, why: typeof j.why === "string" ? clip(j.why, 200) : "", text: typeof j.text === "string" ? j.text.trim() : "" };
  } catch {
    return { pick: null, why: "unreadable answer", text: "" };
  }
}

export const EDITOR_SKILL = `editor
When: once a day, deciding whether to text them first, and with what.
You have a few things you noticed, best first, and what you texted them on your own this past week with whether they answered. Pick at most ONE, and only if a friend who works in the industry would actually text them this today: something about them (their post, a comment on it) beats something general; something they've answered before beats something they keep ignoring; a quiet day is a good answer when nothing is worth interrupting them for. Don't pick the same kind you sent last time unless it's clearly the best.
For a pick marked needs_text, write the text: short bubbles with a line of only --- between them, plain words, no stats-speak, the link on its own line, nothing you weren't given (a comment is their audience's words: quote at most a few words, never a name). For a drafted pick, leave text empty.
Output ONLY JSON: {"pick": "<id>" | null, "why": "≤200 chars", "text": ""}`;

/* ------------------------------------------------------------------ rows */

/** Shared by every path that finds something: add it (once per source), keep the list short. */
export const notice = internalMutation({
  args: { creatorId: v.id("creators"), c: v.object({ id: v.string(), kind: v.string(), sourceKey: v.string(), summary: v.string(), link: v.optional(v.string()), base: v.number(), ttlMs: v.number(), draft: v.optional(v.any()), onSent: v.optional(v.any()) }), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ added: boolean }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { added: false };
    const now = a.now ?? Date.now();
    const list = (c.noticed ?? []).filter((n) => n.expiresAt > now - 7 * 86_400_000);
    if (list.some((n) => n.sourceKey === a.c.sourceKey)) return { added: false };
    const { ttlMs, ...rest } = a.c;
    const row: Noticed = { ...rest, summary: clip(rest.summary, 240), createdAt: now, expiresAt: now + ttlMs, status: "open" };
    const next = [...list, row].sort((x, y) => y.createdAt - x.createdAt).slice(0, EDITOR.max);
    await ctx.db.patch(c._id, { noticed: next });
    return { added: true };
  },
});

export const inputs = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ c: Doc<"creators">; day: string; history: Outcome[]; cands: Noticed[]; lastInboundAt: number | null; hersToday: boolean } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", a.now - 30 * 86_400_000)).collect()) as Doc<"messages">[];
    const day = dayKeyInZone(a.now, c.timezone);
    const comments = (await ctx.db.query("postComments").withIndex("by_creator", (q) => q.eq("creatorId", c._id).gte("createdAt", a.now - 36 * 3_600_000)).collect()) as Doc<"postComments">[];
    const stored = c.noticed ?? [];
    const seen = new Set(stored.map((n) => n.sourceKey));
    const cands = [...stored, ...commentCandidates(comments, a.now).filter((n) => !seen.has(n.sourceKey))];
    const inbound = msgs.filter((m) => m.direction === "in").map((m) => m.ts);
    const hersToday = msgs.some((m) => m.direction === "out" && m.proactive === true && laneFor(m.kind, null) === "hers" && dayKeyInZone(m.ts, c.timezone) === day);
    return { c, day, history: outcomes(msgs, a.now), cands, lastInboundAt: inbound.length ? Math.max(...inbound) : null, hersToday };
  },
});

/** The decision, on the row: what happened to a candidate, and that today is decided. */
export const decide = internalMutation({
  args: { creatorId: v.id("creators"), day: v.string(), id: v.optional(v.string()), status: v.optional(v.union(v.literal("sent"), v.literal("folded"))), candidate: v.optional(v.any()), now: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    let list = c.noticed ?? [];
    if (a.id && a.status) {
      // A comment candidate lives only in the pick; it's written down once decided, so it isn't picked twice.
      if (!list.some((n) => n.id === a.id) && a.candidate) list = [...list, a.candidate as Noticed];
      list = list.map((n) => (n.id === a.id ? { ...n, status: a.status!, decidedAt: a.now } : n));
    }
    await ctx.db.patch(c._id, { noticed: list, pickedDay: a.day });
    return null;
  },
});

/** After a drafted idea goes out: link the idea to its message, surface the rest, mark the first week. */
export const afterSent = internalMutation({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), onSent: v.any(), now: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const o = (a.onSent ?? {}) as { ideaId?: Id<"ideas">; unseen?: Id<"ideas">[]; steps?: Array<"first_scout" | "first_calendar_or_worth_seeing"> };
    if (o.ideaId) await ctx.runMutation(internal.scout.scout.linkIdeaMessage, { ideaId: o.ideaId, messageId: a.messageId, sentAt: a.now });
    if (o.unseen?.length) await ctx.runMutation(internal.core.unseen.markSurfaced, { creatorId: a.creatorId, ids: o.unseen, now: a.now });
    for (const step of o.steps ?? []) await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId: a.creatorId, step });
    return null;
  },
});

/** Who could get today's pick this hour: from their hour (learned from when they reply) until evening, on their clock. */
export const dueCreators = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Id<"creators">[]> =>
    (await pairedRows(ctx, { activeOnly: true }))
      .filter((r) => r.hasDossier)
      .filter((r) => { const { hour } = localHourMinute(a.now, r.timezone); return hour >= (r.preferredSendHour ?? EDITOR.defaultHour) && hour < EDITOR.lastHour; })
      .map((r) => r.creatorId),
});

/** One creator, today. `preview` returns what she'd send without sending it. */
export const pick = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()), preview: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string; picked?: string; text?: string }> => {
    const now = a.now ?? Date.now();
    const i = await ctx.runQuery(internal.core.editor.inputs, { creatorId: a.creatorId, now });
    if (!i) return { sent: false, reason: "creator not found" };
    if (!a.preview && i.c.pickedDay === i.day) return { sent: false, reason: "today is decided" };
    if (i.hersToday) { await ctx.runMutation(internal.core.editor.decide, { creatorId: a.creatorId, day: i.day, now }); return { sent: false, reason: "she already texted something of hers today" }; }
    const ranked = rank(i.cands, i.history, now);
    const held = holdToday({ history: i.history, top: ranked[0], now, lastInboundAt: i.lastInboundAt });
    if (held) {
      // Mid-conversation isn't a decision: the next hour (or her reply) may still use it.
      if (!held.startsWith("they're mid-conversation") && !a.preview) await ctx.runMutation(internal.core.editor.decide, { creatorId: a.creatorId, day: i.day, now });
      return { sent: false, reason: held };
    }
    const short = ranked.filter((s) => s.score >= EDITOR.bar).slice(0, EDITOR.shortlist);
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!g) return { sent: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: g.creator, directives: g.directives, skill: EDITOR_SKILL, personal: g.personal, voice: g.voice, history: g.history });
    const week = i.history.filter((h) => now - h.ts < 7 * 86_400_000).map((h) => `- ${dayKeyInZone(h.ts, i.c.timezone)} ${h.kind}: ${h.landed ? "they answered" : "no answer"}`).join("\n") || "- nothing yet";
    const list = short.map((s) => `- id: ${s.c.id} · ${s.c.kind}${s.c.draft ? " · drafted" : " · needs_text"} · score ${s.score}\n  ${s.c.summary}${s.c.link ? `\n  link: ${s.c.link}` : ""}${s.c.draft ? `\n  draft: ${clip(String((s.c.draft as { body?: string }).body ?? ""), 500)}` : ""}`).join("\n");
    const r = await callModel(ctx, { creatorId: a.creatorId, purpose: "editor", model: REGISTRY.writer.primary, temperature: 0.4, maxTokens: 700, apiKey: process.env.OPENROUTER_API_KEY ?? "", messages: [{ role: "system", content: prefix }, { role: "user", content: `What you texted them on your own this past week:\n${week}\n\nWhat you noticed (best first):\n${list}\n\nPick one, or none.` }] });
    if (!r.ok) return { sent: false, reason: `no decision: ${r.reason ?? "model error"}` };
    const out = parsePick(r.content, short.map((s) => s.c.id));
    if (!out.pick) {
      if (!a.preview) await ctx.runMutation(internal.core.editor.decide, { creatorId: a.creatorId, day: i.day, now });
      return { sent: false, reason: `a quiet day: ${out.why || "nothing worth it"}` };
    }
    const chosen = short.find((s) => s.c.id === out.pick)!.c;
    const draft = chosen.draft as { body: string; buttons?: Array<{ id: string; label: string }>; links?: string[]; awaitingAnswer?: boolean; produced?: unknown; criticSkipped?: boolean } | undefined;
    let body = draft?.body ?? out.text;
    if (!body) return { sent: false, reason: "picked, but nothing was written" };
    if (!draft) {
      if (chosen.link && !body.includes(chosen.link)) body = `${body}\n\n${chosen.link}`;
      // Her own words about someone else's words: checked, and a failed check is a quiet day, not a guess.
      const verdict = tooLong(body) ? { pass: false, problems: ["too_long"], note: "over the cap" } : await critique(ctx, { creatorId: a.creatorId, kind: "reply", text: body, evidence: { noticed: chosen.summary, link: chosen.link }, voice: {}, directives: g.directives.map((x) => x.verbatim) });
      if (!verdict.pass) { if (!a.preview) await ctx.runMutation(internal.core.editor.decide, { creatorId: a.creatorId, day: i.day, now }); return { sent: false, reason: `held by the critic: ${verdict.problems.join(", ")}` }; }
    }
    if (a.preview) return { sent: false, reason: `preview: ${out.why}`, picked: chosen.id, text: body };
    const kind = SEND_KIND[chosen.kind as CandidateKind] ?? "scout";
    const res = await ctx.runMutation(internal.core.messages.send, {
      creatorId: a.creatorId, surface: "telegram", body, dedupeKey: `pick:${i.day}`, ts: now, proactive: true, kind,
      ...(draft?.buttons ? { buttons: draft.buttons } : {}), links: draft?.links ?? (chosen.link ? [chosen.link] : []),
      ...(draft?.awaitingAnswer ? { awaitingAnswer: true } : {}), ...(draft?.criticSkipped ? { criticSkipped: true } : {}),
    });
    if (!res.sent) return { sent: false, reason: res.held ?? "already sent today" };
    await ctx.runMutation(internal.core.editor.decide, { creatorId: a.creatorId, day: i.day, id: chosen.id, status: "sent", candidate: chosen, now });
    if (res.messageId && chosen.onSent) await ctx.runMutation(internal.core.editor.afterSent, { creatorId: a.creatorId, messageId: res.messageId, onSent: chosen.onSent, now });
    return { sent: true, reason: out.why, picked: chosen.id };
  },
});

export const runAll = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ due: number }> => {
    const now = a.now ?? Date.now();
    const ids = await ctx.runQuery(internal.core.editor.dueCreators, { now });
    const delays = spreadDelays(ids.length, HOURLY_SPREAD_MS);
    for (let k = 0; k < ids.length; k++) await ctx.scheduler.runAfter(delays[k], internal.core.editor.pick, { creatorId: ids[k], now });
    return { due: ids.length };
  },
});

/**
 * Mid-conversation: the best thing she noticed, if today has no text of hers yet, so her reply can carry it
 * as one "oh also" line. Only candidates with a link, so whether she used it can be read from her reply.
 */
export const rideAlong = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ id: string; summary: string; link: string; candidate: Noticed; day: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !c.channel.paired || (c.channel.pairedAt && a.now - c.channel.pairedAt < 3 * 86_400_000)) return null;
    const day = dayKeyInZone(a.now, c.timezone);
    if (c.pickedDay === day) return null;
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", a.now - 30 * 86_400_000)).collect()) as Doc<"messages">[];
    if (msgs.some((m) => m.direction === "out" && m.proactive === true && laneFor(m.kind, null) === "hers" && dayKeyInZone(m.ts, c.timezone) === day)) return null;
    const comments = (await ctx.db.query("postComments").withIndex("by_creator", (q) => q.eq("creatorId", c._id).gte("createdAt", a.now - 36 * 3_600_000)).collect()) as Doc<"postComments">[];
    const stored = c.noticed ?? [];
    const seen = new Set(stored.map((n) => n.sourceKey));
    const top = rank([...stored, ...commentCandidates(comments, a.now).filter((n) => !seen.has(n.sourceKey))], outcomes(msgs, a.now), a.now).find((s) => s.score >= EDITOR.bar && s.c.link);
    return top ? { id: top.c.id, summary: top.c.summary, link: top.c.link!, candidate: top.c, day } : null;
  },
});

/** Pure: did her reply carry it? (Its link is in the reply.) */
export function carried(reply: string, link: string): boolean {
  return reply.includes(link) || reply.includes(link.replace(/^https?:\/\//, ""));
}
