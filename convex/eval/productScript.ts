/**
 * The product script: the first-week simulation's week (eval/firstWeek.ts), with scripted moments that
 * exercise everything else the product promises, each checked against ROWS, not prose (docs/PRODUCT_SIM.md).
 *
 * Run it with `script: "product"` (and `replay: true` for zero ScrapeCreators credits). Beats run in the
 * day's plan after the morning actor turn. Every beat goes through the doors a real person uses: their
 * texts through the phone's recorder and her real turn, button taps by label, app acts through the same
 * shared function the app calls, reminders and cadence through the functions the crons fan out to.
 *
 * Two roles, so both branches of the promise run: even creators follow through (film when booked, say
 * yes to the check-in, post it); odd creators flake (ignore the check-in, don't film, say so when asked).
 */
import { v } from "convex/values";
import { internalQuery, type ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { applyIdeaAct, hookOf } from "../core/ideaActs";
import { recordAction } from "../core/act";
import { countsTowardCap } from "../core/messages";
import { dayKeyInZone } from "../core/cadence";
import { THRESHOLDS } from "../config/thresholds";
import { CADENCE } from "../agent/cadence";
import { clip } from "../lib/clip";

export type Role = "follows_through" | "flakes";
export const roleOf = (i: number): Role => (i % 2 === 0 ? "follows_through" : "flakes");

/** Pure: the scripted beats for simulated day `d`. Day 3 is the shoot; day 6 is Sunday on a Monday signup. */
export function productBeats(d: number): string[] {
  switch (d) {
    case 1: return ["settings", "remember"];
    case 2: return ["book", "ideaActs"];
    case 3: return ["prep", "checkin", "shootDone", "after"];
    case 4: return ["missedFollowUp", "share", "askMaya"];
    case 5: return ["care", "pause"];
    case 6: return ["memory", "tone"];
    case 7: return ["audit"];
    default: return [];
  }
}

export const BEATS = ["settings", "tone", "remember", "book", "ideaActs", "prep", "checkin", "shootDone", "after", "missedFollowUp", "share", "askMaya", "care", "pause", "memory", "audit"] as const;

/** One checked promise. `ok: null` is "not applicable for this role". */
export type Check = { d: number; beat: string; check: string; ok: boolean | null; detail: string };

/** What a beat needs to see, from rows. Sim creators only (the caller checks the subject). */
export type Probe = {
  creator: { quietHours: { start: string; end: string }; tone: string; status: string; careUntil: number | null; timezone: string; notes: string[] };
  /** What she kept about them outside the notes (the personal-memory layer). */
  personal: string[];
  /** Their calendar, from a day ago to two months out. */
  events: Array<{ title: string; start: number }>;
  directives: string[];
  blocks: Array<{ id: Id<"calendarBlocks">; kind: string; title: string; start: number; end: number; booked: boolean; filmedAt: number | null; missedAt: number | null; touches: string[]; ideaId: Id<"ideas"> | null; status: string }>;
  ideas: Array<{ id: Id<"ideas">; hook: string; status: string; saved: boolean; createdAt: number; text: string }>;
  messages: Array<{ id: Id<"messages">; direction: string; kind: string; body: string; buttons: string[]; ts: number; proactive: boolean; capped: boolean }>;
};

const SIM_SUBJECT = /^eval-run:fw-/;

export const probe = internalQuery({
  args: { creatorId: v.id("creators"), since: v.optional(v.number()) },
  handler: async (ctx, a): Promise<Probe | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !SIM_SUBJECT.test(c.clerkUserId)) return null;
    const directives = (await ctx.db.query("directives").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"directives">[];
    const personal = (await ctx.db.query("personalRecords").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(200)) as Doc<"personalRecords">[];
    const now = Date.now();
    const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId).gte("start", now - 86_400_000).lte("start", now + 60 * 86_400_000)).take(50)) as Doc<"calendarEvents">[];
    const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(200)) as Doc<"calendarBlocks">[];
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(100)) as Doc<"ideas">[];
    const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.since ?? 0)).order("desc").take(400)) as Doc<"messages">[];
    return {
      creator: { quietHours: c.quietHours, tone: c.tone, status: c.plan.status, careUntil: c.careUntil ?? null, timezone: c.timezone, notes: (c.notes ?? []).filter((n) => !n.tombstonedAt).map((n) => n.text) },
      directives: directives.filter((x) => x.active).map((x) => x.verbatim),
      personal: personal.map((x) => x.text),
      events: events.filter((e) => e.status === "active").map((e) => ({ title: e.title, start: e.start })),
      blocks: blocks.map((b) => ({ id: b._id, kind: b.kind, title: b.title, start: b.start, end: b.end, booked: Boolean(b.consentAt), filmedAt: b.filmedAt ?? null, missedAt: b.missedAt ?? null, touches: b.touches ?? [], ideaId: b.ideaId ?? null, status: b.status })),
      ideas: ideas.map((i) => ({ id: i._id, hook: hookOf(i), status: i.status, saved: Boolean(i.savedAt), createdAt: i.createdAt, text: i.messageText })),
      messages: messages.reverse().map((m) => ({ id: m._id, direction: m.direction, kind: m.kind ?? (m.direction === "in" ? "inbound" : "reply"), body: m.body, buttons: (m.buttons ?? []).map((b) => b.label), ts: m.ts, proactive: Boolean(m.proactive), capped: countsTowardCap(m) })),
    };
  },
});

