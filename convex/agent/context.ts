/**
 * Context assembly (plan §15.1). Stable prefix first, byte-identical for a creator
 * within a week; variable suffix after. A test asserts the prefix is identical
 * across two consecutive turns.
 */

import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { SOUL, SOUL_VERSION, REGISTER_ADDENDA } from "./soul";

export const RECENT_MESSAGES = 20;
export const CONTEXT_VERSION = "ctx-2026-09-02.1";

export interface AssembledContext {
  prefix: string;
  suffix: string;
  produced: { skillVersion: string; model: string; thresholdsVersion: string };
  creator: Doc<"creators">;
  lastInbound: Doc<"messages"> | null;
}

export const gather = internalQuery({
  args: { creatorId: v.id("creators"), messageId: v.optional(v.id("messages")) },
  handler: async (ctx, args): Promise<{ creator: Doc<"creators">; directives: Doc<"directives">[]; recent: Doc<"messages">[]; target: Doc<"messages"> | null } | null> => {
    const creator = (await ctx.db.get(args.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const directives = (await ctx.db
      .query("directives")
      .withIndex("by_creator_and_active", (q) => q.eq("creatorId", args.creatorId).eq("active", true))
      .collect()) as Doc<"directives">[];
    const recent = (await ctx.db
      .query("messages")
      .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", args.creatorId))
      .order("desc")
      .take(RECENT_MESSAGES)) as Doc<"messages">[];
    const target = args.messageId ? ((await ctx.db.get(args.messageId)) as Doc<"messages"> | null) : null;
    return { creator, directives, recent: recent.reverse(), target };
  },
});

/** Build the stable prefix: soul → register → skill → dossier → directives → live notes. */
export function buildPrefix(input: { creator: Doc<"creators">; directives: Doc<"directives">[]; skill: string }): string {
  const c = input.creator;
  const notes = (c.notes ?? []).filter((n) => !n.tombstonedAt && (!n.expiresHint || n.expiresHint > Date.now()));
  const dossier = c.dossier ? JSON.stringify(c.dossier) : `{"mode":"newCreator","note":"no dossier yet — the catalogue read has not finished"}`;
  return [
    SOUL,
    REGISTER_ADDENDA[c.tone ?? "friend"],
    `# Skill\n${input.skill}`,
    `# The creator (their dossier, evidence-backed; say "unknown" for anything not in it)\nHandles: ${JSON.stringify(c.handles)}\nTheir words about what they make: ${JSON.stringify(c.niche)}\nTimezone: ${c.timezone}\n${dossier}`,
    `# House rules, verbatim (${input.directives.length})\n${input.directives.map((d) => `- ${d.verbatim}`).join("\n") || "- none yet"}`,
    `# Things they told you (${notes.length})\n${notes.map((n) => `- ${n.text}`).join("\n") || "- nothing yet"}`,
  ].join("\n\n");
}

/** The variable suffix: the recent conversation, oldest first, then the message being answered. */
export function buildSuffix(input: { recent: Doc<"messages">[]; target: Doc<"messages"> | null }): string {
  const lines = input.recent.map((m) => `${m.direction === "in" ? "them" : "you"}: ${m.body}`);
  const t = input.target;
  const targetLine = t ? `\n\nAnswer this one:\nthem${t.kind && t.kind !== "inbound" ? ` (${t.kind})` : ""}: ${t.body}` : "";
  return `# Recent conversation (oldest first)\n${lines.join("\n") || "(none)"}${targetLine}`;
}

export function producedStamp(model: string): { skillVersion: string; model: string; thresholdsVersion: string } {
  return { skillVersion: `${SOUL_VERSION}+${CONTEXT_VERSION}`, model, thresholdsVersion: "thresholds-0" };
}

export type CreatorId = Id<"creators">;
