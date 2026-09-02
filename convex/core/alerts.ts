/**
 * Nothing fails silently (plan §16, principle 5). Every hour: dead jobs, outbound
 * that has not been delivered for over an hour, a failed vendor smoke, a connection
 * that needs attention. Anything new since the last look becomes ONE message to the
 * operator's Telegram chat, with ids and never content. Quiet when nothing happened.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { resolveTelegramBotIdentity, sendTelegramMessage } from "../integrations/telegram/client";

export interface Findings { deadJobs: Array<{ id: string; kind: string; error: string }>; undelivered: Array<{ id: string; creatorId: string; ageMin: number; error: string }>; smokeFailed: Array<{ vendor: string; check: string }>; attention: Array<{ creatorId: string; provider: string; detail: string }> }

/** Pure: the message, or null when there is nothing to say. */
export function composeAlert(f: Findings, env: string): string | null {
  const lines: string[] = [];
  if (f.deadJobs.length) lines.push(`☠️ ${f.deadJobs.length} dead job${f.deadJobs.length === 1 ? "" : "s"}: ${f.deadJobs.slice(0, 5).map((j) => `${j.kind} (${j.error.slice(0, 60)})`).join("; ")}`);
  if (f.undelivered.length) lines.push(`📭 ${f.undelivered.length} undelivered for over an hour: ${f.undelivered.slice(0, 5).map((u) => `creator ${u.creatorId.slice(-6)} ${u.ageMin}m (${u.error.slice(0, 50)})`).join("; ")}`);
  if (f.smokeFailed.length) lines.push(`🩺 smoke failed: ${f.smokeFailed.map((s) => `${s.vendor}/${s.check}`).join(", ")}`);
  if (f.attention.length) lines.push(`🔌 ${f.attention.length} connection${f.attention.length === 1 ? "" : "s"} need attention: ${f.attention.slice(0, 5).map((a) => `${a.provider} for creator ${a.creatorId.slice(-6)}: ${a.detail.slice(0, 60)}`).join("; ")}`);
  if (!lines.length) return null;
  return `maya · ${env}\n${lines.join("\n")}`;
}

export const findings = internalQuery({
  args: { since: v.number(), now: v.number() },
  handler: async (ctx, a): Promise<Findings> => {
    const jobs = (await ctx.db.query("jobs").order("desc").take(300)) as Doc<"jobs">[];
    const deadJobs = jobs.filter((j) => j.status === "dead" && j.updatedAt >= a.since).map((j) => ({ id: j._id, kind: j.kind, error: j.lastError ?? "" }));
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    const undelivered: Findings["undelivered"] = [];
    for (const c of creators) {
      const rows = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", a.now - 24 * 3_600_000)).collect()) as Doc<"messages">[];
      for (const m of rows) {
        if (m.direction !== "out" || m.deliveredAt || m.deliveryError === "no Telegram chat paired for this account") continue;
        const ageMin = Math.round((a.now - m.ts) / 60_000);
        if (ageMin >= 60 && m.ts >= a.since - 3_600_000) undelivered.push({ id: m._id, creatorId: c._id, ageMin, error: m.deliveryError ?? "not delivered" });
      }
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
    return { deadJobs, undelivered, smokeFailed, attention };
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
    if (text && chat && identity) {
      const r = await sendTelegramMessage(identity, { chatId: chat, text }).catch(() => null);
      sent = Boolean(r && r.ok);
    }
    await ctx.runMutation(internal.core.alerts.markRun, { sent, detail: text?.slice(0, 200) });
    return { sent, text };
  },
});