async function simCreator(ctx: { db: { get: (id: Id<"creators">) => Promise<unknown> } }, creatorId: Id<"creators">): Promise<Doc<"creators">> {
  const c = (await ctx.db.get(creatorId)) as Doc<"creators"> | null;
  if (!c || !SIM_SUBJECT.test(c.clerkUserId)) throw new Error("only a simulation creator");
  return c;
}

/** The app's swipe, through the one function the app and her chat tools share. */
export const appAct = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), act: v.union(v.literal("save"), v.literal("pass")) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    await simCreator(ctx, a.creatorId);
    return await applyIdeaAct(ctx, a.creatorId, a.ideaId, a.act, { origin: "app" });
  },
});

/** The app's Ask Maya tap: the same awareness row `share.askMaya` writes (that mutation needs a signed-in phone). */
export const appAskMaya = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas") },
  handler: async (ctx, a): Promise<{ draft: string }> => {
    await simCreator(ctx, a.creatorId);
    const idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
    if (!idea || idea.creatorId !== a.creatorId) throw new Error("not their idea");
    const label = `the "${hookOf(idea).slice(0, 60)}" idea`;
    await recordAction(ctx, { creatorId: a.creatorId, kind: "ask", objectId: `idea:${a.ideaId}`, summary: `tapped Ask Maya on ${label}; if their next message says "this" or "it", they mean that` });
    return { draft: `about ${label}: ` };
  },
});

/**
 * The follow-through creator posts the video: a new post row on their account, marked as simulated in
 * its id and URL (it exists only in this run's rows; nothing outside the run reads it). Returns its URL
 * so they can text it to her, the way a person does.
 */
export const simPost = internalMutation({
  args: { creatorId: v.id("creators"), caption: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; url?: string; reason?: string }> => {
    const c = await simCreator(ctx, a.creatorId);
    const platform = c.handles.tiktok ? "tiktok" : "instagram";
    const handle = c.handles[platform]!;
    const latest = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").first()) as Doc<"ownPosts"> | null;
    if (!latest) return { ok: false, reason: "no posts of theirs to model the new one on" };
    const postId = `sim${Date.now()}`;
    const url = platform === "tiktok" ? `https://www.tiktok.com/@${handle}/video/${postId}` : `https://www.instagram.com/reel/${postId}/`;
    const { _id, _creationTime, ...rest } = latest;
    void _id; void _creationTime;
    await ctx.db.insert("ownPosts", { ...rest, platform, postId, url, caption: a.caption, createTime: Date.now(), metricsAsOf: Date.now(), metrics: { views: 0, likes: 0, comments: 0, shares: 0 }, crossPostOf: undefined } as never);
    return { ok: true, url };
  },
});

/** A public post URL the dev cache can answer (a `post.info` row), for Send to Maya under replay. */
export const cachedPostUrl = internalQuery({
  args: { platform: v.optional(v.string()) },
  handler: async (ctx, a): Promise<string | null> => {
    const rows = (await ctx.db.query("readCache").withIndex("by_key", (q) => q.eq("kind", "post.info")).take(200)) as Doc<"readCache">[];
    for (const r of rows) {
      const p = r.params as { platform?: string; url?: string } | null;
      if (r.value && p?.url && (!a.platform || p.platform === a.platform) && !/\/sim\d/.test(p.url)) return p.url;
    }
    return null;
  },
});

