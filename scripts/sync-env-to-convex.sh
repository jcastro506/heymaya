#!/usr/bin/env bash
# Sync an env file's API keys -> Convex cloud env so backend actions can use them.
#
# Run once after creating the new Convex project:
#   npx convex dev --configure new
#   ./scripts/sync-env-to-convex.sh
#
# To target a specific deployment without changing .env.local:
#   ./scripts/sync-env-to-convex.sh --deployment dev/staging
#   ./scripts/sync-env-to-convex.sh --env-file .env.staging.local --deployment dev/staging
#
# Skips: CONVEX_*, NEXT_PUBLIC_*, APP_URL (Convex doesn't need these)
# Skips: empty values (no point shipping blanks)
set -euo pipefail

ENV_FILE=".env.local"
DEPLOYMENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --deployment)
      DEPLOYMENT="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE found — run from repo root"; exit 1; }

SKIP_PREFIXES=("CONVEX_" "NEXT_PUBLIC_" "APP_URL")
CONVEX_ARGS=()
if [[ -n "$DEPLOYMENT" ]]; then
  CONVEX_ARGS=(--deployment "$DEPLOYMENT")
fi

while IFS='=' read -r KEY VAL; do
  # skip blanks, comments, empty values
  [[ -z "$KEY" || "$KEY" =~ ^[[:space:]]*# || -z "$VAL" ]] && continue

  # skip prefixes Convex doesn't need
  SKIP=false
  for P in "${SKIP_PREFIXES[@]}"; do
    [[ "$KEY" == "$P"* ]] && SKIP=true && break
  done
  $SKIP && continue

  # strip surrounding quotes if any
  VAL="${VAL%\"}"; VAL="${VAL#\"}"

  echo "→ setting $KEY (${#VAL} chars)"
  npx convex env set "${CONVEX_ARGS[@]}" "$KEY" "$VAL" >/dev/null
done < <(grep -E "^[A-Z][A-Z_0-9]*=" "$ENV_FILE")

echo ""
if [[ -n "$DEPLOYMENT" ]]; then
  echo "done. verify with: npx convex env list --deployment $DEPLOYMENT"
else
  echo "done. verify with: npx convex env list"
fi
