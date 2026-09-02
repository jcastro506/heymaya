/**
 * The bounded loop (plan §13.11 (2)–(3)). The writer gets a goal, a seed, the tool
 * belt and a budget; it calls tools until it answers or the budget is gone. Every
 * call is a trace row. Rung and taste stay computed facts in the prompt; this loop
 * only fetches. It ends on a final answer, on the budget, or on a model error, and
 * says which.
 */

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { OpenRouterMessage } from "../integrations/openrouter/client";
import { callModel } from "../core/llm";
import { REGISTRY } from "./registry";
import { DEFAULT_BUDGET, runTool, TOOLS, type ToolBudget, type ToolCallRecord } from "./tools";

export interface InvestigateResult { content: string; trace: ToolCallRecord[]; ended: "answer" | "budget" | "model_error" | "no_answer"; turns: number }

export const INVESTIGATE_RULES = `You may look things up before you answer. Each tool costs what it says; you have a budget and it is shown to you. Look up only what changes the answer: whether this is the account or the sound, whether it is above the author's own normal, what people react to in the comments, whether the shape is a wave this week, and whether the creator already has a post that rhymes with it. When you have enough, answer in the exact JSON the skill asks for. Never invent a number you did not get from a tool or the prompt. If a tool is refused or fails, say what you could not check and answer anyway.`;

export async function investigate(ctx: ActionCtx, input: { creatorId: Id<"creators">; purpose: string; prefix: string; user: string; budget?: ToolBudget; temperature?: number; maxTokens?: number }): Promise<InvestigateResult> {
  const budget = input.budget ?? DEFAULT_BUDGET();
  const trace: ToolCallRecord[] = [];
  const spec = REGISTRY.writer;
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const messages: OpenRouterMessage[] = [
    { role: "system", content: `${input.prefix}\n\n# Looking things up\n${INVESTIGATE_RULES}` },
    { role: "user", content: `${input.user}\n\nBudget: ${budget.calls} tool calls, ${budget.credits} credits.` },
  ];
  const maxTurns = budget.calls + 2;
  for (let turn = 1; turn <= maxTurns; turn++) {
    const spent = trace.reduce((s, t) => s + (t.credits ?? 0), 0);
    const exhausted = trace.length >= budget.calls || Date.now() > budget.deadlineAt;
    const r = await callModel(ctx, { creatorId: input.creatorId, purpose: input.purpose, model: spec.primary, messages, tools: exhausted ? undefined : TOOLS, toolChoice: exhausted ? "none" : "auto", temperature: input.temperature ?? 0.4, maxTokens: input.maxTokens ?? 1600, apiKey });
    if (!r.ok) return { content: "", trace, ended: "model_error", turns: turn };
    if (r.toolCalls && r.toolCalls.length > 0) {
      messages.push({ role: "assistant", content: r.content ?? "", tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
      for (const c of r.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        const out = await runTool(ctx, input.creatorId, { name: c.name, args }, budget, trace);
        const left = Math.max(0, budget.calls - trace.length);
        const creditsLeft = Math.max(0, budget.credits - trace.reduce((s, t) => s + (t.credits ?? 0), 0));
        messages.push({ role: "tool", tool_call_id: c.id, name: c.name, content: `${out}\n\n(budget left: ${left} calls, ${creditsLeft} credits)` });
      }
      continue;
    }
    if (r.content.trim()) return { content: r.content, trace, ended: exhausted && spent >= 0 ? "answer" : "answer", turns: turn };
    return { content: "", trace, ended: "no_answer", turns: turn };
  }
  // Out of turns: one last call with no tools, so the model must answer.
  const final = await callModel(ctx, { creatorId: input.creatorId, purpose: `${input.purpose}_final`, model: spec.primary, messages: [...messages, { role: "user", content: "The budget is spent. Answer now in the exact JSON the skill asks for, with what you have." }], toolChoice: "none", temperature: input.temperature ?? 0.4, maxTokens: input.maxTokens ?? 1600, apiKey });
  return final.ok && final.content.trim() ? { content: final.content, trace, ended: "budget", turns: maxTurns + 1 } : { content: "", trace, ended: "model_error", turns: maxTurns + 1 };
}
