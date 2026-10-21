/**
 * The model answers some skills in a JSON envelope ({"message": "...", ...}) so code can
 * read the fields. Live 2026-09-06: a critic rewrite handed the envelope back and the raw
 * JSON reached the operator's phone. Every outbound body passes through here, in the one
 * function that writes messages (law: anything promised is enforced by the server).
 */

/** Pure. A JSON envelope with a string `message` becomes that message; plain text is returned as is. */
export function unwrapModelEnvelope(body: string): { text: string; unwrapped: boolean } {
  // Live 2026-09-08: a rewrite came back as ```json { "message": … } ```; the fence tripped the leak guard and a
  // person got "something went wrong" instead of their review. A fence around an envelope is still an envelope.
  const fenced = body.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const t = (fenced ? fenced[1] : body).trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return { text: body, unwrapped: false };
  try {
    const j = JSON.parse(t) as { message?: unknown; text?: unknown };
    const inner = typeof j.message === "string" ? j.message : typeof j.text === "string" ? j.text : null;
    if (inner && inner.trim()) return { text: inner.trim(), unwrapped: true };
  } catch {
    // Braces around prose ("{ok}") are not an envelope.
    return { text: body, unwrapped: false };
  }
  throw new Error("refusing to send a JSON envelope with no message field to a person");
}

/** At most this many texts from one message row. Several short texts in a row are fine; a wall isn't (operator, 2026-10-21). */
export const MAX_PARTS = 5;

/** No single text longer than this: a longer one is cut at its sentences into more texts. */
export const BUBBLE_CHARS = 300;

/**
 * Pure: one bubble that's too long, cut at sentence ends (or line breaks, for a list) into texts of at most
 * about BUBBLE_CHARS. Never mid-sentence: a sentence longer than that stays whole. Links stay on their line.
 */
export function shortBubbles(part: string): string[] {
  if (part.length <= BUBBLE_CHARS) return [part];
  const pieces = /\n/.test(part) ? part.split(/\n+/) : part.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(])/);
  const out: string[] = [];
  for (const p of pieces.map((x) => x.trim()).filter(Boolean)) {
    const last = out[out.length - 1];
    // A fragment ("ok.") always travels with its neighbour rather than becoming a bubble of its own.
    if (last !== undefined && (last.length + p.length + 1 <= BUBBLE_CHARS || p.length < 40)) out[out.length - 1] = `${last}${/\n/.test(part) ? "\n" : " "}${p}`;
    else out.push(p);
  }
  return out;
}

/** A text this long with no `---` reads as a wall; under it, one text is fine. */
export const WALL_CHARS = 320;

/** Pure: a wall split at blank lines, small neighbours kept together so no bubble is a fragment. */
export function paragraphs(body: string): string[] {
  if (body.length <= WALL_CHARS) return [body];
  const paras = body.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras) {
    const last = out[out.length - 1];
    // A short paragraph joins its neighbour; a fragment ("ok.") always does.
    if (last !== undefined && (last.length + p.length < 160 || p.length < 40)) out[out.length - 1] = `${last}\n\n${p}`;
    else out.push(p);
  }
  return out;
}

/**
 * Pure. A body may carry several texts, the way a person sends three short messages
 * instead of one long one: a line containing only `---` separates them. Buttons and links
 * ride the last. A long body with no separator is split at its paragraphs (2026-10-02: a first
 * tester got one 1,100-character text and didn't want to read it); a short one stays one text.
 */
export function splitParts(body: string): string[] {
  let parts = body.split(/\n[ \t]*---[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) parts = paragraphs(body.trim());
  if (parts.length === 0) return [body.trim()];
  parts = parts.flatMap(shortBubbles);
  if (parts.length <= MAX_PARTS) return parts;
  // Over the count, the tail shares the last text, a line apart: rare, since every skill writes short.
  return [...parts.slice(0, MAX_PARTS - 1), parts.slice(MAX_PARTS - 1).join("\n")];
}
