/**
 * The horizon script (operator, 2026-09-25): does she hold a goal for months and plan around it on her
 * own? "i'm running the chicago marathon in 20 weeks, let's make content about training for it" should
 * become a series she keeps building, week after week, tighter as the race nears, a celebration when
 * they finish, and a recap after, without being reminded. And a life with dates in it (a move, a race
 * on the calendar, a trip) should show up in her ideas before it happens, not only on the day.
 *
 * Runs on the first-week harness with `script: "horizon"`: each step is a WEEK (the world ages seven
 * days a step, written dates included), and the week's real work runs: the lane reads, two scout
 * passes, the morning line, the review and next week's plan. Checks read rows (ideas, plans, notes,
 * her replies); the words she used are kept in each check's detail for a person to read.
 *
 * Two roles: even creators have the GOAL (the marathon, and they agree to a series); odd creators have
 * a LIFE (moving city in eight weeks, a half marathon and a trip on their calendar).
 */
import { v } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { Check, Probe } from "./productScript";
import { clip } from "../lib/clip";

const D = 86_400_000;
/** The race is this many weekly steps after signup; the default run is RACE_WEEK + 4 steps. */
export const RACE_WEEK = 20;
export const MOVE_WEEK = 8;
export const HORIZON_STEPS = RACE_WEEK + 4;

export type HorizonRole = "goal" | "life";
export const horizonRole = (i: number): HorizonRole => (i % 2 === 0 ? "goal" : "life");

const GOAL_RE = /\b(marathon|chicago|26\.2|race day|race week|taper|weeks? (out|to go|until)|countdown|bib|training block|start line|finish line)\b/i;
const TAPER_RE = /\b(taper|race week|this weekend|final long run|last long run|shakeout|carb|bib|weeks? out|days? out|start line|nerves)\b/i;
const RECAP_RE = /\b(recap|finished|finish line|medal|recovery|recovering|post-race|after the race|i did it|ran it|26\.2 done|results?)\b/i;
const MOVE_RE = /\b(denver|moving|the move|new city|new place|boxes|colorado)\b/i;

/** Pure: which horizon beats run in step `d` (the week number, from 1). */
export function horizonBeats(d: number): string[] {
  const out = ["h-week"];
  if (d === 1) out.unshift("h-start");
  if (d === MOVE_WEEK) out.push("h-recall");
  if (d === 14) out.push("h-countdown");
  if (d === RACE_WEEK + 1) out.push("h-finished");
  return out;
}

/** Pure: "Month D" the way a person texts it, `weeks` from `now`, on their clock. */
export function writtenDate(now: number, weeks: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(now + weeks * 7 * D).toLowerCase();
}

/** Pure: the first number of weeks a reply names ("6 weeks", "six weeks"), or null. */
export function weeksNamed(text: string): number | null {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const m = text.toLowerCase().match(/\b(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(full\s+)?weeks?\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : words.indexOf(m[1]);
}

/** The life role's calendar, as if they had connected it: rows in their calendar table, marked as simulated. */
export const seedLife = internalMutation({
  args: { creatorId: v.id("creators"), events: v.array(v.object({ title: v.string(), start: v.number(), allDay: v.boolean(), filmable: v.boolean() })) },
  handler: async (ctx, a): Promise<number> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !/^eval-run:fw-/.test(c.clerkUserId)) throw new Error("only a simulation creator");
    const now = Date.now();
    for (const [n, e] of a.events.entries()) {
      await ctx.db.insert("calendarEvents", { creatorId: a.creatorId, calendarId: "sim", externalId: `sim-${n}-${now}`, title: e.title, start: e.start, end: e.start + (e.allDay ? D : 3 * 3_600_000), allDay: e.allDay, recurring: false, class: e.filmable ? "filmable" : "unknown", classifiedBy: "code", status: "active", updatedAt: now, createdAt: now });
    }
    return a.events.length;
  },
});

