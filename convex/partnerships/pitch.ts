/**
 * K1: the pitch, done properly. The craft lives in her skill (PITCH_PLAYBOOK); the promises live here,
 * in code, so a draft that breaks them is refused with the reason and she redrafts within budget:
 *
 * - a first email pitch is ≤ 160 words (the research: under ~150 reads; we allow a little rounding),
 *   a follow-up or reply ≤ 120;
 * - the subject is ≤ 60 characters, names the brand, and isn't a generic "collaboration opportunity";
 * - one ask: at most one question;
 * - the kit goes in as a LINK in a first email pitch (the per-brand one when it exists), never an
 *   attachment; at most 3 links;
 * - every performance number in it (followers, views, %, ×) is one of theirs, from the kit.
 *
 * And the send time: an approved FIRST pitch goes out in the next weekday morning window on their
 * clock (09:00–11:00), unless they say "now". Replies and follow-ups go at once.
 */
import type { KitV2 } from "./kitData";

export const FIRST_PITCH_MAX_WORDS = 160;
export const FOLLOW_UP_MAX_WORDS = 120;
export const SUBJECT_MAX = 60;
export const MAX_LINKS = 3;
export const SEND_WINDOW = { startHour: 9, endHour: 11 } as const;

const GENERIC_SUBJECT = /^(re:\s*)?((brand |paid |exciting |potential )?(collab(oration)?|partnership)( opportunity| inquiry| request| proposal)?|opportunity|quick question|hello|hi( there)?|hey|introduction|intro|let'?s work together|work with me)[\s!.?]*$/i;

export function wordCount(s: string): number {
  return s.replace(/https?:\/\/\S+/g, " ").split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

/** Pure: the numbers a brand would read as performance, as written: "8.1K followers", "6.1%", "3.1x", "31,200 views". */
export function performanceNumbers(text: string): Array<{ raw: string; value: number; unit: "%" | "x" | "count" }> {
  const out: Array<{ raw: string; value: number; unit: "%" | "x" | "count" }> = [];
  const body = text.replace(/https?:\/\/\S+/g, " ");
  for (const m of body.matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%|x\b|×|k\b|m\b)?(\s*(?:followers|views|likes|subscribers|people|accounts|viewers|plays|saves|shares|comments))?/gi)) {
    const [raw, num, suffix, noun] = m;
    const n = Number(num.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const s = (suffix ?? "").toLowerCase();
    if (s === "%") out.push({ raw: raw.trim(), value: n, unit: "%" });
    else if (s === "x" || s === "×") out.push({ raw: raw.trim(), value: n, unit: "x" });
    else if (s === "k" || s === "m") out.push({ raw: raw.trim(), value: n * (s === "k" ? 1_000 : 1_000_000), unit: "count" });
    else if (noun) out.push({ raw: raw.trim(), value: n, unit: "count" });
  }
  return out;
}

/** Pure: every number the kit can back, by unit. Percentages in percent, multiples as ×, counts as counts. */
export function kitNumbers(k: KitV2): { "%": number[]; x: number[]; count: number[] } {
  const pct: number[] = [], x: number[] = [], count: number[] = [];
  let total = 0;
  for (const p of k.platforms) {
    if (p.followers !== null) { count.push(p.followers); total += p.followers; }
    if (p.normalViews !== null) count.push(p.normalViews);
    if (p.growth30d) count.push(Math.abs(p.growth30d.net));
    if (p.engagement) { pct.push(p.engagement.perView * 100); if (p.engagement.perFollower !== null) pct.push(p.engagement.perFollower * 100); }
    for (const b of p.best) { count.push(b.views); if (b.multiple !== null) x.push(b.multiple); }
    if (p.audience) for (const s of [...p.audience.age, ...p.audience.gender, ...p.audience.countries, ...p.audience.cities]) pct.push(s.share * 100);
  }
  if (total) count.push(total);
  return { "%": pct, x, count };
}

/** Pure: does a written number match a kit number, allowing the way people round ("8.1K" for 8,050, "31K" for 31,200)? */
export function backed(n: { value: number; unit: "%" | "x" | "count" }, nums: ReturnType<typeof kitNumbers>): boolean {
  const pool = nums[n.unit];
  if (n.unit === "%") return pool.some((p) => Math.abs(p - n.value) <= 0.6);
  if (n.unit === "x") return pool.some((p) => Math.abs(p - n.value) <= 0.15);
  return pool.some((p) => p > 0 && Math.abs(p - n.value) / p <= 0.05);
}

export interface PitchInput {
  route: "email" | "dm" | "application" | "unknown";
  firstTouch: boolean;
  brand: string;
  subject: string;
  body: string;
  /** The per-brand link if she made one, else the base kit link if it's on. */
  kitLinks: string[];
}

/** Pure: what's wrong with this draft, each as the reason she'll read. Empty = fine. */
export function pitchProblems(p: PitchInput, kit: KitV2 | null): string[] {
  if (p.route === "application") return []; // answers to a form's own questions; the form sets the shape
  const problems: string[] = [];
  const words = wordCount(p.body);
  const max = p.route === "email" && p.firstTouch ? FIRST_PITCH_MAX_WORDS : FOLLOW_UP_MAX_WORDS;
  if (words > max) problems.push(`it's ${words} words; keep it under ${max} (brands skim: who they are, why this brand, one idea, one ask)`);
  if (p.route === "email" && p.firstTouch) {
    if (p.subject.length > SUBJECT_MAX) problems.push(`the subject is ${p.subject.length} characters; keep it under ${SUBJECT_MAX}`);
    const brandWords = p.brand.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (!brandWords.some((w) => p.subject.toLowerCase().includes(w))) problems.push(`the subject should name ${p.brand} (e.g. "${p.brand} x @handle: <the idea in a few words>")`);
    if (GENERIC_SUBJECT.test(p.subject.trim())) problems.push("the subject is generic; say the idea or the deliverable instead");
    if (!p.kitLinks.length) problems.push("a first email pitch links their media kit: make the per-brand link with kit_for_brand first");
    else if (!p.kitLinks.some((u) => p.body.includes(u))) problems.push(`link their media kit in the body: ${p.kitLinks[0]}`);
  }
  const questions = (p.body.match(/\?/g) ?? []).length;
  if (questions > 1) problems.push(`there are ${questions} questions; end on ONE clear ask`);
  const links = (p.body.match(/https?:\/\/\S+/g) ?? []).length;
  if (links > MAX_LINKS) problems.push(`there are ${links} links; ${MAX_LINKS} at most (the kit plus one or two posts)`);
  if (/\b(attached|attachment|see attached|pdf attached)\b/i.test(p.body)) problems.push("no attachments: the kit goes in as a link");
  if (kit) {
    const nums = kitNumbers(kit);
    const bad = performanceNumbers(`${p.subject}\n${p.body}`).filter((n) => !backed(n, nums)).map((n) => n.raw);
    if (bad.length) problems.push(`these numbers aren't in their kit: ${[...new Set(bad)].slice(0, 4).join(", ")}. Use the kit's numbers exactly, or leave the number out`);
  }
  return problems;
}

/** Pure: the local weekday and hour of a moment in a timezone. */
function localParts(ts: number, timezone: string): { weekday: number; hour: number; minute: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const parts = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/**
 * Pure: when an approved first pitch goes out. Now, if it's a weekday between 09:00 and 11:00 on their
 * clock; else the next weekday at 09:00 (their clock). Scans in 15-minute steps, so DST is handled by
 * the formatter rather than by arithmetic.
 */
export function nextSendAt(now: number, timezone: string): number {
  const inWindow = (t: number) => { const p = localParts(t, timezone); return p.weekday >= 1 && p.weekday <= 5 && p.hour >= SEND_WINDOW.startHour && p.hour < SEND_WINDOW.endHour; };
  if (inWindow(now)) return now;
  const step = 15 * 60_000;
  let t = Math.ceil(now / step) * step;
  for (let i = 0; i < 4 * 24 * 8; i++, t += step) if (inWindow(t)) return t;
  return now; // unreachable for real timezones; never hold a send forever
}

/** Pure: "tuesday at 9:00" on their clock. */
export function sendWhen(ts: number, timezone: string): string {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(new Date(ts));
  return d.toLowerCase();
}

/** Pure: the disclosure line a paid or gifted post needs (the FTC's standard: clear, up front, not only the toggle). */
export function disclosureLine(brand: string): string {
  return `put "#ad" or "paid partnership with ${brand}" at the start of the caption (the platform's paid-partnership toggle alone isn't enough)`;
}

/** Her playbook for pitches, appended to the partnership skill. */
export const PITCH_PLAYBOOK = `Pitch craft (the research brands and agencies agree on):
- A first email pitch is under ~150 words, in their voice: (1) one line on who they are with ONE real number from media_kit, (2) why THIS brand, a real reason (they already use it: the post; or the brand is paying creators like them), (3) ONE concrete content idea for the brand, (4) one or two links to their most relevant posts, (5) ONE clear ask ("open to me sending a concept?" / "who's the right person for creator partnerships?"), (6) the per-brand kit link from kit_for_brand. No life story, no follower-count bragging, no "I'd love to collaborate".
- The subject names the brand and the idea or the deliverable: "Pacefern x @sam: a 15-second hill-repeat idea". Never "Collaboration opportunity".
- By deal type: sponsorship leads with audience fit and results on their account; UGC (videos the BRAND posts or runs as ads) leads with the quality of the work and asks how they'll use it (usage rights and paid-ad use are theirs to decide), follower count barely matters; gifting is a small, easy ask; affiliate shows their audience acts (saves, shares, a post that sold); ambassador asks for a longer run of posts; applications answer only the form's questions.
- Before a first email pitch: media_kit, then kit_for_brand with the 1–3 of their posts most relevant to this brand and the same idea as the pitch. The kit is a LINK, never an attachment. In a DM, a kit link only if the brand asked; in an application, only in a field that asks for a kit, portfolio or link; in a reply to "send your media kit and rates", the link, and rates are the creator's to give (ask them).
- Follow-ups are shorter than the pitch, add one new thing (a new post, a new idea), and stop after two.
- When a deal is agreed and they post: ${disclosureLine("<brand>")}.`;
