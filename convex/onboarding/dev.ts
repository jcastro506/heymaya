/**
 * Operator-only seams for `npx convex run`, used to exercise the pipeline on a dev
 * deployment without the web. Internal: not reachable from a client.
 *
 *   arch -arm64 npx convex run onboarding/dev:seed '{"tiktok":"leahruns","niche":"marathon training"}'
 *   arch -arm64 npx convex run onboarding/dev:status '{"creatorId":"..."}'
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

export const seed = internalMutation({
  args: { tiktok: v.optional(v.string()), instagram: v.optional(v.string()), niche: v.optional(v.string()), timezone: v.optional(v.string()), email: v.optional(v.string()), admired: v.optional(v.array(v.string())) },
  handler: async (ctx, a): Promise<{ creatorId: string }> => {
    const now = Date.now();
    const creatorId = await ctx.db.insert("creators", {
      clerkUserId: `dev_${now}`,
      email: a.email ?? "dev@example.com",
      handles: { tiktok: a.tiktok, instagram: a.instagram },
      ownership: "unverified",
      niche: a.niche ?? "",
      timezone: a.timezone ?? "UTC",
      quietHours: { start: "22:00", end: "07:00" },
      tone: "friend",
      mode: "full",
      dossierVersion: 0,
      notes: [],
      affinities: [],
      experiments: [],
      channel: { paired: false },
      plan: { status: "comped", founding: true },
      createdAt: now,
    });
    for (const h of a.admired ?? []) {
      await ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: h.replace(/^@/, "").toLowerCase(), addedBy: "creator", baselineN: 0, status: "active", createdAt: now });
    }
    await ctx.runMutation(internal.core.jobs.enqueue, {
      kind: "ingest_catalogue",
      idempotencyKey: `ingest:${creatorId}:v0`,
      creatorId,
      payloadJson: JSON.stringify({ reason: "dev seed" }),
    });
    return { creatorId };
  },
});

export const status = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a) => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ownPosts">[];
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"jobs">[];
    const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(10)) as Doc<"messages">[];
    const costs = await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", a.creatorId)).collect();
    const signals = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(10)) as Doc<"signals">[];
    return {
      mode: creator.mode,
      dossierVersion: creator.dossierVersion,
      dossierSummary: (creator.dossier as { persona?: { summary?: string } } | undefined)?.persona?.summary ?? null,
      posts: posts.length,
      transcripts: posts.filter((p) => p.transcript).length,
      baselineSample: posts.slice(0, 3).map((p) => ({ id: p.postId, url: p.url, type: p.contentType, sec: p.durationSec, views: p.metrics.views, multiple: p.multiple, sample: p.sample, transcript: p.transcript ? p.transcript.slice(0, 80) : null })),
      jobs: jobs.map((j) => ({ kind: j.kind, status: j.status, attempts: j.attempts, lastError: j.lastError })),
      messages: messages.map((m) => ({ dir: m.direction, kind: m.kind, body: m.body.slice(0, 160), delivered: m.deliveredAt ? true : m.deliveryError ?? "pending" })),
      spendUsd: costs.reduce((s, c) => s + c.costUsd, 0),
      signals: signals.map((x) => ({ kind: x.kind, score: x.score, verdict: x.verdict, why: x.why.slice(0, 200), investigation: (x.investigation ?? []).map((t) => `${t.tool}(${JSON.stringify(t.params).slice(0, 60)}) ${t.ok ? "ok" : "refused"} ${t.credits ?? 0}cr ${t.ms}ms — ${t.why.slice(0, 80)}`) })),
    };
  },
});

/** Pull a creator's queued jobs forward so a drain claims them now. */
export const retryNow = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ moved: number }> => {
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"jobs">[];
    let moved = 0;
    for (const j of jobs) {
      if (j.status === "queued" || j.status === "dead") {
        await ctx.db.patch(j._id, { status: "queued", runAfter: Date.now(), updatedAt: Date.now() });
        moved += 1;
      }
    }
    return { moved };
  },
});

/** Bind a Telegram chat to a dev creator without the web flow (the operator's own chat, for a live smoke). */
export const pairChat = internalMutation({
  args: { creatorId: v.id("creators"), chatId: v.string() },
  handler: async (ctx, a): Promise<{ paired: boolean }> => {
    // Same exclusivity rule as the real pairing path: one chat, one creator.
    for (const other of await ctx.db.query("creators").withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", a.chatId)).collect()) {
      if (other._id !== a.creatorId) await ctx.db.patch(other._id, { telegramChatId: undefined, channel: { paired: false }, updatedAt: Date.now() });
    }
    await ctx.db.patch(a.creatorId, { telegramChatId: a.chatId, channel: { paired: true, pairedAt: Date.now() }, updatedAt: Date.now() });
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"jobs">[];
    for (const j of jobs) if (j.kind === "deliver_message" && j.status !== "succeeded") await ctx.db.patch(j._id, { status: "queued", runAfter: Date.now(), updatedAt: Date.now() });
    return { paired: true };
  },
});

