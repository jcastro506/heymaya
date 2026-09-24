// Generate ScrapeCreators fixtures from the vendor's own OpenAPI response examples.
// These are `fixture: spec-example` fixtures (plan §16.7, overnight log): they let the
// read layer and every integration test run with zero credits. `npm run fixtures:record`
// replaces them with live recordings once credits exist.
//
//   node scripts/fixtures-from-spec.mjs [path-to-openapi.json]
//
// Default source: https://docs.scrapecreators.com/openapi.json (fetched if no path given).
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../convex/integrations/scrapeCreators/__tests__/fixtures/spec/", import.meta.url).pathname;
const PATHS = [
  "/v1/tiktok/profile", "/v1/tiktok/profile/region", "/v3/tiktok/profile/videos", "/v2/tiktok/video",
  "/v1/tiktok/video/transcript", "/v1/tiktok/video/comments", "/v1/tiktok/comment/replies",
  "/v1/tiktok/user/following", "/v1/tiktok/user/followers", "/v1/tiktok/user/audience",
  "/v1/tiktok/search/users", "/v1/tiktok/search/hashtag", "/v1/tiktok/search/keyword", "/v1/tiktok/search/top",
  "/v1/tiktok/search/suggestions", "/v1/tiktok/get-trending-feed", "/v1/tiktok/creators/popular",
  "/v1/tiktok/song", "/v1/tiktok/song/videos", "/v1/tiktok/collection/videos",
  "/v1/instagram/profile", "/v1/instagram/profile/post-count", "/v1/instagram/user/posts", "/v2/instagram/user/posts",
  "/v1/instagram/user/reels", "/v1/instagram/post", "/v2/instagram/post/comments", "/v2/instagram/media/transcript",
  "/v2/instagram/reels/search", "/v1/instagram/search", "/v1/instagram/search/popular", "/v1/instagram/search/profiles",
  "/v1/instagram/search/hashtag", "/v1/instagram/reels/trending", "/v1/instagram/audio/reels",
  "/v1/instagram/user/highlights", "/v1/instagram/user/highlight/detail",
  "/v1/find-social-profiles", "/v1/reddit/search", "/v1/credit-balance",
  "/v1/account/get-daily-usage-count", "/v1/account/get-most-used-routes",
];

const src = process.argv[2];
const spec = src
  ? JSON.parse(readFileSync(src, "utf8"))
  : await (await fetch("https://docs.scrapecreators.com/openapi.json")).json();

mkdirSync(OUT, { recursive: true });
const index = {};
for (const p of PATHS) {
  const op = spec.paths?.[p]?.get ?? spec.paths?.[p]?.post;
  const content = op?.responses?.["200"]?.content?.["application/json"];
  let example = content?.example;
  if (example === undefined && content?.examples) example = Object.values(content.examples)[0]?.value;
  if (example === undefined) example = content?.schema?.example;
  const file = p.replace(/^\//, "").replace(/[\/{}]/g, "_") + ".json";
  if (example === undefined) {
    index[p] = { file: null, credits: creditsOf(op) };
    continue;
  }
  writeFileSync(join(OUT, file), JSON.stringify(example, null, 2) + "\n");
  index[p] = { file, credits: creditsOf(op), summary: op?.summary ?? "" };
}
writeFileSync(join(OUT, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), source: "spec-example", paths: index }, null, 2) + "\n");
// One combined map for runtime use (bundled into Convex for SCRAPE_FIXTURES=spec and imported by tests).
const combined = {};
for (const [p, v] of Object.entries(index)) if (v.file) combined[p] = JSON.parse(readFileSync(join(OUT, v.file), "utf8"));
writeFileSync(new URL("../convex/integrations/scrapeCreators/fixtures.spec.json", import.meta.url).pathname, JSON.stringify(combined) + "\n");
const missing = Object.entries(index).filter(([, v]) => !v.file).map(([k]) => k);
console.log(`fixtures: ${Object.keys(index).length - missing.length} written to ${OUT}`);
if (missing.length) console.log("no example in spec for:", missing.join(", "));

function creditsOf(op) {
  const text = `${op?.description ?? ""} ${op?.summary ?? ""}`;
  const m = text.match(/(\d+)\s*credits?\s*per\s*request/i) ?? text.match(/costs?\s*(\d+)\s*credits?/i);
  return m ? Number(m[1]) : null;
}
