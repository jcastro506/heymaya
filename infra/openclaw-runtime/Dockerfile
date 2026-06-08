# syntax=docker/dockerfile:1.7
#
# HeyMaya OpenClaw runtime image. One image, every per-customer Fly machine
# pulls it; per-business state lives entirely on the mounted /data volume
# (workspace bundle + cron jobs + memory-wiki vault + gateway config).
#
# Native-first per `feedback_openclaw_native_first.md`: this image is a thin
# wrapper around the upstream `openclaw` npm package. We do NOT reimplement
# bootstrap, cron scheduling, channel routing, memory persistence, or skill
# loading — OpenClaw owns all of that.
#
# Build + push:
#   flyctl auth docker
#   docker buildx build --platform linux/amd64 \
#     --build-arg OPENCLAW_VERSION=2026.5.26 \
#     -t registry.fly.io/heymaya-openclaw:v2026.5.26 \
#     -t registry.fly.io/heymaya-openclaw:latest \
#     --push infra/openclaw-runtime/
#
# Sprint 2.18 — upgraded 2026.4.23 → 2026.5.26 for these load-bearing fixes:
# - 5.12: HEARTBEAT.md prose outside `tasks:` block no longer silently
#         dropped — directly fixes our case (voice + tool primer prose
#         above the tasks block was getting lost in 4.x).
# - 5.12: Stream-establishment idle-timer fix — SDK requests stuck at
#         TCP/TLS handshake or before first response byte no longer
#         hang indefinitely (the X subagent jam we hit).
# - 5.12: Multi-agent heartbeat Promise.all fan-out — one busy agent no
#         longer starves siblings sequentially.
# - 5.12: skipWhenBusy scoped per-agent lane — single stuck subagent on
#         one agent no longer disables every other agent's heartbeat.
# - 5.14: sessions_spawn task delivered as first visible [Subagent Task]
#         message instead of hidden in system prompt — debuggable.
# - 5.26: Subagent bootstrap context defaults to AGENTS.md + TOOLS.md
#         only — lean worker prompts.
# - 5.26: Telegram ENETDOWN treated as transient pre-connect failure —
#         flaky Fly→Telegram retries correctly.
# - 5.26: Boot handler runs in dedicated `agent:<id>:boot` session (not
#         main) with suppressPromptPersistence — no transcript pollution.
#
# Still VANILLA OpenClaw startup. No "creator runtime" optimization
# patches. The bundled boot-md hook fires on gateway:startup → reads
# BOOT.md → runs the agent command → message tool delivers to Telegram.
#
# Layout contract (consumed by `convex/onboarding/business/deployServiceMaya.ts`):
#   The deploy passes `OPENCLAW_STATE_DIR=/data` on the machine env. The
#   bootstrap shell writes:
#     /data/workspace/                 (extracted workspace bundle)
#     /data/cron/jobs.json             (cron schedule)
#     /data/openclaw.json              (gateway config)
#   …and execs `openclaw gateway --bind lan --port 3000 --allow-unconfigured`.
#   The image's CMD is the same; init.cmd in Fly's machine config replaces it.
FROM --platform=linux/amd64 node:24-bookworm-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       ca-certificates curl tar jq coreutils procps git openssl python3 \
       ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Sprint 12.7.2 — ffmpeg is included so the `mahmoudadelbghany/ffmpeg-video-editor`
# ClawHub skill can actually execute the commands it generates. Without this,
# the skill teaches Maya FFmpeg syntax but every `bash` invocation against
# `ffmpeg` fails with "executable file not found in $PATH".

ARG OPENCLAW_VERSION=2026.5.26
RUN npm install -g openclaw@${OPENCLAW_VERSION} \
    && openclaw --version

# Resolve external channel plugins at image build time, not during a creator's
# Fly boot. The machine bootstrap copies these files onto the persistent
# /data volume before writing openclaw.json, then the config loads them through
# plugins.load.paths.
RUN mkdir -p /opt/openclaw-seed \
    && OPENCLAW_STATE_DIR=/opt/openclaw-seed HOME=/tmp/openclaw-seed-home \
       openclaw plugins install @emotion-machine/claw-messenger --force \
    && rm -rf /opt/openclaw-seed/.npm /opt/openclaw-seed/logs /tmp/openclaw-seed-home \
    && chown -R node:node /opt/openclaw-seed

