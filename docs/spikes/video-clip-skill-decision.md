# Video clip composition skill — install-first decision (Wave C.6, 2026-04-27)

## Rule applied

Per `feedback_install_first_not_build.md` (operator-stated rule, twice on
2026-04-27): **don't author video pipeline code from scratch when an
installable skill exists**. The Maya `clip-composer` wrapper owns
**judgment** (which clips, what hook, what aspect ratio per platform, what
max-duration); the installed skill owns **mechanics** (cut/trim/merge,
aspect-ratio rescale, audio overlay, captions).

## Searches performed

1. `GET https://clawhub.ai/api/v1/search?q=ffmpeg+video+editor` — top 5
2. `GET https://clawhub.ai/api/v1/search?q=video+composition+social` — top 5
3. `GET https://clawhub.ai/api/v1/search?q=video+reel+aspect+ratio` — top 10
4. `GET https://clawhub.ai/api/v1/search?q=ffmpeg-video-editor` (detail)
5. `GET https://clawhub.ai/api/v1/skills/{slug}` for `ffmpeg-video-editor`,
   `video-stitcher`, `social-video-resizer`, `ffmpeg-cli`
6. `awesome-openclaw-skills` curated index — `image-and-video-generation.md`
7. `github.com/digitalsamba/claude-code-video-toolkit` — repo structure +
   skills directory + LICENSE

OpenClaw native tools (`video_generate`, `image_generate`, `music_generate`)
are first-class on 2026.4.5+ (we run 2026.4.23). They are reserved for
**net-new generative content**; this skill **edits operator footage**, so
they are not the right primitive.

## Top three candidates evaluated

| Candidate | License | Maturity | Capability fit | Moderation | Notes |
|---|---|---|---|---|---|
| `clawhub:ffmpeg-video-editor` (mahmoudadelbghany) | unspecified | 11,238 dl, 96 active installs, 17 stars | cut + trim + aspect + extract — no concat, no captions | clean | License unstated → unsafe to vendor |
| `clawhub:video-stitcher` (oliviapp8) | MIT-0 | 344 dl, 1 install | concat + transitions + BGM + captions | **suspicious.llm_suspicious** | Moderation flag is disqualifying |
| `clawhub:ffmpeg-cli` (ascendswang) | unspecified | 5,273 dl, 35 installs | cut/merge/extract/thumbs/gifs/subtitles/watermarks | **suspicious.vt_suspicious** | Disqualifying |
| `digitalsamba/claude-code-video-toolkit` `.claude/skills/ffmpeg` | **MIT** | v0.15.0 (Apr 21 2026), commercial maintainer (Digital Samba), full skills dir (acestep / elevenlabs / ffmpeg / moviepy / remotion / playwright-recording / qwen-edit / runpod) | concat + aspect + audio + captions + transitions via ffmpeg + moviepy + Remotion delegation | clean (known-good repo) | Best fit |

## Decision (REVISED 2026-04-27 — third operator correction)

**Adopt a ClawHub-installed cloud video composer skill, downloaded by OpenClaw at runtime. Specific skill ID set at deploy via `maya-skill-installer` on operator approval.**

Top candidates:
1. `vcarolxhberger/free-video-generator-capcut` (community wrapper for NemoVideo backend)
2. NemoVideo first-party publish (`nemovideo/nemovideo_skills`)

Both call the same cloud API at `https://mega-api-prod.nemovideo.ai`. Free tier: 100 credits / 7 days for anonymous tokens. Output: 1080p MP4, H.264, up to 1080×1920. Cloud-rendered, no local compute, no ffmpeg-on-Fly install dep.

### Why the original Wave C.6 vendor decision was reversed

The original decision below adopted `digitalsamba/claude-code-video-toolkit` `.claude/skills/ffmpeg/` v0.15.0, vendored at `agents/skills/installed/ffmpeg/`. This violated two operator-stated rules — the second one stated *after* this decision was made:

1. **No vendoring of low-level binaries / tooling** (operator rule, 2026-04-27 third correction): "We shouldn't be installing FFM peg or whatever, like nothing weird like that, okay? OpenClaw is great because it could just download skills, and then all of a sudden it's an expert on that workflow."
2. **Climb up the skill stack to the highest-level fit, not the first hit at the lowest layer.** The original Phase 0 search stopped at "ffmpeg skill" candidates. ClawHub also has higher-level cloud-rendered video-editor skills (NemoVideo / CapCut family) that replace BOTH the vendored ffmpeg skill AND most of the custom judgment wrapper's deterministic-fallback code.

The reversal also drops a Tier-4 operator-blocked dep entirely: `apt-get install -y ffmpeg && pip install moviepy` on per-business Fly machine boot is no longer needed.

### What stayed unchanged after the reversal

- **Maya owns judgment** (which clips, hook at second 0, aspect ratio per platform, max duration, music vibe, caption overlay). Cloud composer owns mechanics. Same wrapper-vs-mechanics split as before.
- **Test seam pattern** (`CloudVideoComposerInvoker` injectable; deterministic fallback for tests) — same shape, different name. The pattern survives a vendor swap.
- **Studio-only initial gate** via `planFeaturesService(business).mayaVideoEditing`.
- **Graceful degrade** when no cloud composer is reachable: `enqueuedForRender: false` + clear rationale, surfaced as a maya-skill-installer install opportunity.

### Original Wave C.6 decision (PRESERVED for history; SUPERSEDED by the above)

> **Adopt the `ffmpeg` skill from `digitalsamba/claude-code-video-toolkit`, pinned to v0.15.0.** Rationale: only candidate with clearly compatible license (MIT), recent commit activity (Apr 21 2026), and a commercial maintainer behind it. Vendor at `agents/skills/installed/ffmpeg/`; operator installs `ffmpeg + moviepy` on Fly machine boot.

This decision was reversed before any actual files were vendored on disk — the C.6 wave wrote the wrapper as-if vendoring had happened but the `agents/skills/installed/ffmpeg/` directory was never created. The reversal is therefore a doc-and-comment update, not a file-removal cleanup.

## What the wrapper (`maya-service-clip-composer`) owns vs delegates

**Wrapper (judgment):**

- Which subset of `mediaAssets` videos to keep (newest, highest visualQuality,
  matching `serviceCategory`).
- Order of clips (hook at second 0).
- Aspect ratio per platform (GBP 16:9, IG Reel 9:16, TikTok 9:16, FB
  landscape 16:9).
- Max duration per platform (Reel ≤ 90s; TikTok ≤ 60s; GBP ≤ 30s).
- Music vibe / no-music decision (mirrors brand voice).
- Caption overlay text (drawn from `gbpPosts.text` already approved).
- Plan-tier gate (Studio-only).
- `mediaAssets.editPlan` write + `derivedFromAssetIds` lineage.
- `gbpPosts` row creation with `status="pending"`.
- Async render dispatch via `services/video-synth-worker/`.

**Cloud video composer skill (mechanics, post-revision):**

- Upload clips/images via the composer's `/api/upload-video` endpoint
- Compose via the composer's natural-language session (clip cuts, ordering, aspect-ratio rescale, audio overlay, caption burn-in)
- Cloud-side render (GPU-backed); 30-90s typical job duration
- Returns 1080p MP4 download URL on completion
- All compute remote — no Fly machine compute consumed, no ffmpeg/moviepy/imagemagick install dep

## Fallback if Phase 0 had turned up nothing usable

(Unused — the Digital Samba toolkit fits.) The intended fallback would have
been to **stop and surface the gap to the operator** rather than custom-
authoring ffmpeg pipeline code in a Wave C.6 sandbox session. The
install-first rule is firm.
