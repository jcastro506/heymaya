/**
 * How fast, and how alike, the critic judges with each thinking setting (2026-10-01). On staging the
 * critic took 20–25 s a reply (its models thought as long as they liked) and was most of the wait.
 * Runs the real critic prompt over this deployment's recent replies, per model and setting, and
 * reports latency, cost, and agreement with the unbounded verdict. Operator-run; spends a few cents.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { CRITIC_PROMPT } from "../agent/critic";
import { budgetFor } from "../core/llm";

type Setting = { name: string; reasoning?: { effort?: "minimal" | "low" | "medium" | "high"; enabled?: boolean } };
const SETTINGS: Setting[] = [{ name: "unbounded" }, { name: "low", reasoning: { effort: "low" } }, { name: "off", reasoning: { enabled: false } }];

export const samples = internalQuery({
  args: { n: v.number() },
  handler: async (ctx, a): Promise<Array<{ theirs: string; reply: string }>> => {
    const rows = ((await ctx.db.query("messages").order("desc").take(800)) as Doc<"messages">[]).reverse();
    const out: Array<{ theirs: string; reply: string }> = [];
    const lastIn = new Map<string, string>();
    for (const r of rows) {
      if (r.direction === "in") lastIn.set(r.creatorId, r.body);
      else if (r.kind === "reply" && lastIn.has(r.creatorId)) out.push({ theirs: lastIn.get(r.creatorId)!, reply: r.body });
    }
    out.splice(0, Math.max(0, out.length - a.n));
    return out;
  },
});

export const run = internalAction({
  args: { n: v.optional(v.number()), models: v.optional(v.array(v.string())) },
  handler: async (ctx, a): Promise<Array<{ model: string; setting: string; medianS: number; maxS: number; failures: number; usd: number; agreesWithUnbounded: string }>> => {
    const { callOpenRouter } = await import("../integrations/openrouter/client");
    const cases = await ctx.runQuery(internal.eval.criticSpeed.samples, { n: a.n ?? 6 });
    const models = a.models ?? ["deepseek/deepseek-v4-flash", "z-ai/glm-5.3-flash"];
    const report = [];
    for (const model of models) {
      const verdicts: Record<string, Array<boolean | null>> = {};
      for (const s of SETTINGS) {
        const times: number[] = [];
        let failures = 0;
        let usd = 0;
        verdicts[s.name] = await Promise.all(cases.map(async (c) => {
          const user = `Kind: reply\n\nHouse rules:\n- none\n\nCreator voice block:\n{}\n\nEvidence the message may cite:\n${JSON.stringify({ theirMessage: c.theirs })}\n\nMessage:\n"""\n${c.reply}\n"""`;
          const t0 = Date.now();
          const r = await callOpenRouter({ model, messages: [{ role: "system", content: CRITIC_PROMPT }, { role: "user", content: user }], temperature: 0, maxTokens: budgetFor(model, 400), timeoutMs: 40_000, apiKey: process.env.OPENROUTER_API_KEY ?? "", reasoning: s.reasoning });
          times.push((Date.now() - t0) / 1000);
          if (!r.ok) { failures++; return null; }
          usd += r.usage?.costUsd ?? 0;
          try { return Boolean((JSON.parse(r.content.match(/\{[\s\S]*\}/)?.[0] ?? "") as { pass?: boolean }).pass); } catch { failures++; return null; }
        }));
        times.sort((x, y) => x - y);
        const base = verdicts.unbounded;
        const both = base.map((b, i) => [b, verdicts[s.name][i]]).filter(([x, y]) => x !== null && y !== null);
        report.push({ model, setting: s.name, medianS: times[Math.floor(times.length / 2)] ?? 0, maxS: times[times.length - 1] ?? 0, failures, usd: Math.round(usd * 100000) / 100000, agreesWithUnbounded: `${both.filter(([x, y]) => x === y).length}/${both.length}` });
      }
    }
    return report;
  },
});
