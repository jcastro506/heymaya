/**
 * The rung (plan §13.7): a computed fact placed in context, never the diagnosis.
 * Over a week's own posts: L0 fewer posts than planned · L1 (format) median multiple
 * below 0.7× their own baseline, nobody saw it · L2 (topic) reach fine but
 * engagement per view below 0.7× their own median, they saw it and scrolled ·
 * healthy otherwise · unknown below three posts or with missing samples. Pure.
 */

import { THRESHOLDS } from "../config/thresholds";

export type Rung = "L0" | "L1" | "L2" | "healthy" | "unknown";

export interface WeekPost { views: number; multiple: number | null; likes: number; comments: number; shares: number; saves: number; ageHours: number }

export interface RungFacts {
  rung: Rung;
  posted: number;
  planned: number | null;
  medianMultiple: number | null;
  engagementRatio: number | null; // (saves + shares + comments) / views, this week
  baselineEngagement: number | null; // their own median, from history
  why: string;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function engagement(p: { views: number; likes?: number; comments: number; shares: number; saves: number }): number | null {
  return p.views > 0 ? (p.saves + p.shares + p.comments) / p.views : null;
}

export function computeRung(input: { week: WeekPost[]; planned: number | null; history: Array<{ views: number; comments: number; shares: number; saves: number }> }): RungFacts {
  const sampled = input.week.filter((p) => p.ageHours >= 48 && p.multiple !== null);
  const posted = input.week.length;
  const base = { posted, planned: input.planned, medianMultiple: median(sampled.map((p) => p.multiple as number)), engagementRatio: null as number | null, baselineEngagement: null as number | null };
  const baselineEngagement = median(input.history.map(engagement).filter((x): x is number => x !== null));
  const weekEngagement = median(sampled.map(engagement).filter((x): x is number => x !== null));
  base.engagementRatio = weekEngagement;
  base.baselineEngagement = baselineEngagement;

  if (input.planned !== null && posted < input.planned) return { ...base, rung: "L0", why: `posted ${posted}, planned ${input.planned}` };
  if (sampled.length < 3 || base.medianMultiple === null) return { ...base, rung: "unknown", why: sampled.length < 3 ? `only ${sampled.length} post${sampled.length === 1 ? "" : "s"} with a 48 h sample this week` : "no multiples yet" };
  if (base.medianMultiple < THRESHOLDS.formatRungBelow) return { ...base, rung: "L1", why: `median ${base.medianMultiple}× their normal; nobody saw it` };
  if (baselineEngagement !== null && weekEngagement !== null && baselineEngagement > 0 && weekEngagement / baselineEngagement < THRESHOLDS.topicRungBelow) {
    return { ...base, rung: "L2", why: `reach at ${base.medianMultiple}× but engagement per view at ${Math.round((weekEngagement / baselineEngagement) * 100)}% of their median; they saw it and scrolled` };
  }
  return { ...base, rung: "healthy", why: `median ${base.medianMultiple}× their normal, engagement in range` };
}
