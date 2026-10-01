/**
 * Getting to know them (2026-10-01): a handful of questions only a friend in the industry would ask,
 * asked one at a time at the moment each one matters, never as a form. Code keeps track of what she
 * already knows (their own words, saved by agent/remember with the message they came from); she
 * decides when a question fits and how to word it. Each answer changes what she sends, and she
 * brings it back in their words when it matters ("you said filming in public feels weird, so…").
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { recordVisible } from "../agent/personalHistory";
import { clip } from "../lib/clip";

export type Topic = "goal" | "hesitation" | "origin" | "boundary" | "audience" | "proud" | "filmTime";

/** In the order they usually come up. `when` is the moment it fits; `ask` is the gist, never a script. */
export const TOPICS: Array<{ kind: Topic; label: string; when: string; ask: string; use: string }> = [
  { kind: "goal", label: "what they want out of this", when: "her hello asks it", ask: "what do you most want out of this?", use: "points every suggestion at it" },
  { kind: "hesitation", label: "what gets in the way", when: "right after your read, or the first time they mention falling off, being busy or nerves", ask: "what usually gets in the way of posting more?", use: "shapes ideas around it: no face if they're camera-shy, quick to film if time is short, private if they worry who sees it" },
  { kind: "filmTime", label: "when they usually film", when: "right after they react to the month plan, or when booking a week", ask: "when do you usually have time to film? i'll put your sessions there", use: "every week's sessions land in those slots" },
  { kind: "origin", label: "how they started", when: "a relaxed moment, or when they share a win", ask: "what got you posting in the first place?", use: "the reason they care; bring it back when they're discouraged" },
  { kind: "boundary", label: "what they won't do on camera", when: "before the first idea that needs their face, voice, a public place or other people, or when they push back on one", ask: "anything you'd rather not do on camera? i'll keep it out of what i send", use: "never suggest it again" },
  { kind: "audience", label: "who they picture watching", when: "when you're talking about a hook, a caption or who a post is for", ask: "when you film, who are you picturing watching?", use: "write hooks and captions for that person" },
  { kind: "proud", label: "the post they're proudest of", when: "after a post does well, or when they share one of their own; name a real post of theirs if you can", ask: "which of your posts are you proudest of?", use: "their taste in their own words, beyond what got views" },
];

export type Known = { kind: Topic; text: string; at: number };

/** Pure: the section. What she knows, in their words; and, when she's answering them (`asking`), what's still open and when each fits. */
export function knowThemSection(known: Known[], now: number, asking: boolean): string {
  const byKind = new Map<Topic, Known>();
  for (const k of known) if (!byKind.has(k.kind) || byKind.get(k.kind)!.at < k.at) byKind.set(k.kind, k);
  const knownLines = TOPICS.filter((t) => byKind.has(t.kind)).map((t) => `- ${t.label}: "${clip(byKind.get(t.kind)!.text, 160)}" (${Math.max(0, Math.round((now - byKind.get(t.kind)!.at) / 86_400_000))}d ago; ${t.use})`);
  const open = TOPICS.filter((t) => asking && !byKind.has(t.kind) && t.kind !== "goal").map((t) => `- ${t.label}, when ${t.when} (e.g. "${t.ask}")`);
  if (!knownLines.length && !open.length) return "";
  if (!knownLines.length && !asking) return "";
  return `# Getting to know them
${knownLines.length ? `What they've told you, in their words:\n${knownLines.join("\n")}\nUse it when it changes your advice, in their words ("you said…"), not to show you remember. Never suggest anything a boundary rules out.` : "Nothing yet beyond what you see in their posts."}
${open.length ? `Still worth asking, one at a time, only when the moment fits:\n${open.join("\n")}
How: at most one of these a day, never in the same text as an idea or a plan, and only after you've given them something useful. Ask it your way, casually, and say in a few words why you're asking if it isn't obvious ("it changes what i send you"). Make it specific to them when you can (a real post of theirs, something they just said). If they shrug it off or say "idk", let it go; it won't come up again. Never ask about family, health, money, relationships, where they live or their age unless they bring it up. Never number questions, mention a profile, or make it feel like a form.` : ""}`.trim();
}

/** Their saved answers, visible ones only (the same rule as the rest of her memory). */
export async function knownAbout(ctx: QueryCtx, creatorId: Id<"creators">): Promise<Known[]> {
  const out: Known[] = [];
  const c = (await ctx.db.get(creatorId)) as Doc<"creators"> | null;
  if (c?.filmPrefs) out.push({ kind: "filmTime", text: c.filmPrefs.said, at: c.filmPrefs.at });
  for (const t of TOPICS) {
    if (t.kind === "filmTime") continue;
    const rows = (await ctx.db.query("personalRecords").withIndex("by_creator_kind", (q) => q.eq("creatorId", creatorId).eq("kind", t.kind as Exclude<Topic, "filmTime">)).order("desc").take(5)) as Doc<"personalRecords">[];
    for (const r of rows) if (await recordVisible(ctx, r, creatorId)) { out.push({ kind: t.kind, text: r.text, at: r.at }); break; }
  }
  return out;
}
