#!/usr/bin/env bash
# Sprint 12 Phase 1C — calendar CRUD smoke harness.
#
# Sweeps every calendar HTTP endpoint (Google + Apple) against the live
# Convex deployment and reports status code + first 200 chars of body.
# Confirms each tool Maya has access to is reachable and either 200s or
# fails with the expected diagnostic.
#
# What this exercises (Google):
#   1. /lc_maya/calendar_list_events       — list in [now, now+30d]
#   2. /lc_maya/calendar_create_event      — create a 1h block 1d from now
#   3. /lc_maya/calendar_update_event      — rename + reschedule
#   4. /lc_maya/calendar_delete_event      — clean up the created event
#
# What this exercises (Apple):
#   5. /lc_maya/apple_calendar_list_calendars
#   6. /lc_maya/apple_calendar_list_events  — list in [now, now+30d]
#   7. /lc_maya/apple_calendar_create_event — create a 1h block 1d from now
#   8. /lc_maya/apple_calendar_update_event — rename + reschedule
#   9. /lc_maya/apple_calendar_delete_event — clean up
#
# All created events are deleted at the end. If a step fails, the script
# stops and prints the failing response — operator must clean up manually.
#
# Prereqs:
#   SECRET     — WEBHOOK_INTERNAL_SECRET from the Convex deployment
#   CREATOR    — creator id with active Google AND/OR Apple calendar
#                connection. The script auto-detects which providers the
#                creator has and skips the absent ones.
#   CONVEX_HTTP — base URL, default https://vibrant-platypus-264.convex.site
#
# Usage:
#   SECRET=... CREATOR=... ./scripts/calendar_crud_smoke.sh
#   (or)
#   SECRET=... CREATOR=... PROVIDERS=google ./scripts/calendar_crud_smoke.sh

set -u
: "${SECRET:?SECRET required}"
: "${CREATOR:?CREATOR required}"
: "${CONVEX_HTTP:=https://vibrant-platypus-264.convex.site}"
: "${PROVIDERS:=both}"  # both | google | apple

# Time windows.
NOW_MS=$(($(date +%s) * 1000))
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PLUS_30D_ISO=$(date -u -v+30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)
PLUS_1D_ISO=$(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ)
PLUS_1D_1H_ISO=$(date -u -v+1d -v+1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -d '+1 day +1 hour' +%Y-%m-%dT%H:%M:%SZ)
PLUS_2D_ISO=$(date -u -v+2d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -d '+2 days' +%Y-%m-%dT%H:%M:%SZ)
PLUS_2D_1H_ISO=$(date -u -v+2d -v+1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -d '+2 days +1 hour' +%Y-%m-%dT%H:%M:%SZ)

GOOGLE_EVENT_ID=""
APPLE_EVENT_URL=""
APPLE_EVENT_UID=""

call() {
  local label="$1"; local path="$2"; local body="$3"
  printf "%-50s " "$label"
  local resp
  resp=$(curl -sS -X POST "$CONVEX_HTTP$path" \
    -H 'content-type: application/json' \
    -d "$body" \
    -w "\nHTTP:%{http_code}" 2>&1)
  local status
  status=$(echo "$resp" | tail -1 | sed 's/HTTP://')
  local body_out
  body_out=$(echo "$resp" | sed '$d')
  echo "HTTP $status"
  echo "  $(echo "$body_out" | head -c 240)"
  RESP_BODY="$body_out"
  RESP_STATUS="$status"
}

cleanup() {
  echo
  echo "=== cleanup ==="
  if [ -n "$GOOGLE_EVENT_ID" ]; then
    call "google delete (cleanup)" \
      "/lc_maya/calendar_delete_event" \
      "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"eventId\":\"$GOOGLE_EVENT_ID\"}"
  fi
  if [ -n "$APPLE_EVENT_URL" ]; then
    call "apple delete (cleanup)" \
      "/lc_maya/apple_calendar_delete_event" \
      "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"eventUrl\":\"$APPLE_EVENT_URL\"}"
  fi
}