/** Dev only: the most recent failed or dead jobs with their errors, fleet-wide. */
export const failedJobs = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Record<string, unknown>>> => {
    const rows = (await ctx.db.query("jobs").order("desc").take(40)) as Doc<"jobs">[];
    return rows.filter((j) => j.status === "failed" || j.status === "dead").slice(0, 5).map((j) => ({ kind: j.kind, status: j.status, attempts: j.attempts, creatorId: j.creatorId, error: j.lastError ?? null, payload: (j.payloadJson ?? "").slice(0, 200) }));
  },
});

/** Dev only: the last jobs and messages for whichever creator owns a Telegram chat. */
export const chatTrace = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, a): Promise<Record<string, unknown>> => {
    const creator = (await ctx.db.query("creators").withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", a.chatId)).first()) as Doc<"creators"> | null;
    if (!creator) return { creator: null };
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).order("desc").take(6)) as Doc<"jobs">[];
    const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creator._id)).order("desc").take(4)) as Doc<"messages">[];
    const predictions = (await ctx.db.query("predictions").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).order("desc").take(3)) as Doc<"predictions">[];
    const costs = (await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", creator._id)).order("desc").take(12)) as Doc<"costEvents">[];
    return {
      creator: creator._id,
      recentCosts: costs.map((c) => `${new Date(c.at).toISOString().slice(11, 19)} ${c.vendor} ${c.kind} $${c.costUsd.toFixed(4)}`),
      predictions: predictions.map((p) => ({ confidence: p.confidence, expectedMultiple: p.expectedMultiple, subject: p.subject, citations: (p.opinion as { citations?: unknown }).citations, investigation: ((p.opinion as { investigation?: Array<{ tool: string; params: unknown; ok: boolean; credits?: number; why: string }> }).investigation ?? []).map((t) => `${t.tool}(${JSON.stringify(t.params).slice(0, 70)}) ${t.ok ? "ok" : "refused"} ${t.credits ?? 0}cr — ${t.why.slice(0, 80)}`) })),
      jobs: jobs.map((j) => ({ kind: j.kind, status: j.status, attempts: j.attempts, error: j.lastError ?? null })),
      messages: messages.reverse().map((m) => ({ dir: m.direction, kind: m.kind, body: m.body.slice(0, 500), delivered: Boolean(m.deliveredAt), error: m.deliveryError ?? null })),
    };
  },
});


/** Dev only: put a creator's judged signals back to pending so the scout can be exercised again. */
export const reopenSignals = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ reopened: number }> => {
    const rows = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"signals">[];
    let n = 0;
    for (const r of rows) {
      await ctx.db.patch(r._id, { verdict: "pending", createdAt: Date.now(), investigation: undefined });
      n++;
    }
    return { reopened: n };
  },
});

/** Dev only: one call to a model id through OpenRouter, to see the raw reason when a role's primary keeps falling back. */
export const probeModel = internalAction({
  args: { model: v.string(), maxTokens: v.optional(v.number()) },
  handler: async (_ctx, a): Promise<{ ok: boolean; reason?: string; content?: string; usage?: unknown }> => {
    const { callOpenRouter } = await import("../integrations/openrouter/client");
    const r = await callOpenRouter({ model: a.model, messages: [{ role: "system", content: "Answer with one word." }, { role: "user", content: "Say ok." }], temperature: 0, maxTokens: a.maxTokens ?? 200, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    return r.ok ? { ok: true, content: r.content.slice(0, 80), usage: r.usage } : { ok: false, reason: r.reason };
  },
});

/** Dev only: a plausible breakout candidate for an admired account, so the scout and its evals have something worth judging. */
export const seedBreakout = internalMutation({
  args: { creatorId: v.id("creators"), handle: v.string(), ratio: v.number(), url: v.string() },
  handler: async (ctx, a): Promise<{ signalId: Id<"signals"> }> => {
    const now = Date.now();
    let tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).filter((q) => q.eq(q.field("handle"), a.handle)).first()) as Doc<"trackedAccounts"> | null;
    if (!tracked) {
      const id = await ctx.db.insert("trackedAccounts", { creatorId: a.creatorId, platform: "tiktok", handle: a.handle, status: "active", addedBy: "creator", baselineN: 12, medianPace24h: 4000, createdAt: now } as never);
      tracked = (await ctx.db.get(id)) as Doc<"trackedAccounts">;
    }
    const signalId = await ctx.db.insert("signals", { creatorId: a.creatorId, url: a.url, kind: "breakout", sourcePostIds: [a.url.split("/").pop() ?? "p"], trackedAccountId: tracked._id, score: a.ratio, corroboration: { accounts: 2, soundRising: false }, verdict: "pending", why: `${a.ratio}x their normal after 9h (${Math.round(a.ratio * 4000 * 9).toLocaleString()} views vs a normal of ${(4000 * 9).toLocaleString()} at this age); ${a.url}`, thresholdsVersion: "dev", createdAt: now });
    return { signalId };
  },
});

