# OpenClaw runtime image — `heymaya-openclaw`

The Docker image every per-customer Fly machine boots from. One image, shared
across all tenants; per-business state lives on the mounted `/data` volume
that the deploy action populates (workspace bundle + cron jobs + memory-wiki
vault + gateway config).

## When to rebuild

- OpenClaw version bump (npm package `openclaw`). Update `OPENCLAW_VERSION`
  in `convex/onboarding/business/deployServiceMaya.ts:233` AND in this
  README's build commands AND retag.
- Base image security update (Node 24 → Node 26 someday).
- Any new system dep needed by the bootstrap shell (`jq`, `tar`, `curl`,
  `base64` are already covered).

## Operator: build + push

One-time setup:

```bash
flyctl auth docker        # authenticates docker against registry.fly.io
flyctl apps create heymaya-openclaw --org personal   # one-time, registry namespace
```

Then for each version:

```bash
# Build only (do NOT pass --push on the first build of a fresh app)
docker buildx build --platform linux/amd64 \
  --build-arg OPENCLAW_VERSION=2026.4.23 \
  -t registry.fly.io/heymaya-openclaw:v2026.4.23 \
  -t registry.fly.io/heymaya-openclaw:latest \
  infra/openclaw-runtime/

# Refresh registry auth + push directly. The buildx `--push` flag uses a
# different auth code path that fails with "app repository not found" on
# fresh apps; the manual `docker push` works against the same registry
# after a re-auth. (Confirmed quirk 2026-04-27 on first publish.)
flyctl auth docker
docker push registry.fly.io/heymaya-openclaw:v2026.4.23
docker push registry.fly.io/heymaya-openclaw:latest
```

Verify:

```bash
flyctl image show -a heymaya-openclaw
docker pull registry.fly.io/heymaya-openclaw:v2026.4.23
docker run --rm registry.fly.io/heymaya-openclaw:v2026.4.23 openclaw --version
# expect: 2026.4.23
```

## Why this layout (and what NOT to add)

**Native-first.** `feedback_openclaw_native_first.md` is the locked rule:
OpenClaw owns cron, heartbeat, memory, memory-wiki, bootstrap, channels,
skill loading. This image only provides:

- A working `openclaw` CLI on PATH.
- The shell tools the bootstrap shell needs (`bash`, `curl`, `tar`, `jq`,
  `base64`, `mkdir`).
- `HOME=/data` so any path that defaults to `~/...` lands on the persistent
  volume.

The deploy action sets `OPENCLAW_STATE_DIR=/data` on the machine's env, NOT
in the image. This keeps the image layout-agnostic — same image works for
any future deploy variant that wants a different state-dir.

**Things that should NOT be added to this image:**

- Workspace files (AGENTS.md / SOUL.md / etc.). Those come from the per-
  business workspace bundle uploaded by `deployServiceMaya.buildAndUploadWorkspace`
  and extracted on machine boot.
- Skills. `manifest.json` lists Anthropic + ClawHub skills the gateway
  fetches on first boot; custom `maya-service-*` skills ship inside the
  workspace bundle.
- Per-tenant config or secrets. Secrets are set via `fly secrets set`; the
  bootstrap-time gateway config is `/data/openclaw.json` (written from
  `MAYA_BOOTSTRAP_JSON`).
- A custom entrypoint or PID-1 wrapper. The OpenClaw gateway is the PID-1.

## What the deploy action does at boot

The Fly machine's `init.cmd` is set by `deployServiceMaya.ts` to:

```sh
mkdir -p /data/workspace /data/cron \
  && curl -fsSL "$MAYA_WORKSPACE_BUNDLE_URL" -o /tmp/workspace.tar \
  && tar -xf /tmp/workspace.tar -C /data/workspace \
  && echo "$MAYA_JOBS_JSON_BASE64" | base64 -d > /data/cron/jobs.json \
  && echo "$MAYA_BOOTSTRAP_JSON" | jq .gatewayConfig > /data/openclaw.json \
  && exec openclaw gateway --bind lan --port 3000 --allow-unconfigured
```

`init.cmd` REPLACES the image's `CMD`, so the bootstrap is the entire
process. The final `exec openclaw gateway …` becomes PID-1.

## Healthchecks

- `/healthz` — liveness. Returns 200 once the gateway process is up.
- `/readyz` — readiness. Returns 200 once the gateway has read its config
  + workspace + cron jobs.

The image's `HEALTHCHECK` directive checks `/healthz` on `PORT`. The Fly
machine config uses `internal_port: 3000` to match.

## Image version pin policy

- **Don't pin `latest`.** OpenClaw promotes betas through `latest` on npm
  rapidly. Pin a specific CalVer tag (e.g. `v2026.4.23`).
- **Bump in lockstep with sprint planning.** Coordinate the npm version,
  the image tag, and the `MAYA_OPENCLAW_VERSION` env on the machine.
- Document version-bump testing in the sprint plan; minimum is "build,
  push, deploy one fixture business, observe heartbeat fires."

## Open questions / future work

- The current image runs on `shared-cpu-1x` (512 MB) — adequate for v0
  per service-plan economics. Revisit if voice-call (Studio) memory
  pressure shows up.
- `agents probe` exit-code semantics aren't documented; the deploy
  action treats non-zero as a soft failure (machine still up). Re-verify
  in the first live smoke run.
- A2P 10DLC registration is operator-side and 1-2wk lead time. Not
  required for the first internal smoke (which uses an existing Twilio
  number); required before any public-facing operator can receive SMS.