/** Send to Maya: the share extension's mutation, then her turn for that message (the queue would run it; the sim runs it now). */
export const newestInbound = internalQuery({
  args: { creatorId: v.id("creators"), since: v.number() },
  handler: async (ctx, a): Promise<Id<"messages"> | null> => {
    const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.since - 1000)).order("desc").take(10)) as Doc<"messages">[];
    return rows.find((m) => m.direction === "in")?._id ?? null;
  },
});

// ------------------------------------------------------------------ the beats

type Say = (text: string) => Promise<string>;
type BeatEnv = { ctx: ActionCtx; creatorId: Id<"creators">; i: number; d: number; role: Role; say: Say; runStartedAt: number; prior?: Check[] };

const lc = (s: string) => s.toLowerCase();
const CRISIS = /\b(988|crisis|hotline|lifeline|samaritans)\b/i;

/** Pure: the open idea a scripted moment talks about (newest first, not passed or posted). */
export function openIdeas(p: Probe): Probe["ideas"] {
  return p.ideas.filter((x) => x.status === "sent" || x.status === "hearted");
}

/** Pure: the booked film block for the shoot, if one exists (the newest not deleted). */
export function shootBlock(p: Probe): Probe["blocks"][number] | null {
  return [...p.blocks].filter((b) => b.kind === "film" && b.status !== "deleted" && b.booked).sort((x, y) => y.start - x.start)[0] ?? null;
}

async function probeOf(env: BeatEnv, since?: number): Promise<Probe> {
  const p = await env.ctx.runQuery(internal.eval.productScript.probe, { creatorId: env.creatorId, since });
  if (!p) throw new Error("creator is not a simulation creator");
  return p;
}

/**
 * Run one beat. Returns the checks it made; a thrown error becomes a failed check upstream. Each check
 * names what was promised and what the rows say, so the report reads as a list of promises kept or not.
 */
