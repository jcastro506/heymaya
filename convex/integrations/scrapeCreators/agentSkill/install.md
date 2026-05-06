# ScrapeCreators agent skill — installation guide

ScrapeCreators publishes an OpenClaw / Claude Skill Plugin that wraps their REST endpoints
as agent-callable tools. We install it into every Maya's workspace at provision time so
Maya can natively call `scrapecreators.tiktok_profile`, `scrapecreators.ig_post`, etc., from
inside her chat / cron loops without going through Convex.

> **v0 status:** ScrapeCreators ships their skill as a downloadable manifest pinned to a
> version. We commit `manifest.json` here so Maya's workspace template references a
> deterministic version (no surprise upstream skill updates).

## Where this skill ends up

In each Maya's OpenClaw workspace (provisioned by Sprint 1's `deployMaya.ts`):

```
/workspace/skills/scrapecreators/
    SKILL.md                # human-readable summary (auto-generated from manifest)
    manifest.json           # this file, copied at provision time
```

The deploy pipeline (Sprint 1, task §5 — `convex/onboarding/maya/deployMaya.ts`) reads
this directory, copies the contents into the new Fly machine's workspace volume, and
points the OpenClaw skill registry at it.

## Required environment variables (per Maya)

The skill itself needs the same `SCRAPE_CREATORS_API_KEY` that Convex uses, exposed to
each Maya's runtime:

```
SCRAPE_CREATORS_API_KEY=<shared, from Convex deployment env>
SCRAPE_CREATORS_BASE_URL=https://api.scrapecreators.com
```

The deploy pipeline injects these as Fly secrets at machine create time.

## Version pinning

`manifest.json` declares `version` — when ScrapeCreators publishes a new version of the
skill, **do not auto-update**. Instead:

1. Pull the new manifest into a feature branch
2. Run the Sprint 1 fixture suite against it (`npx vitest run convex/integrations/scrapeCreators`)
3. Smoke-test against one real creator
4. Bump `version` in `manifest.json`, commit
5. The next `deployMaya` run picks it up; existing Mayas stay on the prior version until
   `redeployMaya(creatorId)` runs

## Why we don't dynamically fetch the skill

Two reasons:
1. **Determinism.** A creator's Maya should behave identically across her lifetime unless
   we *intentionally* update her. Auto-pulling the latest skill defeats this.
2. **Citation firewall.** Sprint 2's hallucination check requires that every tool Maya
   uses is enumerated in `SKILL.md`. Auto-updating tools breaks the enumeration.

## Open question for the lead

**Does ScrapeCreators publish the skill as a single JSON manifest, a tarball, or only via
a runtime API call?** Their public docs (https://docs.scrapecreators.com) describe the
HTTP API exhaustively but the agent-skill docs were not crawlable from this sprint. The
`manifest.json` checked in here is a **placeholder shape derived from the documented HTTP
endpoints we use** — it exposes the same endpoints as agent tools so Maya can call them
natively, but the wire format may need to be updated to match ScrapeCreators' actual
plugin spec once the lead confirms.
