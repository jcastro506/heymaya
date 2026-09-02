/**
 * The dossier contract (plan §14.1). Zod-validated at write time; the same shape
 * is handed to the model as the response schema. Every claim carries evidence.
 */
import { z } from "zod";

const claim = z.object({ claim: z.string().max(200), evidencePostIds: z.array(z.string()).min(1) });

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
    register: z.enum(["casual", "expert", "comic", "calm", "hype", "mixed"]),
    onCamera: z.enum(["face", "voice", "hands", "text", "mixed"]),
    whyTheyPost: z.string().max(200),
  }),
  themes: z.array(z.object({ label: z.string(), share: z.number().min(0).max(1), evidencePostIds: z.array(z.string()) })),
  interests: z.array(z.object({ label: z.string(), source: z.enum(["follows", "sounds", "linkInBio", "admired", "collections", "highlights", "stated"]), evidence: z.string().max(120) })),
  audience: z.object({ whoComments: z.string().max(200), asks: z.array(z.string()).max(5), arguesAbout: z.array(z.string()).max(3), evidencePostIds: z.array(z.string()) }),
  formatsUsed: z.array(z.object({ formatFingerprint: z.string(), label: z.string(), count: z.number(), medianMultiple: z.number(), evidencePostIds: z.array(z.string()) })),
  fingerprint: z.object({
    opening: z.enum(["text-first", "speech-first", "visual-first", "mixed", "unknown"]),
    medianCutSeconds: z.union([z.number(), z.literal("unknown")]),
    textStyle: z.string().max(120),
    settings: z.array(z.string()).max(5),
    energy: z.string().max(80),
    confidence: z.number().min(0).max(1),
  }),
  voice: z.object({ sampleLines: z.array(z.string()).max(5), avoid: z.array(z.string()).max(5) }),
  works: z.array(claim),
  doesNot: z.array(claim),
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
  "persona": {"summary": "≤400 chars", "register": "casual|expert|comic|calm|hype|mixed", "onCamera": "face|voice|hands|text|mixed", "whyTheyPost": "≤200 chars or 'unknown'"},
  "themes": [{"label": "", "share": 0.0, "evidencePostIds": [""]}],
  "interests": [{"label": "", "source": "follows|sounds|linkInBio|admired|collections|highlights|stated", "evidence": "≤120 chars"}],
  "audience": {"whoComments": "≤200", "asks": ["≤5"], "arguesAbout": ["≤3"], "evidencePostIds": [""]},
  "formatsUsed": [{"formatFingerprint": "", "label": "", "count": 0, "medianMultiple": 1.0, "evidencePostIds": [""]}],
  "fingerprint": {"opening": "text-first|speech-first|visual-first|mixed|unknown", "medianCutSeconds": 0, "textStyle": "≤120", "settings": ["≤5"], "energy": "≤80", "confidence": 0.0},
  "voice": {"sampleLines": ["≤5 real lines they said"], "avoid": ["≤5"]},
  "works": [{"claim": "≤200", "evidencePostIds": [">=1"]}],
  "doesNot": [{"claim": "≤200", "evidencePostIds": [">=1"]}],
  "triedAndAbandoned": [{"what": "≤120", "when": "YYYY-MM", "evidencePostIds": [""]}],
  "trajectory": {"postsPerWeekTrend": "up|flat|down|unknown", "viewsTrend": "up|flat|down|unknown", "breaks": [{"from": "YYYY-MM", "to": "YYYY-MM"}]},
  "cadence": {"postsPerWeek": 0, "filmingDays": [], "bestHoursLocal": []},
  "keywords": ["3-8 lane keywords"]
}`;
