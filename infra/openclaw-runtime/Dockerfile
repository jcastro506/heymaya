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
#     --build-arg OPENCLAW_VERSION=2026.4.23 \
#     -t registry.fly.io/heymaya-openclaw:v2026.4.23 \
#     -t registry.fly.io/heymaya-openclaw:latest \
#     --push infra/openclaw-runtime/
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

ARG OPENCLAW_VERSION=2026.4.23
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

COPY patch-claw-messenger-plugin.mjs /usr/local/bin/patch-claw-messenger-plugin.mjs
RUN node /usr/local/bin/patch-claw-messenger-plugin.mjs

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
       @mariozechner/pi-ai@0.70.0 \
       @mariozechner/pi-coding-agent@0.70.0 \
       ajv@^8.18.0 \
       typebox@1.1.28 \
       ws@^8.20.0 \
       zod@^4.3.6 \
    && node -e 'const fs=require("node:fs");const root=process.argv[1];const specs=["@anthropic-ai/sdk@0.90.0","@aws-sdk/client-bedrock-runtime@3.1033.0","@aws-sdk/client-bedrock@3.1033.0","@aws-sdk/credential-provider-node@3.972.33","@aws/bedrock-token-generator@^1.1.0","@clack/prompts@^1.2.0","@mariozechner/pi-ai@0.70.0","@mariozechner/pi-coding-agent@0.70.0","ajv@^8.18.0","typebox@1.1.28","ws@^8.20.0","zod@^4.3.6"].sort();fs.writeFileSync(`${root}/.openclaw-runtime-deps.json`,`${JSON.stringify({specs},null,2)}\n`);' "$RUNTIME_ROOT" \
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
