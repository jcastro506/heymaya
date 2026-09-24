#!/usr/bin/env bash
# Push functions to STAGING (precise-canary-781) without repointing your local env.
# `convex dev --once` rewrites .env.local to whatever deployment it just pushed to, so a local
# web server silently starts reading staging (2026-09-24: /k pages 404'd against the wrong backend).
set -euo pipefail
backup=""
if [ -f .env.local ]; then backup="$(mktemp)"; cp .env.local "$backup"; fi
restore() { if [ -n "$backup" ]; then cp "$backup" .env.local; rm -f "$backup"; fi; }
trap restore EXIT
CONVEX_DEPLOYMENT=dev:precise-canary-781 npx convex dev --once "$@"
