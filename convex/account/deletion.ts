/**
 * Deletion is everything, in one procedure, in this order (plan §16.5). Triggered
 * from Settings after a typed confirmation and the offer of an export; never from a
 * single message. Freeze first, so nothing new can start; the final message before
 * the pairing goes; the rows last, by one mutation that walks every table keyed by
 * creatorId; then files. Identity (Clerk) is deleted by the web route that called
 * this, once it returns. Stripe and Zernio steps run when those rows exist.
 */

import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { disconnectFor } from "../calendar/oauth";
import { resolveTelegramBotIdentity, sendTelegramMessage } from "../integrations/telegram/client";
import { getStripe } from "../billing/stripe";
import { disconnectFor as zernioDisconnectFor } from "../connections/zernio";

/** Every table with a creatorId, and the index that reaches it. Adding a table without listing it here fails the deletion test. */
export const TABLES_BY_CREATOR = [
  "trackedAccounts",
  "ownPosts",
  "ownPostReads",
  "signals",
  "ideas",
  "predictions",
  "calendarBlocks",
  "calendarEvents",
  "tasteEvents",
  "oauthStates",
  "connections",
  "directives",
  "messages",
  "jobs",
  "budgets",
  "costEvents",
  "memories",
  "laneReads",
  "evalRuns",
  "evalLabels",
] as const;

export const FINAL_MESSAGE = "deleting everything now: your posts as i read them, every idea, every message, your calendar fields, your notes. this chat unpairs after this text. take care out there.";

/** Step 1: freeze. The plan row flips first, so every proactive and on-demand path refuses from here. */
export const requestDelete = mutation({
  args: { confirm: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; creatorId?: Id<"creators"> }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return { ok: false, reason: "no account" };
    if (a.confirm.trim().toUpperCase() !== "DELETE") return { ok: false, reason: "type DELETE to confirm" };
    if (c.plan.status !== "deleting") await ctx.db.patch(c._id, { plan: { ...c.plan, status: "deleting" }, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.account.deletion.run, { creatorId: c._id });
    return { ok: true, creatorId: c._id };
  },
});

/** The export offered before deletion: their rows, as JSON, nothing derived from other people's posts. */
export const exportMine = query({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown> | null> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return null;
    const pick = async (table: (typeof TABLES_BY_CREATOR)[number]) => (await ctx.db.query(table).filter((q) => q.eq(q.field("creatorId"), c._id)).take(2000)) as Doc<typeof table>[];
    const { tokenRef: _t, pairingToken: _p, ...creator } = c as Doc<"creators"> & { tokenRef?: string };
    void _t; void _p;
    return {
      exportedAt: new Date().toISOString(),
      creator,
      ownPosts: await pick("ownPosts"),
      ownPostReads: await pick("ownPostReads"),
      ideas: await pick("ideas"),
      predictions: await pick("predictions"),
      messages: await pick("messages"),
      directives: await pick("directives"),
      calendarBlocks: await pick("calendarBlocks"),
      tasteEvents: await pick("tasteEvents"),
      trackedAccounts: await pick("trackedAccounts"),
    };
  },
});

export const snapshot = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ creator: Doc<"creators">; fileIds: Id<"_storage">[]; zernio: Doc<"connections"> | null } | null> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"messages">[];
    const fileIds = messages.map((m) => m.fileId).filter((x): x is Id<"_storage"> => Boolean(x));
    const zernio = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    return { creator, fileIds, zernio };
  },
});

/** Steps 2–7, in order. Each step is logged on its own so a partial run is visible. */
export const run = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ ok: boolean; steps: Record<string, string> }> => {
    const steps: Record<string, string> = {};
    const snap = await ctx.runQuery(internal.account.deletion.snapshot, { creatorId: a.creatorId });
    if (!snap) return { ok: false, steps: { snapshot: "creator not found" } };
    const { creator } = snap;
    if (creator.plan.status !== "deleting") return { ok: false, steps: { freeze: "not frozen; refusing" } };

    // 2. Stripe: cancel now; the customer and invoices are retained (tax law, and the privacy policy says so).
    if (creator.plan.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
      try {
        const sub = await getStripe().subscriptions.cancel(creator.plan.stripeSubscriptionId);
        steps.stripe = `subscription ${sub.status}`;
      } catch (e) {
        steps.stripe = `cancel failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`;
      }
    } else steps.stripe = "no subscription";

    // 3. Zernio: every account, then the profile (400 while any account remains, so the order is enforced).
    try {
      steps.zernio = await zernioDisconnectFor(ctx, a.creatorId);
    } catch (e) {
      steps.zernio = `disconnect failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}; rows purged below`;
    }

    // 4. Calendar: revoke at Google, drop the bundle and every stored event.
    try {
      await disconnectFor(ctx, a.creatorId);
      steps.calendar = "revoked and purged";
    } catch (e) {
      steps.calendar = `revoke failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}; rows purged below`;
    }

    // 5. Telegram: the final message BEFORE the pairing goes.
    const identity = resolveTelegramBotIdentity();
    if (creator.telegramChatId && identity) {
      const r = await sendTelegramMessage(identity, { chatId: creator.telegramChatId, text: FINAL_MESSAGE }).catch(() => null);
      steps.telegram = r && r.ok ? "final message sent, pairing removed" : "final message failed, pairing removed";
    } else steps.telegram = "not paired";

    // 6. Rows.
    const purged = await ctx.runMutation(internal.account.deletion.purgeRows, { creatorId: a.creatorId });
    steps.rows = `${purged.deleted} rows across ${purged.tables} tables, creator row gone`;

    // 7. Files.
    let files = 0;
    for (const id of snap.fileIds) {
      try {
        await ctx.storage.delete(id);
        files++;
      } catch {
        /* already gone */
      }
    }
    steps.files = `${files} of ${snap.fileIds.length}`;
    console.log(`[deletion] ${a.creatorId}: ${JSON.stringify(steps)}`);
    return { ok: true, steps };
  },
});

/** Step 6: one mutation, every table keyed by creatorId, then the creator row itself. */
export const purgeRows = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ deleted: number; tables: number }> => {
    let deleted = 0;
    for (const table of TABLES_BY_CREATOR) {
      const rows = await ctx.db.query(table).filter((q) => q.eq(q.field("creatorId"), a.creatorId)).collect();
      for (const r of rows) {
        await ctx.db.delete(r._id);
        deleted++;
      }
    }
    // The creator row last: notes, affinities, dossier, tokens and the pairing all live on it.
    const c = await ctx.db.get(a.creatorId);
    if (c) {
      await ctx.db.delete(a.creatorId);
      deleted++;
    }
    return { deleted, tables: TABLES_BY_CREATOR.length };
  },
});

/** For the web route: is the purge done, so Clerk can be deleted? */
export const gone = action({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ gone: boolean }> => {
    const snap = await ctx.runQuery(internal.account.deletion.snapshot, { creatorId: a.creatorId });
    return { gone: snap === null };
  },
});
