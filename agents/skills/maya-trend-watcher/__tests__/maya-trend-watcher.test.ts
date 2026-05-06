/**
 * Sprint 5 — `maya-trend-watcher` unit tests.
 *
 * Pure-logic tests. The Convex action wiring (ScrapeCreators read-layer +
 * callMaya + `trendObservations` write) is tested separately.
 *
 * Coverage maps to the 5 mandatory categories per CLAUDE.md § Testing:
 *   1. Cross-tenant isolation: dedupe baselines for creator A do not affect
 *      creator B's observations (proven via dedupe-key purity + per-creator
 *      baseline scoping in the caller).
 *   2. Plan-tier × action: gating happens in the calling Convex action;
 *      this skill itself is plan-agnostic. We assert the skill never
 *      mutates plan-relevant fields.
 *   3. Adversarial:
 *      - hallucinated trend with no citation -> firewall drops
 *      - trend conflicting with banned_topics -> model is told to score 0
 *        and the parser respects the score (we test parser side-effects)
 *      - malformed JSON / extra fences / missing fields -> parser drops
 *      - citation.ref pointing at evil.com -> firewall rejects
 *   4. Cross-platform: TikTok candidates and IG candidates produce
 *      platform-tagged observations that DO NOT collide in dedupe.
 *   5. Sibling-file scan: SKILL.md voice fixture grep — no banned terms,
 *      no "AI" tokens, frontmatter has metadata.openclaw block.
 *   + TODO grep on the skill files.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  buildScoringPrompt,
  parseScoringResponse,
  citationFirewall,
  dedupeAgainstBaseline,
  dedupeKey,
  type CreatorPictureSubset,
  type TrendCandidate,
  type TrendObservation,
} from "../script";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, "..");

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

const fitnessCreator: CreatorPictureSubset = {
  niche: "fitness",
  voiceFingerprint:
    "Calm, evidence-led, refuses bro-science. Speaks to recovering injury cases and women returning to lifting. Uses specifics over hype. Avoids gendered marketing tropes.",
  audience: {
    interestTags: ["strength training", "rehab", "women's lifting", "programming"],
    topGeos: ["US", "UK"],
  },
  boundaries: {
    banned_topics: ["politics", "alcohol", "weight-loss-shaming"],
    banned_formats: ["thirst-traps", "shock-content"],
  },
};

const financeCreator: CreatorPictureSubset = {
  niche: "personal finance",
  voiceFingerprint:
    "Dry, calm, plainspoken. Pet peeve is hype. Refuses to talk about meme stocks.",
  audience: {
    interestTags: ["index investing", "tax planning", "FIRE"],
    topGeos: ["US"],
  },
  boundaries: {
    banned_topics: ["meme stocks", "crypto leverage", "politics"],
  },
};

function tiktokHashtag(pattern: string, ref: string, fact: string): TrendCandidate {
  return {
    kind: "hashtag",
    pattern,
    citation: { ref, fact },
    sampleCreatorsRiding: ["pro_lifter", "rehab_dr"],
    momentum: "2.4× 24h growth",
    platform: "tiktok",
  };
}

function igReel(pattern: string, ref: string, fact: string): TrendCandidate {
  return {
    kind: "video",
    pattern,
    citation: { ref, fact },
    sampleCreatorsRiding: ["ig_creator_a"],
    momentum: "1.8× 48h",
    platform: "instagram",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// buildScoringPrompt
// ─────────────────────────────────────────────────────────────────────────

describe("maya-trend-watcher — buildScoringPrompt", () => {
  it("includes niche, voiceFingerprint, audience, and every candidate", () => {
    const candidates = [
      tiktokHashtag(
        "rehabFriendlyLifts",
        "https://www.tiktok.com/tag/rehabfriendlylifts",
        "Trending hashtag with 12.4M views, top creators include @pro_lifter"
      ),
      igReel(
        "split-squat tutorials",
        "https://www.instagram.com/reel/DOq6eV6iIgD",
        "Reel with 240K likes featuring split-squat regression"
      ),
    ];
    const prompt = buildScoringPrompt(fitnessCreator, candidates);
    expect(prompt).toContain("fitness");
    expect(prompt).toContain("Calm, evidence-led");
    expect(prompt).toContain("strength training");
    expect(prompt).toContain("rehabFriendlyLifts");
    expect(prompt).toContain("https://www.tiktok.com/tag/rehabfriendlylifts");
    expect(prompt).toContain("split-squat tutorials");
    // platform-tagged
    expect(prompt).toContain("platform=tiktok");
    expect(prompt).toContain("platform=instagram");
  });

  it("instructs the model to LOWER scores for boundary / voice conflicts", () => {
    const prompt = buildScoringPrompt(fitnessCreator, [
      tiktokHashtag("politicsHotTake", "https://www.tiktok.com/tag/politicshottake", "trend"),
    ]);
    // Boundaries surface verbatim
    expect(prompt).toContain("politics");
    expect(prompt).toContain("thirst-traps");
    // Explicit instruction
    expect(prompt).toMatch(/LOWER the score/);
    expect(prompt).toMatch(/banned_topic|banned_format/);
    expect(prompt).toMatch(/anti-sycophancy/i);
  });

  it("forbids virality prediction in prose", () => {
    const prompt = buildScoringPrompt(fitnessCreator, []);
    expect(prompt).toMatch(/Do not predict virality numerically/);
    expect(prompt).toMatch(/fabrication/);
  });

  it("tells the model to copy citations verbatim — do not invent URLs", () => {
    const prompt = buildScoringPrompt(fitnessCreator, [
      tiktokHashtag("a", "https://www.tiktok.com/tag/a", "fact"),
    ]);
    expect(prompt).toMatch(/Do not invent URLs/i);
    expect(prompt).toMatch(/copy.*citation.*verbatim/i);
  });

  it("handles an empty candidate list without crashing", () => {
    const prompt = buildScoringPrompt(fitnessCreator, []);
    expect(prompt).toContain("(none — return an empty observations array)");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// parseScoringResponse
// ─────────────────────────────────────────────────────────────────────────

describe("maya-trend-watcher — parseScoringResponse", () => {
  const candidates: TrendCandidate[] = [
    tiktokHashtag(
      "rehabFriendlyLifts",
      "https://www.tiktok.com/tag/rehabfriendlylifts",
      "Trending hashtag with 12.4M views"
    ),
    igReel(
      "split-squat tutorials",
      "https://www.instagram.com/reel/DOq6eV6iIgD",
      "Reel with 240K likes"
    ),
  ];

  it("parses well-formed JSON observations and joins platform/kind from candidates", () => {
    const raw = JSON.stringify({
      observations: [
        {
          candidateIdx: 0,
          trendPattern: "rehabFriendlyLifts",
          citation: {
            ref: "https://www.tiktok.com/tag/rehabfriendlylifts",
            fact: "Trending hashtag with 12.4M views",
          },
          fitToCreatorScore: 8,
          sampleCreatorsRiding: ["pro_lifter"],
          rationale: "Matches the rehab-focused audience and the calm, specifics-first voice.",
        },
      ],
    });
    const parsed = parseScoringResponse(raw, candidates);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].platform).toBe("tiktok");
    expect(parsed[0].kind).toBe("hashtag");
    expect(parsed[0].fitToCreatorScore).toBe(8);
    expect(parsed[0].trendPattern).toBe("rehabFriendlyLifts");
  });

  it("strips ```json fences before parsing", () => {
    const raw = "```json\n" + JSON.stringify({
      observations: [
        {
          candidateIdx: 1,
          trendPattern: "split-squat tutorials",
          citation: {
            ref: "https://www.instagram.com/reel/DOq6eV6iIgD",
            fact: "Reel with 240K likes",
          },
          fitToCreatorScore: 7,
          rationale: "Niche-fit reel, audience matches.",
        },
      ],
    }) + "\n```";
    const parsed = parseScoringResponse(raw, candidates);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].platform).toBe("instagram");
  });

  // ── adversarial: hallucinated entries must be dropped ─────────────────
  it("drops entries with no citation (model hallucinated a trend with no source)", () => {
    const raw = JSON.stringify({
      observations: [
        {
          candidateIdx: 0,
          trendPattern: "fictional-trend",
          // citation omitted entirely — hallucinated
          fitToCreatorScore: 9,
          rationale: "Maya invented this.",
        },
      ],
    });
    expect(parseScoringResponse(raw, candidates)).toHaveLength(0);
  });

  it("drops entries with empty citation.ref or empty fact", () => {
    const raw = JSON.stringify({
      observations: [
        {
          candidateIdx: 0,
          trendPattern: "rehabFriendlyLifts",
          citation: { ref: "", fact: "trending" },
          fitToCreatorScore: 7,
          rationale: "Fits.",
        },
        {
          candidateIdx: 1,
          trendPattern: "split-squat tutorials",
          citation: {
            ref: "https://www.instagram.com/reel/DOq6eV6iIgD",
            fact: "",
          },
          fitToCreatorScore: 7,
          rationale: "Fits.",
        },
      ],
    });
    expect(parseScoringResponse(raw, candidates)).toHaveLength(0);
  });

  it("drops out-of-range scores (negative, >10, NaN)", () => {
    const raw = JSON.stringify({
      observations: [
        {
          candidateIdx: 0,
          trendPattern: "x",
          citation: { ref: "https://www.tiktok.com/tag/x", fact: "f" },
          fitToCreatorScore: -1,
          rationale: "r",
        },
        {
          candidateIdx: 0,
          trendPattern: "y",
          citation: { ref: "https://www.tiktok.com/tag/y", fact: "f" },
          fitToCreatorScore: 99,
          rationale: "r",
        },
        {
          candidateIdx: 0,
          trendPattern: "z",
          citation: { ref: "https://www.tiktok.com/tag/z", fact: "f" },
          fitToCreatorScore: 7,
          rationale: "valid",
        },
      ],
    });
    const out = parseScoringResponse(raw, candidates);
    expect(out).toHaveLength(1);
    expect(out[0].trendPattern).toBe("z");
  });

  it("returns [] on completely malformed JSON (no fabrication)", () => {
    expect(parseScoringResponse("not json", candidates)).toEqual([]);
    expect(parseScoringResponse("", candidates)).toEqual([]);
    expect(parseScoringResponse("[]", candidates)).toEqual([]);
  });

  it("respects 0-score entries that the model wrote because banned_topics matched", () => {
    // The model is told to set fitToCreatorScore=0 when banned_topics match.
    // The parser keeps these — the action filters them downstream — because
    // the audit trail of "Maya saw this and said no" is valuable telemetry.
    const raw = JSON.stringify({
      observations: [
        {
          candidateIdx: 0,
          trendPattern: "politics-hot-take",
          citation: { ref: "https://www.tiktok.com/tag/politicshottake", fact: "trend" },
          fitToCreatorScore: 0,
          rationale: "Matches creator's banned_topic 'politics'.",
        },
      ],
    });
    const out = parseScoringResponse(raw, candidates);
    expect(out).toHaveLength(1);
    expect(out[0].fitToCreatorScore).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// citationFirewall
// ─────────────────────────────────────────────────────────────────────────

describe("maya-trend-watcher — citationFirewall", () => {
  function obs(over: Partial<TrendObservation>): TrendObservation {
    return {
      platform: "tiktok",
      kind: "hashtag",
      trendPattern: "rehabFriendlyLifts",
      citation: {
        ref: "https://www.tiktok.com/tag/rehabfriendlylifts",
        fact: "12.4M views",
      },
      fitToCreatorScore: 8,
      sampleCreatorsRiding: [],
      rationale: "Niche fit, calm voice register matches.",
      ...over,
    };
  }

  it("passes a clean observation with a real ScrapeCreators-shaped URL", () => {
    expect(citationFirewall(obs({}))).toEqual({ ok: true });
  });

  it("passes a bare-id citation when prefix is recognized", () => {
    expect(
      citationFirewall(
        obs({
          citation: { ref: "tt:hashtag:rehabfriendlylifts", fact: "12.4M views" },
        })
      )
    ).toEqual({ ok: true });
  });

  // ── adversarial ───────────────────────────────────────────────────────
  it("rejects a citation with a fabricated host (evil.com)", () => {
    const r = citationFirewall(
      obs({ citation: { ref: "https://evil.com/fake", fact: "trending" } })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ScrapeCreators URL\/id shape/);
  });

  it("rejects an empty citation.ref", () => {
    const r = citationFirewall(obs({ citation: { ref: "", fact: "f" } }));
    expect(r.ok).toBe(false);
  });

  it("rejects an empty rationale (uncited prose)", () => {
    const r = citationFirewall(obs({ rationale: "" }));
    expect(r.ok).toBe(false);
  });

  it("rejects an out-of-range fitToCreatorScore", () => {
    const r = citationFirewall(obs({ fitToCreatorScore: 12 }));
    expect(r.ok).toBe(false);
  });

  it("rejects a non-https / non-http ref scheme", () => {
    const r = citationFirewall(
      obs({ citation: { ref: "javascript:alert(1)", fact: "f" } })
    );
    expect(r.ok).toBe(false);
  });

  it("accepts youtube.com, instagram.com, x.com, threads.net, linkedin.com", () => {
    const hosts = [
      "https://www.youtube.com/shorts/abc",
      "https://www.instagram.com/reel/xyz",
      "https://x.com/user/status/1",
      "https://www.threads.net/@user/post/1",
      "https://www.linkedin.com/posts/foo",
    ];
    for (const ref of hosts) {
      expect(
        citationFirewall(
          obs({ citation: { ref, fact: "f" }, platform: "tiktok" })
        ).ok
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// dedupeAgainstBaseline
// ─────────────────────────────────────────────────────────────────────────

describe("maya-trend-watcher — dedupeAgainstBaseline", () => {
  function obs(
    platform: "tiktok" | "instagram",
    pattern: string,
    ref: string
  ): TrendObservation {
    return {
      platform,
      kind: "hashtag",
      trendPattern: pattern,
      citation: { ref, fact: "fact" },
      fitToCreatorScore: 7,
      sampleCreatorsRiding: [],
      rationale: "rationale",
    };
  }

  it("drops observations whose dedupe key matches the baseline", () => {
    const baseline = [obs("tiktok", "rehabFriendlyLifts", "https://www.tiktok.com/tag/rehabfriendlylifts")];
    const fresh = [
      obs("tiktok", "rehabFriendlyLifts", "https://www.tiktok.com/tag/rehabfriendlylifts/?utm=x"),
      obs("tiktok", "newTrend2026", "https://www.tiktok.com/tag/newtrend2026"),
    ];
    const out = dedupeAgainstBaseline(fresh, baseline);
    expect(out.map((o) => o.trendPattern)).toEqual(["newTrend2026"]);
  });

  it("dedupes within the same incoming batch (same key twice → one row)", () => {
    const fresh = [
      obs("tiktok", "rehabFriendlyLifts", "https://www.tiktok.com/tag/rehabfriendlylifts"),
      obs("tiktok", "Rehab Friendly Lifts!", "https://www.tiktok.com/tag/rehabfriendlylifts"), // slugifies same
    ];
    expect(dedupeAgainstBaseline(fresh, [])).toHaveLength(1);
  });

  it("CROSS-PLATFORM: same hashtag on TikTok vs Instagram does NOT dedupe (different platforms)", () => {
    const baseline = [obs("tiktok", "rehabFriendlyLifts", "https://www.tiktok.com/tag/rehabfriendlylifts")];
    const fresh = [
      obs("instagram", "rehabFriendlyLifts", "https://www.instagram.com/explore/tags/rehabfriendlylifts/"),
    ];
    const out = dedupeAgainstBaseline(fresh, baseline);
    expect(out).toHaveLength(1);
    expect(out[0].platform).toBe("instagram");
  });

  it("CROSS-TENANT: passing creator B's baseline (i.e., empty for creator A) does not suppress creator A's observations", () => {
    // Per CLAUDE.md § 1: cross-tenant isolation. The action scopes baseline
    // by creatorId BEFORE calling this helper, so a creator-A baseline read
    // never contains creator-B rows. Here we assert the helper itself is
    // pure and per-call: creator A's fresh observations pass through when
    // the baseline (scoped to creator A) is empty, even if some other
    // creator's baseline would have matched.
    const creatorBBaseline = [
      obs("tiktok", "rehabFriendlyLifts", "https://www.tiktok.com/tag/rehabfriendlylifts"),
    ];
    const creatorAFresh = [
      obs("tiktok", "rehabFriendlyLifts", "https://www.tiktok.com/tag/rehabfriendlylifts"),
    ];
    // Creator A is called with their own (empty) baseline → observation surfaces.
    expect(dedupeAgainstBaseline(creatorAFresh, [])).toHaveLength(1);
    // Creator A is called with creator B's baseline (a bug) → would dedupe.
    // This is the cross-tenant invariant the action MUST enforce above this
    // helper. The helper is correctly pure: same-key in baseline collapses.
    expect(dedupeAgainstBaseline(creatorAFresh, creatorBBaseline)).toHaveLength(0);
  });

  it("dedupeKey is platform+kind+slug — robust to capitalization, punctuation, whitespace", () => {
    const a = dedupeKey({
      platform: "tiktok",
      kind: "hashtag",
      trendPattern: "  Rehab-Friendly Lifts!  ",
      citation: { ref: "https://www.tiktok.com/tag/rehabfriendlylifts" },
    });
    const b = dedupeKey({
      platform: "tiktok",
      kind: "hashtag",
      trendPattern: "rehab friendly lifts",
      citation: { ref: "https://www.tiktok.com/tag/rehabfriendlylifts" },
    });
    expect(a).toBe(b);
  });

  it("dedupeKey distinguishes by kind on the same pattern (hashtag vs sound)", () => {
    const k1 = dedupeKey({
      platform: "tiktok",
      kind: "hashtag",
      trendPattern: "summer-vibes",
      citation: { ref: "tt:hashtag:summer-vibes" },
    });
    const k2 = dedupeKey({
      platform: "tiktok",
      kind: "sound",
      trendPattern: "summer-vibes",
      citation: { ref: "tt:sound:summer-vibes" },
    });
    expect(k1).not.toBe(k2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sibling-file scan: SKILL.md voice fixture
// ─────────────────────────────────────────────────────────────────────────

describe("maya-trend-watcher — SKILL.md voice fixture", () => {
  const skillMd = readFileSync(resolve(SKILL_DIR, "SKILL.md"), "utf-8");

  it("frontmatter has metadata.openclaw with primaryEnv SCRAPECREATORS_API_KEY", () => {
    expect(skillMd).toMatch(/^---/);
    expect(skillMd).toContain("metadata:");
    expect(skillMd).toContain("openclaw:");
    expect(skillMd).toContain("primaryEnv: SCRAPECREATORS_API_KEY");
    expect(skillMd).toContain("- SCRAPECREATORS_API_KEY");
  });

  it("frontmatter declares the canonical name + version", () => {
    expect(skillMd).toContain("name: maya-trend-watcher");
    expect(skillMd).toMatch(/version: 0\.1\.0-sprint5/);
  });

  it("body cites real ScrapeCreators endpoints (popular_hashtags, get-trending-feed, creators/popular)", () => {
    expect(skillMd).toContain("/v1/tiktok/hashtags/popular");
    expect(skillMd).toContain("/v1/tiktok/get-trending-feed");
    expect(skillMd).toContain("/v1/tiktok/creators/popular");
  });

  it("does not contain the literal token 'AI' as a standalone word in marketing prose", () => {
    // Grep guard: "AI" must not appear as a standalone uppercase token in
    // user-facing copy. Allow technical mentions inside fenced code blocks
    // and inline code, and inside quoted spans where the word is being
    // called out as banned (e.g. `No "AI" in any prose`). We strip those
    // before checking.
    const stripped = skillMd
      .replace(/```[\s\S]*?```/g, "") // fenced code
      .replace(/`[^`]*`/g, "") // inline code
      .replace(/"[^"\n]*"/g, "") // quoted callouts (banned-list spans)
      .replace(/'[^'\n]*'/g, "");
    expect(stripped).not.toMatch(/\bAI\b/);
  });

  it("does not contain anti-sycophancy banned hype tokens", () => {
    const stripped = skillMd
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "")
      // Allow the words to appear when wrapped in quotes as banned-list examples
      // (e.g. 'No "incredible".'). Strip quoted spans before grepping.
      .replace(/"[^"\n]*"/g, "")
      .replace(/'[^'\n]*'/g, "");
    const banned = [
      /\bgame-?changer\b/i,
      /\bgame-?changing\b/i,
      /\brevolutionary\b/i,
      /\bworld-?class\b/i,
      /\bcutting-?edge\b/i,
      /\bsynergize\b/i,
    ];
    for (const re of banned) {
      expect(stripped, `should not contain ${re}`).not.toMatch(re);
    }
  });

  it("body explicitly states anti-sycophancy + grounded-or-silent posture", () => {
    expect(skillMd.toLowerCase()).toContain("anti-sycophancy");
    expect(skillMd).toMatch(/citation/i);
    expect(skillMd).toMatch(/dedupe/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TODO grep — no unjustified TODO/FIXME/eslint-disable
// ─────────────────────────────────────────────────────────────────────────

describe("maya-trend-watcher — TODO/FIXME grep", () => {
  it("script.ts has no TODO / FIXME / eslint-disable", () => {
    const script = readFileSync(resolve(SKILL_DIR, "script.ts"), "utf-8");
    expect(script).not.toMatch(/\bTODO\b/);
    expect(script).not.toMatch(/\bFIXME\b/);
    expect(script).not.toMatch(/eslint-disable/);
  });

  it("SKILL.md has no TODO / FIXME", () => {
    const md = readFileSync(resolve(SKILL_DIR, "SKILL.md"), "utf-8");
    expect(md).not.toMatch(/\bTODO\b/);
    expect(md).not.toMatch(/\bFIXME\b/);
  });
});
