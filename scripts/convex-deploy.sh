#!/usr/bin/env bash
# The only way Convex is deployed from this repo. See docs/CREATOR_SPRINT_PLAN.md §20.3.
#
#   npm run deploy:staging   -> the Convex staging project (branch `creator`, later `staging`)
#   npm run deploy:prod      -> the Convex production project (branch `creator-main`, later `main`)
#
# Scar tissue: on 2026-08-11 a bare `npx convex deploy` run from the staging branch shipped
# 27 unreleased commits to production, because that command ignores CONVEX_DEPLOYMENT.
# This script is the guard. `npm run convex:deploy-guard` blocks the bare command entirely.
set -euo pipefail

target="${1:-}"
case "$target" in
  staging)    key_var="CONVEX_DEPLOY_KEY_STAGING";    allowed_branches="creator staging" ;;
  production) key_var="CONVEX_DEPLOY_KEY_PRODUCTION"; allowed_branches="creator-main main" ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac

branch="$(git rev-parse --abbrev-ref HEAD)"
if ! grep -qw -- "$branch" <<<"$allowed_branches"; then
  echo "refusing: branch '$branch' may not deploy to $target (allowed: $allowed_branches)" >&2; exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "refusing: working tree is not clean" >&2; exit 1
fi
git fetch -q origin "$branch"
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$branch")" ]]; then
  echo "refusing: local $branch is not in sync with origin/$branch" >&2; exit 1
fi
if [[ -z "${!key_var:-}" ]]; then
  echo "refusing: $key_var is not set (a project deploy key from the Convex dashboard)" >&2; exit 1
fi

deployment_name="$(CONVEX_DEPLOY_KEY="${!key_var}" npx convex deployment 2>/dev/null || true)"
echo "About to deploy branch '$branch' (${GITHUB_SHA:-$(git rev-parse --short HEAD)}) to $target${deployment_name:+ [$deployment_name]}."
if [[ "$target" == "production" && -z "${CI:-}" ]]; then
  read -r -p "Type the word 'production' to continue: " confirm
  [[ "$confirm" == "production" ]] || { echo "aborted" >&2; exit 1; }
fi

CONVEX_DEPLOY_KEY="${!key_var}" npx convex deploy --yes
