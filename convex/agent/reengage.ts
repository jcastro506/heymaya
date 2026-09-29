/**
 * Reaching back out to someone who has gone quiet (re-engagement, 2026-09-28).
 *
 * One function decides whether she texts into a silence and which rung it is: `decideReengage`. It is
 * pure and owns every rule; the action below only gathers rows, asks the writer, and sends through
 * `messages.send` (so the daily cap, quiet hours, opt-out and Linq's chat-health rail still hold).
 *
 * The shape, from Linq's Chat Health guidance (texting into silence is the fastest way to a flagged
 * line) and from "grounded or silent":
 *   nudge     ≥3 days silent, and only when there is something TRUE to say (an idea they haven't seen, a
 *             post of theirs doing well). Worded to be answered in a word.
 *   nudge2    ≥9 days, ≥6 days after the first, again only with something true and new.
 *   easy_out  ≥15 days: the last text until they write. Says she'll stop, and how to choose (pause, or
 *             send anything). Goes even with nothing to report: it is the exit, not a pitch.
 * After the easy-out: nothing, until they text. Their next message of any kind starts a new spell.
 *
 * A spell is identified by the message that opened it (their last inbound), never by a timestamp, so it
 * survives the simulations that shift time. A rung is sent at most once per spell (dedupe key).
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { deliverNow } from "../core/scheduler";
import { dayKeyInZone } from "../core/cadence";
import { REGISTRY } from "./registry";
import { buildPrefix, producedStamp } from "./context";
import { critique } from "./critic";
import { capabilityFor, capabilityKey, returnFacts, type Capability, type Reason } from "./returnFacts";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const REENGAGE = {
  nudgeAfterDays: 3,
  nudge2AfterDays: 9,
  easyOutAfterDays: 15,
  /** At least this long between rungs: about one text a week to someone who is not answering. */
  minGapDays: 6,
  /** Nudges wait if we have already texted them this recently: they are being reached. */
  nudgeQuietMs: 48 * HOUR,
  easyOutQuietMs: 20 * HOUR,
  /** Three unanswered texts (Linq's ladder): only the easy-out is left. */
  maxUnansweredBeforeEasyOut: 3,
} as const;

/** Reminders for a shoot they booked and status lines are commitments, not "texting into silence". */
export const COMMITMENT_KINDS = ["reminder", "checkin", "status"] as const;

export type Rung = "nudge" | "nudge2" | "easy_out";

export interface SpellSend { ts: number; kind: string | undefined; dedupeKey: string | undefined }

export interface ReengageInput {
  now: number;
  paired: boolean;
  optedOutAt: number | undefined;
  lastInboundAt: number | null;
  pairedAt: number | null;
  /** The message that opened this spell (their last inbound), or "paired" if they never wrote. */
  spellId: string;
  /** Proactive texts sent since the spell opened, oldest first. */
  sends: SpellSend[];
  reasons: Reason[];
  capability: Capability | null;
  /** Her last two nudge / easy-out texts to them (any spell), so the next one is worded differently. */
  earlier?: string[];
}

export type Decision =
  | { send: false; why: string }
  | { send: true; rung: Rung; kind: "nudge" | "quiet"; reasons: Reason[]; capability: Capability | null; dedupeKey: string; silentDays: number };

const no = (why: string): Decision => ({ send: false, why });

export const spellKey = (spellId: string, rung: Rung): string => `reengage:${spellId}:${rung}`;

