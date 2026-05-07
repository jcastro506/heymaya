#!/usr/bin/env bash
# Sprint 9.7+ — sweep every lc_maya HTTP endpoint against the live dev Convex
# deployment and report status code + first 200 chars of body. Confirms each
# tool Maya has access to is reachable and either 200s or fails with the
# expected diagnostic.
#
# Prereqs:
#   SECRET     — WEBHOOK_INTERNAL_SECRET from Fly machine (`flyctl ssh ...`)
#   CONVEX_HTTP — base URL, default https://vibrant-platypus-264.convex.site
#   CREATOR    — creator id to test against

set -u
: "${SECRET:?SECRET required}"
: "${CREATOR:?CREATOR required}"
: "${CONVEX_HTTP:=https://vibrant-platypus-264.convex.site}"

probe() {
  local label="$1"; local path="$2"; local body="$3"; local expected="$4"
  printf "%-50s " "$label"
  local resp
  resp=$(curl -sS -X POST "$CONVEX_HTTP$path" \
    -H 'content-type: application/json' \
    -d "$body" \
    -w "\nHTTP:%{http_code}" 2>&1)
  local status
  status=$(echo "$resp" | tail -1 | sed 's/HTTP://')
  local body_out
  body_out=$(echo "$resp" | sed '$d' | head -c 200)
  if [[ "$status" == "$expected" ]]; then
    printf "✓ %s  %s\n" "$status" "$body_out"
  else
    printf "✗ %s (expected %s)  %s\n" "$status" "$expected" "$body_out"
  fi
}

echo "=== lc_maya endpoint smoke ==="
echo "convex: $CONVEX_HTTP"
echo "creator: $CREATOR"
echo

# 1. submit_opening_answers — happy
probe "submit_opening_answers (happy)" \
  "/lc_maya/submit_opening_answers" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"goal\":\"smoke-test\",\"tone\":\"strategic\",\"locationCity\":\"NYC\"}" \
  "200"

# 2. lock_picture — happy (no-op corrections)
probe "lock_picture (no corrections)" \
  "/lc_maya/lock_picture" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\"}" \
  "200"

# 3. update_creator — NEW endpoint
probe "update_creator (firstBootCompletedAt)" \
  "/lc_maya/update_creator" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"setFirstBootCompletedAt\":true}" \
  "200"

# 4. update_creator — idempotent re-call
probe "update_creator (idempotent re-stamp)" \
  "/lc_maya/update_creator" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"setFirstBootCompletedAt\":true}" \
  "200"

# 5. update_creator — firstWeeklyPlanSentAt
probe "update_creator (firstWeeklyPlanSentAt)" \
  "/lc_maya/update_creator" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"setFirstWeeklyPlanSentAt\":true}" \
  "200"

# 6. start_oauth gmail — Sprint 9.8 unified Google OAuth (Calendar + Gmail one consent)
probe "start_oauth gmail (unified Google)" \
  "/lc_maya/start_oauth" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"provider\":\"gmail\",\"redirectUri\":\"https://heymaya.ai/oauth/callback\"}" \
  "200"

# 7. start_oauth googlecalendar — same unified path (alias)
probe "start_oauth googlecalendar (alias)" \
  "/lc_maya/start_oauth" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"provider\":\"googlecalendar\",\"redirectUri\":\"https://heymaya.ai/oauth/callback\"}" \
  "200"

# 8. log_trend — happy
probe "log_trend (happy)" \
  "/lc_maya/log_trend" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"source\":\"niche-scan\",\"observation\":\"smoke probe\",\"evidence\":[{\"kind\":\"hashtag\",\"ref\":\"https://tiktok.com/tag/smoke\",\"fact\":\"smoke trend\"}],\"relevanceScore\":0.5}" \
  "200"

# 9. cron_heartbeat — happy (correct field is jobName, not jobId)
probe "cron_heartbeat (happy)" \
  "/lc_maya/cron_heartbeat" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"jobName\":\"smoke-probe\",\"firedAt\":$(date +%s)000}" \
  "200"

# 10. start_google_calendar_oauth — issues a state token
probe "start_google_calendar_oauth" \
  "/lc_maya/start_google_calendar_oauth" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\"}" \
  "200"

# 11. sync_wiki_observations — payload takes trends/competitors/weeklyLearnings;
#     at least one must be non-empty (validates the contract).
probe "sync_wiki_observations (single trend)" \
  "/lc_maya/sync_wiki_observations" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"trends\":[{\"wikiVaultPath\":\"trends/smoke.md\",\"observation\":\"smoke probe trend\",\"source\":\"niche-scan\",\"evidence\":[{\"kind\":\"hashtag\",\"ref\":\"https://tiktok.com/tag/smoke\",\"fact\":\"smoke probe\"}],\"relevanceScore\":0.5,\"observedAt\":$(date +%s)000}],\"competitors\":[],\"weeklyLearnings\":[]}" \
  "200"

# Sprint 9.8 A — Gmail HTTP endpoints. No Google connection yet → 404 with hint.
probe "gmail_list_inbox (no connection → 404)" \
  "/lc_maya/gmail_list_inbox" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\"}" \
  "404"

probe "gmail_get_message (no connection → 404)" \
  "/lc_maya/gmail_get_message" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"messageId\":\"abc123\"}" \
  "404"

probe "gmail_draft (no connection → 404)" \
  "/lc_maya/gmail_draft" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"to\":\"x@y.com\",\"bodyText\":\"smoke\"}" \
  "404"

probe "gmail_send (no connection → 404)" \
  "/lc_maya/gmail_send" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"to\":\"x@y.com\",\"bodyText\":\"smoke\"}" \
  "404"

# 12. apple_calendar_connect — fake creds → 401 with hint (Sprint 9.8 B)
probe "apple_calendar_connect (fake creds → 401)" \
  "/lc_maya/apple_calendar_connect" \
  "{\"secret\":\"$SECRET\",\"creatorId\":\"$CREATOR\",\"appleId\":\"smoke-only@example.com\",\"appPassword\":\"fake-fake-fake-fake\"}" \
  "401"

# 13. Wrong-secret 401 sanity
probe "submit_opening_answers (wrong secret)" \
  "/lc_maya/submit_opening_answers" \
  "{\"secret\":\"wrong\",\"creatorId\":\"$CREATOR\",\"goal\":\"x\",\"tone\":\"strategic\"}" \
  "401"

echo
echo "=== done ==="
