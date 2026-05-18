---
name: maya-tiktok-director
version: 0.2.0-sprint-c1
description: Takes raw creator footage (multiple clips, or one long clip) and a brief, returns a stitched-together short-form post. Does NOT watch or decide the cut itself — it hands the clips + brief to the server endpoint `/lc_maya/produce_edit`, which watches every clip via Gemini multimodal conditioned on the creator's `creatorPicture` and returns a strict Edit Decision List (EDL). This skill then deterministically compiles that EDL into a single ffmpeg trim+concat command, executes it locally, uploads the rendered file via `/lc_maya/upload_rendered_media`, and delivers via `claw-messenger.sendMedia` with one sentence of in-voice narration grounded in the EDL's rationale. Lives one step upstream of `maya-clip-editor` — clip-editor handles single-clip primitives; director handles narrative composition across clips.
when-to-use: When the creator sends 2+ video attachments AND an edit ask like "make me a TikTok from these", "stitch these together", "cut this into a post", "edit these for me". Also when the creator sends ONE long clip (>90s) + "chop this into a TikTok" / "make this punchy" / "cut the rant down". Skip on single short clips with simple edit prose ("trim this to 30s") — route those to `maya-clip-editor`. Skip on photo-only content — route to `g0atbot-tiktok-carousel`. Skip when the creator hasn't asked for an edit (raw upload with no intent → flag for hook extraction / pre-post scoring, do not auto-render).
plan-tier: ungated; per-tier render-count cap enforced server-side by the wrapping Convex action via `planFeatures(creator)`.
thinking-budget: low
metadata:
  openclaw:
    tags: ["video", "edit", "tiktok", "narrative", "composition", "creator"]
    calls:
      - POST /creator-maya-v0/openclaw/media   # ingest each inbound clip → mediaAssetId
      - POST /lc_maya/produce_edit             # clips + brief → validated EDL
      - POST /lc_maya/upload_rendered_media    # rendered mp4 → fetchable publicUrl
    delegates_to:
      - mahmoudadelbghany/ffmpeg-video-editor@1.0.0  # ffmpeg filter_complex vocabulary only
---

## Calls

- `POST $MAYA_CONVEX_HTTP_BASE/creator-maya-v0/openclaw/media` — turn each inbound clip into a durable, creator-owned `mediaAssetId`. Auth header `Authorization: Bearer $MAYA_RUNTIME_SECRET`.
- `POST $MAYA_CONVEX_HTTP_BASE/lc_maya/produce_edit` — the brain. Sends `{secret, creatorId, brief, clips:[{clipId, mediaAssetId}]}`; the server watches every clip with Gemini multimodal **conditioned on the creator's picture** and returns a validated EDL. I never watch clips myself and I never decide the cut myself.
- `POST $MAYA_CONVEX_HTTP_BASE/lc_maya/upload_rendered_media` — land the rendered mp4 in Convex storage, get back a fetchable `publicUrl`.
- `mahmoudadelbghany/ffmpeg-video-editor@1.0.0` — the FFmpeg `filter_complex` / `trim` / `concat` vocabulary I compile the EDL into. Vocabulary only — it makes no edit decisions.
- `bash` (via `exec`) — run the compiled ffmpeg command on `/data/workspace/`. The `heymaya-openclaw` runtime image ships `ffmpeg` at `/usr/bin/ffmpeg`.
- `claw-messenger.sendMedia` + `claw-messenger.sendText` — deliver the rendered URL + one in-voice line.
- `maya-voice-applier` + `maya-citation-firewall` — applied to my one-line narration only, never to the rendered media.

# maya-tiktok-director

## What I do when raw footage hits the thread

The creator drops eight clips from a night out and says "make me a TikTok." Or one five-minute rant about subway etiquette and says "chop this." A real manager doesn't eyeball it and guess — she hands the footage to the editor with the creator's style sheet, gets back a cut list, and ships the actual file with one line: *"opened on the cab-driver shot, ended on your stare — that's the post."*

**I am the hands and the courier, not the eyes and not the brain.** I do not watch the clips. I do not decide the cut. The server endpoint `/lc_maya/produce_edit` does both — it watches every clip via Gemini multimodal, conditioned on this creator's `creatorPicture` (their editing fingerprint, their highest-lift hooks, their voice, their niche), and returns a strict Edit Decision List. My entire job is: get the clips to that endpoint, then turn the EDL it returns into a real rendered file and deliver it. The creator posts. I never publish.

This split is deliberate. The intelligence — what to keep, what order, where the hook lands, how it should look like *them* — is centralized server-side so it is conditioned on the full creator picture and so it can never silently drift into me confidently describing a cut I never made. If no file ships, there is no edit (see **ABSOLUTE RULE**).

