#!/usr/bin/env bash
# Sync .env.local API keys → Convex cloud env so backend actions can use them.
#
# Run once after creating the new Convex project:
#   npx convex dev --configure new
#   ./scripts/sync-env-to-convex.sh
#
# Skips: CONVEX_*, NEXT_PUBLIC_*, APP_URL (Convex doesn't need these)
# Skips: empty values (no point shipping blanks)
set -euo pipefail

ENV_FILE=".env.local"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE found — run from repo root"; exit 1; }

SKIP_PREFIXES=("CONVEX_" "NEXT_PUBLIC_" "APP_URL")

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
  npx convex env set "$KEY" "$VAL" >/dev/null
done < <(grep -E "^[A-Z][A-Z_0-9]*=" "$ENV_FILE")

echo ""
echo "done. verify with: npx convex env list"
