/**
 * Live smoke (plan §17.1): one cheap real call per vendor, daily, writing vendorHealth,
 * so a retired endpoint, an expired key or a dead bot shows on the console before a
 * creator hits it. Nothing here spends a model token; the credit check is free and
 * Telegram's getMe is free.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { resolveTelegramBotIdentity } from "../integrations/telegram/client";

export const record = internalMutation({
  args: { vendor: v.string(), check: v.string(), ok: v.boolean(), detail: v.optional(v.any()) },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.insert("vendorHealth", { vendor: a.vendor, check: a.check, ok: a.ok, detail: a.detail, at: Date.now() });
    return null;
  },
});

/** The latest reading per vendor and check, for the console. */
export const latest = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ vendor: string; check: string; ok: boolean; detail: unknown; at: number }>> => {
    const rows = (await ctx.db.query("vendorHealth").order("desc").take(200)) as Doc<"vendorHealth">[];
    const seen = new Map<string, Doc<"vendorHealth">>();
    for (const r of rows) {
      const k = `${r.vendor}:${r.check}`;
      if (!seen.has(k)) seen.set(k, r);
    }
    return Array.from(seen.values()).map((r) => ({ vendor: r.vendor, check: r.check, ok: r.ok, detail: r.detail, at: r.at }));
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, boolean>> => {
    const out: Record<string, boolean> = {};

    // ScrapeCreators: the credit balance, always live (the fixture flag does not apply to the vendor's own account).
    try {
      const key = process.env.SCRAPE_CREATORS_API_KEY ?? "";
      const res = await fetch("https://api.scrapecreators.com/v1/credit-balance", { headers: { "x-api-key": key } });
      const body = (await res.json().catch(() => ({}))) as { creditCount?: number; success?: boolean };
      const ok = res.ok && Boolean(body.success);
      await ctx.runMutation(internal.core.smoke.record, { vendor: "scrapecreators", check: "credit-balance", ok, detail: { status: res.status, credits: body.creditCount ?? null, fixtures: process.env.SCRAPE_FIXTURES ?? "off" } });
      out.scrapecreators = ok;
    } catch (e) {
      await ctx.runMutation(internal.core.smoke.record, { vendor: "scrapecreators", check: "credit-balance", ok: false, detail: String(e).slice(0, 200) });
      out.scrapecreators = false;
    }

    // Telegram: getMe on the bot this deployment uses.
    try {
      const identity = resolveTelegramBotIdentity();
      if (!identity) throw new Error("no bot identity");
      const res = await fetch(`https://api.telegram.org/bot${identity.token}/getMe`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string } };
      const ok = res.ok && Boolean(body.ok);
      await ctx.runMutation(internal.core.smoke.record, { vendor: "telegram", check: "getMe", ok, detail: { username: body.result?.username ?? null } });
      out.telegram = ok;
    } catch (e) {
      await ctx.runMutation(internal.core.smoke.record, { vendor: "telegram", check: "getMe", ok: false, detail: String(e).slice(0, 200) });
      out.telegram = false;
    }

    // OpenRouter: the models list is free and proves the key.
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", { headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}` } });
      await ctx.runMutation(internal.core.smoke.record, { vendor: "openrouter", check: "models", ok: res.ok, detail: { status: res.status } });
      out.openrouter = res.ok;
    } catch (e) {
      await ctx.runMutation(internal.core.smoke.record, { vendor: "openrouter", check: "models", ok: false, detail: String(e).slice(0, 200) });
      out.openrouter = false;
    }

    // Gemini: the models list is free and proves the key.
    try {
      const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=1`);
      await ctx.runMutation(internal.core.smoke.record, { vendor: "gemini", check: "models", ok: res.ok, detail: { status: res.status } });
      out.gemini = res.ok;
    } catch (e) {
      await ctx.runMutation(internal.core.smoke.record, { vendor: "gemini", check: "models", ok: false, detail: String(e).slice(0, 200) });
      out.gemini = false;
    }
    return out;
  },
});
