#!/usr/bin/env bash
#
# ⚠️ The ONLY safe way to deploy Convex production.
#
# `npx convex deploy` targets the project's PRODUCTION deployment and silently
# ignores CONVEX_DEPLOYMENT — so running it from `staging` (the natural thing to
# do after merging a PR) ships unreleased work to prod. That happened on
# 2026-08-11: 27 commits of staging work reached prod's backend while prod's
# Vercel frontend was still serving `main`.
#
# The guardrail existed in docs/DEPLOYMENT_ENVIRONMENTS.md and was not enforced,
# which is the same failure this repo keeps finding everywhere else: a
# documented contract is not an enforced one until something fails when it's
# broken.
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$branch" != "main" ]; then
  echo "✗ Refusing to deploy Convex production from '$branch'." >&2
  echo "  Production Convex mirrors 'main'. Deploying from another branch" >&2
  echo "  ships unreleased work to real customers." >&2
  echo >&2
  echo "  Release first (staging -> main), then run this from main." >&2
  echo "  For staging, use:  npm run convex:staging" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  # Uncommitted work would be deployed too, and would not exist in any commit
  # anyone could later look at to explain what production is running.
  echo "✗ Refusing to deploy Convex production with a dirty tree." >&2
  git status --short >&2
  exit 1
fi

echo "Deploying Convex PRODUCTION from main ($(git rev-parse --short HEAD))"
exec npx convex deploy "$@"
