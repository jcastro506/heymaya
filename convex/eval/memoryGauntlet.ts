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
import { morningHourFor } from "../agent/cadence";

const D = 86_400_000, H = 3_600_000;

interface Step { step: string; said: string[]; facts: Record<string, unknown>; ok: boolean; why: string }

/**
 * For the run: an active plan and a paired channel, because every proactive rail refuses an
 * unpaired or paused creator (the first run failed four touches on exactly that). No chat is
 * attached, so nothing can reach a phone: deliveries defer on "no chat paired". Restored after.
 */
export const setPlanStatus = internalMutation({
  args: { creatorId: v.id("creators"), status: v.string(), paired: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ status: string; paired: boolean }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { status: "none", paired: false };
    const before = { status: c.plan.status, paired: c.channel.paired };
    await ctx.db.patch(a.creatorId, { plan: { ...c.plan, status: a.status as Doc<"creators">["plan"]["status"] }, channel: { ...c.channel, paired: a.paired ?? c.channel.paired }, updatedAt: Date.now() });
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

export const creatorByHandle = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, a): Promise<Id<"creators"> | null> => ((await ctx.db.query("creators").withIndex("by_tiktok", (q) => q.eq("handles.tiktok", a.handle)).first()) as Doc<"creators"> | null)?._id ?? null,
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

/** Forget rows of one kind (a review, say), so a step whose dedupe key already fired can run again. */
export const deleteMessagesOfKind = internalMutation({
  args: { creatorId: v.id("creators"), kind: v.string() },
  handler: async (ctx, a): Promise<number> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"messages">[];
    let n = 0;
    for (const m of rows) if (m.kind === a.kind) { await ctx.db.delete(m._id); n += 1; }
    return n;
  },
});

export const quietOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ start: string; end: string } | null> => ((await ctx.db.get(a.creatorId)) as Doc<"creators"> | null)?.quietHours ?? null,
});

export const buttonRow = internalMutation({
  args: { creatorId: v.id("creators"), body: v.string() },
  handler: async (ctx, a): Promise<Id<"messages">> => await ctx.db.insert("messages", { creatorId: a.creatorId, direction: "in", surface: "telegram", kind: "button", body: a.body, ts: Date.now() }),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The report lives in a row (the fleet key/value table), because a long transcript is not a function result. */
export const saveReport = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const existing = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", a.key)).first();
    if (existing) await ctx.db.patch(existing._id, { value: a.value, updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key: a.key, value: a.value, updatedAt: Date.now() });
    return null;
  },
});

export const report = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, a): Promise<string | null> => (await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", a.key)).first())?.value ?? null,
});

