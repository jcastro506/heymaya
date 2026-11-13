/**
 * What's on near them, end to end (2026-11-13). localLive showed the weekly look finds real, dated events. This
 * follows one through: the event becomes an idea on their list, she texts about it before the date (morning, the
 * editor's pick, the week plan), the same event never gets a second idea, and a trip (their phone says another
 * city) shows what's on there for that week and never becomes home.
 *
 * Clones a scenario persona with real posts (cloneForRun), paired so her texts are recorded; eval-run personas are
 * never delivered (messages.send). Real web search and real models: about $0.50 a persona.
 *
 *   npx convex run eval/localTrip:run '{"source":"eval:vanessaalopezz","home":"Austin, TX","trip":"San Diego, CA"}'
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { namesIt } from "../scout/stock";
import { clip } from "../lib/clip";

const D = 86_400_000;
type Check = { stage: string; check: string; ok: boolean | null; detail: string };

export const prepare = internalMutation({
  args: { creatorId: v.id("creators"), home: v.string(), now: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) throw new Error("clone missing");
    await ctx.db.patch(a.creatorId, {
      channel: { ...c.channel, paired: true, pairedAt: a.now - 30 * D, kind: "imessage" },
      plan: { ...c.plan, status: "active" },
      notes: [...c.notes.filter((n) => !/\blive[sd]? in\b|\bmoved to\b/i.test(n.text)), { id: `n_home_${a.now}`, text: `I live in ${a.home}`, kind: "fact", at: a.now - 20 * D }],
      whereNow: undefined,
      localScout: undefined,
    } as never);
    return null;
  },
});

export const travel = internalMutation({
  args: { creatorId: v.id("creators"), place: v.string(), at: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    // What setWhereNow does for a new city: the place, and the weekly look allowed to run again.
    await ctx.db.patch(a.creatorId, { whereNow: { place: a.place, at: a.at }, ...(c?.localScout ? { localScout: { ...c.localScout, at: 0 } } : {}) } as never);
    return null;
  },
});

export const state = internalQuery({
  args: { creatorId: v.id("creators"), since: v.number() },
  handler: async (ctx, a): Promise<{ notes: string[]; world: string; scout: unknown; events: Array<{ place: string; title: string; date: string; url: string }>; ideas: Array<{ hook: string; why: string; link: string; about?: string; at: number }>; texts: Array<{ kind: string; body: string; ts: number }> }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const events = (await ctx.db.query("localEvents").withIndex("by_creator_date", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"localEvents">[];
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ideas">[];
    const out = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.since)).take(200)) as Doc<"messages">[];
    return {
      notes: (c?.notes ?? []).map((n) => n.text),
      world: String((c?.dossier as { persona?: { world?: string } } | undefined)?.persona?.world ?? ""),
      scout: c?.localScout ?? null,
      events: events.map((e) => ({ place: e.place, title: e.title, date: e.date, url: e.url })),
      ideas: ideas.filter((i) => i.createdAt >= a.since).map((i) => ({ hook: String((i.version as { hook?: string }).hook ?? ""), why: String((i.version as { why?: string }).why ?? ""), link: i.evidenceLinks[0] ?? "", about: (i.version as { about?: string }).about, at: i.createdAt })),
      texts: out.filter((m) => m.direction === "out").map((m) => ({ kind: m.kind ?? "", body: m.body, ts: m.ts })),
    };
  },
});

export const run = internalAction({
  args: { source: v.string(), home: v.string(), trip: v.string() },
  handler: async (ctx, a): Promise<{ creatorId: string; checks: Check[]; log: Record<string, unknown> }> => {
    const t0 = Date.now();
    const runId = `localtrip-${t0}`;
    const sourceId = await ctx.runQuery(internal.eval.expertBench.personaSource, { clerkUserId: a.source });
    if (!sourceId) throw new Error(`persona ${a.source} missing`);
    const id: Id<"creators"> = await ctx.runMutation(internal.eval.scenarios.cloneForRun, { sourceId, runId });
    await ctx.runMutation(internal.eval.localTrip.prepare, { creatorId: id, home: a.home, now: t0 });
    const checks: Check[] = [];
    const log: Record<string, unknown> = {};
    const check = (stage: string, name: string, ok: boolean | null, detail: string) => checks.push({ stage, check: name, ok, detail: clip(detail, 400) });
    const read = () => ctx.runQuery(internal.eval.localTrip.state, { creatorId: id, since: t0 });
    const mentions = (body: string, titles: string[]) => titles.filter((t) => namesIt(body, t));

    // 1. Home: the weekly look finds what's on where they live.
    const home = await ctx.runAction(internal.scout.local.run, { creatorId: id, now: t0, force: true });
    log.home = home;
    check("home", `the look reads where they live (${a.home})`, (home.place ?? "").toLowerCase().includes(a.home.split(",")[0].toLowerCase()), JSON.stringify(home));
    let s = await read();
    const homeEvents = s.events;
    check("home", "found at least one dated event", homeEvents.length > 0 ? true : null, homeEvents.map((e) => `${e.date} ${e.title}`).join(" | ") || "none (the web had nothing that fit: not a failure)");

    // 2. The stock reads them: an idea on their list for one, linked to its page.
    const first = await ctx.runAction(internal.scout.stock.topUp, { creatorId: id, now: t0 });
    s = await read();
    const titles = homeEvents.map((e) => e.title);
    const urls = new Set(homeEvents.map((e) => e.url));
    const forEvent = s.ideas.filter((i) => urls.has(i.link) || mentions(`${i.hook} ${i.why}`, titles).length);
    log.stock = { first, ideas: s.ideas.map((i) => `${i.hook} [${i.link}]`) };
    if (homeEvents.length) check("stock", "an idea on their list for a local event", forEvent.length > 0, forEvent.map((i) => i.hook).join(" | ") || `${s.ideas.length} ideas, none for ${titles.join("; ")}`);

    // 3. Six days on, the soonest event is close: it gets its own idea once, and she texts about it.
    const later = t0 + 6 * D;
    const soon = homeEvents.filter((e) => { const d = Date.parse(`${e.date}T12:00:00Z`) - later; return d >= 0 && d <= 10 * D; });
    const second = await ctx.runAction(internal.scout.stock.topUp, { creatorId: id, now: later });
    const third = await ctx.runAction(internal.scout.stock.topUp, { creatorId: id, now: later + 3_600_000 });
    s = await read();
    log.soon = { soon: soon.map((e) => `${e.date} ${e.title}`), second, third };
    if (soon.length) {
      const covered = soon.filter((e) => s.ideas.some((i) => i.about === e.title || urls.has(i.link) && i.link === e.url || mentions(`${i.hook} ${i.why}`, [e.title]).length));
      check("soon", "each event within 10 days has an idea", covered.length === soon.length, `${covered.length}/${soon.length}: ${soon.map((e) => e.title).join("; ")}`);
      const abouts = s.ideas.map((i) => i.about).filter(Boolean) as string[];
      check("soon", "no event got a second 'soon' idea", new Set(abouts).size === abouts.length, abouts.join(" | ") || "none written by the soon path");
    }
    const morning = await ctx.runAction(internal.agent.cadence.morning, { creatorId: id, now: later });
    const pick = await ctx.runAction(internal.core.editor.pick, { creatorId: id, now: later });
    const plan = await ctx.runAction(internal.calendar.weekPlan.draft, { creatorId: id, now: later, horizon: "next_week", force: true });
    s = await read();
    log.texts = { morning, pick: { sent: pick.sent, reason: pick.reason, picked: pick.picked }, plan, texts: s.texts.map((m) => `[${m.kind}] ${clip(m.body, 300)}`) };
    if (soon.length) {
      const said = s.texts.filter((m) => mentions(m.body, soon.map((e) => e.title)).length);
      check("texts", "she texts about an event coming up within 10 days", said.length > 0, said.map((m) => `[${m.kind}] ${clip(m.body, 200)}`).join(" | ") || `${s.texts.length} texts, none naming ${soon.map((e) => e.title).join("; ")}`);
    } else {
      check("texts", "she texts about an event coming up within 10 days", null, "no event within 10 days of the later date");
    }

    // 4. A trip: the phone says another city this week. The look searches there and says it may be a trip.
    const tripAt = later + 2 * D;
    await ctx.runMutation(internal.eval.localTrip.travel, { creatorId: id, place: a.trip, at: tripAt });
    const trip = await ctx.runAction(internal.scout.local.run, { creatorId: id, now: tripAt });
    log.trip = trip;
    check("trip", `the look searches where the phone is (${a.trip}), without waiting a week`, (trip.place ?? "").toLowerCase().includes(a.trip.split(",")[0].toLowerCase()), JSON.stringify(trip));
    s = await read();
    const tripEvents = s.events.filter((e) => e.place.toLowerCase().includes(a.trip.split(",")[0].toLowerCase()));
    check("trip", "found something on there", tripEvents.length > 0 ? true : null, tripEvents.map((e) => `${e.date} ${e.title}`).join(" | ") || "none");
    const beforeTrip = Date.now(); // ideas are stamped with the real clock, not the simulated one
    const tripStock = await ctx.runAction(internal.scout.stock.topUp, { creatorId: id, now: tripAt });
    s = await read();
    const tripIdeas = s.ideas.filter((i) => i.at >= beforeTrip && (tripEvents.some((e) => e.url === i.link) || mentions(`${i.hook} ${i.why}`, tripEvents.map((e) => e.title)).length));
    log.tripStock = { tripStock, ideas: tripIdeas.map((i) => i.hook) };
    const tripSoon = tripEvents.filter((e) => { const d = Date.parse(`${e.date}T12:00:00Z`) - tripAt; return d >= 0 && d <= 10 * D; });
    if (tripSoon.length) check("trip", "a trip event this week or next gets an idea", tripIdeas.length > 0, tripIdeas.map((i) => i.hook).join(" | ") || `none for ${tripSoon.map((e) => e.title).join("; ")}`);

    // 5. Home again: past the week, the look goes back to where they live, and the trip never became home.
    const back = await ctx.runAction(internal.scout.local.run, { creatorId: id, now: tripAt + 8 * D, force: true });
    log.back = back;
    check("back", `after the trip the look is home again (${a.home})`, (back.place ?? "").toLowerCase().includes(a.home.split(",")[0].toLowerCase()), JSON.stringify(back));
    s = await read();
    const tripCity = a.trip.split(",")[0].toLowerCase();
    check("back", "the trip city is in no note or their world as home", !s.notes.some((n) => n.toLowerCase().includes(tripCity)) && !s.world.toLowerCase().includes(tripCity), `${s.notes.filter((n) => n.toLowerCase().includes(tripCity)).join(" | ")} ${s.world}`);
    log.allEvents = s.events.map((e) => `${e.place} · ${e.date} ${e.title}`);
    return { creatorId: id, checks, log };
  },
});

/** Debug: what the look searched, what came back, and what the picker said, for one creator. Pennies. */
export const why = internalAction({
  args: { creatorId: v.id("creators"), place: v.string() },
  handler: async (ctx, a): Promise<{ lane?: string; keyword?: string; qs: string[]; titles: string[]; pick: string | undefined }> => {
    const { localQueries, PICK_PROMPT } = await import("../scout/local");
    const { callModel } = await import("../core/llm");
    const { REGISTRY } = await import("../agent/registry");
    const now = Date.now();
    const i = await ctx.runQuery(internal.scout.local.inputs, { creatorId: a.creatorId, now });
    const qs = localQueries(a.place, i?.keyword, now);
    const results: Array<{ url: string; title: string; excerpt: string }> = [];
    for (const q of qs) {
      const r = (await ctx.runAction(internal.agent.web.search, { creatorId: a.creatorId, query: q, topic: "general" })) as { ok: boolean; results: Array<{ url: string; title: string; excerpt: string }> };
      if (r.ok) results.push(...r.results);
    }
    const p = await callModel(ctx, { creatorId: a.creatorId, purpose: "local_pick", model: REGISTRY.writer.primary, temperature: 0.2, maxTokens: 900, timeoutMs: 40_000, apiKey: process.env.OPENROUTER_API_KEY ?? "", messages: [
      { role: "system", content: PICK_PROMPT },
      { role: "user", content: `Today: ${new Date(now).toISOString().slice(0, 10)}. They live in ${a.place}.\nTheir lane: ${i?.lane || "unknown"}\nAlready found (don't repeat): none\n\nSearch results:\n${results.map((r) => `- url: ${r.url}\n  title: ${r.title}\n  text: ${r.excerpt}`).join("\n")}` },
    ] });
    return { lane: i?.lane, keyword: i?.keyword, qs, titles: results.map((r) => `${r.title} · ${clip(r.excerpt, 160)}`), pick: p.ok ? p.content : p.reason };
  },
});
