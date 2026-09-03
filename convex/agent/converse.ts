/**
 * `converse` (plan §11.2 #8): any inbound not routed elsewhere. Tonight's version
 * is the minimal real turn: prefix + suffix → writer → leak guard (inside
 * messages.send) → deliver. The classifier, tool calls, the critic and the
 * skill-choice arrive with Sprint 3; the shape they plug into is this file.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { callModel } from "../core/llm";
import { REGISTRY } from "./registry";
import { buildPrefix, buildSuffix, producedStamp } from "./context";
import { deliverNow } from "../core/scheduler";
import { classifyInbound, type Route } from "./inbound";
import { classifyText } from "./classify";
import { investigate } from "./investigate";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { critique } from "./critic";

export const SHOTLIST_SKILL = `adapt-format (shot list)
When: they tapped "shot list" on an idea you sent.
The judgment: turn the idea into something they can shoot this afternoon. Five to six shots at most, each one line: what's on screen, what they say or the text that appears, roughly how long. Their setting and their opening pattern from the dossier. No production jargon.
Hard rules: under 120 words. No question at the end unless a real decision needs it.`;

export const markIdea = internalMutation({
  args: { ideaId: v.id("ideas"), status: v.optional(v.union(v.literal("sent"), v.literal("hearted"), v.literal("posted"), v.literal("passed"), v.literal("expired"))), savedAt: v.optional(v.number()) },
  handler: async (ctx, a): Promise<null> => {
    const patch: Record<string, unknown> = {};
    if (a.status) patch.status = a.status;
    if (a.savedAt) patch.savedAt = a.savedAt;
    if (Object.keys(patch).length) await ctx.db.patch(a.ideaId, patch);
    return null;
  },
});

export const ideaById = internalQuery({
  args: { ideaId: v.id("ideas") },
  handler: async (ctx, a) => await ctx.db.get(a.ideaId),
});

export const CONVERSE_SKILL = `converse
When: any message that is not a command, a file, a link to a post, or a button tap.
The judgment: answer the thing they actually asked, in their register, with what you know from the dossier, the conversation, and what you can look up (you have the tools: a post's numbers and words, a sound, an account's normal, what a keyword or hashtag is doing this week, what people are typing next to a keyword, their own posts that rhyme, their calendar). Look something up when it changes the answer; don't when it doesn't. If they ask about numbers nobody outside the app can see (watch time), say so. If they ask for an idea, give one, shaped to them, with why. If nothing needs a question, don't ask one.
What you can do from here, when they ask: give an opinion on a plan or a hook in words; explain what an account is doing; recall an idea or a note; and the management moves (quiet hours, tone, watch or drop an account, what they make) and edits to the latest idea happen when their message is routed to those tools, not inside this reply.
Hard rules: never invent a metric, a post, or a trend. Never promise a post will do well. Under 120 words unless they asked for detail. You cannot change settings, watch or drop an account, or edit their list from inside a reply: those happen only when the message is routed to the tool that does them. If you are answering a request like that here, it means it was NOT done; never say "added", "done" or "tracking" — say what to text so it lands ("say: add @handle" / "say: stop watching @handle" / "say: no messages before 9am") or that it's in Settings.`;

function hourBucket(epoch: number, timeZone: string): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(epoch));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export const setWatch = internalMutation({
  args: { creatorId: v.id("creators"), trackedAccountId: v.id("trackedAccounts"), keep: v.boolean() },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const t = (await ctx.db.get(a.trackedAccountId)) as Doc<"trackedAccounts"> | null;
    if (!t || t.creatorId !== a.creatorId) return { ok: false };
    if (!a.keep) await ctx.db.patch(t._id, { status: "removed" }); // history kept, like the web control
    return { ok: true };
  },
});

export const messageByTelegramId = internalQuery({
  args: { creatorId: v.id("creators"), telegramMessageId: v.string() },
  handler: async (ctx, a): Promise<{ ideaId: Id<"ideas"> | null } | null> => {
    const m = (await ctx.db.query("messages").withIndex("by_creator_tg_message", (q) => q.eq("creatorId", a.creatorId).eq("telegramMessageId", a.telegramMessageId)).first()) as Doc<"messages"> | null;
    return m ? { ideaId: m.ideaId ?? null } : null;
  },
});

export const run = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), rerouted: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: args.creatorId, messageId: args.messageId });
    if (!gathered) return { ok: false, reason: "creator not found" };
    const { creator, directives, recent, target } = gathered;
    if (!target) return { ok: false, reason: "message not found" };

    // §15.3: code decides the route. Commands never reach a model; links and files go
    // to the opinion path; a voice note or screenshot is read first and then answered here.
    const route: Route = args.rerouted ? { route: "text" } : classifyInbound({ text: target.body, kind: target.kind ?? "inbound", mime: target.fileMime, handles: creator.handles });
    if (route.route === "command") {
      if (route.command === "person") {
        await ctx.runAction(internal.agent.commands.person, { creatorId: creator._id, messageId: target._id });
        return { ok: true };
      }
      const { body } = await ctx.runMutation(internal.agent.commands.apply, { creatorId: creator._id, command: route.command });
      if (body) {
        await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body, dedupeKey: `cmd:${target._id}`, proactive: false, kind: "reply" });
        await deliverNow(ctx as never);
      }
      return { ok: true };
    }
    if (route.route === "link") {
      const r = await ctx.runAction(internal.agent.opinion.run, { creatorId: creator._id, messageId: target._id, mode: route.own ? "own" : "link", link: route.link });
      return { ok: r.ok, reason: r.reason };
    }
    if (route.route === "file") {
      // A photo of a place is a moment, a screenshot is numbers, an edited clip is a draft: Gemini says which (Sprint 3d).
      if (route.media === "video" || route.media === "image") {
        const kind = await ctx.runAction(internal.agent.moment.kindOfMedia, { messageId: target._id });
        if (kind === "scene" || (kind === "unknown" && route.media === "image" && target.body.trim().length > 0)) {
          const r = await ctx.runAction(internal.agent.moment.run, { creatorId: creator._id, messageId: target._id, hasMedia: true });
          return { ok: r.ok, reason: r.reason };
        }
        if (route.media === "video") {
          const r = await ctx.runAction(internal.agent.opinion.run, { creatorId: creator._id, messageId: target._id, mode: "video" });
          return { ok: r.ok, reason: r.reason };
        }
      }
      if (route.media === "image" || route.media === "audio") {
        const r = await ctx.runAction(internal.agent.opinion.run, { creatorId: creator._id, messageId: target._id, mode: route.media });
        if (!r.transcript) return { ok: true, reason: r.reason }; // she already answered in words
        // The body now carries the transcript or the numbers: answer it as text.
        return await ctx.runAction(internal.agent.converse.run, { creatorId: creator._id, messageId: target._id, rerouted: true });
      }
      await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: "i can take a video, a screenshot, a voice note or a link. this one i can't open.", dedupeKey: `file:${target._id}`, proactive: false, kind: "reply" });
      await deliverNow(ctx as never);
      return { ok: true };
    }

    // A reaction or button is a signal, not a prompt.
    if (target.kind === "reaction") {
      // A reaction on an idea message is a taste event (§13.10); on anything else it is just noticed.
      const reacted = target.telegramMessageId ? await ctx.runQuery(internal.agent.converse.messageByTelegramId, { creatorId: creator._id, telegramMessageId: target.telegramMessageId }) : null;
      if (reacted?.ideaId) {
        const emoji = target.body;
        const kind = /👎|💩|🤮|😴/.test(emoji) ? "thumbs_down" : emoji === "removed" ? null : "heart";
        if (kind) await ctx.runMutation(internal.taste.events.record, { creatorId: creator._id, kind, ideaId: reacted.ideaId, messageId: target._id, reaction: emoji });
      }
      return { ok: true };
    }

    // One-tap options on an idea (§7 S3). Handled here without a model call where the answer is code.
    if (target.kind === "button") {
      // A proposed filming block: yes is the consent row and the calendar write; no keeps the idea (§12.5).
      const b = target.body.match(/^block:([a-z0-9]+):(yes|no)$/);
      if (b) {
        const blockId = b[1] as Id<"calendarBlocks">;
        let body: string;
        const blk = await ctx.runQuery(internal.calendar.blocks.byId, { blockId });
        if (blk?.ideaId) await ctx.runMutation(internal.taste.events.record, { creatorId: creator._id, kind: b[2] === "yes" ? "blocked" : "idea_only", ideaId: blk.ideaId, messageId: target._id, extraKeys: [`blockhour:${hourBucket(blk.start, creator.timezone)}`] });
        if (b[2] === "yes") {
          const r = await ctx.runAction(internal.calendar.blocks.confirm, { blockId });
          body = r.ok ? `blocked ${r.when}. it's on your calendar; move it and i'll follow.${r.htmlLink ? `\n${r.htmlLink}` : ""}` : `couldn't write to your calendar just now (${r.reason}). it's saved here as a plan for ${r.when}; reconnect in Settings and tap again.`;
        } else {
          await ctx.runMutation(internal.calendar.blocks.decline, { blockId });
          body = "idea only. it's in Ideas whenever you want it.";
        }
        await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body, dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply" });
        await deliverNow(ctx as never);
        return { ok: true };
      }
      // "stop watching @x?" (§13.9): their answer is a row on the tracked account.
      const w = target.body.match(/^watch:([a-z0-9]+):(stop|keep)$/);
      if (w) {
        const r = await ctx.runMutation(internal.agent.converse.setWatch, { creatorId: creator._id, trackedAccountId: w[1] as Id<"trackedAccounts">, keep: w[2] === "keep" });
        await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: r.ok ? (w[2] === "keep" ? "kept. i'll only bring theirs when it's clearly a fit." : "done, off the list. add them back any time.") : "couldn't find that account on your list.", dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply" });
        await deliverNow(ctx as never);
        return { ok: true };
      }
      // "maybe this one?" (§13.5 unsure): their yes is the match; their no is a negative example for the skill, not for taste.
      const mm = target.body.match(/^match:([a-z0-9]+):([a-z0-9]+):(yes|no)$/);
      if (mm) {
        const r = await ctx.runMutation(internal.scout.matchPost.apply, { creatorId: creator._id, ideaId: mm[1] as Id<"ideas">, ownPostId: mm[2] as Id<"ownPosts">, confidence: mm[3] === "yes" ? "certain" : "no", why: "they said so" });
        await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: mm[3] === "yes" ? "logged. that one counts." : "got it, not from me. i'll be less sure next time.", dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply" });
        await deliverNow(ctx as never);
        return { ok: r.ok };
      }
      const bn = target.body.match(/^idea:([a-z0-9]+):blocknow$/);
      if (bn) {
        const b = await ctx.runMutation(internal.agent.moment.blockNow, { creatorId: creator._id, ideaId: bn[1] as Id<"ideas"> });
        if (b) {
          const when = new Intl.DateTimeFormat("en-US", { timeZone: creator.timezone, hour: "numeric", minute: "2-digit" }).format(b.start);
          await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: `block it from ${when}? i'll put it on your calendar and you shoot.`, dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply", buttons: [{ id: `block:${b.blockId}:yes`, label: "block it" }, { id: `block:${b.blockId}:no`, label: "not now" }] });
        } else await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: "couldn't find that idea.", dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply" });
        await deliverNow(ctx as never);
        return { ok: true };
      }
      const m = target.body.match(/^idea:([a-z0-9]+):(shotlist|notme|save)$/);
      if (m) {
        const ideaId = m[1] as Id<"ideas">;
        const op = m[2];
        await ctx.runMutation(internal.taste.events.record, { creatorId: creator._id, kind: op, ideaId, messageId: target._id });
        if (op === "notme") {
          await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: "noted. fewer like that.", dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply" });
          await deliverNow(ctx as never);
          return { ok: true };
        }
        if (op === "save") {
          await ctx.runMutation(internal.agent.converse.markIdea, { ideaId, savedAt: Date.now() });
          const saved = await ctx.runQuery(internal.agent.converse.ideaById, { ideaId });
          if (saved) await ctx.scheduler.runAfter(0, internal.agent.memory.index, { creatorId: creator._id, kind: "swipe", refId: String(ideaId), text: `${(saved.version as { hook?: string } | undefined)?.hook ?? ""}\n${saved.messageText}` });
          await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: "saved. it's in your swipe file.", dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply" });
          await deliverNow(ctx as never);
          return { ok: true };
        }
        // shotlist: a short writer call with the idea in context
        const idea = await ctx.runQuery(internal.agent.converse.ideaById, { ideaId });
        const prefix = buildPrefix({ creator, directives, skill: SHOTLIST_SKILL, personal: gathered.personal, voice: gathered.voice });
        const spec = REGISTRY.writer;
        const r = await callModel(ctx, { creatorId: creator._id, purpose: "shot_list", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `The idea you sent them:\n${JSON.stringify(idea)}\n\nWrite the shot list.` }], temperature: 0.5, maxTokens: 500, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
        const text = r.ok ? r.content.trim() : "";
        await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: text || "couldn't put the shot list together just now. ask me again in a minute.", dedupeKey: `btn:${target._id}`, proactive: false, kind: "reply", produced: producedStamp(spec.primary) });
        await deliverNow(ctx as never);
        return { ok: true };
      }
    }

    // Their first reply to an idea is read once, by the screener, as warm or cold (§13.10 reply_pos/neg).
    const lastOut = [...recent].reverse().find((m) => m.direction === "out" && m._id !== target._id);
    if (target.kind === "inbound" && lastOut?.ideaId && !recent.some((m) => m.direction === "in" && m._id !== target._id && m.ts > lastOut.ts)) {
      const screen = await callModel(ctx, { creatorId: creator._id, purpose: "taste_reply", model: REGISTRY.screener.primary, messages: [{ role: "system", content: `A creator was just sent a content idea. Read their reply and answer ONE word: warm (they like it, they're in, they're building on it), cold (they're passing, unconvinced, annoyed), or neutral (a question, a logistics detail, unclear).` }, { role: "user", content: `Idea message: ${lastOut.body.slice(0, 600)}\n\nTheir reply: ${target.body.slice(0, 400)}` }], temperature: 0, maxTokens: 5, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      const w = screen.ok ? screen.content.trim().toLowerCase() : "";
      if (w.startsWith("warm") || w.startsWith("cold")) await ctx.runMutation(internal.taste.events.record, { creatorId: creator._id, kind: w.startsWith("warm") ? "reply_pos" : "reply_neg", ideaId: lastOut.ideaId, messageId: target._id });
    }

    // §15.3: what do they want? The model decides (one cheap call); code has already taken commands, links and files.
    const lastOutbound = [...recent].reverse().find((m) => m.direction === "out")?.body;
    const intent = target.kind === "inbound" && !args.rerouted ? await classifyText(ctx, { creatorId: creator._id, text: target.body, ownHandles: creator.handles, lastOutbound, quietHours: creator.quietHours }) : ({ intent: "text" } as const);
    // §1 chat is complete: the same rows the Settings controls write, from a sentence.
    if (intent.intent === "manage") {
      let out: { ok: boolean; body: string; buttons?: Array<{ id: string; label: string }> };
      if (intent.action === "quiet_hours") out = await ctx.runMutation(internal.agent.manage.setQuietHours, { creatorId: creator._id, start: intent.start, end: intent.end });
      else if (intent.action === "tone") out = await ctx.runMutation(internal.agent.manage.setTone, { creatorId: creator._id, tone: intent.tone });
      else if (intent.action === "add_admired") out = await ctx.runMutation(internal.agent.manage.addAdmired, { creatorId: creator._id, platform: intent.platform, handle: intent.handle });
      else if (intent.action === "stop_watching") out = await ctx.runMutation(internal.agent.manage.stopWatchingButtons, { creatorId: creator._id, handle: intent.handle });
      else out = await ctx.runMutation(internal.agent.manage.setNiche, { creatorId: creator._id, text: intent.text });
      if (out.body) {
        await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: out.body, dedupeKey: `manage:${target._id}`, proactive: false, kind: "reply", buttons: out.buttons });
        await deliverNow(ctx as never);
        return { ok: true };
      }
    }
    if (intent.intent === "moment") {
      const r = await ctx.runAction(internal.agent.moment.run, { creatorId: creator._id, messageId: target._id, hasMedia: false });
      return { ok: r.ok, reason: r.reason };
    }
    if (intent.intent === "edit_idea" || intent.intent === "drop_idea") {
      const latest = await ctx.runQuery(internal.agent.moment.latestIdea, { creatorId: creator._id });
      let body: string;
      if (!latest) body = "nothing of mine to change yet. send me a moment or wait for the next idea.";
      else if (intent.intent === "drop_idea") {
        await ctx.runMutation(internal.taste.events.record, { creatorId: creator._id, kind: "notme", ideaId: latest.id, messageId: target._id });
        body = "scrapped. fewer like that.";
      } else {
        const r = await ctx.runMutation(internal.agent.moment.editIdea, { creatorId: creator._id, ideaId: latest.id, field: intent.field, value: intent.value });
        body = r.ok ? `changed. ${intent.field === "lengthSec" ? `${intent.value.replace(/[^\d]/g, "")}s it is.` : `${intent.field === "hook" ? "hook" : intent.field === "onScreenText" ? "on-screen text" : intent.field === "shotList" ? "shots" : intent.field} updated.`} it's in ideas.` : "couldn't change that one.";
      }
      await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body, dedupeKey: `edit:${target._id}`, proactive: false, kind: "reply" });
      await deliverNow(ctx as never);
      return { ok: true };
    }
    if (intent.intent === "profile_ask") {
      const r = await ctx.runAction(internal.agent.profile.run, { creatorId: creator._id, messageId: target._id, platform: intent.platform, handle: intent.handle });
      return { ok: r.ok, reason: r.reason };
    }

    // §15.7 (4): a look back runs the vector search; the passages ride into the turn, the prefix stays the same size.
    let recalled = "";
    if (intent.intent === "recall") {
      const hits = await ctx.runAction(internal.agent.memory.recall, { creatorId: creator._id, query: target.body, k: 4 }).catch(() => []);
      if (hits.length) recalled = `\n\n# From memory (their own saved ideas and notes; quote, don't invent)\n${hits.map((h) => `- [${h.kind}, ${new Date(h.at).toISOString().slice(0, 10)}] ${h.text.slice(0, 400)}`).join("\n")}`;
      else recalled = "\n\n# From memory\n- nothing close enough; say so plainly";
    }

    const prefix = buildPrefix({ creator, directives, skill: CONVERSE_SKILL, personal: gathered.personal, voice: gathered.voice });
    const suffix = buildSuffix({ recent: recent.filter((m) => m._id !== target._id), target }) + recalled;
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    const spec = REGISTRY.writer;

    // §13.11: conversation is armed too. Three lookups, ten credits, so "is this hashtag dead" or
    // "when should i post this week" is answered from the catalogue, not from memory.
    const inv = await investigate(ctx, { creatorId: creator._id, purpose: "converse", prefix, user: suffix, budget: { calls: 3, credits: 10, deadlineAt: Date.now() + 40_000 }, temperature: spec.temperature, maxTokens: spec.maxTokens });
    let result: { ok: true; content: string } | { ok: false; reason: string } = inv.content ? { ok: true, content: inv.content } : { ok: false, reason: `converse ${inv.ended}` };
    if (!result.ok) {
      const fb = await callModel(ctx, {
        creatorId: creator._id,
        purpose: "converse_fallback",
        model: spec.fallback,
        messages: [
          { role: "system", content: prefix },
          { role: "user", content: suffix },
        ],
        temperature: spec.temperature,
        maxTokens: spec.maxTokens,
        apiKey,
      });
      result = fb.ok ? { ok: true, content: fb.content } : { ok: false, reason: fb.reason };
    }
    if (!result.ok) return { ok: false, reason: result.reason };

    let text = result.content.trim();
    if (!text) return { ok: false, reason: "empty completion" };

    /**
     * ⭐ The reply path used to be the ONE outbound path with no critic: the scout, the
     * review and the first read were all judged, and the surface the creator actually
     * talks to was not. The first live conversation came back with a markdown heading and
     * a bulleted shot list, which Telegram renders as literal asterisks (2026-09-02).
     *
     * ⚠️ It rewrites, it NEVER blocks. A person is waiting on this message, so a failed
     * critique costs one rewrite and then sends regardless; a swallowed reply is worse
     * than an ugly one.
     */
    /**
     * ⚠️ The critic is told WHAT WAS ACTUALLY LOOKED UP this turn. Without it, it cannot
     * tell a named sound that came from a lookup from one the writer remembered from
     * training data — and on the first live run it could not: she named a real Taylor
     * Swift track having made no sound call at all. Plausible, on-brand, and unevidenced,
     * which is the one thing this product must never do.
     */
    const toolsUsed = (inv.trace ?? []).map((t) => String((t as { tool?: unknown }).tool ?? "")).filter(Boolean);
    const verdict = await critique(ctx, { creatorId: creator._id, kind: "reply", text, evidence: { theirMessage: target.body.slice(0, 400), toolsUsedThisTurn: toolsUsed }, voice: (creator.dossier as { voice?: unknown; persona?: unknown } | undefined) ?? {}, directives: directives.map((d) => d.verbatim) });
    let criticSkipped = verdict.skipped === true;
    if (!verdict.pass) {
      const rewrite = await callModel(ctx, {
        creatorId: creator._id,
        purpose: "converse_rewrite",
        model: spec.primary,
        messages: [
          { role: "system", content: prefix },
          { role: "user", content: `${suffix}\n\nYour previous reply was rejected for: ${verdict.problems.join(", ")} (${verdict.note}). Send it again as one plain text message, fixing exactly that. No markdown, no asterisks, no headings, no bullet list.\n\nPrevious reply:\n${text}` },
        ],
        temperature: spec.temperature,
        maxTokens: spec.maxTokens,
        apiKey,
      });
      if (rewrite.ok && rewrite.content.trim()) text = rewrite.content.trim();
      else criticSkipped = true;
    }

    await ctx.runMutation(internal.core.messages.send, {
      creatorId: creator._id,
      surface: "telegram",
      body: text,
      dedupeKey: `reply:${args.messageId}`,
      proactive: false,
      kind: "reply",
      produced: producedStamp(spec.primary),
      criticSkipped,
    });
    await deliverNow(ctx as never);
    // remember (§15.7 layer 2): what they said in passing becomes a note or a rule, after the reply is on its way.
    await ctx.scheduler.runAfter(0, internal.agent.remember.afterTurn, { creatorId: creator._id, messageId: target._id });
    return { ok: true };
  },
});
