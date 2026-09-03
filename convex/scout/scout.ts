/**
 * `scout` (plan §11.2 #6): after the rails pass, the ranked candidates go to the
 * writer with the dossier, the catalogue and the posts' transcripts. It decides
 * which are notable and which fit this creator, and writes one message with links
 * and one-tap options. Everything else is held or dropped with the model's reason.
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { buildPrefix, producedStamp } from "../agent/context";
import { localDateKey, zonedTimeToEpoch } from "../calendar/time";
import { investigate } from "../agent/investigate";
import { deliverNow } from "../core/scheduler";
import { THRESHOLDS } from "../config/thresholds";
import { critique, tooLong } from "../agent/critic";
import { localHourMinute } from "./gate";
import { internalQuery } from "../_generated/server";
import { LOOKUPS } from "../agent/playbooks";

export const SCOUT_SKILL = `scout
When: the gate has passed and there are candidates. Six kinds: "breakout" (an account they admire, above its own normal), "shape" (the top of their lane for one of their keywords this week; the account is not one they named), "win" (THEIR OWN post crossing 3× their normal; the message is a real, specific celebration and one thing to do while it's moving, nothing else), "sound" (a sound two or more accounts in their lane used this week; look it up with sound_info and sound_videos before judging: is it rising, is it the kind of sound they use, what would THEIR video on it be), "worth_seeing" (a post from outside their lane, often from the platform's trending feed, whose FORMAT the screener marked as transferable; the topic is not theirs and that is fine; at most one of these a day), and "calendar" (something on THEIR OWN calendar two or more days out that a post could ride: the message names the event, the shape of the post it makes possible, and proposes ONE filming block before it, with a day and a time on their clock; "version.block" carries that block and the question at the end is whether to block it).
The judgment: which of these, if any, is notable (a real breakout above that account's own normal, not just a big account being big) AND fits this creator. Fit is two questions, and either can carry it: does the TOPIC belong to them, and does the FORMAT transfer (the structure, the hook shape, the angle, the humor, the pacing) to their subject even though the topic is somebody else's. A comedy bit, a list with a cut to an object on every point, a hook that opens on a thing instead of a face: those travel. Never reject a candidate only because it is outside their lane; reject it because neither the topic nor the format is theirs, and say which. When the pick is a transfer, the message says the source is not their world, names exactly what transfers (the structure, not the joke), and gives their version on their subject in one line. Default is still no. Pick at most one. If one fits, write the message: the evidence (who, how far above their normal, how old), the link, what the post does (from the transcript; you have NOT watched it, so say nothing about visuals), and their version: a hook line, the length, the sound if known, one line of on-screen text. End with exactly one question that has a decision behind it.

⚠️ A "shape" candidate is the top of their lane from an account nobody is tracking, so there IS NO per-account normal for it and its ratio is not a real multiple. Never write "Nx their normal" for a shape. Say the plain view count and, if you have it, how it compares to their lane's median this week. The same goes for any candidate whose ratio you were not given. Inventing a multiple to make a sentence land is the one thing that ends this job.

Sound: name a real one or say original audio. If you name a sound it must be one a lookup actually returned (sound_info, sound_videos, or the candidate's own sound), and you say in three words why it fits. "a trending sound", "whatever is on your fyp" or "an upbeat track" is a refusal to do the work: say "your own audio" instead, which is honest and often right.

The on-screen text and the hook are the part they will actually read on the screen, so they are held to the voice rules above: their length, their case, their kind of joke, one concrete noun from their life, and a line no other creator in the niche could post word for word.
Taste: each candidate carries "taste", their history with things like it; the prefix carries the note you keep on what they take. Weigh it, don't obey it: a "passed on" is a reason to pick something else unless this one is clearly different, and say what's different. Name the idea's features honestly in "features"; they are how you learn from what they do next. If the prompt says the explore slot is open, you may pick something outside their usual, set "newForYou": true, and say in the message that it's not their usual.
Output ONLY JSON:
{"pick": {"postId": "", "notable": true, "fit": "yes|maybe|no", "fitWhy": "≤160", "transfer": false, "newForYou": false, "features": {"format": "talking-head|skit|vlog|tutorial|list|reaction|duet|pov|grwm|text-on-screen|other", "topics": ["≤3 short tags"], "tone": "serious|deadpan|ironic|hype|warm", "lengthBucket": "<15|15-30|30-60|60+", "sound": "trending|original|none"}, "message": "≤900 chars, in your voice, lowercase fine, no bullets", "version": {"hook": "≤120", "onScreenText": "≤80", "lengthSec": 0, "sound": "≤80 or ''", "block": {"startLocal": "YYYY-MM-DDTHH:MM on their clock", "lengthMin": 60, "title": "≤60, starts with 'film:'"} | null}} | null,
 "rejected": [{"postId": "", "why": "≤80, must say whether the topic or the format was the problem"}]}` + LOOKUPS.scout;

export const writeIdea = internalMutation({
  args: {
    creatorId: v.id("creators"),
    signalId: v.id("signals"),
    evidenceLinks: v.array(v.string()),
    fit: v.union(v.literal("yes"), v.literal("maybe"), v.literal("no")),
    fitWhy: v.string(),
    version: v.any(),
    messageText: v.string(),
    produced: v.object({ skillVersion: v.string(), model: v.string(), thresholdsVersion: v.string() }),
    features: v.optional(v.object({ format: v.string(), topics: v.array(v.string()), tone: v.string(), lengthBucket: v.string(), sound: v.string(), source: v.string(), account: v.optional(v.string()) })),
    newForYou: v.optional(v.boolean()),
  },
  handler: async (ctx, a): Promise<Id<"ideas">> =>
    await ctx.db.insert("ideas", {
      features: a.features,
      newForYou: a.newForYou,
      creatorId: a.creatorId,
      signalId: a.signalId,
      evidenceLinks: a.evidenceLinks,
      fit: a.fit,
      fitWhy: a.fitWhy,
      version: a.version,
      messageText: a.messageText,
      status: "sent",
      produced: a.produced,
      createdAt: Date.now(),
    }),
});

export const linkIdeaMessage = internalMutation({
  args: { ideaId: v.id("ideas"), messageId: v.id("messages"), sentAt: v.number() },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.patch(a.ideaId, { messageId: a.messageId, sentAt: a.sentAt });
    await ctx.db.patch(a.messageId, { ideaId: a.ideaId });
    return null;
  },
});

/** One creator's scout pass. Rails → candidates → the skill → at most one message. */
export const run = internalAction({
  args: { creatorId: v.id("creators"), dryRun: v.optional(v.boolean()), ignoreRails: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ sent: boolean; reason: string; dry?: { message: string; pick: unknown; rejected?: unknown; evidence: unknown; trace: unknown } }> => {
    const now = Date.now();
    const g = await ctx.runQuery(internal.scout.gate.railsFor, { creatorId: args.creatorId, now });
    if (!g) return { sent: false, reason: "creator not found" };
    /**
     * ⚠️ `ignoreRails` is for MEASUREMENT ONLY, and only alongside `dryRun`, which cannot
     * send. The rails are environmental — quiet hours, the daily cap, an open question — so
     * a regression suite run at 1am for a Los Angeles creator measures nothing at all, which
     * is exactly what happened the first time this gate ran. The rails have their own tests;
     * this path exists to test the writer, not the delivery policy.
     */
    const skipRails = args.ignoreRails === true && args.dryRun === true;
    if (!g.rails.ok && !skipRails) return { sent: false, reason: g.rails.reason ?? "rails" };
    if (g.tasteDropped.length && !args.dryRun) await ctx.runMutation(internal.scout.gate.setVerdicts, { verdicts: g.tasteDropped.map((d) => ({ signalId: d.signalId, verdict: "dropped" as const, why: d.why })) });
    // §13.9 / §13.10 (5): after three passes on one account she asks once whether to stop watching it.
    for (const ask of args.dryRun ? [] : g.askStop) {
      await ctx.runMutation(internal.core.messages.send, { creatorId: args.creatorId, surface: "telegram", body: `you've passed on the last three from @${ask.handle}. want me to stop watching them, or keep them on the list and just be pickier?`, dedupeKey: `askstop:${ask.trackedAccountId}`, proactive: false, kind: "status", buttons: [{ id: `watch:${ask.trackedAccountId}:stop`, label: "stop watching" }, { id: `watch:${ask.trackedAccountId}:keep`, label: "keep, be pickier" }] });
    }
    if (g.candidates.length === 0) return { sent: false, reason: g.tasteDropped.length ? "no candidates (taste dropped the rest)" : "no candidates" };

    // Evidence for the model: the candidate posts with transcripts (a credit each, cached fleet-wide).
    // ⚠️ `ratio` is meaningless for a "shape" candidate (no tracked account, so no normal).
    // It is sent as null rather than a number the model will read as a multiple and cite.
    const evidence: Array<{ postId: string; kind: string; url: string; ratio: number | null; why: string; transcript: string | null; handle: string | null; taste: string }> = [];
    for (const s of g.candidates) {
      /**
       * The stored URL first. Parsing it back out of `why` was the old way, and `why` gets
       * overwritten with the model's reason when a verdict is recorded, so a re-judged
       * signal lost its link entirely and she wrote about a post nobody could open.
       */
      const url = s.url ?? s.why.split("; ").pop() ?? "";
      let transcript: string | null = null;
      let handle: string | null = null;
      if (s.trackedAccountId) {
        const t = (await ctx.runQuery(internal.scout.scout.trackedHandle, { id: s.trackedAccountId })) ?? null;
        handle = t;
      }
      if (s.kind !== "calendar" && url.startsWith("http")) {
        try {
          const r = await ctx.runAction(internal.reads.read.read, { kind: "post.transcript", params: { platform: url.includes("tiktok.com") ? "tiktok" : "instagram", url }, creatorId: args.creatorId });
          transcript = ((r.value as { transcript?: string | null } | null)?.transcript ?? null)?.slice(0, 1200) ?? null;
        } catch {
          transcript = null;
        }
      }
      evidence.push({ postId: s.sourcePostIds[0], kind: s.kind, url, ratio: s.kind === "shape" ? null : s.score, why: s.why, transcript, handle, taste: g.tasteHints[s._id] ?? "" });
    }

    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: args.creatorId });
    if (!gathered) return { sent: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: gathered.creator, directives: gathered.directives, skill: SCOUT_SKILL, personal: gathered.personal, voice: gathered.voice });
    const spec = REGISTRY.writer;
    const user = `Candidates (kind: breakout / shape / win / calendar), ranked; for posts, ratio is how far above that account's own normal:\n${JSON.stringify(evidence)}\n\nToday on their clock: ${localDateKey(now, g.creator.timezone)}, ${g.rails.localHour}:00 (${g.creator.timezone}). Messages already sent today: ${g.rails.sentToday}.${g.exploreOpen ? " The explore slot is open: one idea in five may be outside their usual, flagged newForYou." : ""}`;
    // §13.11: the writer may look things up (the sound, the comments, the author's normal, their own rhymes) before judging.
    const inv = await investigate(ctx, { creatorId: args.creatorId, purpose: "scout", prefix, user, temperature: 0.5, maxTokens: 1400 });
    if (!inv.content) return { sent: false, reason: `scout ${inv.ended === "model_error" ? "model failed" : "gave no answer"} after ${inv.trace.length} lookups` };
    const result = { ok: true as const, content: inv.content };
    if (inv.trace.length && !args.dryRun) await ctx.runMutation(internal.scout.gate.setInvestigation, { signalIds: g.candidates.map((s) => s._id), trace: inv.trace });

    let parsed: { pick: null | { postId: string; notable: boolean; fit: "yes" | "maybe" | "no"; fitWhy: string; message: string; version: unknown; newForYou?: boolean; features?: { format?: string; topics?: string[]; tone?: string; lengthBucket?: string; sound?: string } }; rejected?: Array<{ postId: string; why: string }> };
    try {
      const m = result.content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : "{}") as typeof parsed;
    } catch {
      // The raw head goes to the log and, on a dry run, to the caller: a parse failure must be diagnosable, not a shrug.
      console.error(`[scout] no JSON from the writer after ${inv.trace.length} lookups (ended: ${inv.ended}): ${result.content.slice(0, 300).replace(/\s+/g, " ")}`);
      return { sent: false, reason: `scout returned no JSON (${inv.ended}, ${inv.turns} turns): ${result.content.slice(0, 160).replace(/\s+/g, " ")}` };
    }

    const verdicts: Array<{ signalId: Id<"signals">; verdict: "sent" | "held" | "dropped"; why: string }> = [];
    const rejectedWhy = new Map((parsed.rejected ?? []).map((r) => [r.postId, r.why]));
    const pick = parsed.pick && parsed.pick.notable && parsed.pick.fit !== "no" ? parsed.pick : null;
    for (const s of g.candidates) {
      const id = s.sourcePostIds[0];
      if (pick && pick.postId === id) continue;
      verdicts.push({ signalId: s._id, verdict: "dropped", why: rejectedWhy.get(id) ?? (parsed.pick?.postId === id ? `not a fit: ${parsed.pick.fitWhy}` : "not picked") });
    }

    if (!pick || !pick.message?.trim()) {
      if (args.dryRun) return { sent: false, reason: "nothing worth their time today", dry: { message: "", pick: parsed.pick, rejected: parsed.rejected ?? [], evidence, trace: inv.trace } };
      await ctx.runMutation(internal.scout.gate.setVerdicts, { verdicts });
      return { sent: false, reason: "nothing worth their time today" };
    }
    const signal = g.candidates.find((s) => s.sourcePostIds[0] === pick.postId)!;
    if (pick.fit === "maybe" && !args.dryRun) {
      verdicts.push({ signalId: signal._id, verdict: "held", why: `maybe: ${pick.fitWhy}` });
      await ctx.runMutation(internal.scout.gate.setVerdicts, { verdicts });
      return { sent: false, reason: "held for the weekly review" };
    }

    const ev = evidence.find((e) => e.postId === pick.postId);
    const links = ev?.url && signal.kind !== "calendar" ? [ev.url] : [];
    const produced = producedStamp(spec.primary);

    // The critic (§15.5): different family, one rewrite, then drop with a verdict.
    const dossierVoice = (gathered.creator.dossier as { voice?: unknown; persona?: unknown } | undefined);
    const directiveTexts = gathered.directives.map((d) => d.verbatim);
    let text = pick.message.trim();
    let verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "over the length cap" } : await critique(ctx, { creatorId: args.creatorId, kind: "scout", text, evidence: ev, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: directiveTexts });
    let criticSkipped = Boolean(verdict.skipped);
    if (!verdict.pass) {
      const rewrite = await callModel(ctx, { creatorId: args.creatorId, purpose: "scout_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `${user}\n\nYour previous message was rejected by the critic for: ${verdict.problems.join(", ")} (${verdict.note}). Rewrite ONLY the message text for post ${pick.postId}, fixing exactly that. Output the message text only, no JSON.` }], temperature: 0.4, maxTokens: 600, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (rewrite.ok && rewrite.content.trim()) {
        text = rewrite.content.trim();
        verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "still over the length cap" } : await critique(ctx, { creatorId: args.creatorId, kind: "scout", text, evidence: ev, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: directiveTexts });
        criticSkipped = criticSkipped || Boolean(verdict.skipped);
      }
      if (!verdict.pass) {
        if (args.dryRun) return { sent: false, reason: `dropped by the critic: ${verdict.problems.join(", ")}`, dry: { message: "", pick, evidence, trace: inv.trace } };
        verdicts.push({ signalId: signal._id, verdict: "dropped", why: `critic: ${verdict.problems.join(", ")}; ${verdict.note}` });
        await ctx.runMutation(internal.scout.gate.setVerdicts, { verdicts });
        return { sent: false, reason: `dropped by the critic: ${verdict.problems.join(", ")}` };
      }
    }

    /**
     * ⚠️ The dry run stops HERE, after the critic, not before it.
     *
     * It used to return the raw writer output, so the eval suite measured a draft that
     * production would never send. The gate's very first finding was a missing link, which
     * the critic's `no_link` rule catches every time — the defect was only ever visible
     * because the measurement skipped the gate the real path goes through. An eval that
     * measures something other than what ships is worse than no eval.
     */
    if (args.dryRun) return { sent: false, reason: "dry run", dry: { message: text, pick, evidence, trace: inv.trace } };
    pick.message = text;
    const f = pick.features ?? {};
    const features = { format: String(f.format ?? "other"), topics: (f.topics ?? []).map(String).slice(0, 3), tone: String(f.tone ?? "unknown"), lengthBucket: String(f.lengthBucket ?? "unknown"), sound: String(f.sound ?? "unknown"), source: signal.kind, account: ev?.handle ?? undefined };
    const ideaId = await ctx.runMutation(internal.scout.scout.writeIdea, { creatorId: args.creatorId, signalId: signal._id, evidenceLinks: links, fit: pick.fit, fitWhy: pick.fitWhy, version: pick.version ?? {}, messageText: pick.message, produced, features, newForYou: Boolean(pick.newForYou) && g.exploreOpen });
    // A calendar pick proposes a block; the row is `proposed` and nothing reaches Google until they tap yes (§12.5).
    let buttons: Array<{ id: string; label: string }> = [
      { id: `idea:${ideaId}:shotlist`, label: "shot list" },
      { id: `idea:${ideaId}:notme`, label: "not me" },
      { id: `idea:${ideaId}:save`, label: "save" },
    ];
    const block = (pick.version as { block?: { startLocal?: string; lengthMin?: number; title?: string } | null } | undefined)?.block;
    if (signal.kind === "calendar" && block?.startLocal) {
      const start = zonedTimeToEpoch(block.startLocal, g.creator.timezone);
      if (Number.isFinite(start) && start > now) {
        const minutes = Math.min(240, Math.max(15, Number(block.lengthMin) || 60));
        const blockId = await ctx.runMutation(internal.calendar.blocks.propose, { creatorId: args.creatorId, kind: "film", start, end: start + minutes * 60_000, title: (block.title || "film").slice(0, 80), ideaId });
        buttons = [
          { id: `block:${blockId}:yes`, label: "block it" },
          { id: `block:${blockId}:no`, label: "idea only" },
          { id: `idea:${ideaId}:notme`, label: "not me" },
        ];
      }
    }
    const body = links.length && !pick.message.includes(links[0]) ? `${pick.message}\n\n${links[0]}` : pick.message;
    const { messageId } = await ctx.runMutation(internal.core.messages.send, {
      creatorId: args.creatorId,
      surface: "telegram",
      body,
      dedupeKey: `scout:${signal._id}`,
      proactive: true,
      awaitingAnswer: /\?\s*$/.test(pick.message),
      kind: "scout",
      links,
      buttons,
      produced,
      criticSkipped,
    });
    if (messageId) await ctx.runMutation(internal.scout.scout.linkIdeaMessage, { ideaId, messageId, sentAt: now });
    await ctx.scheduler.runAfter(0, internal.agent.memory.index, { creatorId: args.creatorId, kind: "idea", refId: String(ideaId), text: `${(pick.version as { hook?: string } | undefined)?.hook ?? ""}\n${pick.message}` });
    verdicts.push({ signalId: signal._id, verdict: "sent", why: `sent: ${pick.fitWhy}` });
    await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId: args.creatorId, step: "first_scout" });
    if (signal.kind === "calendar" || signal.kind === "worth_seeing") await ctx.runMutation(internal.scout.firstWeek.markStep, { creatorId: args.creatorId, step: "first_calendar_or_worth_seeing" });
    await ctx.runMutation(internal.scout.gate.setVerdicts, { verdicts });
    await deliverNow(ctx as never);
    return { sent: true, reason: pick.fitWhy };
  },
});