# Sprint 2.18 — patch-claw-messenger-plugin.mjs NO LONGER RUNS.
#
# The script was written against the 2026.4.x claw-messenger layout
# (`/opt/openclaw-seed/extensions/claw-messenger/dist/channel.js`). The
# 2026.5.26 plugin reorganized that layout and the targeted markers no
# longer exist. Rather than chase moving targets across plugin versions,
# we go fully vanilla per `feedback_vanilla_openclaw_no_startup_patches`:
# vanilla OpenClaw + vanilla plugin. The original patches were:
#   1. Slop firewall — already removed from Convex in 2.16u-fix8 ("hate
#      hardcoded string blockers"); SOUL.md owns voice now.
#   2. Channel lifetime patches — verified obsolete in 5.x lifecycle.
#   3. HTTP probes-before-hooks — vanilla 5.26 already places probes
#      ahead of hook handlers (5.12 stream-establishment fix area).
#   4. Plugin version drift tolerance — ironic; was for upgrades like
#      this one. Empty target now.
# File kept in source for historical reference; not copied into image.

# OpenClaw auto-enables the provider plugin that owns the configured primary
# model, then installs bundled runtime deps into OPENCLAW_STATE_DIR on first
# boot. Creator machines use fresh /data volumes, so pre-seed the exact cache
# shape and let the deploy bootstrap copy it into /data before gateway start.
RUN RUNTIME_ROOT="$(node -e 'const fs=require("node:fs");const path=require("node:path");const crypto=require("node:crypto");const packageRoot="/usr/local/lib/node_modules/openclaw";const version=JSON.parse(fs.readFileSync(path.join(packageRoot,"package.json"),"utf8")).version;const hash=crypto.createHash("sha256").update(path.resolve(packageRoot)).digest("hex").slice(0,12);process.stdout.write(`/opt/openclaw-runtime-preseed/plugin-runtime-deps/openclaw-${version}-${hash}`);')" \
    && mkdir -p "$RUNTIME_ROOT" \
    && printf '%s\n' '{"name":"openclaw-runtime-deps-install","private":true}' > "$RUNTIME_ROOT/package.json" \
    && npm install --prefix "$RUNTIME_ROOT" --ignore-scripts --legacy-peer-deps --package-lock=false --save=false \
       @anthropic-ai/sdk@0.90.0 \
       @aws-sdk/client-bedrock-runtime@3.1033.0 \
       @aws-sdk/client-bedrock@3.1033.0 \
       @aws-sdk/credential-provider-node@3.972.33 \
       @aws/bedrock-token-generator@^1.1.0 \
       @clack/prompts@^1.2.0 \
       @grammyjs/runner@^2.0.3 \
       @grammyjs/transformer-throttler@^1.2.1 \
       @mariozechner/pi-ai@0.70.0 \
       @mariozechner/pi-coding-agent@0.70.0 \
       ajv@^8.18.0 \
       grammy@^1.42.0 \
       typebox@1.1.28 \
       ws@^8.20.0 \
       zod@^4.3.6 \
    && node -e 'const fs=require("node:fs");const root=process.argv[1];const specs=["@anthropic-ai/sdk@0.90.0","@aws-sdk/client-bedrock-runtime@3.1033.0","@aws-sdk/client-bedrock@3.1033.0","@aws-sdk/credential-provider-node@3.972.33","@aws/bedrock-token-generator@^1.1.0","@clack/prompts@^1.2.0","@grammyjs/runner@^2.0.3","@grammyjs/transformer-throttler@^1.2.1","@mariozechner/pi-ai@0.70.0","@mariozechner/pi-coding-agent@0.70.0","ajv@^8.18.0","grammy@^1.42.0","typebox@1.1.28","ws@^8.20.0","zod@^4.3.6"].sort();fs.writeFileSync(`${root}/.openclaw-runtime-deps.json`,`${JSON.stringify({specs},null,2)}\n`);' "$RUNTIME_ROOT" \
    && rm -rf "$RUNTIME_ROOT"/.npm \
    && chown -R node:node /opt/openclaw-runtime-preseed

ENV NODE_ENV=production \
    HOME=/data \
    PORT=3000

RUN mkdir -p /data && chown -R node:node /data
USER node
WORKDIR /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["openclaw","gateway","--bind","lan","--port","3000","--allow-unconfigured"]