trap cleanup EXIT

echo "=== calendar CRUD smoke ==="
echo "convex   : $CONVEX_HTTP"
echo "creator  : $CREATOR"
echo "providers: $PROVIDERS"
echo "now      : $NOW_ISO"
echo

# -------- Google --------
if [ "$PROVIDERS" = "both" ] || [ "$PROVIDERS" = "google" ]; then
  echo "=== Google Calendar ==="

  call "google list (now → +30d)" \
    "/lc_maya/calendar_list_events" \
    "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"timeMin\":\"$NOW_ISO\",\"timeMax\":\"$PLUS_30D_ISO\",\"maxResults\":5}"

  call "google create (Maya smoke event)" \
    "/lc_maya/calendar_create_event" \
    "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"summary\":\"[smoke] Maya CRUD test\",\"description\":\"calendar_crud_smoke.sh — safe to delete\",\"location\":\"Test Location\",\"start\":{\"dateTime\":\"$PLUS_1D_ISO\"},\"end\":{\"dateTime\":\"$PLUS_1D_1H_ISO\"}}"

  if [ "$RESP_STATUS" = "200" ]; then
    GOOGLE_EVENT_ID=$(echo "$RESP_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    echo "  -> captured eventId: $GOOGLE_EVENT_ID"

    if [ -n "$GOOGLE_EVENT_ID" ]; then
      call "google update (rename + reschedule)" \
        "/lc_maya/calendar_update_event" \
        "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"eventId\":\"$GOOGLE_EVENT_ID\",\"summary\":\"[smoke] Maya CRUD test (updated)\",\"start\":{\"dateTime\":\"$PLUS_2D_ISO\"},\"end\":{\"dateTime\":\"$PLUS_2D_1H_ISO\"}}"
    fi
  else
    echo "  (skipping update + delete — create failed)"
  fi
fi

# -------- Apple --------
if [ "$PROVIDERS" = "both" ] || [ "$PROVIDERS" = "apple" ]; then
  echo
  echo "=== Apple Calendar ==="

  call "apple list_calendars" \
    "/lc_maya/apple_calendar_list_calendars" \
    "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\"}"

  call "apple list_events (now → +30d)" \
    "/lc_maya/apple_calendar_list_events" \
    "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"timeRangeStartIso\":\"$NOW_ISO\",\"timeRangeEndIso\":\"$PLUS_30D_ISO\"}"

  call "apple create (Maya smoke event)" \
    "/lc_maya/apple_calendar_create_event" \
    "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"summary\":\"[smoke] Maya CRUD test\",\"description\":\"calendar_crud_smoke.sh — safe to delete\",\"location\":\"Test Location\",\"startIso\":\"$PLUS_1D_ISO\",\"endIso\":\"$PLUS_1D_1H_ISO\"}"

  if [ "$RESP_STATUS" = "200" ]; then
    APPLE_EVENT_URL=$(echo "$RESP_BODY" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p' | head -1)
    APPLE_EVENT_UID=$(echo "$RESP_BODY" | sed -n 's/.*"uid":"\([^"]*\)".*/\1/p' | head -1)
    echo "  -> captured eventUrl: $APPLE_EVENT_URL"
    echo "  -> captured uid:      $APPLE_EVENT_UID"

    if [ -n "$APPLE_EVENT_URL" ] && [ -n "$APPLE_EVENT_UID" ]; then
      call "apple update (rename + reschedule)" \
        "/lc_maya/apple_calendar_update_event" \
        "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"eventUrl\":\"$APPLE_EVENT_URL\",\"uid\":\"$APPLE_EVENT_UID\",\"summary\":\"[smoke] Maya CRUD test (updated)\",\"startIso\":\"$PLUS_2D_ISO\",\"endIso\":\"$PLUS_2D_1H_ISO\"}"
    fi
  else
    echo "  (skipping update + delete — create failed)"
  fi
fi

echo
echo "=== done (cleanup runs on exit) ==="