export const trackedHandle = internalQuery({
  args: { id: v.id("trackedAccounts") },
  handler: async (ctx, a): Promise<string | null> => {
    const row = (await ctx.db.get(a.id)) as Doc<"trackedAccounts"> | null;
    return row ? `@${row.handle}` : null;
  },
});

/** Creators whose local hour is inside the scout window and who have not had a scout pass today. */
export const dueForScout = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Id<"creators">[]> => {
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    const due: Id<"creators">[] = [];
    for (const c of creators) {
      if (!c.channel.paired || !c.dossier) continue;
      const { hour } = localHourMinute(a.now, c.timezone);
      if (hour < 8 || hour >= 20) continue; // scouting is a daytime thing; the gate enforces quiet hours too
      // Learned cadence (§13.10): once she knows the hour they tend to reply in, she aims for the hour before it.
      if (c.preferredSendHour !== undefined && Math.abs(hour - (c.preferredSendHour - 1)) > 1) continue;
      due.push(c._id);
    }
    return due;
  },
});

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ creators: number; sent: number }> => {
    const now = Date.now();
    const due = await ctx.runQuery(internal.scout.scout.dueForScout, { now });
    let sent = 0;
    for (const creatorId of due) {
      try {
        const r = await ctx.runAction(internal.scout.scout.run, { creatorId });
        if (r.sent) sent += 1;
      } catch (error) {
        console.error(`[scout] ${creatorId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { creators: due.length, sent };
  },
});

export const THRESHOLDS_VERSION = THRESHOLDS.version;
