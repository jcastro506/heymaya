# Vendor manifest — third-party skills bundled into Maya

This file is the canonical record of every skill copied into `agents/skills/`
from an external source. When a skill needs to be re-vendored on update, run
the documented vendor command against the upstream commit listed here so the
diff is auditable.

## Anthropic public skills

Vendored from `github.com/anthropics/skills` (Anthropic's public skill repo).
Each entry below was copied verbatim from upstream and extended only with a
`metadata.openclaw` block in the SKILL.md frontmatter (provenance + tags;
upstream prose is unchanged).

| Skill | Local path | Upstream URL | Commit SHA | Pinned at |
|---|---|---|---|---|
| `pdf` | `agents/skills/pdf/` | https://github.com/anthropics/skills/tree/main/skills/pdf | `d230a6dd6eb1a0dbee9fec55e2f00a96e28dff81` | 2026-05-06 |
| `docx` | `agents/skills/docx/` | https://github.com/anthropics/skills/tree/main/skills/docx | `d230a6dd6eb1a0dbee9fec55e2f00a96e28dff81` | 2026-05-06 |
| `internal-comms` | `agents/skills/internal-comms/` | https://github.com/anthropics/skills/tree/main/skills/internal-comms | `d230a6dd6eb1a0dbee9fec55e2f00a96e28dff81` | 2026-05-06 |

### Re-vendor command

```bash
# Choose the upstream commit you want to pin (ideally a tagged release once
# anthropics/skills publishes them; the latest main commit is fine in v0).
COMMIT=d230a6dd6eb1a0dbee9fec55e2f00a96e28dff81
WORKDIR=$(mktemp -d)

git clone --depth 1 https://github.com/anthropics/skills.git "$WORKDIR"
( cd "$WORKDIR" && git fetch --depth 1 origin "$COMMIT" && git checkout "$COMMIT" )

for skill in pdf docx internal-comms; do
  rm -rf "agents/skills/$skill"
  cp -R "$WORKDIR/skills/$skill" "agents/skills/$skill"
done

# Re-add the metadata.openclaw frontmatter block to each SKILL.md
# (see existing files for shape) — do NOT edit the upstream prose.
```

After re-vendoring, bump the commit SHA + pinned-at date in the table above.

## Deferred / skipped

The following Anthropic skills exist upstream but are intentionally NOT
vendored in v0:

- `xlsx` — deferred. Not needed yet; revisit when Maya gains spreadsheet
  ingestion or rendering use cases (revenue snapshot CSV exports could pull
  this in later).
- `pptx` — skipped. No Maya surface needs PowerPoint rendering in v0; the
  manager-readiness packet renders to PDF via the `pdf` skill, not PPTX.
- `frontend-design` — skipped. Not utility; Anthropic positions it as a
  generation skill for HTML/CSS UIs, which is outside Maya's scope.
- `algorithmic-art`, `brand-guidelines`, `canvas-design`, `claude-api`,
  `doc-coauthoring`, `mcp-builder`, `skill-creator`, `slack-gif-creator`,
  `theme-factory`, `web-artifacts-builder`, `webapp-testing` — none fit
  Maya's task surface.

`skill-creator` is referenced in `agents/skills/maya-platform/skill.md` as an
authoring meta-skill; we use it to write our own custom Maya skills, but it
is not bundled into Maya's runtime workspace. Operator-side only.

## Non-Anthropic vendored skills

The following live in `agents/skills/` but are sourced from elsewhere:

- `scrapecreators-api/` — first-party from ScrapeCreators (the read-layer
  vendor). Tracked in `convex/integrations/scrapeCreators/` for the API
  client; the SKILL.md here is the agent-side wrapper.
- `maya-*` — custom-authored by HeyMaya. Not vendored from any upstream.
- `tiktok` (ClawHub pin), `free-video-generator-capcut`, `video-frames`,
  `faster-whisper`, `elevenlabs-transcribe`, `instagram-photo-text-overlay`,
  `brave-search` — pinned ClawHub skills, materialized into the deployed
  Maya workspace via `convex/creatorMayaV0/pinnedClawhubSkills.ts` (NOT
  committed under `agents/skills/`; they live in the lock file). See that
  file for the full pin list and provenance per pin.
