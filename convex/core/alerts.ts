/**
 * Nothing fails silently (plan §16, principle 5). Every hour: dead jobs, outbound
 * that has not been delivered for over an hour, a failed vendor smoke, a connection
 * that needs attention. Anything new since the last look becomes ONE message to the
 * operator's Telegram chat, with ids and never content. Quiet when nothing happened.
 */

import { v } from "convex/values";
import { PLATFORM_FACTS, staleDays } from "../knowledge/platforms";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { resolveTelegramBotIdentity, sendTelegramMessage } from "../integrations/telegram/client";
import { allRows } from "./schedule";

export interface Findings { staleFacts?: string[]; scale?: { creators: number; pctOfReadLimit: number } | null; deadJobs: Array<{ id: string; kind: string; error: string }>; undelivered: Array<{ id: string; creatorId: string; ageMin: number; error: string }>; smokeFailed: Array<{ vendor: string; check: string }>; attention: Array<{ creatorId: string; provider: string; detail: string }> }

export const READ_LIMIT_BYTES = 16 * 1024 * 1024; // Convex: data read per query or mutation
export const SCALE_WARN_PCT = 40;
/** Pure: roughly what a full scan of these documents reads. */
export function scanBytes(rows: unknown[]): number {
  let n = 0;
  for (const r of rows) n += JSON.stringify(r).length;
  return n;
}

/** Pure: the message, or null when there is nothing to say. */
export function composeAlert(f: Findings, env: string): string | null {
  const lines: string[] = [];
  if (f.deadJobs.length) lines.push(`☠️ ${f.deadJobs.length} dead job${f.deadJobs.length === 1 ? "" : "s"}: ${f.deadJobs.slice(0, 5).map((j) => `${j.kind} (${j.error.slice(0, 60)})`).join("; ")}`);
  if (f.undelivered.length) lines.push(`📭 ${f.undelivered.length} undelivered for over an hour: ${f.undelivered.slice(0, 5).map((u) => `creator ${u.creatorId.slice(-6)} ${u.ageMin}m (${u.error.slice(0, 50)})`).join("; ")}`);
  if (f.smokeFailed.length) lines.push(`🩺 smoke failed: ${f.smokeFailed.map((s) => `${s.vendor}/${s.check}`).join(", ")}`);
  if (f.attention.length) lines.push(`🔌 ${f.attention.length} connection${f.attention.length === 1 ? "" : "s"} need attention: ${f.attention.slice(0, 5).map((a) => `${a.provider} for creator ${a.creatorId.slice(-6)}: ${a.detail.slice(0, 60)}`).join("; ")}`);
  if (f.staleFacts?.length) lines.push(`📚 ${f.staleFacts.length} platform fact${f.staleFacts.length === 1 ? "" : "s"} older than 60 days (she hedges them; re-check and bump verifiedOn in convex/knowledge/platforms.ts): ${f.staleFacts.slice(0, 5).join(", ")}`);
  if (f.scale) lines.push(`📈 the creators table is ${f.scale.pctOfReadLimit}% of the per-query read limit (${f.scale.creators} creators). Every hourly job that scans it fails at 100%: do S0 #1 (schedule rows) now.`);
  if (!lines.length) return null;
  return `maya · ${env}\n${lines.join("\n")}`;
}

