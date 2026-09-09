/**
 * The memory gauntlet (2026-09-08): a real Maya, real model, real reads, pushed to the
 * boundaries the operator named. Does she clock a change of direction they told her in
 * words, remember it a turn later, and not contradict it with the drift question? Does a
 * calendar event she was handed show up in the scout, in the morning line, in a reply, and
 * does a block follow it when it moves? Does a commitment in chat become a row? Does the
 * evening question, the rebook, the readback's viewer line, the review and the quiet line
 * all fire from rows and rails?
 *
 * Runs on a scenario creator (never paired: rows are written, deliveries defer). Every
 * reply goes through the checks and the judge into evalRuns under suite "memory". The
 * transcript comes back so a person can read it.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

const D = 86_400_000, H = 3_600_000;

interface Step { step: string; said: string[]; facts: Record<string, unknown>; ok: boolean; why: string }

export const setPlanStatus = internalMutation({
  args: { creatorId: v.id("creators"), status: v.string() },
  handler: async (ctx, a): Promise<string> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return "none";
    const before = c.plan.status;
    await ctx.db.patch(a.creatorId, { plan: { ...c.plan, status: a.status as Doc<"creators">["plan"]["status"] }, updatedAt: Date.now() });
    return before;
  },
});

/** The creator's memory as she sees it: notes, rules, the prefix text, the lane. */
export const memoryOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ notes: string[]; rules: string[]; niche: string; keywords: string[]; lanes: unknown; growthPlan: unknown; prefix: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const rules = (await ctx.db.query("directives").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"directives">[];
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    const prefix = g ? `${JSON.stringify(g.creator.notes ?? [])}\n${g.personal}\n${g.history}\n${g.voice}` : "";
    return { notes: (c.notes ?? []).filter((n) => !n.tombstonedAt).map((n) => n.text), rules: rules.map((r) => r.verbatim), niche: c.niche, keywords: ((c.dossier as { keywords?: string[] } | undefined)?.keywords ?? []), lanes: c.lanes ?? null, growthPlan: c.growthPlan ?? null, prefix: prefix.slice(0, 8000) };
  },
});

export const outboundSince = internalQuery({
  args: { creatorId: v.id("creators"), since: v.number() },
  handler: async (ctx, a): Promise<Array<{ id: Id<"messages">; kind: string; body: string; buttons: string[]; awaitingAnswer: boolean; ts: number }>> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.since)).collect()) as Doc<"messages">[];
    return rows.filter((m) => m.direction === "out").sort((x, y) => x.ts - y.ts).map((m) => ({ id: m._id, kind: m.kind ?? "", body: m.body, buttons: (m.buttons ?? []).map((b) => b.id), awaitingAnswer: Boolean(m.awaitingAnswer), ts: m.ts }));
  },
});

export const blocksOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ id: Id<"calendarBlocks">; title: string; start: number; end: number; status: string; consented: boolean; filmedAt: number | null; missedAt: number | null; eventId: string | null }>> => {
    const rows = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"calendarBlocks">[];
    return rows.map((b) => ({ id: b._id, title: b.title, start: b.start, end: b.end, status: b.status, consented: Boolean(b.consentAt), filmedAt: b.filmedAt ?? null, missedAt: b.missedAt ?? null, eventId: b.externalEventId ?? null }));
  },
});

export const eventsOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ id: Id<"calendarEvents">; externalId: string; title: string; class: string; start: number; status: string }>> => {
    const rows = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"calendarEvents">[];
    return rows.map((e) => ({ id: e._id, externalId: e.externalId, title: e.title, class: e.class, start: e.start, status: e.status }));
  },
});

export const signalsOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ kind: string; verdict: string; why: string }>> => {
    const rows = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(30)) as Doc<"signals">[];
    return rows.map((s) => ({ kind: s.kind, verdict: s.verdict, why: s.why.slice(0, 120) }));
  },
});

