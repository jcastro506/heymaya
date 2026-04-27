# heymaya-video-synth-worker

Tiny Fly worker that downloads creator post videos via `yt-dlp` and runs the
multimodal creator-picture synthesis through Google's Gemini Files API
directly. It replaces the OpenRouter text-only embedding path that doesn't
actually let Gemini watch videos.

## Why this exists

The Convex synthesis pipeline (`convex/onboarding/maya/synthesizeCreatorPicture.ts`)
needs Gemini to WATCH the creator's top-engagement and bottom-engagement
videos to ground hook patterns in actual visual evidence. OpenRouter doesn't
proxy multimodal video uploads, so we route the synthesis call through this
worker instead. The worker:

1. Receives a per-creator request from Convex (HMAC bearer auth)
2. Downloads `kind:"video"` posts via `yt-dlp` (parallel, capped at 5)
3. Uploads each to Gemini Files API, polls until ACTIVE
4. Makes ONE `generateContent` call with all video file refs + the synthesis
   system prompt + the per-creator user payload (already includes
   `kind:"text-context"` posts as plain text)
5. Returns the raw model JSON to Convex for parsing + validation

The worker is a dumb pipe. The canonical synthesis prompt lives in
`convex/onboarding/maya/synthesizeCreatorPicture.ts::SYNTH_SYSTEM_PROMPT`
and is sent over the wire on every request.

## Architecture rules

- **Cross-tenant safety lives upstream.** The worker trusts the `creatorId`
  in the request body ONLY because the bearer match proves the call came
  from our Convex deployment. The Convex action that calls the worker
  re-resolves the creator from Clerk identity FIRST.
- **Scalable.** Single shared multi-tenant Fly machine with auto-stop. v0
  caps concurrency at 4 requests; bump `fly.toml::http_service.concurrency`
  when real load lands.
- **Cleanup discipline.** Every downloaded temp file is removed in a
  `finally` block; the tmp dir is also swept of files >10min old at the end
  of each request.

## One-time deploy

```bash
cd services/video-synth-worker

# Generate the Fly app + push the first deploy.
fly launch --no-deploy           # interactive: name "heymaya-video-synth", region iad

# Set the two required secrets:
fly secrets set \
  WORKER_SHARED_SECRET="$(node -e 'console.log(crypto.randomBytes(32).toString(\"hex\"))')" \
  GOOGLE_GENAI_API_KEY="..."     # from https://aistudio.google.com/

# Deploy.
fly deploy

# Smoke-test:
curl -fsS https://heymaya-video-synth.fly.dev/health
```

Then on the **Convex** side, set the matching env so the client can sign
requests:

```bash
# WORKER_SHARED_SECRET must match the value set on Fly.
npx convex env set WORKER_SHARED_SECRET "<same hex>"
npx convex env set VIDEO_SYNTH_WORKER_URL "https://heymaya-video-synth.fly.dev"
# Flip the feature flag once you've verified the worker's /health passes.
npx convex env set USE_VIDEO_SYNTH_WORKER true
```

## Cost envelope

Per synthesis call the worker side costs:

- **Fly machine:** auto-stop on idle. Cold start is ~5s of `shared-cpu-1x`.
  At Fly's $0.0000022/sec for shared-cpu-1x + 1GB RAM, a 60s synthesis call
  is ~$0.00013, plus negligible bandwidth (videos are downloaded then
  uploaded to Gemini once each). Round to ~$0.001.
- **Gemini Files API:** uploads are free; storage is free for the first 48h.
  We delete files locally and don't proactively delete from Gemini (they
  expire on their own).
- **Gemini generateContent:** 30 min of video × ~250 tokens/sec = ~450K input
  tokens × $0.50/MTok = $0.225. Plus ~5K text prompt + ~55K thinking output
  × $3.00/MTok ≈ $0.18. **Total Gemini cost ≈ $0.40 per synthesis.**

The brief's "$0.01 per synthesis" estimate covered Fly auto-stop wake costs
ONLY — Gemini token spend dominates. Net per-creator onboarding cost is
unchanged from the prior OpenRouter path (which was $0.40 too — same model,
same thinking budget); this worker just makes the multimodal frames actually
land in Gemini's input.

## Failure modes

| Mode | Behavior |
|---|---|
| `yt-dlp` download timeout (60s) | Post skipped, surfaced in `diagnostics.skippedVideos`. Synthesis still runs with the remaining videos + text-only fallback for the skipped one. |
| TikTok photo/slideshow URL | Detected at the source via `/photo/` URL pattern. Skipped; same fallback. |
| Instagram age-restricted / login-walled | yt-dlp fails; post skipped. v0 has no cookie wiring — operator will see the skipped count in `aiCallLog`. |
| YouTube long-form > 30 min | Already pre-batched out of `kind:"video"` upstream by `videoBatching.ts`; the worker never sees it. |
| Gemini Files API processing timeout (30s/file) | File skipped from the multimodal batch. Synthesis still runs without it. |
| Gemini `generateContent` timeout (120s default; clamped to remaining request budget) | `{ok:false, error:{code:"gemini-failure"}}` returned to Convex; synthesis throws and deploy halts cleanly with retryable=true. |
| Worker request budget exceeded (5 min total) | `{ok:false, error:{code:"internal"}}` with diagnostics. Convex retries once. |
| Missing `WORKER_SHARED_SECRET` on the worker | Server refuses to boot in production (`NODE_ENV=production`). |
| Missing `GOOGLE_GENAI_API_KEY` on the worker | Each synthesize call returns 503 with `{code:"gemini-init"}`. Convex falls back to OpenRouter when the feature flag is off. |
| Wrong/missing bearer | 401 with `{code:"invalid-bearer"|"missing-bearer"}`, no body parsed. |

## Local development

```bash
cd services/video-synth-worker
npm install
WORKER_SHARED_SECRET=devsecret \
GOOGLE_GENAI_API_KEY=... \
npm run dev
```

`npm test` runs the worker's vitest suite against the mocked Gemini client
and a fake `yt-dlp` exec. No real downloads or Gemini calls are made.

## Operator action checklist

See `services/video-synth-worker/__tests__/server.test.ts` for the full
contract tested. To go live:

1. `fly launch --no-deploy` → app named `heymaya-video-synth`, region `iad`
2. Set `WORKER_SHARED_SECRET` (random 32-byte hex) and `GOOGLE_GENAI_API_KEY`
3. `fly deploy`
4. On Convex: `WORKER_SHARED_SECRET` (same hex), `VIDEO_SYNTH_WORKER_URL`,
   `USE_VIDEO_SYNTH_WORKER=true`
5. Run a real-creator onboarding end-to-end and confirm
   `aiCallLog.taskTag = "creator_picture_synthesis"` rows include the model
   field `gemini-3-flash` (worker path) instead of `google/gemini-3-flash`
   (OpenRouter path)