export const findings = internalQuery({
  args: { since: v.number(), now: v.number() },
  handler: async (ctx, a): Promise<Findings> => {
    const jobs = (await ctx.db.query("jobs").order("desc").take(300)) as Doc<"jobs">[];
    const deadJobs = jobs.filter((j) => j.status === "dead" && j.updatedAt >= a.since).map((j) => ({ id: j._id, kind: j.kind, error: j.lastError ?? "" }));
    /**
     * S0 #1: the hourly jobs now scan the slim `schedule` rows, not creators. That scan is
     * the one that still grows with the fleet, so it is the one measured: from 40% of the
     * 16 MiB read limit, once a day, long before any job fails.
     */
    const rows = await allRows(ctx);
    const pct = Math.round((scanBytes(rows) / READ_LIMIT_BYTES) * 100);
    const scale = pct >= SCALE_WARN_PCT && new Date(a.now).getUTCHours() === 12 ? { creators: rows.length, pctOfReadLimit: pct } : null;
    // Undelivered outbound, straight from the delivery index: no per-creator walk.
    const undelivered: Findings["undelivered"] = [];
    const pending = (await ctx.db.query("messages").withIndex("by_delivery", (q) => q.eq("direction", "out").eq("deliveredAt", undefined)).order("desc").take(500)) as Doc<"messages">[];
    for (const m of pending) {
      if (m.deliveryError === "no Telegram chat paired for this account" || m.ts < a.now - 24 * 3_600_000) continue;
      const ageMin = Math.round((a.now - m.ts) / 60_000);
      if (ageMin >= 60 && m.ts >= a.since - 3_600_000) undelivered.push({ id: m._id, creatorId: m.creatorId, ageMin, error: m.deliveryError ?? "not delivered" });
    }
    const health = (await ctx.db.query("vendorHealth").order("desc").take(60)) as Doc<"vendorHealth">[];
    const seen = new Set<string>();
    const smokeFailed: Findings["smokeFailed"] = [];
    for (const h of health) {
      const k = `${h.vendor}:${h.check}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!h.ok && h.at >= a.since) smokeFailed.push({ vendor: h.vendor, check: h.check });
    }
    const conns = (await ctx.db.query("connections").collect()) as Doc<"connections">[];
    const attention = conns.filter((x) => (x.status === "attention" || x.status === "needs_reconnect") && x.updatedAt >= a.since).map((x) => ({ creatorId: x.creatorId, provider: x.provider, detail: x.detail ?? x.status }));
    const staleFacts = new Date(a.now).getUTCHours() === 12 ? PLATFORM_FACTS.filter((x) => staleDays(x.verifiedOn, a.now) > 60).map((x) => x.id) : [];
    return { staleFacts, scale, deadJobs, undelivered, smokeFailed, attention };
  },
});

export const lastRun = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> => {
    const row = (await ctx.db.query("vendorHealth").withIndex("by_vendor_at", (q) => q.eq("vendor", "alerts")).order("desc").first()) as Doc<"vendorHealth"> | null;
    return row?.at ?? 0;
  },
});

export const markRun = internalMutation({
  args: { sent: v.boolean(), detail: v.optional(v.string()) },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.insert("vendorHealth", { vendor: "alerts", check: "hourly", ok: true, detail: { sent: a.sent, detail: a.detail ?? null }, at: Date.now() });
    return null;
  },
});

/** Is this Telegram chat a creator's? Ops never writes to a customer. */
export const isCustomerChat = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, a): Promise<boolean> =>
    Boolean(await ctx.db.query("creators").withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", a.chatId)).first()),
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: boolean; text: string | null }> => {
    const now = Date.now();
    const since = Math.max(await ctx.runQuery(internal.core.alerts.lastRun, {}), now - 6 * 3_600_000);
    const f = await ctx.runQuery(internal.core.alerts.findings, { since, now });
    const text = composeAlert(f, process.env.ENVIRONMENT_NAME ?? "local");
    let sent = false;
    const chat = process.env.TELEGRAM_OPERATOR_CHAT_ID;
    const identity = resolveTelegramBotIdentity();
    // 2026-09-06: on dev the operator's chat was also the pilot's, and "🩺 smoke failed" reached
    // a person as if Maya had said it. A customer never receives an ops line, in any environment:
    // if the operator chat belongs to a creator, the alert goes to the log and nowhere else.
    const customer = chat ? await ctx.runQuery(internal.core.alerts.isCustomerChat, { chatId: chat }) : false;
    if (text && customer) console.error(`[alerts] REFUSED: TELEGRAM_OPERATOR_CHAT_ID is a creator's chat; not sending: ${text.slice(0, 200)}`);
    if (text && chat && identity && !customer) {
      const r = await sendTelegramMessage(identity, { chatId: chat, text }).catch(() => null);
      sent = Boolean(r && r.ok);
    }
    await ctx.runMutation(internal.core.alerts.markRun, { sent, detail: customer && text ? `refused: operator chat belongs to a creator · ${text.slice(0, 150)}` : text?.slice(0, 200) });
    return { sent, text };
  },
});
