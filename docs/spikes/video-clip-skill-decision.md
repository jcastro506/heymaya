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

## Decision

**Adopt the `ffmpeg` skill from `digitalsamba/claude-code-video-toolkit`,
pinned to v0.15.0.**

Rationale (2 lines):

1. Only candidate with a clearly compatible license (MIT), recent commit
   activity (Apr 21 2026), and a commercial maintainer behind it — the two
   purpose-built ClawHub candidates each carry suspicious-moderation
   verdicts and the third (`ffmpeg-video-editor`) lacks any license at all.
2. Capability surface matches our needs end-to-end: concat / aspect-ratio
   rescale / audio overlay / captions / transitions are all in the
   toolkit's documented skills directory, with Remotion available as a
   richer composition fallback if a future arc needs it.

## Vendoring strategy

- We do NOT clone the full toolkit (it pulls in Remotion + Playwright +
  RunPod — heavy, not all relevant).
- We vendor only `digitalsamba/claude-code-video-toolkit/.claude/skills/ffmpeg/`
  into `agents/skills/installed/ffmpeg/` at the v0.15.0 git ref.
- Add a sibling `LICENSE` copy + a top-of-folder `VENDORED.md` with
  upstream URL + ref + the script path the wrapper invokes.
- Operator action: install `ffmpeg` + `moviepy` (Python) on the per-business
  Fly machine boot — `apt-get install -y ffmpeg && pip install moviepy` in
  the workspace bundle deploy script. (Operator-blocked item: Wave D
  picks this up alongside the `voice-call` plugin install ordering; not
  our wave's responsibility to ship, but documented.)
- Wrapper invokes via OpenClaw's skill-invocation mechanism — Maya emits a
  `Skill("installed/ffmpeg", { op: "concat" | "rescale" | "overlay" | ... })`
  call, not a direct ffmpeg shell-out.

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

**Installed skill (mechanics):**

- ffmpeg invocation + flag composition.
- Stream cuts + concat without re-encode where possible.
- Aspect-ratio rescale (`scale=...,pad=...`).
- Audio overlay (`-i music.mp3 -filter_complex amix`).
- Caption burn-in (`drawtext` filter).
- Container muxing.

## Fallback if Phase 0 had turned up nothing usable

(Unused — the Digital Samba toolkit fits.) The intended fallback would have
been to **stop and surface the gap to the operator** rather than custom-
authoring ffmpeg pipeline code in a Wave C.6 sandbox session. The
install-first rule is firm.