type Say = (text: string) => Promise<string>;
export type HorizonEnv = { ctx: ActionCtx; creatorId: Id<"creators">; i: number; d: number; say: Say; timezone: string; prior?: Check[] };

async function probeOf(env: HorizonEnv, since?: number): Promise<Probe> {
  const p = await env.ctx.runQuery(internal.eval.productScript.probe, { creatorId: env.creatorId, since });
  if (!p) throw new Error("creator is not a simulation creator");
  return p;
}

/** Everything she produced this week that a person would see: ideas written and her texts. */
function thisWeek(p: Probe, since: number): { ideas: Probe["ideas"]; plan: string | null; texts: string[] } {
  const ideas = p.ideas.filter((x) => x.createdAt >= since);
  const out = p.messages.filter((m) => m.direction === "out" && m.ts >= since);
  const plan = [...out].reverse().find((m) => m.kind === "plan")?.body ?? null;
  return { ideas, plan, texts: out.map((m) => m.body) };
}

export async function runHorizonBeat(env: HorizonEnv, beat: string): Promise<Check[]> {
  const out: Check[] = [];
  const check = (name: string, ok: boolean | null, detail: string) => out.push({ d: env.d, beat, check: name, ok, detail: clip(detail, 400) });
  const role = horizonRole(env.i);
  const { say } = env;
  const now = Date.now();
  const weekAgo = now - 7 * D;

  switch (beat) {
    case "h-start": {
      if (role === "goal") {
        const r1 = await say(`by the way, i'm running the chicago marathon on ${writtenDate(now, RACE_WEEK, env.timezone)}!! first full marathon. i want to make content about the whole training block`);
        check("a big goal gets a real reaction", /!|amazing|huge|so exciting|love|congrat|incredible|let'?s go/i.test(r1), r1);
        const r2 = await say("yes let's definitely do a series leading up to it over the next few months");
        check("she takes on the series", r2.length > 0 && !/^\(no /.test(r2), r2);
      } else {
        const moveAt = now + MOVE_WEEK * 7 * D;
        const r = await say(`we're moving to denver on ${writtenDate(now, MOVE_WEEK, env.timezone)}, it's going to be chaos lol`);
        check("a life change gets a real reaction", r.length > 0 && !/^\(no /.test(r), r);
        const n = await env.ctx.runMutation(internal.eval.horizonScript.seedLife, { creatorId: env.creatorId, events: [
          { title: "Denver Half Marathon", start: now + 10 * D + 8 * 3_600_000, allDay: false, filmable: true },
          { title: "Boulder trip with Sam", start: now + 24 * D, allDay: true, filmable: true },
          { title: "Move to Denver", start: moveAt, allDay: true, filmable: false },
        ] });
        check("their calendar has the life in it", n === 3, `${n} events`);
      }
      break;
    }
    case "h-week": {
      const p = await probeOf(env, weekAgo - D);
      const w = thisWeek(p, weekAgo);
      const kept = [...p.creator.notes, ...p.personal, ...p.directives];
      if (role === "goal") {
        const weeksLeft = RACE_WEEK - env.d;
        check("the goal is still a row", kept.some((x) => /chicago|marathon/i.test(x)), `notes: ${p.creator.notes.filter((x) => /chicago|marathon/i.test(x)).join(" | ") || "none"}; personal: ${p.personal.filter((x) => /chicago|marathon|series/i.test(x)).slice(-2).join(" | ") || "none"}`);
        const goalIdeas = w.ideas.filter((x) => GOAL_RE.test(`${x.hook} ${x.text}`));
        const planHits = w.plan ? GOAL_RE.test(w.plan) : null;
        const arc = `${goalIdeas.length}/${w.ideas.length} ideas on the goal; plan ${planHits === null ? "not sent" : planHits ? "has it" : "doesn't"}; ${weeksLeft >= 0 ? `${weeksLeft} weeks to go` : `${-weeksLeft} weeks after`}${goalIdeas[0] ? `; e.g. "${clip(goalIdeas[0].hook, 90)}"` : ""}`;
        if (weeksLeft > 3) {
          check("the marathon series keeps coming (ideas or plan, every week)", goalIdeas.length > 0 || planHits === true, arc);
        } else if (weeksLeft >= 0) {
          const tight = [...w.ideas.map((x) => `${x.hook} ${x.text}`), w.plan ?? "", ...w.texts].some((t) => TAPER_RE.test(t));
          check("close to race day, the content is about race day (taper, race week, nerves)", tight, arc);
        } else if (weeksLeft < -1) {
          const recap = [...w.ideas.map((x) => `${x.hook} ${x.text}`), w.plan ?? ""].some((t) => RECAP_RE.test(t));
          const stillTraining = [...w.ideas.map((x) => `${x.hook} ${x.text}`)].some((t) => /\b(taper|race week|weeks? out|training for (the )?(chicago|marathon))\b/i.test(t));
          check("after the race: recap and recovery, not still training for it", recap && !stillTraining, arc);
        }
        check("arc (record)", null, arc);
      } else {
        const said = [...w.ideas.map((x) => `${x.hook} ${x.text}`), w.plan ?? "", ...w.texts];
        // Anything on their calendar in the next three weeks should reach her work before it happens.
        const soon = p.events.filter((e) => e.start > now && e.start - now <= 21 * D && !/move to denver/i.test(e.title));
        for (const e of soon) {
          const word = e.title.split(" ")[e.title.startsWith("Denver") ? 1 : 0].toLowerCase(); // "half" / "boulder"
          const days = Math.round((e.start - now) / D);
          check(`a calendar event ${days <= 7 ? "this week" : "1–3 weeks out"} shows up in her work`, said.some((t) => t.toLowerCase().includes(word)), `${e.title} in ${days} days; mentioned: ${said.some((t) => t.toLowerCase().includes(word))}`);
        }
        const toMove = MOVE_WEEK - env.d;
        if (toMove >= 0 && toMove <= 3) check("the move shapes her ideas as it gets close", said.some((t) => MOVE_RE.test(t)), `${toMove} weeks to the move`);
        if (toMove < 0 && toMove >= -4) check("after the move she knows they live in Denver now", said.some((t) => /\bdenver|colorado|new city|new place\b/i.test(t)), `${-toMove} weeks after the move`);
        check("life (record)", null, `${w.ideas.length} ideas; move ${toMove >= 0 ? `in ${toMove} weeks` : `${-toMove} weeks ago`}; calendar soon: ${soon.map((e) => e.title).join(", ") || "nothing"}`);
      }
      break;
    }
    case "h-recall": {
      if (role === "goal") {
        const r = await say("wait remind me what we said we'd do for chicago?");
        check("recalls the agreed series weeks later", /chicago|marathon/i.test(r) && /series|training|leading up|every week|build|content|countdown/i.test(r), r);
      } else {
        const r = await say("did i tell you about the move?");
        check("recalls the move weeks later", /denver/i.test(r), r);
      }
      break;
    }
    case "h-countdown": {
      if (role !== "goal") { check("counts down right", null, "the life creator has no race"); break; }
      const r = await say("how many weeks till chicago now?");
      const n = weeksNamed(r);
      const expected = RACE_WEEK - env.d;
      check(`counts down right (${expected} weeks)`, n !== null && Math.abs(n - expected) <= 1, `said ${n ?? "no number"}: ${r}`);
      break;
    }
    case "h-finished": {
      if (role !== "goal") { check("celebrates the finish first", null, "the life creator has no race"); break; }
      const r = await say("I FINISHED CHICAGO!!! 3:58. legs are destroyed but i did it");
      const first = r.split(/(?<=[.!?])\s|\n/)[0] ?? "";
      check("celebrates the finish first", /!|congrat|you did it|proud|incredible|amazing|legend|huge/i.test(first) && !/^(how|what|when)\b/i.test(first), r);
      break;
    }
    default:
      check("known beat", false, `no such horizon beat: ${beat}`);
  }
  return out;
}
