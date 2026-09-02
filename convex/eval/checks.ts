/**
 * Deterministic checks (plan Sprint 3c). Pure functions over a message and the
 * evidence she was given. An invented number is the worst failure: every number in
 * the message must appear somewhere in the evidence. The rest are the rules from
 * §21.2 that can be code: no tells, no leak, one question, no bullets, her name once.
 */

import { checkPlainLanguage } from "../core/plainLanguage";

export interface Check { name: string; pass: boolean; detail: string }

/** The exact tells (§21.4): deliberately short, because over-blocking is the worse failure. */
export const TELLS: RegExp[] = [/\bgreat question\b/i, /\bi'?d be happy to\b/i, /\bas an ai\b/i, /\bi hope this helps\b/i, /\bcontent strategy\b/i, /\bleverage\b/i, /\boptimi[sz]e\b/i, /\bengagement\b/i, /\bsynerg/i, /\bunlock\b/i, /\bgame[- ]changer\b/i, /🚀/];

/**
 * The numbers that are claims: counts ≥ 100, and anything with k / m / × / %. Advice
 * numbers ("keep it under 30s", "after 9h", "three fixes") and years are not citations.
 */
export function numbersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(k|m|×|x|%)?(?![\w])/gi)) {
    const raw = m[1].replace(/,/g, "");
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    if (/^(19|20)\d{2}$/.test(raw)) continue; // a year
    const unit = m[2]?.toLowerCase();
    if (!unit && n < 100) continue; // advice and counting words
    out.add(raw + (unit ?? ""));
  }
  return Array.from(out);
}

/** Is a number present in the evidence, in any of its spellings (559925, 559,925, 559.9k, 560k)? */
export function numberGrounded(token: string, evidence: string): boolean {
  const unit = token.match(/[a-z×%]+$/)?.[0] ?? "";
  const raw = token.replace(/[a-z×%]+$/, "");
  const n = Number(raw);
  const flat = evidence.replace(/,/g, "");
  if (flat.includes(raw)) return true;
  if (unit === "k" || unit === "m") {
    const full = unit === "k" ? n * 1000 : n * 1_000_000;
    const nums = Array.from(flat.matchAll(/\d+(?:\.\d+)?/g)).map((x) => Number(x[0]));
    return nums.some((v) => v > 0 && Math.abs(v - full) / full <= 0.05); // 560k for 559,925 is honest rounding
  }
  if (unit === "×" || unit === "x") {
    const nums = Array.from(flat.matchAll(/\d+(?:\.\d+)?/g)).map((x) => Number(x[0]));
    return nums.some((v) => Math.abs(v - n) < 0.06);
  }
  return false;
}

/** Words that assert she did something to their setup. Only a routed management turn may say them. */
const ACTION_CLAIMS = /\b(added|i've added|now watching|tracking (her|him|them) now|i'?ve set|i set (your|the)|updated your|i'?ve updated|blocked (it|that|thu|fri|mon|tue|wed|sat|sun)|removed|dropped (her|him|them)|paused|i'?ve turned)\b/i;

export function runChecks(input: { text: string; evidence: unknown; kind: string; creatorUsesEmoji?: boolean; maxChars?: number; actionTaken?: boolean }): Check[] {
  const text = input.text;
  const evidence = typeof input.evidence === "string" ? input.evidence : JSON.stringify(input.evidence ?? "");
  const checks: Check[] = [];

  const nums = numbersIn(text);
  const ungrounded = nums.filter((t) => !numberGrounded(t, evidence));
  checks.push({ name: "numbers_grounded", pass: ungrounded.length === 0, detail: ungrounded.length ? `not in the evidence: ${ungrounded.join(", ")}` : `${nums.length} number${nums.length === 1 ? "" : "s"}, all in the evidence` });

  const tells = TELLS.filter((re) => re.test(text)).map((re) => re.source);
  checks.push({ name: "no_tells", pass: tells.length === 0, detail: tells.length ? tells.join(", ") : "clean" });

  const leak = checkPlainLanguage(text);
  checks.push({ name: "no_leak", pass: leak.ok, detail: leak.ok ? "clean" : (leak as { reason?: string }).reason ?? "leak" });

  const max = input.maxChars ?? 900;
  checks.push({ name: "length", pass: text.length <= max, detail: `${text.length} / ${max}` });

  const questions = (text.match(/\?/g) ?? []).length;
  checks.push({ name: "one_question", pass: questions <= 1, detail: `${questions} question mark${questions === 1 ? "" : "s"}` });

  const bullets = /^\s*([-*•]|\d+\.)\s/m.test(text) || /^#{1,6}\s/m.test(text);
  checks.push({ name: "no_bullets", pass: !bullets, detail: bullets ? "bullets or headers in chat" : "prose" });

  const names = (text.match(/\bmaya\b/gi) ?? []).length;
  checks.push({ name: "name_once", pass: names <= 1, detail: `${names}` });

  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text);
  checks.push({ name: "emoji_default", pass: !emoji || Boolean(input.creatorUsesEmoji), detail: emoji ? (input.creatorUsesEmoji ? "emoji, and they use them" : "emoji, and they don't") : "none" });

  // A message that stops mid-thought, or carries markdown or a draft label, is a budget or a leak problem, never a style.
  const trimmed = text.trim();
  const complete = trimmed.length < 40 || /[.!?…"”)\]]$/.test(trimmed) || /https?:\/\/\S+$/.test(trimmed);
  checks.push({ name: "complete", pass: complete, detail: complete ? "ends on a sentence" : `ends with "…${trimmed.slice(-30)}"` });
  const markdown = /\*\*|^#{1,6}\s|```/m.test(text) || /\b(refining|draft|revised|final answer)\b.*[:*]/i.test(text.split("\n")[0] ?? "");
  checks.push({ name: "no_markdown", pass: !markdown, detail: markdown ? "markdown or a draft label in chat" : "clean" });

  // A reply that says "added" or "done" when no management row was written is a lie about their setup.
  if (input.kind === "reply" && input.actionTaken === false) {
    const claim = ACTION_CLAIMS.test(text);
    checks.push({ name: "no_claimed_action", pass: !claim, detail: claim ? "claims an action no tool took" : "no action claimed" });
  }

  if (input.kind === "scout") checks.push({ name: "has_link", pass: /https?:\/\//.test(text) || /https?:\/\//.test(evidence), detail: /https?:\/\//.test(text) ? "link in message" : "link only in evidence" });

  return checks;
}

export function passed(checks: Check[]): boolean {
  return checks.every((c) => c.pass);
}
