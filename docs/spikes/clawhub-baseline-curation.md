# Maya v0 baseline skill curation — what every Maya gets at deploy

**Author:** Claude (Opus 4.7) on behalf of Joshua Castro
**Date:** 2026-04-27
**Scope:** Identify the ClawHub + Anthropic public skills that should ship in **every** Maya's deploy bundle for the v0 service product. Per the operator's locked rule (2026-04-27, fourth correction): every Maya gets the SAME curated bundle; no runtime skill installation; no per-business divergence.

**Method:** Reviewed the Anthropic public skills repo (`github.com/anthropics/skills`), ClawHub semantic search via the awesome-list (`VoltAgent/awesome-openclaw-skills`), and direct SKILL.md reads on top candidates. Live ClawHub web/API search wasn't returning useful results from where I'm fetching — surfaced as a note for future curation passes (operator can browse manually at `clawhub.ai`).

**Sources:**
- [Anthropic public skills](https://github.com/anthropics/skills)
- [VoltAgent awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills)
- [DeepRead OCR SKILL.md](https://github.com/openclaw/skills/blob/main/skills/uday390/deepread-ocr/SKILL.md)
- [Free Video Generator (CapCut) SKILL.md](https://github.com/openclaw/skills/blob/main/skills/vcarolxhberger/free-video-generator-capcut/SKILL.md)

---

## TL;DR — one addition to the v0 baseline

| Skill | Source | Purpose | Custom skill it supports |
|---|---|---|---|
| **NemoVideo / CapCut family** (`vcarolxhberger/free-video-generator-capcut` or `nemovideo/nemovideo_skills`) | ClawHub | Cloud video composition | `maya-service-clip-composer` (already locked) |

**Skills initially proposed and rejected this session:**

- **`uday390/deepread-ocr` (REJECTED 2026-04-27).** Recommended in the first pass for asset-cataloger receipt/invoice OCR. Operator's gut flagged "seems sketchy"; verification turned up an unfunded 9-year-old single-team product at deepread.tech (the SKILL.md author wrote `deepread.ai` — minor sketch flag itself). No funding, no review signal, multiple unrelated "DeepRead" branded products in the space. Replaced by **Gemini multimodal via OpenRouter** for any OCR need — we already pay for it, no new vendor surface, no operator data flowing to a thinly-resourced shop. Cost difference is negligible at v0 scale (most operator photos are job-site visuals, not receipts).
- **Anthropic `pptx` and `xlsx` (REJECTED 2026-04-27).** Per operator UX rule (`memory/feedback_basic_ui_for_home_service.md`): home service operators (plumbers, HVAC, electricians) want plain numbers + Maya's reasoning, not slide decks or spreadsheet exports. Sparkline is the visual ceiling. The `maya-service-packet-generator` "quarterly report" framing should itself be re-examined for fit with this audience — likely a plain text summary delivered via iMessage is the right surface, not a PDF/PPTX deliverable. Defer that conversation; for now, no `pptx` / `xlsx` in v0 baseline.

---

## Final v0 baseline list (proposed)

### Anthropic public skills (4 in workspace bundle, 1 dev-time-only)

Already locked in `project_skill_strategy.md`:
- `pdf` — parse + render (used by `maya-service-contract-redflag` for parse, `maya-service-packet-generator` for render)
- `docx` — for brand briefs that arrive as docx
- `internal-comms` — long-form prose tone for weekly summaries
- `skill-creator` — dev-time authoring pattern when WE write Maya skills (NOT shipped in workspace bundle — used by us only)

No additions. `pptx` and `xlsx` were considered and rejected — see "Basic UI" rule in `feedback_basic_ui_for_home_service.md`.

### ClawHub install-on-deploy (1)

- `vcarolxhberger/free-video-generator-capcut` v(latest, pin TBD) OR `nemovideo/nemovideo_skills` first-party — cloud video composition, 1080p MP4 output, free anonymous tier 100 credits / 7d, register for more.

### Custom Maya-service skills (18, all already shipped)

`review-request-drafter, review-reply-drafter, gbp-post-optimizer, job-photo-curator, lead-response-nudger, brand-voice-applier, citation-firewall, packet-generator, content-arc-planner, contract-redflag, revenue-snapshot-renderer, voice-brevity-overlay, competitor-watcher, asset-cataloger, content-rejuvenation, learnings-extractor, gbp-seo-auditor, clip-composer`.

Plus the dev-time-only / not-shipped-in-v0 reference:
- `maya-skill-installer` — kept in repo as a dev-time reference shape, NOT in deploy bundle. Use for our own ClawHub baseline curation passes (this doc is one such pass).

**Total per-Maya skill count:** 4 Anthropic (in bundle) + 1 ClawHub + 18 custom = **23 skills shipped per Maya**. Plus `skill-creator` for our dev-time use.

---

## Candidates evaluated and rejected

| Candidate | Why rejected |
|---|---|
| `nitishgargiitd/3d-cog` (image quality classification) | Install path looks immature: `/cellcog-setup` ritual + `pip install cellcog` + `CELLCOG_API_KEY`. Niche product; SKILL.md surface thin. Maya can use Gemini multimodal via OpenRouter for image-quality judgment — simpler, no extra vendor. |
| `coolmanns/canva-connect` (Canva integration) | Requires per-operator Canva OAuth — adds onboarding friction. Maya's marketing visuals don't need Canva for v0; she works with operator's actual photos. |
| `michael-laffin/content-recycler` | Overlaps with our `maya-service-content-rejuvenator` + `content-arc-planner`. Would need a depth check; uncertain it adds beyond what our judgment skills do. SKIP for v0; revisit if rejuvenator/arc-planner falls short in beta. |
| `oyi77/data-analyst` | Generic SQL + data viz; too broad. Our use case (revenue snapshot, growth metrics) is narrow. HQ UI already renders charts client-side via `components/creator/Sparkline.tsx`. No need for a server-side chart skill in v0. |
| Generic image manipulation skills (resize/crop/exif) | OpenClaw's native `image_generate` (available 2026.4.5+; we're on 4.23) plus Gemini multimodal cover everything Maya needs. Operator-uploaded photos already arrive sized; we don't re-render. |
| `eftalyurtseven/ai-avatar-generation`, `ascii-art-generator`, `album-cover-generation`, `best-image-generation` | Generative image skills — wrong shape for service-business marketing. Maya works with operator's actual job photos, not synthesized content. |
| `hongkongkiwi/elevenlabs-cli` | We already use ElevenLabs Agents directly via `convex/voice/`. The CLI skill is redundant. |
| Anthropic `algorithmic-art`, `slack-gif-creator`, `theme-factory`, `frontend-design`, `webapp-testing`, `web-artifacts-builder`, `claude-api`, `mcp-builder`, `canvas-design`, `brand-guidelines`, `doc-coauthoring` | Either dev-tooling shape (not Maya's runtime) or wrong domain. `brand-guidelines` is the closest near-miss but soul.md + memory-wiki already cover brand-voice ground. |
| Anthropic `pptx` (slide-deck render) and `xlsx` (spreadsheet) | **Operator UX rule rejection** (2026-04-27, `feedback_basic_ui_for_home_service.md`): home service operators want plain numbers + Maya's reasoning, not slide decks. Sparkline is the visual ceiling. Quote: *"these are just home service guys."* |

---

## Curation method limitations + how to verify

1. **Live ClawHub web/API search returned empty for most queries** from where I'm fetching. The awesome-list at `github.com/VoltAgent/awesome-openclaw-skills` was the only useful index. Operator should manually browse `clawhub.ai` to confirm the picks above are still highly-rated as of any beta launch date — versions and quality can shift fast in this ecosystem.
2. **No license verification** done for the ClawHub pick. `free-video-generator-capcut` needs a license read before locking in. Anthropic public skills are MIT.
3. **Version pinning** not done. The deploy manifest needs explicit version pins on every ClawHub skill so OpenClaw's runtime download is deterministic. Pin to whatever the latest stable is at install time and treat any version bump as an explicit operator-approved change in a future wave.

---

## What's needed to wire this up in code

The deploy pack at `convex/agents/packs/maya_service/` builds the workspace bundle but doesn't currently emit a ClawHub skill manifest (the file OpenClaw reads to know what to download on first run). One small follow-up wave would:

1. Add `convex/agents/packs/maya_service/clawhubManifest.ts` exporting the 2 ClawHub skill IDs + version pins above.
2. Add `convex/agents/packs/maya_service/anthropicSkillsManifest.ts` exporting the 5 Anthropic public skill IDs + version pins.
3. Update `deployServiceMaya.ts` `assembleServiceWorkspace` to write `manifest.json` listing all skills (Anthropic + ClawHub + custom) at the workspace root, so OpenClaw's bootstrap reads it on first boot.
4. Update operator-action docs:
   - `docs/operator-actions/voice-a2p-10dlc.md` — already covers ElevenLabs side; add a note that NemoVideo also runs cloud-side, no Fly install needed.
5. Update the standing-orders sibling-file scan test to NOT require a 1:1 mapping between standing-orders entries and ClawHub-baseline skills (only between standing-orders and custom maya-service-* skills, which is the existing rule).

Estimated 1-2 hours of code work. Not urgent for any operator-blocked unblock.

---

## Open questions (operator-blocked)

1. Confirm Anthropic public skill licensing covers our use (MIT — should be fine, but worth a 5-min verify before lock).
2. Decide between `vcarolxhberger/free-video-generator-capcut` (community wrapper) vs NemoVideo first-party (`nemovideo/nemovideo_skills`) for video. Both call same backend; first-party probably more reliable for SKILL.md updates as the API evolves. Operator-judgment call.
3. Whether to upgrade the DeepRead free tier (2000 pages/mo, 10 req/min) to paid for production beta. 5-10 operators × maybe 30 receipts/operator/month = 150-300 pages/mo well under free tier. Probably fine for v0 beta; revisit at scale.
4. Whether `maya-service-packet-generator`'s "quarterly report" framing needs reshaping for the home-service audience. Plain-text iMessage summary may be the right surface, not a PDF deliverable. Defer to beta feedback.
