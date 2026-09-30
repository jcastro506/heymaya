/**
 * The idea taste test (2026-09-30). Are her ideas good, or cheesy, generic, "AI"? Machines judging
 * machines can't say, so the operator rates them, blind, against a plain-chatbot baseline written
 * from the same account's bio. The ratings are the golden set the model judge is calibrated on and
 * every later prompt or model change is scored against.
 *
 *   dev:     npx convex run eval/ideaTaste:collect '{"runId":"fw-..."}' > items.json   (after a firstWeek run)
 *   staging: npx convex run eval/ideaTaste:importItems "$(cat items.json)"
 *   rate at /ops/taste?token=…  ·  results: eval/ideaTaste:results
 */
import { v } from "convex/values";
import { internalAction, internalQuery, query } from "../_generated/server";
import { internalMutation, mutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { judge } from "./judge";

export const SUITE = "idea_taste";
/** What can be wrong with an idea, in the operator's words. "Would film it" is the label itself. */
export const FLAGS = ["cheesy", "generic", "sounds like AI", "weird", "not them", "unclear", "already done"] as const;

type Account = { handles: { tiktok?: string; instagram?: string }; summary: string | null; themes: string[]; note: string | null };
type Item = { source: "maya" | "baseline"; account: Account; text: string; evidence: string[]; fitWhy: string | null; judge: Doc<"evalRuns">["judge"] | null; batch: string };

export const BASELINE_PROMPT = `You are a social media assistant. Suggest short-form video ideas for this creator. For each idea write one short text message (under 60 words) pitching it to them. Output ONLY JSON: {"ideas": ["...", "..."]}`;

/** Dev: the ideas a firstWeek run produced, per creator, with what she knew about them. */
export const gathered = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<Array<{ creatorId: string; account: Account; bio: string; ideas: Array<{ text: string; evidence: string[]; fitWhy: string }> }>> => {
    if (!/^fw-[a-z0-9]+$/.test(a.runId)) throw new Error("not a first-week run id");
    const prefix = `eval-run:${a.runId}:`;
    const creators = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.gte("clerkUserId", prefix).lt("clerkUserId", `${prefix}~`)).collect()) as Doc<"creators">[];
    const out = [];
    for (const c of creators) {
      const d = c.dossier as { persona?: { summary?: string }; themes?: Array<{ label: string }>; keywords?: string[] } | undefined;
      const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"ideas">[];
      out.push({
        creatorId: c._id,
        account: { handles: c.handles, summary: d?.persona?.summary ?? null, themes: (d?.themes ?? []).map((t) => t.label).slice(0, 4), note: null },
        bio: `Handles: ${JSON.stringify(c.handles)}. What they make: ${d?.persona?.summary ?? "unknown"}. Topics: ${(d?.keywords ?? []).join(", ") || "unknown"}.`,
        ideas: ideas.map((i) => ({ text: i.messageText, evidence: i.evidenceLinks.slice(0, 2), fitWhy: i.fitWhy })),
      });
    }
    return out;
  },
});

