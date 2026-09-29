/**
 * The profile's honesty is code, not a hope (2026-09-29): the real profiles on dev said "472x their
 * normal" from 2 of 10 posts, a 0-second median cut at 95% confidence, and "baseline" in a claim.
 * `honestDossier` runs on every write (first read, weekly rewrite, correction) through `parseDossier`.
 */
import { describe, expect, it } from "vitest";
import { DossierSchema, honestDossier, HONEST, type Dossier } from "../dossier";
import { parseDossier } from "../../onboarding/ingest";

const base: Dossier = DossierSchema.parse({
  version: 1, rewrittenAt: "x", readFrom: { tiktokPosts: 10, instagramPosts: 0, transcripts: 3, watched: 8, sampledFromHistory: false },
  persona: { summary: "Runner who films hill repeats, beating her baseline most weeks", register: "casual", onCamera: "face", whyTheyPost: "w" },
  themes: [], interests: [], audience: { whoComments: "unknown", asks: [], arguesAbout: [], evidencePostIds: [] },
  formatsUsed: [
    { formatFingerprint: "meme", label: "Relatable running meme", count: 2, medianMultiple: 472.48, evidencePostIds: ["a", "b"] },
    { formatFingerprint: "vlog", label: "Walking vlog", count: 4, medianMultiple: 0.93, evidencePostIds: ["c", "d", "e", "f"] },
    { formatFingerprint: "pov", label: "Travel POV", count: 5, medianMultiple: 120, evidencePostIds: ["g"] },
  ],
  fingerprint: { opening: "text-first", medianCutSeconds: 0, textStyle: "", settings: [], energy: "steady", confidence: 0.95 },
  voice: { sampleLines: [], avoid: [] },
  works: [
    { claim: "Self-deprecating overlays go massively viral above baseline", evidencePostIds: ["a"] },
    { claim: "Short candid clips beat long vlogs", evidencePostIds: ["a", "b", "c"] },
    { claim: "Two ids that are the same post", evidencePostIds: ["a", "a"] },
  ],
  doesNot: [{ claim: "Long packing vlogs underperform", evidencePostIds: ["c", "d"] }],
  triedAndAbandoned: [], trajectory: { postsPerWeekTrend: "unknown", viewsTrend: "unknown", breaks: [] },
  cadence: { postsPerWeek: 3, filmingDays: [], bestHoursLocal: [] }, keywords: ["running"], mode: "thin",
});

describe("honestDossier", () => {
  const h = honestDossier(base, { postsRead: 10, watched: 8 });

  it("no multiple from under three posts, and none that big from any number", () => {
    expect(h.formatsUsed.map((f) => f.medianMultiple)).toEqual([null, 0.93, null]);
    expect(h.formatsUsed).toHaveLength(3); // the format itself is still a fact about them
  });

  it("a claim needs two different posts behind it; the rest are dropped", () => {
    expect(h.works.map((w) => w.claim)).toEqual(["Short candid clips beat long vlogs"]);
    expect(h.doesNot).toHaveLength(1);
  });

  it("with fewer than five posts read, there are no claims at all", () => {
    const thin = honestDossier(base, { postsRead: HONEST.minPostsForClaims - 1, watched: 8 });
    expect(thin.works).toEqual([]);
    expect(thin.doesNot).toEqual([]);
  });

  it("a zero cut is unknown, and confidence can't outrun what she watched", () => {
    expect(h.fingerprint.medianCutSeconds).toBe("unknown");
    expect(h.fingerprint.confidence).toBe(0.95);
    expect(honestDossier(base, { postsRead: 10, watched: 1 }).fingerprint.confidence).toBe(0.3);
    expect(honestDossier(base, { postsRead: 10, watched: 3 }).fingerprint.confidence).toBe(0.6);
    const watchedCut = honestDossier({ ...base, fingerprint: { ...base.fingerprint, medianCutSeconds: 2.4 } }, { postsRead: 10, watched: 0 });
    expect(watchedCut.fingerprint.medianCutSeconds, "a cut length needs watched posts").toBe("unknown");
  });

  it("the words a person reads are plain: never baseline", () => {
    const all = JSON.stringify([h.persona.summary, h.works, h.doesNot, h.formatsUsed.map((f) => f.label)]);
    expect(all).not.toMatch(/baseline/i);
    expect(h.persona.summary).toMatch(/beating her normal/);
  });

  it("runs on every write: parseDossier returns the honest version", () => {
    const { version: _v, rewrittenAt: _r, readFrom: _f, mode: _m, ...fromModel } = base;
    const r = parseDossier(JSON.stringify(fromModel), { readFrom: base.readFrom, mode: "thin" });
    expect(r.ok).toBe(true);
    const d = (r as { dossier: Dossier }).dossier;
    expect(d.formatsUsed[0].medianMultiple).toBeNull();
    expect(d.fingerprint.medianCutSeconds).toBe("unknown");
    expect(d.works).toHaveLength(1);
  });
});
