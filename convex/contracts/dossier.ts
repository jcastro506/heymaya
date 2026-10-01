/**
 * The dossier contract (plan §14.1). Zod-validated at write time; the same shape
 * is handed to the model as the response schema. Every claim carries evidence.
 */
import { z } from "zod";
import { checkPlainLanguage } from "../core/plainLanguage";

const claim = z.object({ claim: z.string().max(200), evidencePostIds: z.array(z.string()).min(1) });
/**
 * Why something worked (operator, 2026-10-01): a concert post that blew up is not a plan unless they
 * are at concerts all the time. "skill" travels anywhere (their delivery, timing, editing, storytelling,
 * a format they own); "routine" is their real life on repeat (a city they live in, a weekly class);
 * "circumstance" is a one-off (a trip, an event, a trend wave, a collab, luck).
 */
const DRIVER = z.enum(["skill", "routine", "circumstance"]);
const worksClaim = claim.extend({ driver: DRIVER.optional(), travels: z.string().max(160).optional() });

export const DossierSchema = z.object({
  version: z.number(),
  rewrittenAt: z.string(),
  readFrom: z.object({
    tiktokPosts: z.number(),
    instagramPosts: z.number(),
    transcripts: z.number(),
    watched: z.number(),
    sampledFromHistory: z.boolean(),
  }),
  persona: z.object({
    summary: z.string().max(400),
    register: z.enum(["casual", "expert", "comic", "calm", "hype", "mixed", "unknown"]),
    onCamera: z.enum(["face", "voice", "hands", "text", "mixed", "unknown"]),
    whyTheyPost: z.string().max(200),
    // 2026-09-07: the person, the way a friend who watched everything would put it. From the
    // watched cards' "them" blocks only; absent when the cards are silent. Never age, ethnicity,
    // body or health.
    look: z.string().max(200).optional(),
    voice: z.string().max(200).optional(),
    humor: z.string().max(160).optional(),
    presence: z.string().max(160).optional(),
    world: z.string().max(200).optional(),
    cares: z.string().max(160).optional(),
  }),
  themes: z.array(z.object({ label: z.string(), share: z.number().min(0).max(1), evidencePostIds: z.array(z.string()) })),
  interests: z.array(z.object({ label: z.string(), source: z.enum(["follows", "sounds", "linkInBio", "admired", "collections", "highlights", "stated", "posts", "captions", "transcripts"]), evidence: z.string().max(120) })),
  audience: z.object({ whoComments: z.string().max(200), asks: z.array(z.string()).max(5), arguesAbout: z.array(z.string()).max(3), evidencePostIds: z.array(z.string()) }),
  formatsUsed: z.array(z.object({ formatFingerprint: z.string(), label: z.string(), count: z.number(), medianMultiple: z.number().nullable(), evidencePostIds: z.array(z.string()) })),
  fingerprint: z.object({
    opening: z.enum(["text-first", "speech-first", "visual-first", "mixed", "unknown"]),
    medianCutSeconds: z.union([z.number(), z.literal("unknown")]),
    textStyle: z.string().max(120),
    settings: z.array(z.string()).max(5),
    energy: z.string().max(80),
    confidence: z.number().min(0).max(1),
  }),
  voice: z.object({ sampleLines: z.array(z.string()).max(5), avoid: z.array(z.string()).max(5) }),
  works: z.array(worksClaim),
  doesNot: z.array(claim),
  /** What they're good at wherever they are: the thing a plan is built on. */
  strengths: z.array(z.object({ skill: z.string().max(120), how: z.string().max(160), evidencePostIds: z.array(z.string()).min(1) })).max(4).optional(),
  /** Outliers explained: why it did well, and the part of it that carries to an ordinary day. */
  oneOffs: z.array(z.object({ postId: z.string(), why: z.string().max(160), travels: z.string().max(160) })).max(4).optional(),
  triedAndAbandoned: z.array(z.object({ what: z.string().max(120), when: z.string(), evidencePostIds: z.array(z.string()) })),
  trajectory: z.object({
    postsPerWeekTrend: z.enum(["up", "flat", "down", "unknown"]),
    viewsTrend: z.enum(["up", "flat", "down", "unknown"]),
    breaks: z.array(z.object({ from: z.string(), to: z.string() })),
  }),
  cadence: z.object({ postsPerWeek: z.number(), filmingDays: z.array(z.string()), bestHoursLocal: z.array(z.number()) }),
  keywords: z.array(z.string()),
  mode: z.enum(["full", "thin", "newCreator"]),
});

export type Dossier = z.infer<typeof DossierSchema>;

