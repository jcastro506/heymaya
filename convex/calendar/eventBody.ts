/**
 * What a calendar event says when they click into it (2026-09-09). The event used to carry one
 * fixed sentence; the operator asked what the user actually sees. Now it carries the idea: the
 * hook, the on-screen text, the length and sound, the shot list once she has written one, the post
 * that inspired it, and why it fits them. Pure, plain text, bounded, in her words and not ours: no
 * plumbing, no ids. Google and Apple both render this as the event's notes.
 */
import { clip } from "../lib/clip";

export interface EventIdea {
  hook?: string;
  onScreenText?: string;
  lengthSec?: number;
  sound?: string;
  /** Either the produced shot list (her text) or the shots array from a moment idea. */
  shotList?: string | string[];
  evidenceLinks?: string[];
  fitWhy?: string;
  messageText?: string;
}

export const DESCRIPTION_CAP = 2_400;

const label = (kind: "film" | "edit" | "post") => (kind === "film" ? "Film" : kind === "edit" ? "Edit" : "Post");

/** "Film: the shoe rack list". Pure. */
export function eventSummary(kind: "film" | "edit" | "post", title: string): string {
  const bare = title.replace(/^(film|edit|post)( \(experiment\))?:\s*/i, "").trim();
  return clip(`${label(kind)}: ${bare || "with Maya"}`, 120);
}

function clean(s: unknown, max: number): string {
  return String(s ?? "").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The day's job, first (day sim, 2026-10-01: a session from the week's experiment had notes that only
 * said "Filming block planned with Maya", and a judge scored them 1 of 5). One line they can act on
 * from the event alone, built from what's true: the idea's hook if there is one, else the session's
 * own title. Pure.
 */
export function jobLine(kind: "film" | "edit" | "post", what: string, i?: EventIdea | null): string {
  const w = what ? `"${clean(what, 120)}"` : "today's idea";
  const len = i?.lengthSec && i.lengthSec > 0 ? `under ${Math.round(i.lengthSec)}s` : "short";
  if (kind === "film") return `Today's job: film ${w}. Get the opening line in two or three takes, then the shots below${i?.shotList ? "" : " (a wide, a close-up, and you reacting)"}.`;
  if (kind === "edit") return `Today's job: cut ${w} ${len === "short" ? "tight" : `to ${len}`}, with the hook in the first second${i?.onScreenText ? " and the on-screen text below" : ""}.`;
  return `Today's job: post ${w}, then answer the first comments for the next hour.`;
}

/** The notes. Pure. The job first; then the idea's details, only when there is something true to put in them. */
export function eventDescription(input: { kind: "film" | "edit" | "post"; idea?: EventIdea | null; name?: string | null; title?: string }): string {
  const i = input.idea;
  const what = i?.hook ? i.hook : (input.title ?? "").replace(/^(film|edit|post)( \(experiment\))?:\s*/i, "").trim();
  const lines: string[] = [jobLine(input.kind, what, i), ""];
  if (i?.hook) lines.push(`Hook: ${clean(i.hook, 160)}`);
  if (i?.onScreenText) lines.push(`On screen: "${clean(i.onScreenText, 100)}"`);
  const bits: string[] = [];
  if (i?.lengthSec && i.lengthSec > 0) bits.push(`under ${Math.round(i.lengthSec)}s`);
  if (i?.sound && clean(i.sound, 80)) bits.push(`sound: ${clean(i.sound, 80)}`);
  if (bits.length) lines.push(bits.join(" · "));
  const shots = Array.isArray(i?.shotList) ? i!.shotList!.map((s) => clean(s, 120)).filter(Boolean) : i?.shotList ? [clean(i.shotList, 900)] : [];
  if (shots.length && input.kind === "film") lines.push("", "Shot list:", ...(Array.isArray(i?.shotList) ? shots.map((s, n) => `${n + 1}. ${s}`) : shots));
  if (i?.fitWhy) lines.push("", `Why this one: ${clean(i.fitWhy, 200)}`);
  const links = (i?.evidenceLinks ?? []).filter((u) => /^https?:\/\//.test(u)).slice(0, 1);
  if (links.length && input.kind === "film") lines.push("", `The post that started it: ${links[0]}`);
  lines.push("", `Planned with Maya${input.name ? ` for ${clean(input.name, 40)}` : ""}. Text her to change it.`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, DESCRIPTION_CAP);
}

/** The idea fields an event needs, from an ideas row's loose `version`. Pure. */
export function ideaForEvent(idea: { version?: unknown; evidenceLinks?: string[]; fitWhy?: string; messageText?: string; shotList?: string } | null | undefined): EventIdea | null {
  if (!idea) return null;
  const v = (idea.version ?? {}) as { hook?: string; onScreenText?: string; lengthSec?: number; sound?: string; shotList?: string[] };
  return { hook: v.hook, onScreenText: v.onScreenText, lengthSec: v.lengthSec, sound: v.sound, shotList: idea.shotList ?? v.shotList, evidenceLinks: idea.evidenceLinks, fitWhy: idea.fitWhy, messageText: idea.messageText };
}