export async function runBeat(env: BeatEnv, beat: string): Promise<Check[]> {
  const out: Check[] = [];
  const check = (name: string, ok: boolean | null, detail: string) => out.push({ d: env.d, beat, check: name, ok, detail: clip(detail, 300) });
  const { ctx, creatorId, role, say } = env;

  switch (beat) {
    case "settings": {
      const r1 = await say("can you not text me before 9am? mornings are chaos");
      const p = await probeOf(env);
      check("quiet hours changed by chat", p.creator.quietHours.end === "09:00", `quiet ${p.creator.quietHours.start}–${p.creator.quietHours.end}; she said: ${r1}`);
      break;
    }
    case "tone": {
      // Day 6, not day 1: a week in her default voice first, so the voice sample hears HER (run 1 was blunt from day 1).
      const r = await say("also be more blunt with me. no sugarcoating");
      const p = await probeOf(env);
      check("tone changed by chat", p.creator.tone === "blunt", `tone ${p.creator.tone}; she said: ${r}`);
      break;
    }
    case "remember": {
      // What they say in passing is saved by a job after the turn (agent/remember.afterTurn, up to two
      // minutes later), so it is checked in the day-7 audit, not here. Here: she acknowledges it.
      const r = await say("fyi i'm running the chicago half on oct 12. and please never pitch me dance trends, not my thing");
      check("acknowledges a rule and a fact said in passing", r.length > 0 && !/^\(no /.test(r), r);
      break;
    }
    case "book": {
      const p0 = await probeOf(env);
      const idea = openIdeas(p0)[0];
      if (!idea) { check("an idea to book", false, "no open idea by day 2"); break; }
      const r = await say(`can we film the "${clip(idea.hook, 60)}" one tomorrow at 5pm?`);
      const p = await probeOf(env);
      const b = shootBlock(p);
      const tomorrow = dayKeyInZone(Date.now() + 86_400_000, p.creator.timezone);
      const hour = b ? Number(new Intl.DateTimeFormat("en-US", { timeZone: p.creator.timezone, hour: "numeric", hourCycle: "h23" }).format(b.start)) : -1;
      check("booked by chat: a film block, tomorrow at 5pm, consented", Boolean(b && dayKeyInZone(b.start, p.creator.timezone) === tomorrow && hour === 17), b ? `block "${b.title}" ${new Date(b.start).toISOString()} (local hour ${hour})` : `no booked film block; she said: ${r}`);
      check("the block is for that idea", b ? b.ideaId === idea.id || lc(b.title).includes(lc(idea.hook).slice(0, 20)) : false, b ? `block idea ${b.ideaId ?? "none"}, title "${b.title}"` : "no block");
      if (!b) {
        // The rest of the week needs a shoot: book it through the calendar tool the app and her chat share, and say so.
        const w = await ctx.runAction(internal.calendar.tools.write, { creatorId, op: "block_add", args: { kind: "film", title: idea.hook, whenLocal: "tomorrow 5pm", minutes: 45 } });
        check("fallback: booked through the shared calendar tool", w.ok, w.reason ?? w.detail ?? "");
      }
      const sched = b ? await ctx.runAction(internal.calendar.reminders.scheduleFor, { blockId: b.id }) : { scheduled: [] as string[] };
      check("reminders scheduled at booking", b ? sched.scheduled.length > 0 : null, `scheduled: ${sched.scheduled.join(", ") || "none"}`);
      break;
    }
    case "ideaActs": {
      const p0 = await probeOf(env);
      const open = openIdeas(p0).filter((x) => !p0.blocks.some((b) => b.ideaId === x.id));
      const [toSave, toPass] = [open[0], open[1]];
      if (toSave) {
        const r = await ctx.runMutation(internal.eval.productScript.appAct, { creatorId, ideaId: toSave.id, act: "save" });
        const p = await probeOf(env);
        check("saved in the app", r.ok && Boolean(p.ideas.find((x) => x.id === toSave.id)?.saved), r.reason ?? "saved");
      } else check("saved in the app", null, "fewer than one unbooked idea");
      if (toPass) {
        const r = await say(`pass on the "${clip(toPass.hook, 60)}" one, not for me`);
        const p = await probeOf(env);
        check("passed by chat (same function as the app)", p.ideas.find((x) => x.id === toPass.id)?.status === "passed", `status ${p.ideas.find((x) => x.id === toPass.id)?.status}; she said: ${r}`);
      } else check("passed by chat (same function as the app)", null, "fewer than two unbooked ideas");
      break;
    }
    case "prep": {
      const b = shootBlock(await probeOf(env));
      if (!b) { check("prep reminder the morning of", false, "no booked shoot"); break; }
      const r = await ctx.runAction(internal.calendar.reminders.fire, { blockId: b.id, touch: "prep", expectedStart: b.start });
      check("prep reminder the morning of", r.sent, r.reason);
      break;
    }
    case "checkin": {
      const b = shootBlock(await probeOf(env));
      if (!b) { check("check-in before the shoot", false, "no booked shoot"); break; }
      const r = await ctx.runAction(internal.calendar.reminders.fire, { blockId: b.id, touch: "checkin", expectedStart: b.start });
      const p = await probeOf(env, Date.now() - 60_000);
      const msg = [...p.messages].reverse().find((m) => m.kind === "reminder");
      check("check-in before the shoot, with yes / push it / skip", r.sent && Boolean(msg && ["yes", "push it", "skip"].every((l) => msg.buttons.includes(l))), `${r.reason}; buttons: ${msg?.buttons.join(", ") ?? "none"}`);
      check("never more than two reminder touches", (await probeOf(env)).blocks.find((x) => x.id === b.id)!.touches.filter((t) => t === "prep" || t === "checkin" || t === "postnudge").length <= 2, "");
      if (role === "follows_through") {
        const heard = await say("yes");
        const after = (await probeOf(env)).blocks.find((x) => x.id === b.id);
        check("their yes marks the shoot filmed", Boolean(after?.filmedAt), `filmedAt ${after?.filmedAt ?? "unset"}; she said: ${heard}`);
      } else check("their yes marks the shoot filmed", null, "the flaking creator ignores the check-in");
      break;
    }
    case "shootDone": {
      if (role !== "follows_through") { check("posting is noticed", null, "the flaking creator does not post"); break; }
      const p0 = await probeOf(env);
      const b = shootBlock(p0);
      const idea = b?.ideaId ? p0.ideas.find((x) => x.id === b.ideaId) : null;
      const post = await ctx.runMutation(internal.eval.productScript.simPost, { creatorId, caption: idea ? clip(idea.hook, 90) : "new one" });
      if (!post.ok || !post.url) { check("posting is noticed", false, post.reason ?? "no post"); break; }
      const r = await say(`posted it! ${post.url}`);
      const p = await probeOf(env);
      const posted = idea ? p.ideas.find((x) => x.id === idea.id)?.status === "posted" : false;
      check("the idea is marked posted from their text", idea ? posted : null, `idea status ${idea ? p.ideas.find((x) => x.id === idea.id)?.status : "no linked idea"}; she said: ${r}`);
      break;
    }
    case "after": {
      const b = shootBlock(await probeOf(env));
      if (!b) { check("after the shoot", false, "no booked shoot"); break; }
      const at = b.end + CADENCE.howDidItGoAfterMs + 60_000;
      const r = await ctx.runAction(internal.agent.cadence.howDidItGo, { creatorId, now: at });
      const touches = (await probeOf(env)).blocks.find((x) => x.id === b.id)?.touches ?? [];
      if (role === "follows_through") {
        check("no 'how'd it go' when she already knows it was filmed", !r.sent, r.reason);
      } else {
        const asked = r.sent || touches.includes("howdidit");
        check("asks how the shoot went when it wasn't filmed", asked, `${r.reason}; touches ${touches.join(", ")}`);
        if (asked) {
          // Their own words first: does she understand it without a button?
          const heard = await say("ugh didn't get to it, work ran late");
          let blk = (await probeOf(env)).blocks.find((x) => x.id === b.id);
          check("'didn't get to it', in their own words, is understood", Boolean(blk?.missedAt) || /put it back|another day|rebook|tomorrow|move it|which day|when/i.test(heard), heard);
          check("no guilt about the missed shoot", !/\b(should have|you promised|disappoint)/i.test(heard), heard);
          // Then the button a person would tap, if the free text didn't record it.
          if (!blk?.missedAt) {
            const tapped = await say("didn't happen");
            blk = (await probeOf(env)).blocks.find((x) => x.id === b.id);
            check("'didn't happen' marks the shoot missed and offers it back", Boolean(blk?.missedAt) && /tomorrow|when|back/i.test(tapped), tapped);
          }
          const moved = await say("tomorrow");
          const p = await probeOf(env);
          check("rebooked for tomorrow from the offer", p.blocks.some((x) => x.kind === "film" && x.booked && x.status !== "deleted" && x.start > Date.now() && (x.id === b.id || x.ideaId === b.ideaId)), moved);
        }
      }
      break;
    }
    case "missedFollowUp": {
      if (role !== "flakes") { check("next morning: the missed shoot, with put it back", null, "the follow-through creator filmed"); break; }
      // The evening already put it back (their offer, their "tomorrow"): the morning rightly talks about today's shoot instead.
      if ((env.prior ?? []).some((c) => c.check === "rebooked for tomorrow from the offer" && c.ok)) { check("next morning: the missed shoot, with put it back", null, "rebooked the evening before; the morning stays on today's shoot"); break; }
      const p = await probeOf(env, Date.now() - 6 * 3_600_000);
      const missed = [...p.blocks].filter((b) => b.kind === "film" && b.booked && !b.filmedAt && b.status !== "deleted").sort((x, y) => y.start - x.start)[0];
      if (missed && missed.start > Date.now()) { check("next morning: the missed shoot, with put it back", null, "already rebooked the evening before (the morning stays quiet about it)"); break; }
      const morning = [...p.messages].reverse().find((m) => m.kind === "morning");
      const offered = Boolean(morning?.buttons.includes("put it back"));
      check("next morning: the missed shoot, with put it back", offered, morning?.body ?? "no morning line");
      if (offered) {
        const when = await say("put it back");
        await say("tomorrow");
        const after = await probeOf(env);
        check("put it back books it again", after.blocks.some((b) => b.kind === "film" && b.booked && b.status !== "deleted" && b.start > Date.now() && (!missed || b.id === missed.id || b.ideaId === missed.ideaId)), when);
      }
      break;
    }
    case "share": {
      const url = await ctx.runQuery(internal.eval.productScript.cachedPostUrl, {});
      if (!url) { check("Send to Maya gets an answer", null, "no cached public post to share in this deployment"); break; }
      const since = Date.now();
      const r = await ctx.runMutation(internal.share.receive, { creatorId, url, note: "could i do something like this?", app: "TikTok" });
      if (!r.ok) { check("Send to Maya gets an answer", false, r.reason ?? "refused"); break; }
      const inbound = await ctx.runQuery(internal.eval.productScript.newestInbound, { creatorId, since });
      if (!inbound) { check("Send to Maya gets an answer", false, "no inbound row"); break; }
      await ctx.runAction(internal.agent.converse.run, { creatorId, messageId: inbound });
      const replies = await ctx.runQuery(internal.eval.converse.repliesTo, { creatorId, inboundId: inbound, since });
      const said = replies.map((x) => x.text).join(" / ");
      // Under replay, "couldn't open that link" means the cache lacks that post's reads: it tested nothing.
      const missed = /couldn'?t open|can'?t open|couldn'?t load/i.test(said);
      check("Send to Maya gets an answer about the post", replies.length === 0 ? false : missed ? null : true, missed ? `replay: the post's reads aren't cached (${said})` : said || "no reply");
      break;
    }
    case "askMaya": {
      const p = await probeOf(env);
      const idea = p.ideas.find((x) => x.saved) ?? openIdeas(p)[0];
      if (!idea) { check("Ask Maya about an idea", null, "no idea to ask about"); break; }
      const { draft } = await ctx.runMutation(internal.eval.productScript.appAskMaya, { creatorId, ideaId: idea.id });
      const heard = await say(`${draft}would this work on instagram too?`);
      check("Ask Maya about an idea gets a reply about that idea", heard.length > 0 && !/^\(no /.test(heard), heard);
      break;
    }
    case "care": {
      const heard = await say("honestly kind of over this. nothing i post works");
      const p = await probeOf(env);
      check("a hard moment gets her, not a hotline", !CRISIS.test(heard) && heard.length > 0, heard);
      check("no 24h pause for a content complaint", !p.creator.careUntil || p.creator.careUntil < Date.now(), `careUntil ${p.creator.careUntil ?? "unset"}`);
      break;
    }
    case "pause": {
      await say("pause");
      const paused = (await probeOf(env)).creator.status;
      const scout = await ctx.runAction(internal.scout.scout.run, { creatorId });
      check("pause stops her texting first", paused === "paused" && !scout.sent, `status ${paused}; scout ${scout.sent ? "SENT while paused" : `held: ${scout.reason}`}`);
      await say("resume");
      const back = (await probeOf(env)).creator.status;
      check("resume brings her back", back !== "paused", `status ${back}`);
      break;
    }
    case "memory": {
      const heard = await say("wait what race am i running again?");
      check("remembers what they told her on day 1", /chicago/i.test(heard), heard);
      break;
    }
    case "audit": {
      const p = await probeOf(env, env.runStartedAt);
      const byDay = new Map<string, number>();
      for (const m of p.messages) if (m.direction === "out" && m.capped) byDay.set(dayKeyInZone(m.ts, p.creator.timezone), (byDay.get(dayKeyInZone(m.ts, p.creator.timezone)) ?? 0) + 1);
      const worst = Math.max(0, ...byDay.values());
      check(`never over the daily cap (${THRESHOLDS.dailyMessageCap})`, worst <= THRESHOLDS.dailyMessageCap, `most in one day: ${worst}`);
      const kept = [...p.directives, ...p.creator.notes, ...p.personal].map(lc);
      check("the rule said in passing is kept as a row", p.directives.some((x) => /dance/i.test(x)), `rules: ${p.directives.join(" | ") || "none"}`);
      check("the fact said in passing is kept as a row", kept.some((x) => /chicago/.test(x)), `notes: ${p.creator.notes.slice(-4).join(" | ") || "none"}; personal: ${p.personal.slice(-4).join(" | ") || "none"}`);
      const dance = p.ideas.filter((x) => /\bdanc(e|ing)\b/i.test(`${x.hook} ${x.text}`) && x.createdAt > env.runStartedAt);
      check("the rule held all week: no dance-trend ideas", dance.length === 0, dance.map((x) => x.hook).join(" | ") || "none");
      const beforeNine = p.messages.filter((m) => m.direction === "out" && m.proactive && m.kind !== "reminder" && Number(new Intl.DateTimeFormat("en-US", { timeZone: p.creator.timezone, hour: "numeric", hourCycle: "h23" }).format(m.ts)) < 9 && m.ts > env.runStartedAt + 86_400_000);
      check("quiet hours held: nothing proactive before 9am after day 1", beforeNine.length === 0, beforeNine.map((m) => `${m.kind} at ${new Date(m.ts).toISOString()}`).join(", ") || "none");
      break;
    }
    default:
      check("known beat", false, `no such beat: ${beat}`);
  }
  return out;
}

/** Pure: the fleet summary of every check, per promise. */
export function summariseChecks(all: Check[]): Array<{ check: string; passed: number; failed: number; na: number }> {
  const m = new Map<string, { check: string; passed: number; failed: number; na: number }>();
  for (const c of all) {
    const row = m.get(c.check) ?? { check: c.check, passed: 0, failed: 0, na: 0 };
    if (c.ok === true) row.passed += 1;
    else if (c.ok === false) row.failed += 1;
    else row.na += 1;
    m.set(c.check, row);
  }
  return [...m.values()];
}