export const run = internalAction({
  args: { handle: v.optional(v.string()), steps: v.optional(v.array(v.string())), reportKey: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; passed: number; failed: number; reportKey: string }> => {
    // By handle, so the long-tenure twin (not in the fixed scenario list) can be run too.
    const creatorId = await ctx.runQuery(internal.eval.memoryGauntlet.creatorByHandle, { handle: a.handle ?? "vanessaalopezz" });
    if (!creatorId) throw new Error("no such scenario creator");
    const only = a.steps ? new Set(a.steps) : null;
    const steps: Step[] = [];
    const t0 = Date.now();
    const before = await ctx.runMutation(internal.eval.memoryGauntlet.setPlanStatus, { creatorId, status: "active", paired: true });

    const latencies: number[] = [];
    const say = async (text: string): Promise<string[]> => {
      const since = Date.now();
      const { messageId } = await ctx.runMutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: text });
      await ctx.runAction(internal.agent.converse.run, { creatorId, messageId });
      latencies.push(Date.now() - since);
      await sleep(6_000); // the remember pass is scheduled after the reply
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
        // Kept anywhere she reads from: a note, a rule, or their own words about what they make (the niche field).
        const kept = Boolean(mem && (mem.notes.some((n) => /travel|hostel|whv/i.test(n)) || mem.rules.some((r) => /travel|hostel|whv|running/i.test(r)) || /travel|hostel|whv/i.test(mem.niche)));
        const inPrefix = Boolean(mem && /travel|hostel|whv/i.test(mem.prefix));
        record("direction", said, { notes: mem?.notes, rules: mem?.rules, niche: mem?.niche, keywords: mem?.keywords, inPrefix }, kept, kept ? `a note or a rule now carries the direction${inPrefix ? ", and the prefix carries it" : ", but the prefix does not show it"}` : "nothing kept: the direction lives only in the chat log");
      }
      // 2. Recall it, in a new turn.
      if (want("recall")) {
        const said = await say("what did i tell you about where i'm taking the account?");
        const ok = said.some((s) => /travel|hostel|whv/i.test(s)) && !said.some((s) => /don't (know|recall)|nothing/i.test(s));
        record("recall", said, {}, ok, ok ? "she recalls the direction" : "she did not recall it");
      }
      // 2b. A correction in words: the old direction is superseded, not piled on, and who they are is not blanked.
      if (want("correction")) {
        const before = await ctx.runQuery(internal.eval.memoryGauntlet.memoryOf, { creatorId });
        const said = await say("actually scrap that. running stays the main thing. the travel stuff is just for the summer, not a pivot.");
        const mem = await ctx.runQuery(internal.eval.memoryGauntlet.memoryOf, { creatorId });
        const keptDossier = Boolean(mem && mem.keywords.length > 0);
        const nowSaysRunning = Boolean(mem && (/running/i.test(mem.niche) || mem.notes.some((n) => /running.*(main|stay)|summer/i.test(n))));
        const oldStillCurrent = Boolean(mem && /all in on solo travel/i.test(mem.niche));
        const ok = keptDossier && nowSaysRunning && !oldStillCurrent;
        record("correction", said, { nicheBefore: before?.niche, nicheAfter: mem?.niche, notes: mem?.notes, keywords: mem?.keywords }, ok, !keptDossier ? "the dossier was blanked by the correction" : !nowSaysRunning ? "the correction was not kept" : oldStillCurrent ? "the old direction still reads as current" : "the correction superseded the old direction and the dossier survived");
      }
      // Long tenure (2026-09-09): questions only a year of memory can answer. Seeded by eval/longTenure.
      if (want("why_broll")) {
        const said = await say("remind me why i stopped doing the sunrise b-roll with quotes?");
        const ok = said.some((s) => /everyone else'?s feed|not (you|me)|look(s|ed) like everyone/i.test(s));
        record("why_broll", said, {}, ok, ok ? "the March reason, in their words" : "the reason was not recalled");
      }
      if (want("mornings_rule")) {
        const said = await say("what did we agree about mornings? when can you text me");
        const ok = said.some((s) => /before 8|after 8|8 ?am|8:00/i.test(s)) && !said.some((s) => /10 ?am|before 10/i.test(s));
        record("mornings_rule", said, {}, ok, ok ? "the newest rule, not the superseded one" : "the superseded 10am rule leaked, or no rule");
      }
      if (want("hostel_filmed")) {
        const said = await say("did i ever actually film the hostel tour or did i flake?");
        const ok = said.some((s) => /filmed|you did|did it|shot it/i.test(s)) && !said.some((s) => /didn'?t happen|flaked|never filmed/i.test(s));
        record("hostel_filmed", said, {}, ok, ok ? "read from the block: filmed" : "wrong or hedged about a fact she holds");
      }
      if (want("alarm_missed")) {
        const said = await say("and the 5am alarm one, did that get made?");
        const ok = said.some((s) => /didn'?t happen|never (got )?(made|filmed)|missed|no/i.test(s));
        record("alarm_missed", said, {}, ok, ok ? "read from the block: missed" : "claimed or hedged");
      }
      if (want("style_change")) {
        const said = await say("how has my style changed since spring? be specific");
        const ok = said.some((s) => /\b(20\d\d|january|february|march|april|may|june|july|august|spring|summer)\b/i.test(s)) && !said.some((s) => /i can'?t (see|tell)|no way to know/i.test(s));
        record("style_change", said, {}, ok, ok ? "dated, from the snapshots" : "no dated comparison");
      }
      if (want("taste_vs_perf")) {
        const said = await say("what does best for me numbers-wise, and is that the same as what i actually like making?");
        const ok = said.some((s) => /skit/i.test(s)) && said.some((s) => /deadpan|talking/i.test(s));
        record("taste_vs_perf", said, {}, ok, ok ? "performance and preference named separately" : "the two were merged or missed");
      }
      if (want("naples")) {
        const said = await say("what happened with the naples pizza one in the end?");
        const ok = said.some((s) => /naples|pizza|slice/i.test(s));
        record("naples", said, {}, ok, ok ? "the bit is remembered" : "not recalled");
      }
      if (want("forget_sister")) {
        const before = await ctx.runQuery(internal.eval.memoryGauntlet.memoryOf, { creatorId });
        const said = await say("forget what i told you about my sister");
        const after = await ctx.runQuery(internal.eval.memoryGauntlet.memoryOf, { creatorId });
        const sisterGone = !after?.notes.some((n) => /sister/i.test(n));
        const collateral = (before?.notes.length ?? 0) - (after?.notes.length ?? 0) - (sisterGone ? 1 : 0);
        record("forget_sister", said, { sisterGone, collateral, notesBefore: before?.notes.length, notesAfter: after?.notes.length }, sisterGone && collateral <= 0, sisterGone ? (collateral > 0 ? `the sister note went, but ${collateral} other note(s) went with it` : "the older note about the sister was the one forgotten") : "the sister note is still there (forget targets only the latest thing)");
      }
      if (want("metrics")) {
        const size = await ctx.runQuery(internal.eval.longTenure.prefixSize, { creatorId });
        const ms = latencies.length ? Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length) : null;
        record("metrics", [], { prefixChars: size?.chars, sections: size?.sections, avgTurnMs: ms, turns: latencies.length }, Boolean(size && size.chars < 60_000), size ? `prefix ${size.chars} chars, avg turn ${ms ?? "?"} ms` : "no prefix");
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
      let tripId = "ev-trip";
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
        // The gauntlet itself spends the day's budget (a dossier rewrite, the reads); the scout must not fail on our tab.
        await ctx.runMutation(internal.onboarding.dev.resetBudget, { creatorId });
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
      // 8. A commitment in chat becomes a block. (Batched runs: later steps find the latest booked block from rows.)
      let blockId: Id<"calendarBlocks"> | null = null;
      if (!want("commit")) {
        const latest = (await ctx.runQuery(internal.eval.memoryGauntlet.blocksOf, { creatorId })).filter((x) => x.status !== "deleted" && x.consented).sort((x, y) => y.start - x.start)[0];
        blockId = latest?.id ?? null;
      }
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
        const quiet = await ctx.runQuery(internal.eval.memoryGauntlet.quietOf, { creatorId });
        const morningTs = b.start - (localHour - morningHourFor(quiet ?? undefined)) * H;
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
        await ctx.runMutation(internal.core.messages.closeOpen, { creatorId }); // silence answers nothing; the nightly sweep closes it the same way
        const since = Date.now();
        const r = await ctx.runAction(internal.agent.cadence.quiet, { creatorId });
        const out = await ctx.runQuery(internal.eval.memoryGauntlet.outboundSince, { creatorId, since });
        for (const m of out) await ctx.runAction(internal.eval.run.evaluate, { suite: "memory", skill: "reply", text: m.body, evidence: {}, creatorId, messageId: m.id });
        record("quiet", out.map((m) => `[${m.kind}] ${m.body}`), { result: r }, r.sent, r.sent ? "one warm line, no ask" : `no quiet line: ${r.reason}`);
      }
    } finally {
      await ctx.runMutation(internal.eval.memoryGauntlet.setPlanStatus, { creatorId, status: before.status, paired: before.paired });
    }
    const passed = steps.filter((s) => s.ok).length;
    console.log(`[memory-gauntlet] ${passed}/${steps.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
    const reportKey = a.reportKey ?? `gauntlet:memory:${new Date(t0).toISOString().slice(0, 16)}`;
    await ctx.runMutation(internal.eval.memoryGauntlet.saveReport, { key: reportKey, value: JSON.stringify({ creatorId, at: t0, steps }) });
    return { creatorId, passed, failed: steps.length - passed, reportKey };
  },
});
