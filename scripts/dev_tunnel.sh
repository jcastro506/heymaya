#!/usr/bin/env bash
# Sprint 11 #24 — public dev tunnel for iMessage OAuth tap-on-phone flow.
#
# WHY THIS EXISTS:
# Maya texts the creator an OAuth link via iMessage. The creator taps it
# on their iPhone. The link points to the Next.js dev server's callback
# at http://localhost:3000/... — which the iPhone can't reach. ngrok
# fronts localhost with a public HTTPS URL the phone CAN reach.
#
# WHAT THIS SCRIPT DOES:
#   1. Starts ngrok tunneling localhost:3000 to a public HTTPS URL
#   2. Prints the URL + the env vars that need updating
#   3. Reminds you to add the URL to Google Cloud Console
#
# WHAT YOU STILL HAVE TO DO MANUALLY (one-time per ngrok session, since
# the URL changes on free plan; pin a domain on the paid plan):
#
#   A. Update Convex env:
#      npx convex env set GOOGLE_CALENDAR_IMESSAGE_REDIRECT_URI \
#        "https://YOUR-NGROK-URL.ngrok-free.app/api/google-calendar/callback-imessage"
#
#   B. Update Google Cloud Console → APIs & Services → Credentials →
#      OAuth 2.0 Client → Authorized redirect URIs:
#      https://YOUR-NGROK-URL.ngrok-free.app/api/google-calendar/callback-imessage
#
#   C. Restart `npm run dev` (Next.js) AFTER updating .env.local with the
#      new NEXT_PUBLIC_APP_BASE_URL=https://YOUR-NGROK-URL.ngrok-free.app
#      so OAuth state/callback matching works.
#
# RECOMMENDATION (paid ngrok plan):
#   ngrok http --domain=heymaya-dev.ngrok-free.app 3000
# Pinned domain = no env-update churn between sessions.
#
# Usage:
#   bash scripts/dev_tunnel.sh
#   bash scripts/dev_tunnel.sh --domain=heymaya-dev.ngrok-free.app  # paid

set -euo pipefail

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok not installed."
  echo
  echo "Install: brew install ngrok/ngrok/ngrok"
  echo "Authtoken: https://dashboard.ngrok.com/get-started/your-authtoken"
  echo "  ngrok config add-authtoken <TOKEN>"
  exit 1
fi

PORT="${PORT:-3000}"
DOMAIN_FLAG=""
if [ $# -gt 0 ]; then
  case "$1" in
    --domain=*) DOMAIN_FLAG="--domain=${1#*=}" ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
fi

echo "Starting ngrok tunnel to localhost:${PORT}..."
echo
echo "Once ngrok prints its public URL:"
echo "  1. Copy the https:// URL"
echo "  2. Update Convex env:"
echo "     npx convex env set GOOGLE_CALENDAR_IMESSAGE_REDIRECT_URI \\"
echo "       'https://YOUR-URL/api/google-calendar/callback-imessage'"
echo "  3. Add the same URL to Google Cloud Console OAuth → Redirect URIs"
echo "  4. Update .env.local: NEXT_PUBLIC_APP_BASE_URL=https://YOUR-URL"
echo "  5. Restart npm run dev"
echo
echo "Killing existing ngrok agent (if any)..."
pkill -f "ngrok http" 2>/dev/null || true

# shellcheck disable=SC2086
exec ngrok http $DOMAIN_FLAG "${PORT}"