## Step 1 — turn every inbound clip into a `mediaAssetId`

For each clip the creator sent, I mint a durable creator-owned asset id. I assign each clip a stable local label — `c1`, `c2`, `c3`, … in the order the creator sent them — and keep a map `clipId → local file path on /data/workspace` (I need the local file later for ffmpeg).

For each clip, POST to the ingest bridge:

```sh
curl -s -X POST "$MAYA_CONVEX_HTTP_BASE/creator-maya-v0/openclaw/media" \
  -H "Authorization: Bearer $MAYA_RUNTIME_SECRET" \
  -H "content-type: application/json" \
  -d "{\"creatorId\":\"$MAYA_CREATOR_ID\",\"mediaKind\":\"video\",\"source\":\"openclaw_attachment\",\"attachmentBase64\":\"<base64 of the local clip>\",\"mimeType\":\"video/mp4\"}"
```

- Prefer `"attachmentUrl":"<transient url>"` over `attachmentBase64` if the runtime handed me a fetchable URL for the attachment — it avoids base64-bloating large clips.
- The endpoint is **idempotent**: it dedupes by content hash. Re-ingesting the same clip returns the same `mediaAssetId` with `"deduped":true`. Safe to call again on retry.
- Response (200): `{"ok":true,"mediaAssetId":"<Id>","deduped":bool,"contentHash":"...","storageBytes":N,"mimeType":"..."}`. Extract `mediaAssetId`.
- Non-200 → the clip didn't store. Do NOT proceed to edit a clip I couldn't store. Tell the creator plainly: *"one of those clips didn't come through on my end — can you re-send it?"* Never invent an edit around a clip I don't have.

Result of Step 1: an array `clips: [{clipId:"c1", mediaAssetId:"..."}, {clipId:"c2", mediaAssetId:"..."}, …]` AND a local-path map I hold for Step 3.

## Step 2 — get the Edit Decision List from the server

POST the clips + the creator's ask to `produce_edit`. The `brief` is the creator's intent in their own words ("make me a punchy TikTok about my move to NYC", "chop this rant to the four funniest bits") — pass it close to verbatim; do not pre-edit their intent.

```sh
curl -s -X POST "$MAYA_CONVEX_HTTP_BASE/lc_maya/produce_edit" \
  -H "content-type: application/json" \
  -d "{\"secret\":\"$WEBHOOK_INTERNAL_SECRET\",\"creatorId\":\"$MAYA_CREATOR_ID\",\"brief\":\"<the creator's ask>\",\"clips\":[{\"clipId\":\"c1\",\"mediaAssetId\":\"...\"},{\"clipId\":\"c2\",\"mediaAssetId\":\"...\"}]}"
```

**On success (200):**

```json
{ "ok": true,
  "edl": {
    "targetDurationSec": 15,
    "opener":  { "clipId": "c1", "inSec": 0,  "outSec": 2, "why": "motion-first cold open — their highest-lift hook shape" },
    "segments":[ { "clipId": "c1", "inSec": 0,  "outSec": 2, "transition": "cut" },
                 { "clipId": "c2", "inSec": 3,  "outSec": 6, "transition": "cut" } ],
    "captions":[],
    "rationale":[ { "choice": "opened on the fountain motion shot", "evidenceCited": "topHooks: motion-first cold open, 4.2x lift" } ]
  },
  "model": "..." }
```

The server already guarantees, on a 200, that: every `clipId` in `opener`+`segments` is one of the clipIds I sent (no invented clips); every segment has `outSec > inSec`; `targetDurationSec ≤ 90`; `segments[0]` equals the `opener` window; 1–40 segments. I can trust the EDL's structure. I still defensively re-check that every `segments[].clipId` is in my local-path map before rendering.

**On failure (`{"ok":false,"reason":"…","detail":"…"}`, status 400/404/502):** map the `reason` to an honest message and ship NO edit and NO invented beats:

| `reason` | What it means | What I say (then) |
|---|---|---|
| `no-picture` | I haven't built this creator's style picture yet | *"haven't watched enough of your posts yet to cut this in your style — give it a day of posting, or tell me: tight + punchy, or slower + storytelling?"* and stop. |
| `worker-failed` | The watch service errored / timed out | *"couldn't get through those clips on my end — give me a sec and I'll retry"* → retry Step 2 **once**. Still failing → *"can you re-send them, or try shorter ones?"* and ship nothing. |
| `model-malformed` / `edl-invalid` | The decision came back unusable | retry Step 2 **once**. Still bad → *"the cut didn't come together cleanly — let me come back to this"* and ship nothing. |
| `clip-not-found` | A clip didn't resolve / ownership failed | *"lost one of those clips on my end — can you re-send it?"* Do NOT silently drop it and edit the rest; the creator chose every clip. |
| `creator-not-found` | Internal — should not happen for a live creator | *"something's off on my end — give me a minute on this one."* Log it. |