/** Pure. The whole policy. */
export function decideReengage(i: ReengageInput): Decision {
  if (!i.paired) return no("not paired");
  if (i.optedOutAt !== undefined) return no("they opted out; nothing goes until they text again");
  const since = i.lastInboundAt ?? i.pairedAt;
  if (since === null) return no("no start point for the silence");
  if (since > i.now) return no("their last message is in the future (clock skew)");
  const days = (i.now - since) / DAY;

  const prefix = `reengage:${i.spellId}:`;
  const mine = i.sends.filter((s) => s.dedupeKey?.startsWith(prefix));
  const rungs = mine.map((s) => s.dedupeKey!.slice(prefix.length));
  if (rungs.includes("easy_out")) return no("dormant: the easy-out has gone; nothing until they write");

  const lastRungAt = mine.length ? Math.max(...mine.map((s) => s.ts)) : null;
  const sinceLastRungDays = lastRungAt === null ? Infinity : (i.now - lastRungAt) / DAY;
  const lastSendAt = i.sends.length ? Math.max(...i.sends.map((s) => s.ts)) : null;
  const sinceAnySendMs = lastSendAt === null ? Infinity : i.now - lastSendAt;
  const silentDays = Math.floor(days);

  if (days >= REENGAGE.easyOutAfterDays && sinceLastRungDays >= REENGAGE.minGapDays) {
    if (sinceAnySendMs < REENGAGE.easyOutQuietMs) return no("we just texted them; the easy-out waits a day");
    return { send: true, rung: "easy_out", kind: "quiet", reasons: [], capability: null, dedupeKey: spellKey(i.spellId, "easy_out"), silentDays };
  }

  const nudgesSent = rungs.filter((r) => r === "nudge" || r === "nudge2").length;
  const want: Rung | null = nudgesSent === 0 && days >= REENGAGE.nudgeAfterDays ? "nudge"
    : nudgesSent === 1 && days >= REENGAGE.nudge2AfterDays && sinceLastRungDays >= REENGAGE.minGapDays ? "nudge2"
    : null;
  if (!want) return no(nudgesSent >= 2 ? "both nudges have gone; the easy-out is next" : "not yet: the schedule hasn't reached the next rung");

  const unanswered = i.sends.filter((s) => !(COMMITMENT_KINDS as readonly string[]).includes(s.kind ?? "")).length;
  if (unanswered >= REENGAGE.maxUnansweredBeforeEasyOut) return no("three texts are already unanswered; only the easy-out is left");
  if (sinceAnySendMs < REENGAGE.nudgeQuietMs) return no("we texted them in the last 48 hours; they're already being reached");
  if (!i.reasons.length) return no("nothing true and useful to say yet");
  return { send: true, rung: want, kind: "nudge", reasons: i.reasons, capability: i.capability, dedupeKey: spellKey(i.spellId, want), silentDays };
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                      */
/* -------------------------------------------------------------------------- */

export const REENGAGE_SKILL = `reengage (they have gone quiet, and there is something true to tell them)
When: they haven't written in a few days and code found something real: new ideas waiting in their app, or a post of theirs doing well. You are texting first, into a silence, so it has to be worth their phone lighting up.
The judgment: one short text, under 40 words, in your voice, worded fresh each time (you'll be shown your earlier ones: don't reuse their opening or their closing question). Lead with the thing itself (the idea's hook, or the post and its number), named from the list you were given and nothing else. End with one easy thing they can answer in a word ("want it?", "should i write the shot list?"): a reason to reply, never a demand. If you were given something you can offer, add it as one plain clause only if it fits what you just said; if it doesn't fit, leave it out. Never "just checking in", never "it's been a while", "haven't heard from you", "where'd you go"; no guilt, no list of what they missed, no row of exclamation marks. Every fact and number comes from the list; invent nothing.
Output the text only.`;

export const EASY_OUT_SKILL = `easy-out (the last text into a long silence)
When: they haven't written in about two weeks and you have texted a few times with no reply. This is the last text you will send until they write.
The judgment: say plainly, like a friend easing off, that you'll stop texting so much, and give them the easy way to choose: tell you "pause" and you go fully quiet, or send anything at all (a 👍 is enough) and you're right back. Not a system notice: never "reply X to Y", "text X to stop", "opt out". Under 35 words, warm, no guilt, no summary of what they missed, no question that needs an answer. If the prefix carries something of theirs worth one clause (a race, a bit), you may use it; otherwise don't. Never "just checking in", never "it's been a while".
Output the text only.`;

/** If the writer can't produce a clean easy-out, this goes: the exit must never depend on a model. */
export const EASY_OUT_FALLBACK = "still here. i'll stop texting so much. tell me pause and i'll go fully quiet, or send me anything and i'm right back.";

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

export const inputs = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ input: ReengageInput; unanswered: number } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const recent = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(300)) as Doc<"messages">[];
    const lastIn = recent.find((m) => m.direction === "in") ?? null;
    const pairedAt = c.channel.pairedAt ?? null;
    const since = lastIn?.ts ?? pairedAt;
    const sends = since === null ? [] : recent.filter((m) => m.direction === "out" && m.proactive === true && m.ts > since).sort((x, y) => x.ts - y.ts).map((m) => ({ ts: m.ts, kind: m.kind, dedupeKey: m.dedupeKey }));
    const reasons = since === null ? [] : await returnFacts(ctx, c, since, a.now, { skipSaid: true });
    const capability = reasons.length ? await capabilityFor(ctx, c, a.now) : null;
    const earlier = recent.filter((m) => m.direction === "out" && m.proactive === true && (m.kind === "nudge" || m.kind === "quiet")).slice(0, 2).map((m) => m.body);
    const input: ReengageInput = { now: a.now, paired: c.channel.paired, optedOutAt: c.channel.optedOutAt, lastInboundAt: lastIn?.ts ?? null, pairedAt, spellId: lastIn ? String(lastIn._id) : "paired", sends, reasons, capability, earlier };
    return { input, unanswered: sends.filter((s) => !(COMMITMENT_KINDS as readonly string[]).includes(s.kind ?? "")).length };
  },
});