/** Dev: her ideas plus an equal number from a plain chatbot with the same bio, each scored by the judge. */
export const collect = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ batch: string; items: Item[]; accounts: number; failures: string[] }> => {
    const rows = await ctx.runQuery(internal.eval.ideaTaste.gathered, { runId: a.runId });
    const batch = `${a.runId}-${Date.now().toString(36)}`;
    const items: Item[] = [];
    const failures: string[] = [];
    for (const r of rows) {
      if (!r.ideas.length) { failures.push(`${JSON.stringify(r.account.handles)}: no ideas from her`); continue; }
      const mine: Array<{ source: "maya" | "baseline"; text: string; evidence: string[]; fitWhy: string | null }> = r.ideas.map((i) => ({ source: "maya" as const, ...i }));
      const b = await callModel(ctx, { creatorId: r.creatorId as never, purpose: "idea_taste_baseline", model: REGISTRY.writer.primary, messages: [{ role: "system", content: BASELINE_PROMPT }, { role: "user", content: `${r.bio}\nGive ${r.ideas.length} idea${r.ideas.length === 1 ? "" : "s"}.` }], temperature: 0.8, maxTokens: 900, timeoutMs: 30_000, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (b.ok) {
        try {
          const parsed = JSON.parse(b.content.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { ideas?: unknown[] };
          for (const t of (parsed.ideas ?? []).slice(0, r.ideas.length)) if (typeof t === "string" && t.trim()) mine.push({ source: "baseline", text: t.trim(), evidence: [], fitWhy: null });
        } catch { failures.push(`${JSON.stringify(r.account.handles)}: baseline unparseable`); }
      } else failures.push(`${JSON.stringify(r.account.handles)}: baseline ${b.reason.slice(0, 80)}`);
      for (const m of mine) {
        const j = await judge(ctx, { text: m.text, kind: "scout", evidence: { expect: "one idea worth filming, specific to this creator", account: r.account } });
        items.push({ ...m, account: r.account, judge: j ? { ...j, model: REGISTRY.critic.primary } : null, batch });
      }
    }
    return { batch, items, accounts: rows.length, failures };
  },
});

const itemV = v.object({ source: v.union(v.literal("maya"), v.literal("baseline")), account: v.any(), text: v.string(), evidence: v.array(v.string()), fitWhy: v.union(v.string(), v.null()), judge: v.any(), batch: v.string() });

/** Where the operator rates: store the items (once per batch) in a shuffled order. */
export const importItems = internalMutation({
  args: { batch: v.string(), items: v.array(itemV), accounts: v.optional(v.number()), failures: v.optional(v.array(v.string())) },
  handler: async (ctx, a): Promise<{ imported: number; skipped: string | null }> => {
    const existing = (await ctx.db.query("evalRuns").withIndex("by_suite_at", (q) => q.eq("suite", SUITE)).collect()) as Doc<"evalRuns">[];
    if (existing.some((e) => (e.trace as { batch?: string } | undefined)?.batch === a.batch)) return { imported: 0, skipped: "this batch is already here" };
    // A fixed shuffle (by text hash) so the two sources are interleaved and the order gives nothing away.
    const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const order = [...a.items].sort((x, y) => hash(x.text) - hash(y.text));
    const now = Date.now();
    for (const [i, it] of order.entries()) {
      await ctx.db.insert("evalRuns", { suite: SUITE, skill: "idea", text: it.text, checks: [], ...(it.judge ? { judge: it.judge } : {}), pass: true, trace: { source: it.source, account: it.account, evidence: it.evidence, fitWhy: it.fitWhy, batch: a.batch }, at: now + i });
    }
    return { imported: order.length, skipped: null };
  },
});

const authed = (token: string) => Boolean(process.env.OPS_TOKEN) && token === process.env.OPS_TOKEN;
type Trace = { source: "maya" | "baseline"; account: Account; evidence: string[]; fitWhy: string | null; batch: string };

async function load(ctx: { db: { query: (t: never) => unknown } }) {
  const db = ctx.db as unknown as { query: (t: string) => { withIndex: (i: string, f?: (q: { eq: (k: string, v: string) => unknown }) => unknown) => { collect: () => Promise<unknown[]> } } };
  const items = (await db.query("evalRuns").withIndex("by_suite_at", (q) => q.eq("suite", SUITE)).collect()) as Doc<"evalRuns">[];
  const labels = ((await db.query("evalLabels").withIndex("by_at").collect()) as Doc<"evalLabels">[]).filter((l) => l.skill === SUITE && l.evalRunId);
  const byItem = new Map(labels.map((l) => [String(l.evalRunId), l]));
  return { items, byItem };
}

/** The next idea to rate. Blind: never says who wrote it, and never shows her reasoning or the judge's score. */
export const next = query({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<{ done: boolean; rated: number; total: number; item: { id: string; text: string; account: Account; evidence: string[] } | null; flags: readonly string[] } | null> => {
    if (!authed(a.token)) return null;
    const { items, byItem } = await load(ctx as never);
    const open = items.filter((i) => !byItem.has(String(i._id))).sort((x, y) => x.at - y.at)[0];
    const t = open?.trace as Trace | undefined;
    return { done: !open, rated: byItem.size, total: items.length, item: open && t ? { id: open._id, text: open.text, account: t.account, evidence: t.evidence } : null, flags: FLAGS };
  },
});

export const rate = mutation({
  args: { token: v.string(), id: v.id("evalRuns"), wouldFilm: v.boolean(), flags: v.array(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    if (!authed(a.token)) return { ok: false };
    const item = (await ctx.db.get(a.id)) as Doc<"evalRuns"> | null;
    if (!item || item.suite !== SUITE) return { ok: false };
    const flags = a.flags.filter((f) => (FLAGS as readonly string[]).includes(f));
    await ctx.db.insert("evalLabels", { evalRunId: a.id, skill: SUITE, label: a.wouldFilm ? "good" : "bad", reason: (a.note ?? "").slice(0, 300), flags, by: "operator", at: Date.now() });
    return { ok: true };
  },
});

/** Pure: the score for one source. */
export function scoreOf(rows: Array<{ wouldFilm: boolean; flags: string[]; judgeWouldSend: number | null }>) {
  const n = rows.length;
  const pct = (k: number) => (n ? Math.round((k / n) * 100) : 0);
  const flags = Object.fromEntries(FLAGS.map((f) => [f, pct(rows.filter((r) => r.flags.includes(f)).length)]));
  const judged = rows.filter((r) => r.judgeWouldSend !== null);
  const agree = judged.filter((r) => (r.judgeWouldSend! >= 2) === r.wouldFilm).length;
  return { rated: n, wouldFilmPct: pct(rows.filter((r) => r.wouldFilm).length), cleanPct: pct(rows.filter((r) => r.flags.length === 0).length), flags, judgeAgreesPct: judged.length ? Math.round((agree / judged.length) * 100) : null };
}

/** The reveal: her ideas against the baseline, and how often the model judge agrees with the operator. */
export const results = query({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    if (!authed(a.token)) return null;
    const { items, byItem } = await load(ctx as never);
    const rated = items.flatMap((i) => {
      const l = byItem.get(String(i._id));
      const t = i.trace as Trace;
      return l ? [{ source: t.source, handles: t.account.handles, text: i.text, wouldFilm: l.label === "good", flags: l.flags ?? [], note: l.reason, judgeWouldSend: i.judge?.wouldSend ?? null }] : [];
    });
    return {
      total: items.length,
      rated: rated.length,
      maya: scoreOf(rated.filter((r) => r.source === "maya")),
      baseline: scoreOf(rated.filter((r) => r.source === "baseline")),
      rows: rated,
    };
  },
});

/** The golden set, for the judge and for later prompt work (operator CLI). */
export const exportLabels = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { items, byItem } = await load(ctx as never);
    return items.flatMap((i) => { const l = byItem.get(String(i._id)); return l ? [{ text: i.text, trace: i.trace, judge: i.judge ?? null, wouldFilm: l.label === "good", flags: l.flags ?? [], note: l.reason }] : []; });
  },
});
