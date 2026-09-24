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

/** At most this many texts from one message row. */
export const MAX_PARTS = 4;

/**
 * Pure. A body may carry several texts, the way a person sends three short messages
 * instead of one long one: a line containing only `---` separates them. Buttons and links
 * ride the last. One text when there is no separator.
 */
export function splitParts(body: string): string[] {
  const parts = body.split(/\n[ \t]*---[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [body.trim()];
  if (parts.length <= MAX_PARTS) return parts;
  return [...parts.slice(0, MAX_PARTS - 1), parts.slice(MAX_PARTS - 1).join("\n\n")];
}