/* -------------------------------------------------------------------------- */
/* The action                                                                  */
/* -------------------------------------------------------------------------- */

/** One creator, one decision, at most one text. Called by the hourly cadence at 18:00 on their clock (through `cadence.quiet`). */
export const run = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const now = a.now ?? Date.now();
    const got = await ctx.runQuery(internal.agent.reengage.inputs, { creatorId: a.creatorId, now });
    if (!got) return { sent: false, reason: "creator not found" };
    const d = decideReengage(got.input);
    if (!d.send) return { sent: false, reason: d.why };

    const rails = await ctx.runQuery(internal.scout.gate.railsOnly, { creatorId: a.creatorId, now });
    if (!rails?.ok) return { sent: false, reason: rails?.reason ?? "rails" };
    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!gathered) return { sent: false, reason: "creator not found" };

    const easyOut = d.rung === "easy_out";
    const spec = REGISTRY.writer;
    const prefix = buildPrefix({ creator: gathered.creator, directives: gathered.directives, skill: easyOut ? EASY_OUT_SKILL : REENGAGE_SKILL, personal: gathered.personal, voice: gathered.voice, history: gathered.history });
    const facts = d.reasons.map((r) => `- ${r.text}`).join("\n");
    const ask = easyOut
      ? `They last wrote ${d.silentDays} days ago. You have texted ${got.unanswered} time${got.unanswered === 1 ? "" : "s"} since with no reply. This is your last text until they write. Write it.`
      : `True right now (say these, nothing else):\n${facts}${d.capability ? `\nSomething you can offer, only if it fits what you just said: ${d.capability.text}` : ""}\n\nWrite the text.`;
    const earlier = (got.input.earlier ?? []).length ? `\n\nYour last texts of this kind to them (say it differently; don't reuse their phrasing or shape):\n${got.input.earlier!.map((t) => `- ${t.replace(/\s+/g, " ")}`).join("\n")}` : "";
    const write = async (purpose: string, extra = "") => {
      const r = await callModel(ctx, { creatorId: a.creatorId, purpose, model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `${ask}${earlier}${extra}` }], temperature: 0.7, maxTokens: 160, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      return r.ok ? r.content.trim() : "";
    };
    const evidence = { reasons: d.reasons.map((r) => r.text), offer: d.capability?.text ?? null, silentDays: d.silentDays };
    const judgeIt = (text: string) => critique(ctx, { creatorId: a.creatorId, kind: "reply", text, evidence, voice: {}, directives: gathered.directives.map((x) => x.verbatim) });

    let text = await write(easyOut ? "easy_out" : "reengage");
    let verdict = text ? await judgeIt(text) : null;
    if (!verdict?.pass) {
      const why = verdict ? `Your line was rejected for: ${verdict.problems.join(", ")} (${verdict.note}). Write it again, fixing exactly that.` : "Your last attempt was empty. Write it.";
      text = await write(easyOut ? "easy_out_rewrite" : "reengage_rewrite", `\n\n${why} Text only.`);
      verdict = text ? await judgeIt(text) : null;
    }
    let criticSkipped = verdict?.skipped === true;
    if (!verdict?.pass) {
      if (!easyOut) return { sent: false, reason: `held: no clean line (${verdict ? verdict.problems.join(", ") : "the writer gave nothing"})` };
      text = EASY_OUT_FALLBACK;
      criticSkipped = true;
    }

    const sent = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: text, dedupeKey: d.dedupeKey, ts: now, proactive: true, capped: true, kind: d.kind, awaitingAnswer: false, produced: producedStamp(spec.primary), criticSkipped });
    if (!sent.sent) return { sent: false, reason: sent.held ?? "already said" };
    for (const r of d.reasons) await ctx.runMutation(internal.agent.history.markSaid, { creatorId: a.creatorId, key: r.key });
    if (d.capability) await ctx.runMutation(internal.agent.history.markSaid, { creatorId: a.creatorId, key: capabilityKey(d.capability.id, dayKeyInZone(now, gathered.creator.timezone)) });
    await deliverNow(ctx as never);
    return { sent: true, reason: d.rung };
  },
});
