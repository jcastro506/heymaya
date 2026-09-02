#!/usr/bin/env node
/**
 * Record real vendor responses into fixtures.recorded.json (plan §17.1), one call per
 * path with a sample query, through the dev deployment so the key never leaves it.
 * Costs credits (post detail 10, IG comments 15; the rest 1). Run once credits exist:
 *   npm run fixtures:record
 * Then set SCRAPE_FIXTURES=recorded on the deployment that should replay them.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SAMPLES = [
  ["/v1/tiktok/profile", { handle: "stoolpresidente" }],
  ["/v3/tiktok/profile/videos", { handle: "stoolpresidente" }],
  ["/v2/tiktok/video", { url: "https://www.tiktok.com/@stoolpresidente/video/7499229683859426602" }],
  ["/v1/tiktok/video/transcript", { url: "https://www.tiktok.com/@stoolpresidente/video/7499229683859426602" }],
  ["/v1/tiktok/video/comments", { url: "https://www.tiktok.com/@stoolpresidente/video/7499229683859426602" }],
  ["/v1/tiktok/search/keyword", { query: "marathon training", date_posted: "this-week", sort_by: "most-liked" }],
  ["/v1/tiktok/search/hashtag", { hashtag: "marathontraining" }],
  ["/v1/tiktok/search/top", { query: "marathon training", date_posted: "this-week" }],
  ["/v1/tiktok/search/suggestions", { query: "marathon" }],
  ["/v1/tiktok/get-trending-feed", { region: "US" }],
  ["/v1/tiktok/creators/popular", { band: "100K-1M", country: "US" }],
  ["/v1/instagram/profile", { handle: "nike" }],
  ["/v2/instagram/user/posts", { handle: "nike" }],
  ["/v2/instagram/reels/search", { query: "marathon training" }],
  ["/v1/instagram/search/popular", { query: "marathon training" }],
  ["/v1/instagram/reels/trending", {}],
  ["/v1/credit-balance", {}],
];

const out = {};
for (const [path, query] of SAMPLES) {
  process.stdout.write(`${path} … `);
  try {
    const raw = execFileSync("arch", ["-arm64", "npx", "convex", "run", "onboarding/dev:recordFixture", JSON.stringify({ path, query })], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const r = JSON.parse(raw);
    if (r.ok) {
      out[path] = r.body;
      console.log(`ok (${r.body?.credits_charged ?? "?"} credits)`);
    } else console.log(`FAILED ${r.status ?? ""} ${r.reason ?? ""}`);
  } catch (e) {
    console.log(`error: ${String(e).slice(0, 120)}`);
  }
}
const file = new URL("../convex/integrations/scrapeCreators/fixtures.recorded.json", import.meta.url);
let existing = {};
try { existing = JSON.parse(readFileSync(file, "utf8")); } catch {}
writeFileSync(file, JSON.stringify({ ...existing, ...out, _recordedAt: new Date().toISOString() }, null, 2));
console.log(`wrote ${Object.keys(out).length} paths to fixtures.recorded.json`);
