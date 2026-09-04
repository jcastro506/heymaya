/**
 * A calendar file for the week (Sprint 4b, the no-OAuth path).
 *
 * Apple Calendar has no OAuth API worth building against, and many creators never connect
 * Google. A .ics attachment works on every calendar app with nothing connected: they tap it
 * and the blocks land. Pure: rows in, text out. Each event carries the block id as its UID
 * so a re-send updates rather than duplicates.
 */

export interface IcsBlock { id: string; kind: "film" | "edit" | "post"; title: string; start: number; end: number }

const pad = (n: number) => String(n).padStart(2, "0");
/** UTC timestamp in the iCalendar form, e.g. 20260908T200000Z. */
export function icsStamp(epoch: number): string {
  const d = new Date(epoch);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines must fold at 75 octets per RFC 5545; we keep titles short so a simple fold is enough. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 73) { out.push(rest.slice(0, 73)); rest = " " + rest.slice(73); }
  out.push(rest);
  return out.join("\r\n");
}

export function buildIcs(blocks: IcsBlock[], now: number): string {
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HeyMaya//Week plan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const b of blocks) {
    const summary = b.title.replace(/^(film|edit|post)( \(experiment\))?: /, "");
    const label = b.kind === "film" ? "film" : b.kind === "edit" ? "edit" : "post";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.id}@heymaya`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART:${icsStamp(b.start)}`,
      `DTEND:${icsStamp(b.end)}`,
      fold(`SUMMARY:${escapeText(`${label}: ${summary}`)}`),
      fold(`DESCRIPTION:${escapeText("Planned with Maya. Move it and tell her; she follows.")}`),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
