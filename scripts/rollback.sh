#!/usr/bin/env bash
# Rollback (plan §8 gate 5, §16.6): redeploy a known-good commit to a deployment, through the
# same guard as every deploy. Never touches a branch. Usage:
#   scripts/rollback.sh <git-sha> dev|staging|prod
set -euo pipefail
SHA="${1:?git sha}"; TARGET="${2:?dev|staging|prod}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$ROOT" worktree add --detach "$TMP/wt" "$SHA" >/dev/null
echo "rolling $TARGET back to $(git -C "$TMP/wt" log --oneline -1)"
cp "$ROOT/.env.local" "$TMP/wt/.env.local" 2>/dev/null || true
( cd "$TMP/wt" && npm ci --silent && npm run check >/dev/null && "$ROOT/scripts/convex-deploy.sh" "$TARGET" )
git -C "$ROOT" worktree remove --force "$TMP/wt"
echo "done. record it: docs/OVERNIGHT_LOG.md or the runbook, with the sha and why."