/** The JSON schema handed to the model (a loose mirror; Zod is the gate). */
export const DOSSIER_JSON_SHAPE = `{
  "persona": {"summary": "≤400 chars", "register": "casual|expert|comic|calm|hype|mixed|unknown", "onCamera": "face|voice|hands|text|mixed|unknown (unknown when you only have captions and transcripts)", "whyTheyPost": "≤200 chars or 'unknown'", "look": "≤200 optional, from the cards' them blocks only", "voice": "≤200 optional", "humor": "≤160 optional", "presence": "≤160 optional", "world": "≤200 optional", "cares": "≤160 optional"},
  "themes": [{"label": "", "share": 0.0, "evidencePostIds": [""]}],
  "interests": [{"label": "", "source": "follows|sounds|linkInBio|admired|collections|highlights|stated", "evidence": "≤120 chars"}],
  "audience": {"whoComments": "≤200", "asks": ["≤5"], "arguesAbout": ["≤3"], "evidencePostIds": [""]},
  "formatsUsed": [{"formatFingerprint": "", "label": "", "count": 0, "medianMultiple": "1.0, or null under 3 posts", "evidencePostIds": [""]}],
  "fingerprint": {"opening": "text-first|speech-first|visual-first|mixed|unknown", "medianCutSeconds": "a number of seconds from watched cards, or \"unknown\"", "textStyle": "≤120", "settings": ["≤5"], "energy": "≤80", "confidence": 0.0},
  "voice": {"sampleLines": ["≤5 real lines they said"], "avoid": ["≤5"]},
  "works": [{"claim": "≤200", "evidencePostIds": [">=2"], "driver": "skill|routine|circumstance", "travels": "≤160, the part they can repeat on an ordinary day"}],
  "strengths": [{"skill": "≤120, what they're good at wherever they are: talking to camera, comic timing, editing pace, storytelling, a format they own", "how": "≤160, what it looks like in their posts", "evidencePostIds": [">=2"]}],
  "oneOffs": [{"postId": "", "why": "≤160, what drove it: a trip, an event, a trend wave, a collab, a lucky moment", "travels": "≤160, the part that carries to an ordinary day, or 'nothing'"}],
  "doesNot": [{"claim": "≤200", "evidencePostIds": [">=1"]}],
  "triedAndAbandoned": [{"what": "≤120", "when": "YYYY-MM", "evidencePostIds": [""]}],
  "trajectory": {"postsPerWeekTrend": "up|flat|down|unknown", "viewsTrend": "up|flat|down|unknown", "breaks": [{"from": "YYYY-MM", "to": "YYYY-MM"}]},
  "cadence": {"postsPerWeek": 0, "filmingDays": [], "bestHoursLocal": []},
  "keywords": ["3-8 lane keywords"]
}`;

/**
 * What code guarantees about a profile, whatever the model wrote (2026-09-29 audit of real profiles:
 * "472x their normal" from 2 of 10 posts, a 0-second median cut at 95% confidence, "baseline" in a
 * claim). Applied to every write: the first read, the weekly rewrite and every correction. Pure.
 */
export const HONEST = { minPostsForClaims: 5, minEvidenceForClaim: 2, minPostsForMultiple: 3, maxQuotedMultiple: 50, minPostsForRoutine: 3, maxStrengths: 3 } as const;

const clipTo = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function honestDossier(d: Dossier, facts: { postsRead: number; watched: number }): Dossier {
  const plain = (t: string) => checkPlainLanguage(t.replace(/\bbaselines?\b/gi, "normal")).clean;
  const claims = (list: Dossier["works"]) =>
    facts.postsRead < HONEST.minPostsForClaims ? [] : list.filter((c) => new Set(c.evidencePostIds).size >= HONEST.minEvidenceForClaim).map((c) => ({ ...c, claim: plain(c.claim) }));
  const cut = d.fingerprint.medianCutSeconds;
  const ceiling = facts.watched >= 5 ? 1 : facts.watched >= 2 ? 0.6 : 0.3;
  return {
    ...d,
    persona: { ...d.persona, summary: plain(d.persona.summary) },
    formatsUsed: d.formatsUsed.map((f) => ({
      ...f,
      label: plain(f.label),
      medianMultiple: f.count < HONEST.minPostsForMultiple || f.medianMultiple === null || f.medianMultiple > HONEST.maxQuotedMultiple ? null : f.medianMultiple,
    })),
    fingerprint: {
      ...d.fingerprint,
      medianCutSeconds: typeof cut === "number" && cut > 0 && facts.watched > 0 ? cut : "unknown",
      confidence: Math.min(d.fingerprint.confidence, ceiling),
    },
    // A one-off is never "what works": it's explained in oneOffs. A "routine" needs the setting in
    // at least three posts, or it is a one-off too (a single trip is not their life).
    works: claims(d.works).filter((c) => c.driver !== "circumstance" && !(c.driver === "routine" && new Set(c.evidencePostIds).size < HONEST.minPostsForRoutine)),
    doesNot: claims(d.doesNot),
    strengths: facts.postsRead < HONEST.minPostsForClaims ? [] : (d.strengths ?? []).filter((x) => new Set(x.evidencePostIds).size >= HONEST.minEvidenceForClaim).slice(0, HONEST.maxStrengths).map((x) => ({ ...x, skill: plain(x.skill), how: plain(x.how) })),
    oneOffs: [
      ...(d.oneOffs ?? []),
      ...d.works.filter((c) => c.driver === "circumstance" || (c.driver === "routine" && new Set(c.evidencePostIds).size < HONEST.minPostsForRoutine)).map((c) => ({ postId: c.evidencePostIds[0], why: clipTo(plain(c.claim), 160), travels: clipTo(plain(c.travels ?? "nothing"), 160) })),
    ].slice(0, 4),
  };
}
