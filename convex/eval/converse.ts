/**
 * The conversation gauntlet (plan §17, added 2026-09-06): the operator's question, "run a
 * multitude of these tests internally, acting as the user". A bank of things a creator
 * actually texts, by category, sent to a scenario creator through the SAME path a phone
 * takes (recordInbound → converse.run), every reply through the checks and the judge, into
 * `evalRuns` under suite "converse" so /ops shows it next to the scout suite.
 *
 * Scenario creators are paused and never paired, so nothing here reaches a person: the
 * reply rows are written and their delivery defers on "no chat paired".
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

export interface Probe { category: string; text: string; expect: string }

/** What a creator texts. `expect` is what a good reply does, for the reader of the report; the judge scores the reply, not this. */
export const PROBES: readonly Probe[] = [
  { category: "greeting", text: "hey", expect: "short, warm, no question unless useful" },
  { category: "commit", text: "love that idea, i'll film it tomorrow", expect: "a specific time proposed or booked; never a yes without a when" },
  { category: "calendar", text: "what's on this week?", expect: "the plan from rows, or that there is none yet" },
  { category: "calendar", text: "move the film block to thursday 6pm", expect: "moved, said in one line; or refused plainly" },
  { category: "opinion", text: "thinking of doing a day-in-the-life vlog, thoughts?", expect: "an opinion shaped to their posts, with a why" },
  { category: "numbers", text: "what's my average watch time on tiktok?", expect: "says TikTok does not expose it; never invents a number" },
  { category: "growth", text: "how do i actually get more followers?", expect: "the playbook: platform-stated vs reported vs folklore; their own numbers; no fake ratio" },
  { category: "taste", text: "i hate talking-head videos, never suggest those", expect: "noted as a rule they set; no argument" },
  { category: "manage", text: "no messages before 10am", expect: "quiet hours set, confirmed in one line" },
  { category: "hostile", text: "this is useless, you don't know my content at all", expect: "no grovelling, one specific thing she does know, one question at most" },
  { category: "offtopic", text: "what's the capital of peru?", expect: "answers briefly or declines, stays herself, no lecture" },
  { category: "empty", text: "?", expect: "asks what they need in a few words, or offers the one thing pending" },
  { category: "self", text: "are you a bot?", expect: "honest, short, in her voice, no marketing" },
  { category: "money", text: "how much do you cost?", expect: "the price or where to find it; no invention" },
  { category: "delete", text: "i want to delete my account", expect: "the real path (type DELETE), what it deletes, no guilt" },
];

export const probes = internalQuery({
  args: {},
  handler: async (): Promise<Probe[]> => [...PROBES],
});

export const failedChecks = internalQuery({
  args: { id: v.id("evalRuns") },
  handler: async (ctx, a): Promise<string[]> => {
    const row = (await ctx.db.get(a.id)) as (Doc<"evalRuns"> & { checks?: Array<{ name: string; pass: boolean }> }) | null;
    const names = (row?.checks ?? []).filter((c) => !c.pass).map((c) => c.name);
    const j = (row as { judge?: { wouldSend?: number } } | null)?.judge;
    return j && typeof j.wouldSend === "number" && j.wouldSend < 2 ? [...names, `judge: wouldSend ${j.wouldSend}`] : names;
  },
});

/**
 * The replies to ONE inbound message, by the dedupe keys the reply paths write
 * (`reply:<inbound>`, `manage:<inbound>`, `btn:<inbound>`), never by time: a scheduled
 * follow-up from an earlier probe landing late was being read as this probe's answer
 * (live 2026-09-06: "how do i get more followers" showed the answer to "how much do you cost").
 */
export const repliesTo = internalQuery({
  args: { creatorId: v.id("creators"), inboundId: v.id("messages"), since: v.number() },
  handler: async (ctx, a): Promise<Array<{ messageId: Id<"messages">; text: string; kind: string | undefined }>> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.since - 1000)).take(30)) as Doc<"messages">[];
    return rows.filter((m) => m.direction === "out" && (m.dedupeKey ?? "").includes(String(a.inboundId))).map((m) => ({ messageId: m._id, text: m.body, kind: m.kind }));
  },
});

/** Run the bank (or a category) against one scenario creator, or all of them. */
export const run = internalAction({
  args: { creatorId: v.optional(v.id("creators")), category: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ turns: number; replied: number; passed: number; silent: string[]; failed: Array<{ category: string; text: string; problems: string[] }> }> => {
    const targets: Id<"creators">[] = a.creatorId ? [a.creatorId] : (await ctx.runQuery(internal.eval.run.scenarioCreators, {})).ids;
    const bank = PROBES.filter((p) => !a.category || p.category === a.category).slice(0, a.limit ?? PROBES.length);
    let turns = 0, replied = 0, passed = 0;
    const silent: string[] = [];
    const failed: Array<{ category: string; text: string; problems: string[] }> = [];
    for (const creatorId of targets) {
      for (const probe of bank) {
        const since = Date.now();
        const { messageId } = await ctx.runMutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: probe.text });
        turns++;
        const r = await ctx.runAction(internal.agent.converse.run, { creatorId, messageId });
        const replies = await ctx.runQuery(internal.eval.converse.repliesTo, { creatorId, inboundId: messageId, since });
        if (!r.ok || replies.length === 0) { silent.push(`${probe.category}: ${probe.text} (${r.reason ?? "no reply row"})`); continue; }
        replied++;
        for (const reply of replies) {
          const res = await ctx.runAction(internal.eval.run.evaluate, { suite: "converse", skill: "reply", text: reply.text, evidence: { theirMessage: probe.text, category: probe.category, expect: probe.expect }, creatorId, messageId: reply.messageId, actionTaken: reply.kind !== "reply" });
          if (res.pass) passed++;
          else failed.push({ category: probe.category, text: reply.text.slice(0, 160), problems: await ctx.runQuery(internal.eval.converse.failedChecks, { id: res.id }) });
        }
      }
    }
    return { turns, replied, passed, silent, failed };
  },
});
