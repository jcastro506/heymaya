/**
 * What a calendar event says when they click into it (2026-09-09): the idea, the shot list, the
 * inspiration link, why it fits; bounded; nothing of ours; and the same notes in the .ics.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DESCRIPTION_CAP, eventDescription, eventSummary, ideaForEvent } from "../eventBody";
import { buildIcs } from "../ics";

const idea = { hook: "the shoe rack list, said to camera", onScreenText: "5 things", lengthSec: 25, sound: "", shotList: "1. open on the rack, not your face\n2. one pair off per point\n3. out the door", evidenceLinks: ["https://www.tiktok.com/@runwithcarly/video/7395965676629888274"], fitWhy: "you did the list twice this year and both beat your normal" };

describe("the event body", () => {
  it("carries the idea, the shot list, the link and the why, in plain text", () => {
    const d = eventDescription({ kind: "film", idea });
    expect(d).toContain("Hook: the shoe rack list, said to camera");
    expect(d).toContain('On screen: "5 things"');
    expect(d).toContain("under 25s");
    expect(d).toContain("Shot list:");
    expect(d).toContain("open on the rack");
    expect(d).toContain("Why this one: you did the list twice");
    expect(d).toContain("The post that started it: https://www.tiktok.com/@runwithcarly/video/7395965676629888274");
    expect(d).toContain("Filming block planned with Maya");
    expect(d, "nothing of ours in their calendar").not.toMatch(/prefix|dossier|convex|internal|skill|critic|ideaId|\bid\b/i);
    expect(d).not.toMatch(/\*\*|##|`/);
  });

  it("shows only what is true, and never a bare template", () => {
    const empty = eventDescription({ kind: "edit", idea: null });
    expect(empty).toBe("Editing block planned with Maya. Move or delete it here and she follows; reply in the chat to change the idea.");
    const shots = eventDescription({ kind: "film", idea: { hook: "h", shotList: ["a", "b"] } });
    expect(shots).toContain("1. a");
    expect(shots).toContain("2. b");
    expect(shots).not.toContain("On screen");
    expect(eventDescription({ kind: "post", idea: { evidenceLinks: ["javascript:alert(1)", "https://ok/1"] } })).toContain("https://ok/1");
    expect(eventDescription({ kind: "post", idea: { evidenceLinks: ["javascript:alert(1)"] } })).not.toContain("javascript");
  });

  it("is bounded, strips markdown from the writer, and the summary reads as a calendar title", () => {
    const long = eventDescription({ kind: "film", idea: { hook: "**bold** hook", shotList: "x".repeat(5000) } });
    expect(long.length).toBeLessThanOrEqual(DESCRIPTION_CAP);
    expect(long).toContain("Hook: bold hook");
    expect(eventSummary("film", "film: the shoe rack list")).toBe("Film: the shoe rack list");
    expect(eventSummary("edit", "edit (experiment): the cut")).toBe("Edit: the cut");
    expect(eventSummary("post", "")).toBe("Post: with Maya");
  });

  it("maps an ideas row, preferring the shot list she wrote to the moment's shots", () => {
    expect(ideaForEvent({ version: { hook: "h", shotList: ["a"] }, evidenceLinks: ["https://x/1"], fitWhy: "w", messageText: "m", shotList: "her list" })).toMatchObject({ hook: "h", shotList: "her list", fitWhy: "w" });
    expect(ideaForEvent({ version: { hook: "h", shotList: ["a"] } })?.shotList).toEqual(["a"]);
    expect(ideaForEvent(null)).toBeNull();
  });

  it("the .ics carries the same notes, escaped and folded", () => {
    const ics = buildIcs([{ id: "b1", kind: "film", title: "film: the shoe rack list", start: Date.UTC(2026, 8, 10, 21), end: Date.UTC(2026, 8, 10, 22), description: eventDescription({ kind: "film", idea }) }], Date.UTC(2026, 8, 9));
    expect(ics).toContain("SUMMARY:film: the shoe rack list");
    expect(ics.replace(/\r\n /g, "")).toContain("Hook: the shoe rack list\\, said to camera");
    expect(ics.replace(/\r\n /g, "")).toContain("Shot list:\\n1. open on the rack");
    for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
  });

  it("sibling coherence: confirm, refresh and the week's file all use the one body", () => {
    const blocks = readFileSync(new URL("../blocks.ts", import.meta.url), "utf8");
    expect(blocks).toMatch(/createEvent\(token, \{ calendarId, summary: eventSummary\(b\.kind, b\.title\), description: eventDescription\(/);
    expect(blocks).toMatch(/export const refreshForIdea/);
    expect(readFileSync(new URL("../weekPlan.ts", import.meta.url), "utf8")).toMatch(/description: eventDescription\(/);
    const converse = readFileSync(new URL("../../agent/converse.ts", import.meta.url), "utf8");
    expect(converse.match(/internal\.calendar\.blocks\.refreshForIdea/g)?.length, "a shot list and an edit both reach the event").toBeGreaterThanOrEqual(2);
  });
});
