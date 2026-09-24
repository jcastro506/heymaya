/**
 * Critic-rejected never means silent (audit B0: a1, a4 and e2 all ended in "it didn't pass my
 * own check, ask again", so the creator's biggest question got nothing).
 *
 * The ladder, in order, each rung judged by the same critic:
 *   1. her read;
 *   2. one rewrite fixing exactly what the critic named;
 *   3. the cautious version: only what the evidence shows, what she couldn't check, one question;
 *   4. the floor: a message the caller built from real numbers with no model in it. Always sent.
 *
 * Pure orchestration (the model calls and the critic are injected) so every rung is testable.
 */

import type { CritiqueResult, Problem } from "./critic";

export type Rung = "read" | "rewrite" | "cautious" | "floor";

export interface Judged { text: string; rung: Rung; problems: Problem[]; criticSkipped: boolean }

export const CAUTIOUS_ASK = (problems: string[], note: string): string =>
  `\n\nYour read was rejected twice (${problems.join(", ")}: ${note}). Write the cautious version instead, as plain text in your voice: what the evidence actually shows (with a number you were given), the one thing you couldn't check, and one question for them that would settle it. No cause stated as fact. Under 400 characters, no markdown. Output the message text only.`;

export async function judgeLadder(input: {
  first: string;
  judge: (text: string) => Promise<CritiqueResult>;
  rewrite: (verdict: CritiqueResult) => Promise<string | null>;
  cautious: (verdict: CritiqueResult) => Promise<string | null>;
  floor: string;
}): Promise<Judged> {
  let skipped = false;
  const problems: Problem[] = [];
  const attempt = async (text: string | null): Promise<CritiqueResult | null> => {
    if (!text?.trim()) return null;
    const v = await input.judge(text.trim());
    skipped = skipped || Boolean(v.skipped);
    if (!v.pass) problems.push(...v.problems);
    return v;
  };

  const v1 = await attempt(input.first);
  if (v1?.pass) return { text: input.first.trim(), rung: "read", problems, criticSkipped: skipped };
  const last1 = v1 ?? { pass: false, problems: [], note: "empty" };

  const second = await input.rewrite(last1);
  const v2 = await attempt(second);
  if (v2?.pass && second) return { text: second.trim(), rung: "rewrite", problems, criticSkipped: skipped };

  const third = await input.cautious(v2 ?? last1);
  const v3 = await attempt(third);
  if (v3?.pass && third) return { text: third.trim(), rung: "cautious", problems, criticSkipped: skipped };

  return { text: input.floor, rung: "floor", problems, criticSkipped: skipped };
}

const compact = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n));

/** The floor for their own post: its number against their normal, honesty, one question. No model. */
export function ownPostFloor(p: { views: number; multiple: number | null; hoursOld: number } | null): string {
  if (!p) return "i looked, but i can't give you a read i'd stand behind from what i can see. what do you want me to focus on, the first few seconds or why it went where it went?";
  if (p.hoursOld < 48) return `it's at ${compact(p.views)} so far and it's only ${Math.max(1, p.hoursOld)} hours old, so the numbers aren't done moving. i'll know more in a day or two. anything different about this one i should know?`;
  const vs = p.multiple !== null ? `, ${p.multiple >= 10 ? Math.round(p.multiple) : p.multiple.toFixed(1)}x your normal` : "";
  return `it's at ${compact(p.views)} views${vs}. i can't pin down why from what i can see, and i'd rather not guess. did anything happen around it, like a share, a different sound, or posting somewhere new?`;
}

/** The floor for "why is @x growing": their plain facts, then an offer. No model. */
export function profileFloor(handle: string, f: { perWeek: number | null; medianViews: number | null; outliers: Array<{ multiple: number }> }): string {
  const bits: string[] = [];
  if (f.perWeek) bits.push(`posts about ${f.perWeek} times a week`);
  if (f.medianViews) bits.push(`usually gets around ${compact(f.medianViews)} views`);
  if (f.outliers[0]) bits.push(`and their best recent one did ${f.outliers[0].multiple}x that`);
  const facts = bits.length ? `@${handle} ${bits.join(", ")}.` : `i read @${handle}'s recent posts.`;
  return `${facts} i can't tell you why from the captions alone and i'd rather not guess. want me to pull apart their top post?`;
}