/** Move every inbound row back in time, so the pulse reads a silence (the quiet step). */
export const backdateInbound = internalMutation({
  args: { creatorId: v.id("creators"), byMs: v.number() },
  handler: async (ctx, a): Promise<number> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"messages">[];
    let n = 0;
    for (const m of rows) if (m.direction === "in") { await ctx.db.patch(m._id, { ts: m.ts - a.byMs }); n += 1; }
    return n;
  },
});

export const buttonRow = internalMutation({
  args: { creatorId: v.id("creators"), body: v.string() },
  handler: async (ctx, a): Promise<Id<"messages">> => await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "in", surface: "telegram", kind: "button", body: a.body, ts: Date.now() }),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const run = internalAction({
  args: { handle: v.optional(v.string()), steps: v.optional(v.array(v.string())) },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; steps: Step[]; passed: number; failed: number }> => {
    const scenarios = await ctx.runQuery(internal.eval.scenarios.list, {});
    const sc = scenarios.find((s) => s.handle === (a.handle ?? "vanessaalopezz"));
    if (!sc) throw new Error("no such scenario creator");
    const creatorId = sc.creatorId;
    const only = a.steps ? new Set(a.steps) : null;
    const steps: Step[] = [];
    const t0 = Date.now();
    const before = await ctx.runMutation(internal.eval.memoryGauntlet.setPlanStatus, { creatorId, status: "active" });

    const say = async (text: string): Promise<string[]> => {
      const since = Date.now();
      const { messageId } = await ctx.runMutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: text });
      await ctx.runAction(internal.agent.converse.run, { creatorId, messageId });
      await sleep(9_000); // the remember pass is scheduled after the reply
      const out = await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since });
      for (const m of out) await ctx.runAction(internal.eval.run.evaluate, { suite: "memory", skill: m.kind === "reply" ? "reply" : m.kind, text: m.body, evidence: { theirMessage: text }, creatorId, messageId: m.id, actionTaken: m.kind !== "reply" });
      return out.map((m) => `[${m.kind}] ${m.body}${m.buttons.length ? `  {${m.buttons.join(" | ")}}` : ""}`);
    };
    const record = (step: string, said: string[], facts: Record<string, unknown>, ok: boolean, why: string) => { steps.push({ step, said, facts, ok, why }); };
    const want = (name: string) => !only || only.has(name);

    try {
      // 1. A change of direction, in words.
      if (want("direction")) {
        const said = await say("hey so real talk. i'm moving away from the running content. going all in on solo travel, hostels, the whv life in australia. keep the running as texture at most, not the main thing.");
        const mem = await ctx.runQuery(internal.eval.memoryGauntlet.memoryOf, { creatorId });
        const kept = Boolean(mem && (mem.notes.some((n) => /travel|hostel|whv/i.test(n)) || mem.rules.some((r) => /travel|hostel|whv|running/i.test(r))));
        const inPrefix = Boolean(mem && /travel|hostel|whv/i.test(mem.prefix));
        record("direction", said, { notes: mem?.notes, rules: mem?.rules, niche: mem?.niche, keywords: mem?.keywords, inPrefix }, kept, kept ? `a note or a rule now carries the direction${inPrefix ? ", and the prefix carries it" : ", but the prefix does not show it"}` : "nothing kept: the direction lives only in the chat log");
      }
      // 2. Recall it, in a new turn.
      if (want("recall")) {
        const said = await say("what did i tell you about where i'm taking the account?");
        const ok = said.some((s) => /travel|hostel|whv/i.test(s)) && !said.some((s) => /don't (know|recall)|nothing/i.test(s));
        record("recall", said, {}, ok, ok ? "she recalls the direction" : "she did not recall it");
      }
      // 3. The lane, now.
      if (want("lane")) {
        const said = await say("so what's my lane right now, one line.");
        const ok = said.some((s) => /travel|hostel|australia/i.test(s));
        record("lane", said, {}, ok, ok ? "the lane she states follows what they said" : "the lane she states ignores what they said");
      }
      // 4. The dossier rewrite: does the drift question contradict what they told her?
      if (want("drift")) {
        const since = Date.now();
        const r = await ctx.runAction(internal.onboarding.ingest.synthesize, { creatorId, reason: "weekly" });
        await sleep(2_000);
        const out = await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since });
        const mem = await ctx.runQuery(internal.eval.memoryGauntlet.memoryOf, { creatorId });
        const drift = out.find((m) => m.body.includes("widen your lane"));
        const said = out.map((m) => `[${m.kind}] ${m.body}`);
        // Either no drift question (the rewrite already took their word), or one that names what they said.
        const ok = Boolean(r.ok) && (!drift || /travel|you said|you told me/i.test(drift.body));
        record("drift", said, { rewrite: r, keywords: mem?.keywords, laneDriftAsked: Boolean(drift) }, ok, !r.ok ? `rewrite failed: ${r.reason}` : drift ? "the drift question fired as if they had said nothing" : "no contradictory drift question");
      }
      // 5. Calendar events, through the same door the Google sync uses.
      let tripId = "";
      if (want("calendar")) {
        const now = Date.now();
        const rows = [
          { calendarId: "primary", externalId: "ev-trip", title: "Byron Bay road trip", start: now + 3 * D + 9 * H, end: now + 3 * D + 18 * H, allDay: false, recurring: false, cancelled: false },
          { calendarId: "primary", externalId: "ev-dentist", title: "Dentist", start: now + 2 * D + 10 * H, end: now + 2 * D + 11 * H, allDay: false, recurring: false, cancelled: false },
          { calendarId: "primary", externalId: "ev-marathon", title: "Sydney Marathon", start: now + 5 * D + 6 * H, end: now + 5 * D + 12 * H, allDay: false, recurring: false, cancelled: false },
        ];
        await ctx.runMutation(internal.calendar.sync.upsertEvents, { creatorId, rows });
        const evs = await ctx.runQuery(internal.eval.memoryGauntlet.eventsOf, { creatorId });
        const cls = evs.map((e) => ({ id: e.id, class: (e.externalId === "ev-dentist" ? "private" : "filmable") as "private" | "filmable" }));
        await ctx.runMutation(internal.calendar.sync.applyClasses, { creatorId, classes: cls });
        const tz = (await ctx.runQuery(internal.calendar.secure.creatorTz, { creatorId }))?.timezone ?? "UTC";
        const n = await ctx.runMutation(internal.calendar.sync.writeSignals, { creatorId, timezone: tz, now });
        tripId = "ev-trip";
        const signals = await ctx.runQuery(internal.eval.memoryGauntlet.signalsOf, { creatorId });
        const cal = signals.filter((s) => s.kind === "calendar");
        record("calendar", [], { signalsWritten: n, calendarSignals: cal, events: (await ctx.runQuery(internal.eval.memoryGauntlet.eventsOf, { creatorId })).map((e) => `${e.title || "(private)"}:${e.class}`) }, cal.length >= 2, cal.length >= 2 ? "the trip and the marathon became calendar signals; the dentist did not" : "calendar signals missing");
      }
      // 6. The scout with a calendar signal on the table.
      if (want("scout")) {
        const since = Date.now();
        const r = await ctx.runAction(internal.scout.scout.run, { creatorId });
        const out = await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since });
        for (const m of out) await ctx.runAction(internal.eval.run.evaluate, { suite: "memory", skill: "scout", text: m.body, evidence: { calendar: true }, creatorId, messageId: m.id });
        const said = out.map((m) => `[${m.kind}] ${m.body}${m.buttons.length ? `  {${m.buttons.join(" | ")}}` : ""}`);
        const ok = r.sent && out.some((m) => /byron|marathon|road trip/i.test(m.body));
        record("scout", said, { result: r }, Boolean(ok), r.sent ? (ok ? "the idea rides the calendar event" : "an idea went out but not from the calendar") : `no idea sent: ${r.reason}`);
      }
      // 7. Ask about the calendar in chat: the private one stays private.
      if (want("calendar_chat")) {
        const said = await say("what's coming up on my calendar this week?");
        const ok = said.some((s) => /byron|marathon/i.test(s)) && !said.some((s) => /dentist/i.test(s));
        record("calendar_chat", said, {}, ok, ok ? "names the trip and the race, never the dentist" : "wrong or missing events in the reply");
      }
      // 8. A commitment in chat becomes a block.
      let blockId: Id<"calendarBlocks"> | null = null;
      if (want("commit")) {
        const said = await say("ok let's film the hostel tour thursday at 5pm. put it in.");
        const blocks = await ctx.runQuery(internal.eval.memoryGauntlet.blocksOf, { creatorId });
        const b = blocks.filter((x) => x.status !== "deleted" && x.consented).sort((x, y) => y.start - x.start)[0];
        blockId = b?.id ?? null;
        const okTime = b ? new Date(b.start).getUTCDay() >= 0 : false;
        record("commit", said, { blocks: blocks.map((x) => `${x.title} @ ${new Date(x.start).toISOString()} ${x.status}${x.consented ? " booked" : ""}`) }, Boolean(b) && okTime, b ? "a booked block exists after the commitment" : "no block: the commitment stayed words");
      }
      // 9. The morning line on the block's day.
      if (want("morning") && blockId) {
        const blocks = await ctx.runQuery(internal.eval.memoryGauntlet.blocksOf, { creatorId });
        const b = blocks.find((x) => x.id === blockId)!;
        const tz = (await ctx.runQuery(internal.calendar.secure.creatorTz, { creatorId }))?.timezone ?? "UTC";
        const eightThatDay = new Date(b.start); // 8:00 on their clock, the day of the block
        const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(eightThatDay));
        const morningTs = b.start - (localHour - 8) * H;
        const since = Date.now();
        const r = await ctx.runAction(internal.agent.cadence.morning, { creatorId, now: morningTs });
        const out = await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since });
        for (const m of out) await ctx.runAction(internal.eval.run.evaluate, { suite: "memory", skill: "reply", text: m.body, evidence: { block: b.title }, creatorId, messageId: m.id });
        const said = out.map((m) => `[${m.kind}] ${m.body}`);
        const ok = r.sent && out.some((m) => /hostel|tour|5/i.test(m.body));
        record("morning", said, { result: r, block: b.title }, Boolean(ok), r.sent ? (ok ? "the morning names the shoot" : "the morning did not name the shoot") : `no morning line: ${r.reason}`);
      }
      // 10. The event moves under her; the block follows and she says so.
      if (want("move") && tripId) {
        const evs = await ctx.runQuery(internal.eval.memoryGauntlet.eventsOf, { creatorId });
        const trip = evs.find((e) => e.externalId === tripId)!;
        const since = Date.now();
        const r = await ctx.runMutation(internal.calendar.sync.upsertEvents, { creatorId, rows: [{ calendarId: "primary", externalId: tripId, title: "Byron Bay road trip", start: trip.start + D, end: trip.start + D + 9 * H, allDay: false, recurring: false, cancelled: false }] });
        await ctx.runAction(internal.calendar.sync.followMoves, { creatorId, moved: r.moved, dropped: r.dropped });
        await sleep(1_500);
        const out = await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since });
        const blocks = await ctx.runQuery(internal.eval.memoryGauntlet.blocksOf, { creatorId });
        const followed = blocks.filter((b) => b.eventId === tripId);
        record("move", out.map((m) => `[${m.kind}] ${m.body}`), { moved: r.moved.length, dropped: r.dropped.length, blocksOnEvent: followed.map((b) => `${b.title} @ ${new Date(b.start).toISOString()} ${b.status}`) }, true, r.moved.length ? "a block followed the event" : "no block was tied to the event, so nothing to follow (the scout may not have proposed one)");
      }
      // 11. The evening question, and "didn't happen" → the rebook offer.
      if (want("howdidit") && blockId) {
        const blocks = await ctx.runQuery(internal.eval.memoryGauntlet.blocksOf, { creatorId });
        const b = blocks.find((x) => x.id === blockId)!;
        const since = Date.now();
        const r = await ctx.runAction(internal.agent.cadence.howDidItGo, { creatorId, now: b.end + 2 * H });
        const q = (await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since })).find((m) => m.kind === "checkin");
        let offer: string[] = [];
        if (q) {
          const tap = await ctx.runMutation(internal.eval.memoryGauntlet.buttonRow, { creatorId, body: `shot:${blockId}:no` });
          const s2 = Date.now();
          await ctx.runAction(internal.agent.converse.run, { creatorId, messageId: tap });
          offer = (await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since: s2 })).map((m) => `[${m.kind}] ${m.body}  {${m.buttons.join(" | ")}}`);
        }
        const after = (await ctx.runQuery(internal.eval.memoryGauntlet.blocksOf, { creatorId })).find((x) => x.id === blockId);
        const ok = Boolean(q) && Boolean(after?.missedAt) && offer.some((s) => /push:/.test(s));
        record("howdidit", [q ? `[checkin] ${q.body}  {${q.buttons.join(" | ")}}` : "(no question)", ...offer], { result: r, missedAt: after?.missedAt ?? null }, ok, ok ? "asked, marked missed on 'didn't happen', offered it back" : `question ${q ? "asked" : "not asked: " + r.reason}; missed=${Boolean(after?.missedAt)}`);
      }
      // 12. The readback: their real posts, a viewer's line if one is new.
      if (want("readback")) {
        const since = Date.now();
        const r = await ctx.runAction(internal.scout.readback.run, {});
        const out = await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since });
        record("readback", out.map((m) => `[${m.kind}] ${m.body}`), { result: r }, r.failed === 0, r.failed === 0 ? (out.length ? "read their posts; something to say" : "read their posts; nothing new to react to, which is correct if nothing is new") : "the readback failed for someone");
      }
      // 13. The weekly review, on their real numbers.
      if (want("review")) {
        const since = Date.now();
        const r = await ctx.runAction(internal.review.weekly.run, { creatorId });
        const out = await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since });
        for (const m of out) await ctx.runAction(internal.eval.run.evaluate, { suite: "memory", skill: "review", text: m.body, evidence: {}, creatorId, messageId: m.id });
        record("review", out.map((m) => `[${m.kind}] ${m.body}`), { result: r }, out.some((m) => m.kind === "review"), out.some((m) => m.kind === "review") ? "a review went out" : `no review: ${JSON.stringify(r).slice(0, 200)}`);
      }
      // 14. Quiet: nine days of their silence.
      if (want("quiet")) {
        await ctx.runMutation(internal.eval.memoryGauntlet.backdateInbound, { creatorId, byMs: 9 * D });
        const since = Date.now();
        const r = await ctx.runAction(internal.agent.cadence.quiet, { creatorId });
        const out = await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since });
        for (const m of out) await ctx.runAction(internal.eval.run.evaluate, { suite: "memory", skill: "reply", text: m.body, evidence: {}, creatorId, messageId: m.id });
        record("quiet", out.map((m) => `[${m.kind}] ${m.body}`), { result: r }, r.sent, r.sent ? "one warm line, no ask" : `no quiet line: ${r.reason}`);
      }
    } finally {
      await ctx.runMutation(internal.eval.memoryGauntlet.setPlanStatus, { creatorId, status: before });
    }
    const passed = steps.filter((s) => s.ok).length;
    console.log(`[memory-gauntlet] ${passed}/${steps.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
    return { creatorId, steps, passed, failed: steps.length - passed };
  },
});
