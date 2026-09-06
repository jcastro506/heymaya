/**
 * The model answers some skills in a JSON envelope ({"message": "...", ...}) so code can
 * read the fields. Live 2026-09-06: a critic rewrite handed the envelope back and the raw
 * JSON reached the operator's phone. Every outbound body passes through here, in the one
 * function that writes messages (law: anything promised is enforced by the server).
 */

/** Pure. A JSON envelope with a string `message` becomes that message; plain text is returned as is. */
export function unwrapModelEnvelope(body: string): { text: string; unwrapped: boolean } {
  const t = body.trim();
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
