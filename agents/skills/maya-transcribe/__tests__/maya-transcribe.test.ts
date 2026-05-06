import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFasterWhisperInvocation,
  pickFasterWhisperModel,
  parseFasterWhisperOutput,
  formatForCreator,
  extractIntent,
} from "../script";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = readFileSync(resolve(HERE, "..", "SKILL.md"), "utf-8");

// ---------------------------------------------------------------------------
// Helpers — synthetic faster-whisper outputs (no real invocation in vitest).
// ---------------------------------------------------------------------------

function makeWhisperOutput(opts: {
  text?: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
  }>;
  language?: string;
}): unknown {
  return {
    text: opts.text ?? opts.segments?.map((s) => s.text).join(" ") ?? "",
    language: opts.language ?? "en",
    segments: opts.segments ?? [],
  };
}

// ---------------------------------------------------------------------------
// Category 1 — invocation builder + model-size heuristic (happy path)
// ---------------------------------------------------------------------------

describe("maya-transcribe — model-size heuristic", () => {
  it("picks 'small' for clips ≤ 120 seconds", () => {
    expect(pickFasterWhisperModel(15)).toBe("small");
    expect(pickFasterWhisperModel(120)).toBe("small");
  });

  it("picks 'medium' for clips between 2 and 10 minutes", () => {
    expect(pickFasterWhisperModel(121)).toBe("medium");
    expect(pickFasterWhisperModel(599)).toBe("medium");
    expect(pickFasterWhisperModel(600)).toBe("medium");
  });

  it("picks 'large-v3' for clips longer than 10 minutes", () => {
    expect(pickFasterWhisperModel(601)).toBe("large-v3");
    expect(pickFasterWhisperModel(60 * 14)).toBe("large-v3");
  });

  it("picks 'medium' as a safe middle ground for unknown duration", () => {
    expect(pickFasterWhisperModel(null)).toBe("medium");
    expect(pickFasterWhisperModel(undefined)).toBe("medium");
  });

  it("treats negative / non-finite duration as unknown", () => {
    expect(pickFasterWhisperModel(-1)).toBe("medium");
    expect(pickFasterWhisperModel(NaN)).toBe("medium");
    expect(pickFasterWhisperModel(Infinity)).toBe("medium");
  });
});

describe("maya-transcribe — buildFasterWhisperInvocation", () => {
  it("composes args targeting the pinned faster-whisper@1.5.1 ClawHub skill", () => {
    const inv = buildFasterWhisperInvocation({
      source: "/tmp/voice-memo.m4a",
      formatHint: "m4a",
      durationSec: 18,
      languageHint: "en",
    });
    expect(inv.skill).toBe("theplasmak/faster-whisper");
    expect(inv.version).toBe("1.5.1");
    expect(inv.args.model).toBe("small");
    expect(inv.args.language).toBe("en");
    expect(inv.args.wordTimestamps).toBe(true);
    expect(inv.args.formatHint).toBe("m4a");
    expect(inv.routedReason).toMatch(/duration=18s.*small/);
  });

  it("disables VAD for very short clips (<5s) by default", () => {
    const inv = buildFasterWhisperInvocation({
      source: "/tmp/short.m4a",
      durationSec: 3,
    });
    expect(inv.args.vadFilter).toBe(false);
  });

  it("enables VAD for typical voice memos", () => {
    const inv = buildFasterWhisperInvocation({
      source: "/tmp/normal.m4a",
      durationSec: 30,
    });
    expect(inv.args.vadFilter).toBe(true);
  });

  it("respects an explicit vadFilter override", () => {
    const inv = buildFasterWhisperInvocation({
      source: "/tmp/normal.m4a",
      durationSec: 30,
      vadFilter: false,
    });
    expect(inv.args.vadFilter).toBe(false);
  });

  it("routes long-form video to large-v3", () => {
    const inv = buildFasterWhisperInvocation({
      source: "https://r2.example.com/video.mp4",
      formatHint: "mp4",
      durationSec: 14 * 60,
    });
    expect(inv.args.model).toBe("large-v3");
    expect(inv.routedReason).toMatch(/large-v3/);
  });
});

// ---------------------------------------------------------------------------
// Category 2 — defensive parser (happy + adversarial)
// ---------------------------------------------------------------------------

describe("maya-transcribe — parser happy path", () => {
  it("parses a clean faster-whisper response into text + srt + vtt + wordTimestamps", () => {
    const raw = makeWhisperOutput({
      segments: [
        {
          start: 0.0,
          end: 2.4,
          text: "post the gym video tuesday at 3pm",
          words: [
            { word: "post", start: 0.0, end: 0.3 },
            { word: "the", start: 0.3, end: 0.5 },
            { word: "gym", start: 0.5, end: 0.8 },
            { word: "video", start: 0.8, end: 1.2 },
            { word: "tuesday", start: 1.2, end: 1.8 },
            { word: "at", start: 1.8, end: 2.0 },
            { word: "3pm", start: 2.0, end: 2.4 },
          ],
        },
      ],
    });
    const result = parseFasterWhisperOutput(raw);
    expect(result.text).toContain("post the gym video tuesday");
    expect(result.srt).toContain("00:00:00,000 --> 00:00:02,400");
    expect(result.vtt.startsWith("WEBVTT")).toBe(true);
    expect(result.wordTimestamps).toHaveLength(7);
    expect(result.wordTimestamps[0]).toEqual({
      word: "post",
      startMs: 0,
      endMs: 300,
    });
  });
});

