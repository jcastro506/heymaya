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
import { deliverNow } from "../core/scheduler";
import { THRESHOLDS } from "../config/thresholds";
import { critique, tooLong } from "../agent/critic";
import { localHourMinute } from "./gate";
import { internalQuery } from "../_generated/server";

export const SCOUT_SKILL = `scout
When: the gate has passed and there are candidates. Four kinds: "breakout" (an account they admire, above its own normal), "shape" (the top of their lane for one of their keywords this week; the account is not one they named), "win" (THEIR OWN post crossing 3× their normal; the message is a real, specific celebration and one thing to do while it's moving, nothing else), and "calendar" (something on THEIR OWN calendar two or more days out that a post could ride: the message names the event, the shape of the post it makes possible, and proposes ONE filming block before it, with a day and a time on their clock; "version.block" carries that block and the question at the end is whether to block it).
The judgment: which of these, if any, is notable (a real breakout above that account's own normal, not just a big account being big) AND fits this creator (their formats, their register, their lane, the dossier). Default is no. Pick at most one. If one fits, write the message: the evidence (who, how far above their normal, how old), the link, what the post does (from the transcript; you have NOT watched it, so say nothing about visuals), and their version: a hook line, the length, the sound if known, one line of on-screen text. End with exactly one question that has a decision behind it.
Output ONLY JSON:
{"pick": {"postId": "", "notable": true, "fit": "yes|maybe|no", "fitWhy": "≤160", "message": "≤900 chars, in your voice, lowercase fine, no bullets", "version": {"hook": "≤120", "onScreenText": "≤80", "lengthSec": 0, "sound": "≤80 or ''", "block": {"startLocal": "YYYY-MM-DDTHH:MM on their clock", "lengthMin": 60, "title": "≤60, starts with 'film:'"} | null}} | null,
 "rejected": [{"postId": "", "why": "≤80"}]}`;

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
  },
  handler: async (ctx, a): Promise<Id<"ideas">> =>
    await ctx.db.insert("ideas", {
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
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args): Promise<{ sent: boolean; reason: string }> => {
    const now = Date.now();
    const g = await ctx.runQuery(internal.scout.gate.railsFor, { creatorId: args.creatorId, now });
    if (!g) return { sent: false, reason: "creator not found" };
    if (!g.rails.ok) return { sent: false, reason: g.rails.reason ?? "rails" };
    if (g.candidates.length === 0) return { sent: false, reason: "no candidates" };

    // Evidence for the model: the candidate posts with transcripts (a credit each, cached fleet-wide).
    const evidence: Array<{ postId: string; kind: string; url: string; ratio: number; why: string; transcript: string | null; handle: string | null }> = [];
    for (const s of g.candidates) {
      const url = s.why.split("; ").pop() ?? "";
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
      evidence.push({ postId: s.sourcePostIds[0], kind: s.kind, url, ratio: s.score, why: s.why, transcript, handle });
    }

    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: args.creatorId });
    if (!gathered) return { sent: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: gathered.creator, directives: gathered.directives, skill: SCOUT_SKILL });
    const spec = REGISTRY.writer;
    const user = `Candidates (kind: breakout / shape / win / calendar), ranked; for posts, ratio is how far above that account's own normal:\n${JSON.stringify(evidence)}\n\nToday on their clock: ${localDateKey(now, g.creator.timezone)}, ${g.rails.localHour}:00 (${g.creator.timezone}). Messages already sent today: ${g.rails.sentToday}.`;
    const result = await callModel(ctx, { creatorId: args.creatorId, purpose: "scout", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: user }], temperature: 0.5, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    if (!result.ok) return { sent: false, reason: `scout model failed: ${result.reason}` };

    let parsed: { pick: null | { postId: string; notable: boolean; fit: "yes" | "maybe" | "no"; fitWhy: string; message: string; version: unknown }; rejected?: Array<{ postId: string; why: string }> };
    try {
      const m = result.content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : "{}") as typeof parsed;
    } catch {
      return { sent: false, reason: "scout returned no JSON" };
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
      await ctx.runMutation(internal.scout.gate.setVerdicts, { verdicts });
      return { sent: false, reason: "nothing worth their time today" };
    }
    const signal = g.candidates.find((s) => s.sourcePostIds[0] === pick.postId)!;
    if (pick.fit === "maybe") {
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
        verdicts.push({ signalId: signal._id, verdict: "dropped", why: `critic: ${verdict.problems.join(", ")}; ${verdict.note}` });
        await ctx.runMutation(internal.scout.gate.setVerdicts, { verdicts });
        return { sent: false, reason: `dropped by the critic: ${verdict.problems.join(", ")}` };
      }
    }
    pick.message = text;
    const ideaId = await ctx.runMutation(internal.scout.scout.writeIdea, { creatorId: args.creatorId, signalId: signal._id, evidenceLinks: links, fit: pick.fit, fitWhy: pick.fitWhy, version: pick.version ?? {}, messageText: pick.message, produced });
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
    verdicts.push({ signalId: signal._id, verdict: "sent", why: `sent: ${pick.fitWhy}` });
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