/** Dev only: the creator's settings rows and admired list, for checking a chat management turn landed. */
export const settingsOf = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, a): Promise<Record<string, unknown>> => {
    const creator = (await ctx.db.query("creators").withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", a.chatId)).first()) as Doc<"creators"> | null;
    if (!creator) return {};
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect()) as Doc<"trackedAccounts">[];
    return { tone: creator.tone, quietHours: creator.quietHours, niche: creator.niche, tracked: tracked.map((t) => `${t.platform}/@${t.handle}/${t.status}`) };
  },
});

/** Dev only: put a public image into a chat as if the creator sent it, so the moment path can be exercised from the CLI. */
export const injectImage = internalAction({
  args: { chatId: v.string(), url: v.string(), caption: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const res = await fetch(a.url, { headers: { "user-agent": "Maya-dev/1.0 (image injector for the moment path)" }, redirect: "follow" });
    if (!res.ok) return { ok: false, reason: `fetch ${res.status}` };
    const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    const bytes = await res.arrayBuffer();
    const storageId = await ctx.storage.store(new Blob([bytes], { type: mime }));
    const creatorId = await ctx.runQuery(internal.onboarding.dev.creatorIdByChat, { chatId: a.chatId });
    if (!creatorId) return { ok: false, reason: "no creator for chat" };
    const messageId = await ctx.runMutation(internal.core.telegramFiles.recordInboundFile, { creatorId, storageId, mime, fileUniqueId: `dev_${Date.now()}`, caption: a.caption ?? "", ts: Date.now() });
    await ctx.runMutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: `converse:${messageId}`, creatorId, payloadJson: JSON.stringify({ messageId, chatId: a.chatId, kind: "file", kindHint: "image", mime }) });
    return { ok: true, reason: String(messageId) };
  },
});

export const creatorIdByChat = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, a): Promise<Id<"creators"> | null> => ((await ctx.db.query("creators").withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", a.chatId)).first()) as Doc<"creators"> | null)?._id ?? null,
});

/** Dev only: the real vendor, whatever SCRAPE_FIXTURES says: the credit balance and one cheap live read. */
export const probeScrapeCreators = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const key = process.env.SCRAPE_CREATORS_API_KEY ?? "";
    const headers = { "x-api-key": key, accept: "application/json" };
    const out: Record<string, unknown> = { keyPresent: Boolean(key), keyTail: key.slice(-4) };
    const bal = await fetch("https://api.scrapecreators.com/v1/credit-balance", { headers });
    out.balanceStatus = bal.status;
    out.balance = (await bal.text()).slice(0, 300);
    return out;
  },
});

/** Fixture recording (§17.1): one real vendor call, whatever the fixture flag says, returning the raw body for fixtures.recorded.json. Costs credits. */
export const recordFixture = internalAction({
  args: { path: v.string(), query: v.any() },
  handler: async (_ctx, a): Promise<{ ok: boolean; status?: number; body?: unknown; reason?: string }> => {
    const key = process.env.SCRAPE_CREATORS_API_KEY ?? "";
    if (!key) return { ok: false, reason: "no key" };
    const url = new URL(`https://api.scrapecreators.com${a.path}`);
    for (const [k, val] of Object.entries((a.query ?? {}) as Record<string, unknown>)) if (val !== undefined && val !== null) url.searchParams.set(k, String(val));
    const res = await fetch(url.toString(), { headers: { "x-api-key": key, accept: "application/json" } });
    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, body: JSON.parse(text) };
    } catch {
      return { ok: false, status: res.status, reason: text.slice(0, 200) };
    }
  },
});

/** Dev only: clear today's budget row so a rail can be re-tested without waiting for tomorrow. */
export const resetBudget = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ cleared: number }> => {
    const rows = await ctx.db.query("budgets").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId)).collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { cleared: rows.length };
  },
});

/** Dev only: drop this creator's messages so a pilot starts from zero. Never in production. */
export const clearMessages = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ deleted: number }> => {
    const rows = await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { deleted: rows.length };
  },
});

/** Dev only: put a creator on the right clock. Quiet hours and send times are all local. */
export const setTimezone = internalMutation({
  args: { creatorId: v.id("creators"), timezone: v.string() },
  handler: async (ctx, a): Promise<{ timezone: string }> => {
    await ctx.db.patch(a.creatorId, { timezone: a.timezone, updatedAt: Date.now() });
    return { timezone: a.timezone };
  },
});
