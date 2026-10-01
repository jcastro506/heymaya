#!/usr/bin/env node
/**
 * Record Zernio's real responses for a connected creator, READ ONLY (HTTP GET, nothing else),
 * sanitized, into a fixture the parsers are tested against. "Built against a recording, not the
 * spec" is how the 2026-09-05 bugs were found; this is the second recording (A1/A2 reads).
 *
 *   ZERNIO_API_KEY=… ZERNIO_PROFILE_ID=… IG_ACCOUNT_ID=… TT_ACCOUNT_ID=… \
 *     node scripts/zernio-record.mjs [out.json]
 *
 * Sanitizing: keys/tokens/secrets dropped; every commenter's id, username, name and picture
 * replaced with a stable placeholder (commenter_1, …); @mentions inside comment text become
 * @someone. The creator's own posts, urls, captions and numbers are kept: they are the point.
 * Failures (402 add-on, 412 scope, 404) are recorded as findings, never retried into a write.
 */

import { writeFileSync } from "node:fs";

const KEY = process.env.ZERNIO_API_KEY;
const PROFILE = process.env.ZERNIO_PROFILE_ID;
const IG = process.env.IG_ACCOUNT_ID;
const TT = process.env.TT_ACCOUNT_ID;
const OUT = process.argv[2] ?? "convex/integrations/zernio/fixtures.live-2026-10-01.json";
const BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com";
if (!KEY || !PROFILE || !IG || !TT) {
  console.error("needs ZERNIO_API_KEY, ZERNIO_PROFILE_ID, IG_ACCOUNT_ID, TT_ACCOUNT_ID");
  process.exit(1);
}

const out = { recordedAt: new Date().toISOString(), note: "Live, read-only (GET) recording of the operator's own connected Instagram and TikTok on staging. Commenters replaced by placeholders; @mentions in comment text replaced by @someone; no keys or secrets. Each entry: { status, body }.", calls: {} };

// ------------------------------------------------------------------ sanitize
const people = new Map();
const placeholder = (raw) => {
  const k = String(raw ?? "");
  if (!people.has(k)) people.set(k, `commenter_${people.size + 1}`);
  return people.get(k);
};
const SECRET = /secret|token|apikey|api_key|password|signingkey/i;
const PERSON_KEYS = new Set(["from", "author", "user", "commenter", "owner"]);
const TEXT_KEYS = new Set(["message", "text"]);

const COMMENT_KEYS = new Set(["comments", "comment", "replies"]);
/** Signed CDN links (thumbnails, avatars) carry short-lived signatures in the query; keep the path only. */
const unsign = (s) => (/^https?:\/\/[^/]*(cdn|fbcdn|tiktokcdn)/i.test(s) ? s.replace(/\?.*$/, "") : s);

function sanitize(x, parentKey = "", inComments = false) {
  if (Array.isArray(x)) return x.map((v) => sanitize(v, parentKey, inComments));
  if (typeof x === "string") return unsign(x);
  if (!x || typeof x !== "object") return x;
  const o = {};
  for (const [k, v] of Object.entries(x)) {
    if (SECRET.test(k)) { o[k] = "<redacted>"; continue; }
    if (PERSON_KEYS.has(k) && v && typeof v === "object" && !Array.isArray(v)) {
      const who = placeholder(v.id ?? v.username ?? v.name);
      const p = {};
      for (const [pk, pv] of Object.entries(v)) {
        if (["id", "userId", "openId"].includes(pk)) p[pk] = who;
        else if (["username", "name", "displayName", "handle"].includes(pk)) p[pk] = who;
        else if (/picture|avatar|image|photo/i.test(pk)) p[pk] = pv == null ? pv : "https://example.invalid/avatar.png";
        else p[pk] = sanitize(pv, pk, inComments);
      }
      o[k] = p;
      continue;
    }
    if (TEXT_KEYS.has(k) && typeof v === "string" && inComments) { o[k] = v.replace(/@[\w.]+/g, "@someone"); continue; }
    o[k] = sanitize(v, k, inComments || COMMENT_KEYS.has(k));
  }
  return o;
}