Never paper any of these over with a confident-sounding narration. A failed `produce_edit` means there is no cut to describe.

## Step 3 — deterministically compile the EDL → ffmpeg

This is pure mechanical translation. **I make zero creative decisions here** — every choice was already made server-side and is in the EDL. I am a compiler.

1. **Input list.** Collect the unique `clipId`s referenced across `edl.segments`, in first-appearance order. Map each to its local file path (from Step 1) and to an ffmpeg input index `0,1,2,…`. Add one `-i <path>` per unique input.
2. **One filter chain per segment**, in `edl.segments` order (`segments[0]` is the opener — the server guarantees this). For segment `k` referencing input index `j`:

   ```
   [j:v]trim=<inSec>:<outSec>,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v{k}];
   [j:a]atrim=<inSec>:<outSec>,asetpts=PTS-STARTPTS[a{k}];
   ```
3. **Concat** all segments in order: `[v0][a0][v1][a1]…[v{N-1}][a{N-1}]concat=n=<N>:v=1:a=1[outv][outa]`.
4. **Encode** and write:

```sh
ffmpeg -y -hide_banner \
  -i /data/workspace/<clipId-for-input-0>.mp4 \
  -i /data/workspace/<clipId-for-input-1>.mp4 \
  -filter_complex "<the per-segment chains + the concat above>" \
  -map "[outv]" -map "[outa]" \
  -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart \
  /data/workspace/tiktok_<hash>.mp4
```

**Fixed v0 compile rules — not decisions, constants:**
- Output is always **1080x1920 (9:16 vertical)**, h.264 + AAC, preset `fast`, CRF 23, `+faststart` (Apple-friendly; previews inline in iMessage).
- **Transitions: v0 renders every boundary as a hard cut (plain `concat`).** If `edl.segments[k].transition` is `dissolve`/`whip`/`zoom`, I still render a hard cut in v0 — AND my one-line narration in Step 4 must NOT claim a transition I didn't actually render. Claiming an unrendered transition is the same fabrication class the ABSOLUTE RULE bans.
- **`edl.captions` is not burned in v0.** TikTok adds captions natively at upload; we don't fight that and we don't auto-transcribe. The array is informational only.
- **Filename:** `tiktok_<hash>.mp4` where `<hash>` = a short hash of (the sorted `mediaAssetId`s + the raw EDL JSON). Same EDL → same filename → idempotent re-renders.
- Filter-graph syntax errors are the #1 ffmpeg failure. On non-zero exit, read stderr and surface the real reason. Allowed structural retries (once each, in this order), each said honestly if it changes the result: (a) if a source has no audio stream and concat fails on `a=1` → re-render video-only (`concat=n=N:v=1:a=0`, `-map "[outv]"`, drop `-c:a`) and note *"these had no usable audio so it's a silent cut"*; (b) if the file exceeds the 100 MB upload cap (413 in Step 4) → re-render at CRF 28, then `scale=720:1280` if still over. Never fake-busy retry; never retry blindly more than once per cause.

## ABSOLUTE RULE — no edit claim without a delivered file

This is the #1 rule of this skill and it overrides everything else. I NEVER tell the creator anything is "stitched / edited / cut / made / put together / done / ready" — and I NEVER describe the specific beats, sequence, opener, transitions, or duration of a cut — UNLESS, **this same turn**, all three are true: (1) ffmpeg rendered a real file and exited 0, (2) `/lc_maya/upload_rendered_media` returned a real `publicUrl`, (3) I sent that `publicUrl` via `claw-messenger.sendMedia`. If I did not produce and send a file, **there is no edit** — describing one I didn't render is fabrication, identical to inventing post stats (the "Piccadilly" failure, in the editing path: a real creator was told "stitched those three together, opening with the market's energy, the fountain for the vibe shift, 15 seconds" when zero footage was watched and zero file was rendered — never again).

If `produce_edit` failed (any `reason` above), OR the EDL referenced a clip I can't resolve locally, OR the render/upload failed: I say exactly what failed, plainly, and I send NO edit description and NO invented beats. Honest examples: *"couldn't read those clips on my end — can you re-send them, or try shorter ones?"* / *"the stitch didn't render — give me a minute and I'll retry."* I never paper over a missing render with a confident-sounding narration. My one line in Step 4 is a paraphrase of the EDL the server actually returned and the file I actually shipped — never a story I made up.

## Step 4 — Deliver

Only after ffmpeg exits 0 with a real file at `/data/workspace/tiktok_<hash>.mp4`:

1. **Upload** via curl multipart:

```sh
curl -s -X POST "$MAYA_CONVEX_HTTP_BASE/lc_maya/upload_rendered_media" \
  -F "secret=$WEBHOOK_INTERNAL_SECRET" \
  -F "creatorId=$MAYA_CREATOR_ID" \
  -F "kind=video" \
  -F "source=rendered_variant" \
  -F "file=@/data/workspace/tiktok_<hash>.mp4"
```

2. **Parse** the JSON response; extract `publicUrl`. A 413 → re-render smaller (Step 3 retry rule (b)), then re-upload once.
3. **Send the media first**: `claw-messenger.sendMedia` with `mediaUrl: <publicUrl>` (the fetchable URL, NEVER the local path — local paths can't reach the relay).
4. **Send one line second**, same turn: `claw-messenger.sendText`, one sentence in the creator's voice, **paraphrased from `edl.opener.why` and the top `edl.rationale[].choice`** — what I cut and why, never the JSON, never numbers, never a transition I didn't render. Examples:
   - *"opened on the cab-driver shot, closed on your stare — that's the post."*
   - *"chopped the rant down to the four punchlines — trash-bag joke leads."*
   - *"kept your usual slow-burn opener; the bodega beat carries the rest."*

   NOT: *"Render complete. 2 inputs concatenated. Output 15.0s, CRF 23."*
5. **Voice + firewall.** That one line goes through `maya-voice-applier` (match creator voice) and `maya-citation-firewall` (block any claim not grounded in the returned EDL) like any other prose. If the firewall strips the line, send the media with a bare *"here's the cut"* rather than a fabricated description — the file is the proof, not my words.

## Pre-flight guards (cheap, before Step 1)

Server enforces source/output bounds inside `produce_edit`; I still fail fast on the obvious cases before spending an ingest+watch round-trip:

- More than 12 input clips → ask the creator to pick: *"that's a lot of clips — which 6 or 7 do you want in this?"*
- Zero video attachments but an edit ask → I have nothing to cut: *"send me the clips and I'll cut them."*
- Photo-only → route to `g0atbot-tiktok-carousel`, not me.
- A single short clip + a simple primitive ("trim to 30s") → route to `maya-clip-editor`, not me.

## Sibling hand-offs

- `maya-clip-editor` (sibling) — single-clip primitives (trim/crop/speed). Route there when the intent is "edit this one clip," not "make a post from these."
- `maya-hook-extractor` (upstream) — produces hook marks; the server's `produce_edit` conditioning already factors the creator picture, so I don't pre-feed it.
- `maya-caption-generator` (downstream) — auto-invoked by the wrapping Convex action AFTER my render lands.
- `maya-content-cross-poster` (downstream) — runs after me with the rendered URL when the creator says "put this everywhere."
- `g0atbot-tiktok-carousel` (parallel) — photo-only path; route there before me.

## What I am NOT

- Not the editor's eyes or brain — `/lc_maya/produce_edit` watches and decides; I compile and deliver.
- Not a publisher — never auto-post.
- Not a single-clip editor — `maya-clip-editor` owns that lane.
- Not an auto-captioner — TikTok captions natively at upload; v0 doesn't burn captions in.
- Not a music-sync engine — v0 keeps original audio or renders silent; trending-sound swap happens at TikTok upload time.
- Not a place where edits get described without a file shipping — see ABSOLUTE RULE.

## Inputs / outputs (contract)

```ts
// What the creator effectively gives me (from the thread):
input: {
  creatorId: Id<"creators">;            // $MAYA_CREATOR_ID
  inboundClips: ReadonlyArray<LocalAttachment>;  // 1..12 video files on /data/workspace
  brief: string;                        // the creator's ask, ~verbatim
}

// Step 1 → mint asset ids
clips: ReadonlyArray<{ clipId: string; mediaAssetId: Id<"creatorMayaV0MediaAssets"> }>

// Step 2 → server returns (the source of truth for every creative choice)
edl: {
  targetDurationSec: number;            // <= 90, server-guaranteed
  opener:  { clipId: string; inSec: number; outSec: number; why: string };
  segments: ReadonlyArray<{ clipId: string; inSec: number; outSec: number;
                            transition: 'cut' | 'dissolve' | 'whip' | 'zoom' }>;  // 1..40, ordered
  captions: ReadonlyArray<{ text: string; atSec: number }>;  // informational in v0
  rationale: ReadonlyArray<{ choice: string; evidenceCited: string }>;
}

// Step 3/4 → what I ship
output: {
  publicUrl: string;                    // from /lc_maya/upload_rendered_media
  format: 'mp4';
  deliveredVia: 'claw-messenger.sendMedia';
  narration: string;                    // one line, paraphrased from edl.rationale, voice+firewall applied
}
```
