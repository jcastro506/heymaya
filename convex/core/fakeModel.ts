/**
 * The fake model (plan §17.1 "integration on recorded fixtures"; §17.2 the simulated
 * week and fortnight). With MODEL_FAKE=1 every model call answers from here, by
 * purpose, deterministically and for free, so a whole day of the product (sample →
 * signal → gate → scout → idea → message → reaction → taste → review) runs inside
 * convex-test with assertions on rows. It never runs outside tests: callModel checks
 * the env, and the deploy guard refuses a deployment with MODEL_FAKE set.
 */

import type { OpenRouterMessage, OpenRouterResult } from "../integrations/openrouter/client";

function lastUser(messages: OpenRouterMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
}

function firstPostId(user: string): string | null {
  const m = user.match(/"postId":"([^"]+)"/);
  return m ? m[1] : null;
}

/** Deterministic answers per purpose. Numbers cited are pulled from the prompt so the eval's grounding check passes. */
export function fakeAnswer(purpose: string, messages: OpenRouterMessage[]): OpenRouterResult {
  const user = lastUser(messages);
  const ok = (content: string): OpenRouterResult => ({ ok: true, content, usage: { promptTokens: 100, completionTokens: 50, costUsd: 0 } });
  switch (purpose) {
    case "scout":
    case "scout_final": {
      const postId = firstPostId(user);
      if (!postId) return ok(JSON.stringify({ pick: null, rejected: [] }));
      const ratio = user.match(/"ratio":([\d.]+)/)?.[1] ?? "2";
      return ok(JSON.stringify({ pick: { postId, notable: true, fit: "yes", fitWhy: "same format they already do", transfer: false, newForYou: false, features: { format: "talking-head", topics: ["running"], tone: "deadpan", lengthBucket: "15-30", sound: "none" }, message: `@runwithcarly is at ${ratio}× their normal with a list that cuts to an object on every point. you did the list twice this year and both beat your normal. your version: open on the shoe rack, under 30s. want the shot list?`, version: { hook: "the shoe rack list", onScreenText: "5 things", lengthSec: 25, sound: "", block: null } }, rejected: [] }));
    }
    case "scout_rewrite":
      return ok("shorter version of the same idea, with the link. want the shot list?");
    case "critic":
    case "critic_fallback":
      return ok(JSON.stringify({ pass: true, problems: [], note: "fine" }));
    case "classify":
      return ok(JSON.stringify({ intent: "text" }));
    case "converse":
    case "converse_fallback":
    case "converse_final":
      return ok("got it. one line back, nothing invented.");
    case "first_read":
    case "first_read_rewrite":
      return ok("hey. read your posts; the talking-head ones do best. first idea tomorrow.");
    case "taste_reply":
      return ok("warm");
    case "remember":
      return ok(JSON.stringify({ note: null, rule: null }));
    case "weekly_review":
    case "weekly_review_final":
      return ok(JSON.stringify({ message: "one post this week, at your normal. the list format is still your best. experiment: one post that opens on an object.", experimentVerdict: "none", experimentVerdictWhy: "", newExperiment: "one post that opens on an object, not your face", rungOverride: null }));
    case "opinion":
    case "opinion_retry":
    case "explain_post":
      return ok(JSON.stringify({ message: "solid. the hook lands late; move the cut forward. your own list did 2.1× so this is yours.", biggest: "hook lands late", second: "length", fine: "the premise", confidence: "solid", citations: [{ stat: "own multiple", value: "2.1", sampleSize: 1 }], cannotKnow: "watch time" }));
    case "match_post":
      return ok(JSON.stringify({ ideaId: null, confidence: "no", why: "different premise" }));
    case "taste_profile":
      return ok("you take talking-heads and pass on skits.");
    case "learn_creator":
    case "learn_creator_weekly":
    case "learn_creator_fallback":
      return ok("{}");
    default:
      return ok(JSON.stringify({ ok: true }));
  }
}

export function fakeModelEnabled(): boolean {
  return process.env.MODEL_FAKE === "1";
}
