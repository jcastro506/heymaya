###############################################################################
# heymaya-video-synth-worker — Fly worker container
#
# What lives in here:
#   • Node 22 LTS (slim) for the Express server + @google/genai SDK
#   • python3 + pip + yt-dlp (for downloading TikTok / IG / YouTube / etc videos)
#   • ffmpeg (yt-dlp requires it for many merge/remux operations on modern formats)
#
# What does NOT live in here:
#   • Any HeyMaya backend code — this worker is hermetic. The Convex action
#     that calls it sends every required input in the request body.
#   • Any creator credentials. The shared HMAC bearer is the ONLY auth and
#     it proves the caller is our Convex deployment; per-creator data is
#     trusted by virtue of arriving inside that envelope.
#
# Build: docker build -t heymaya-video-synth .
# Run:   docker run -p 8080:8080 \
#          -e GOOGLE_GENAI_API_KEY=... \
#          -e WORKER_SHARED_SECRET=... \
#          heymaya-video-synth
###############################################################################

FROM node:22-slim

# yt-dlp + ffmpeg + curl (for healthchecks / debugging). python3-pip installs
# the latest yt-dlp from PyPI which keeps up with platform extractor changes
# better than the apt-packaged version.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      ffmpeg \
      ca-certificates \
      curl \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir --break-system-packages "yt-dlp>=2025.1.0"

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Then build sources.
COPY tsconfig.json ./
COPY src ./src

# Install dev deps just for the build, then drop them.
RUN npm install --no-audit --no-fund \
 && npx tsc -p tsconfig.json \
 && npm prune --omit=dev

# Worker temp dir for yt-dlp downloads. The worker writes here and cleans up
# in `finally` blocks; persistent volume is intentionally NOT mounted here.
RUN mkdir -p /tmp/heymaya-videos

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Healthcheck so Fly auto-stop knows when we're back online after a wake.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:${PORT:-8080}/health || exit 1

CMD ["node", "dist/server.js"]