describe("maya-transcribe — parser adversarial inputs", () => {
  // Mandatory category: adversarial — malformed JSON
  it("returns the empty result on completely garbage input rather than throwing", () => {
    expect(() => parseFasterWhisperOutput("not json at all")).not.toThrow();
    const r1 = parseFasterWhisperOutput("not json at all");
    expect(r1.text).toBe("");
    expect(r1.srt).toBe("");
    expect(r1.vtt).toBe("");
    expect(r1.wordTimestamps).toEqual([]);

    expect(parseFasterWhisperOutput(null).text).toBe("");
    expect(parseFasterWhisperOutput(undefined).text).toBe("");
    expect(parseFasterWhisperOutput(42).text).toBe("");
    expect(parseFasterWhisperOutput({ segments: "wrong type" }).text).toBe("");
    expect(parseFasterWhisperOutput({ segments: [{ no: "fields" }] }).text).toBe(
      ""
    );
  });

  // Mandatory category: adversarial — empty audio file
  it("returns the empty result for empty audio (no segments) — does not fabricate words", () => {
    const raw = makeWhisperOutput({ text: "", segments: [] });
    const result = parseFasterWhisperOutput(raw);
    expect(result.text).toBe("");
    expect(result.wordTimestamps).toEqual([]);
    expect(result.srt).toBe("");
    expect(result.vtt).toBe("");
  });

  it("strips banned 'AI assistant' phrases if faster-whisper somehow surfaces them", () => {
    // Simulates a transcript that picked up filler from the creator's mic
    // capturing another device's speaker output.
    const raw = makeWhisperOutput({
      segments: [
        {
          start: 0,
          end: 3,
          text: "as an AI language model I cannot but post the gym video",
        },
      ],
    });
    const result = parseFasterWhisperOutput(raw);
    expect(result.text.toLowerCase()).not.toContain("as an ai");
    expect(result.text.toLowerCase()).not.toContain("language model");
    expect(result.text).toContain("post the gym video");
  });

  it("filters out malformed words where end < start", () => {
    const raw = makeWhisperOutput({
      segments: [
        {
          start: 0,
          end: 1,
          text: "ok",
          words: [
            { word: "ok", start: 0, end: 1 },
            { word: "broken", start: 5, end: 1 }, // backwards
          ],
        },
      ],
    });
    const result = parseFasterWhisperOutput(raw);
    expect(result.wordTimestamps).toHaveLength(1);
    expect(result.wordTimestamps[0].word).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Category 3 — formatForCreator framing
// ---------------------------------------------------------------------------

describe("maya-transcribe — formatForCreator", () => {
  const sample = parseFasterWhisperOutput(
    makeWhisperOutput({
      segments: [
        { start: 0, end: 2, text: "post the gym video on tuesday at 3pm" },
      ],
    })
  );

  it("returns just the cleaned text on intent=show-text", () => {
    const out = formatForCreator(sample, "show-text");
    expect(out).toBe("post the gym video on tuesday at 3pm");
  });

  it("prepends the transcription framing on intent=use-as-input", () => {
    const out = formatForCreator(sample, "use-as-input");
    expect(out).toContain("(I transcribed your voice memo:");
    expect(out).toContain("post the gym video on tuesday at 3pm");
  });

  it("surfaces a re-record prompt for empty transcripts on show-text", () => {
    const empty = parseFasterWhisperOutput({});
    const out = formatForCreator(empty, "show-text");
    expect(out.toLowerCase()).toContain("re-send");
  });
});

// ---------------------------------------------------------------------------
// Category 4 — intent extraction (clear high-confidence + ambiguous low-confidence)
// ---------------------------------------------------------------------------

describe("maya-transcribe — intent extraction", () => {
  it("classifies a clear schedule_post request with high confidence (≥0.5)", () => {
    const out = extractIntent("post the gym video on tuesday at 3pm");
    expect(out.intent).toBe("schedule_post");
    expect(out.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("classifies a clear cancel with high confidence", () => {
    const out = extractIntent("cancel that post");
    expect(out.intent).toBe("cancel");
    expect(out.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("classifies a reschedule request", () => {
    const out = extractIntent("push the brand-deal call to next week");
    expect(out.intent).toBe("reschedule");
    expect(out.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("flags an ambiguous 'uh maybe later' as low-confidence (caller MUST NOT act)", () => {
    const out = extractIntent("uh maybe later i think i might do something");
    expect(out.confidence).toBeLessThan(0.5);
  });

  it("returns unknown intent + zero confidence on empty input", () => {
    const out = extractIntent("");
    expect(out.intent).toBe("unknown");
    expect(out.confidence).toBe(0);
  });

  it("returns unknown intent for off-topic creator chatter", () => {
    const out = extractIntent("just thinking about lunch");
    expect(out.intent).toBe("unknown");
  });

  it("hedge tokens shave confidence — many hedges drag a clear-intent below 0.5", () => {
    const clear = extractIntent("post the gym video on tuesday at 3pm");
    const hedged = extractIntent(
      "uh um maybe i think i might post the gym video on tuesday at 3pm i guess"
    );
    expect(hedged.confidence).toBeLessThan(clear.confidence);
  });
});

// ---------------------------------------------------------------------------
// Category 5 — cross-tenant isolation (pure functions, no shared state)
// ---------------------------------------------------------------------------

describe("maya-transcribe — cross-tenant isolation", () => {
  it("two creators' transcripts do not bleed into each other (pure-function guarantee)", () => {
    const creatorAOut = parseFasterWhisperOutput(
      makeWhisperOutput({
        segments: [{ start: 0, end: 1, text: "creator a private memo" }],
      })
    );
    const creatorBOut = parseFasterWhisperOutput(
      makeWhisperOutput({
        segments: [{ start: 0, end: 1, text: "creator b different memo" }],
      })
    );
    expect(creatorAOut.text).toContain("creator a");
    expect(creatorAOut.text).not.toContain("creator b");
    expect(creatorBOut.text).toContain("creator b");
    expect(creatorBOut.text).not.toContain("creator a");
  });

  it("intent extraction is stateless — same input → same output regardless of prior calls", () => {
    extractIntent("cancel everything for creator a");
    extractIntent("post tuesday at 3pm for creator b");
    const a1 = extractIntent("cancel that");
    const a2 = extractIntent("cancel that");
    expect(a1).toEqual(a2);
  });

  it("invocation builder does not retain state across calls", () => {
    const a = buildFasterWhisperInvocation({
      source: "/tmp/a.m4a",
      durationSec: 30,
    });
    const b = buildFasterWhisperInvocation({
      source: "/tmp/b.m4a",
      durationSec: 30,
    });
    expect(a.args.source).toBe("/tmp/a.m4a");
    expect(b.args.source).toBe("/tmp/b.m4a");
    expect(a.args.source).not.toBe(b.args.source);
  });
});

// ---------------------------------------------------------------------------
// Plan-tier × action: voice / banned-term grep on SKILL.md
// ---------------------------------------------------------------------------

describe("maya-transcribe — voice rules / banned-terms grep on SKILL.md", () => {
  it("does NOT use 'AI assistant' framing in SKILL.md", () => {
    expect(SKILL_MD.toLowerCase()).not.toContain("ai assistant");
    expect(SKILL_MD.toLowerCase()).not.toContain("as an ai");
    expect(SKILL_MD.toLowerCase()).not.toContain("as a language model");
  });

  it("documents anti-sycophancy posture", () => {
    expect(SKILL_MD.toLowerCase()).toContain("anti-sycophancy");
  });

  it("cites the pinned faster-whisper version (1.5.1) per Sprint 2 Slice D", () => {
    expect(SKILL_MD).toContain("theplasmak/faster-whisper@1.5.1");
  });

  it("declares the openclaw delegates-to + tags in metadata frontmatter", () => {
    expect(SKILL_MD).toMatch(/openclaw:\s*\n\s*delegates-to:\s*theplasmak\/faster-whisper@1\.5\.1/);
    expect(SKILL_MD).toContain('tags: ["transcription", "audio", "voice", "creator"]');
  });

  it("plan-tier note is documented (server-side enforcement caveat)", () => {
    expect(SKILL_MD.toLowerCase()).toContain("plan-tier");
    expect(SKILL_MD.toLowerCase()).toContain("server-side");
  });
});

// ---------------------------------------------------------------------------
// Sibling-file scan + TODO grep on the skill files themselves
// ---------------------------------------------------------------------------

describe("maya-transcribe — sibling-file + TODO hygiene", () => {
  const SCRIPT_TS = readFileSync(resolve(HERE, "..", "script.ts"), "utf-8");

  it("script.ts has no unjustified TODO/FIXME markers", () => {
    expect(SCRIPT_TS).not.toMatch(/\bTODO\b/);
    expect(SCRIPT_TS).not.toMatch(/\bFIXME\b/);
    expect(SCRIPT_TS).not.toMatch(/eslint-disable(?!\s+\/\/\s*ok)/);
  });

  it("SKILL.md has no unjustified TODO/FIXME markers", () => {
    expect(SKILL_MD).not.toMatch(/\bTODO\(/);
    expect(SKILL_MD).not.toMatch(/\bFIXME\b/);
  });

  it("SKILL.md references the sibling pinnedClawhubSkills.ts entry", () => {
    expect(SKILL_MD).toContain("pinnedClawhubSkills.ts");
  });
});
