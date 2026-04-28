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
       ca-certificates curl tar jq coreutils procps git openssl \
    && rm -rf /var/lib/apt/lists/*

ARG OPENCLAW_VERSION=2026.4.23
RUN npm install -g openclaw@${OPENCLAW_VERSION} \
    && openclaw --version

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