// ------------------------------------------------------------------ GET only
async function get(label, path, query = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  let status = 0, body = null;
  try {
    const res = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${KEY}`, accept: "application/json" } });
    status = res.status;
    const text = await res.text();
    try { body = text ? JSON.parse(text) : null; } catch { body = { _nonJson: text.slice(0, 500) }; }
  } catch (e) {
    body = { _networkError: String(e?.message ?? e).slice(0, 200) };
  }
  const shownQuery = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined));
  out.calls[label] = { path, query: shownQuery, status, body: sanitize(body) };
  console.log(`${String(status).padEnd(4)} ${label}`);
  return { status, body };
}

const day = (t) => new Date(t).toISOString().slice(0, 10);
const now = Date.now();

// a) per-post analytics, both accounts
const posts = {};
for (const [p, acc] of [["instagram", IG], ["tiktok", TT]]) {
  const r = await get(`analytics.${p}`, "/api/v1/analytics", { accountId: acc, fromDate: day(now - 365 * 86_400_000), page: 1, limit: 20 });
  posts[p] = (r.body?.posts ?? []).slice(0, 4);
}

// a') one single-post read each (the per-post shape can differ from the list)
for (const p of ["instagram", "tiktok"]) {
  const first = posts[p][0];
  if (first?._id) await get(`analytics.single.${p}`, "/api/v1/analytics", { postId: first._id });
}

// b) timeline per post (daily) and the account-level decay curve
for (const p of ["instagram", "tiktok"]) {
  for (const [i, post] of posts[p].slice(0, 3).entries()) if (post?._id) await get(`postTimeline.${p}.${i}`, "/api/v1/analytics/post-timeline", { postId: post._id });
}
for (const [p, acc] of [["instagram", IG], ["tiktok", TT]]) await get(`contentDecay.${p}`, "/api/v1/analytics/content-decay", { accountId: acc });

// c) Instagram demographics: followers and engaged audience
await get("igDemographics.follower", "/api/v1/analytics/instagram/demographics", { accountId: IG, metric: "follower_demographics", timeframe: "this_month" });
await get("igDemographics.engaged", "/api/v1/analytics/instagram/demographics", { accountId: IG, metric: "engaged_audience_demographics", timeframe: "this_month" });
await get("igDemographics.engagedWeek", "/api/v1/analytics/instagram/demographics", { accountId: IG, metric: "engaged_audience_demographics", timeframe: "this_week" });

// d) TikTok per-post viewer countries ride on (a); recorded there as audienceCountries.

// e) Instagram Stories
const stories = await get("igStories", `/api/v1/accounts/${IG}/instagram/stories`);
const storyList = stories.body?.stories ?? stories.body?.data ?? [];
for (const [i, s] of (Array.isArray(storyList) ? storyList : []).slice(0, 3).entries()) {
  const id = s.id ?? s._id ?? s.storyId;
  if (id) await get(`igStoryInsights.${i}`, `/api/v1/accounts/${IG}/instagram/stories/${encodeURIComponent(id)}/insights`);
}

// f) comments: the commented-posts feed, then the most recent posts' comments
for (const [p, acc] of [["instagram", IG], ["tiktok", TT]]) await get(`inboxCommentedPosts.${p}`, "/api/v1/inbox/comments", { profileId: PROFILE, accountId: acc, limit: 10 });
for (const [p, acc] of [["instagram", IG], ["tiktok", TT]]) {
  for (const [i, post] of posts[p].slice(0, 3).entries()) {
    const native = post.platforms?.[0]?.platformPostId ?? post.platformPostId ?? null;
    const id = native ?? post._id;
    if (id) await get(`comments.${p}.${i}`, `/api/v1/inbox/comments/${encodeURIComponent(id)}`, { accountId: acc, limit: 25 });
  }
}

// g) webhook subscriptions (GET; secrets stripped by sanitize)
await get("webhooks", "/api/v1/webhooks/settings");

// h) best time
for (const [p, acc] of [["instagram", IG], ["tiktok", TT]]) await get(`bestTime.${p}`, "/api/v1/analytics/best-time", { accountId: acc });

writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${OUT} (${people.size} commenters replaced)`);
