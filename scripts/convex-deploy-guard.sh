#!/usr/bin/env bash
# Installed as the `convex` npm script so that `npm run convex deploy` and habit-typed
# `npx convex deploy` inside npm scripts hit this instead of the real command.
# Everything except `deploy` passes through.
if [[ "${1:-}" == "deploy" ]]; then
  cat >&2 <<'MSG'
blocked: bare `convex deploy` ignores CONVEX_DEPLOYMENT and targets whatever project the
deploy key points at. Use `npm run deploy:staging` or `npm run deploy:prod` (scripts/convex-deploy.sh).
MSG
  exit 1
fi
exec npx convex "$@"
