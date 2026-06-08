/**
 * GTM Capability Smoke — verifies each external DATA capability the agent
 * relies on, WITHOUT a Fly deploy. The agent's *orchestration* needs the
 * machine; the underlying capabilities (API calls + multimodal) do not.
 *
 * Run: arch -arm64 npx tsx scripts/gtm-capability-smoke.ts
 *
 * Reads keys from .env.local. Prints a per-capability ✓/✗ matrix.
 * Use this as the fast pre-deploy smoke instead of a 20-min Fly round-trip.
 */
import { readFileSync } from "node:fs";

function env(k: string): string {
  try {
    const m = readFileSync(".env.local", "utf8").match(
      new RegExp("^" + k + "=(.*)$", "m")
    );
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

const SC_KEY = env("SCRAPE_CREATORS_API_KEY");
const TW_KEY = env("TWITTERAPI_IO_KEY");

async function scrape(path: string, params: Record<string, string>) {
  const url = new URL("https://api.scrapecreators.com" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "x-api-key": SC_KEY } });
  const text = await res.text();
  return { status: res.status, text, bytes: text.length };
}

type Check = { name: string; run: () => Promise<{ ok: boolean; detail: string }> };

const checks: Check[] = [
  {
    name: "ScrapeCreators · TikTok keyword search",
    run: async () => {
      const { status, text, bytes } = await scrape("/v1/tiktok/search/keyword", {
        query: "screen recording demo",
      });
      const hits = (text.match(/aweme_id|aweme_info|"video"/gi) || []).length;
      return { ok: status === 200 && hits > 0, detail: `HTTP ${status}, ${bytes}B, ~${hits} video hits` };
    },
  },
  {
    name: "ScrapeCreators · Instagram reels search",
    run: async () => {
      const { status, text, bytes } = await scrape("/v2/instagram/reels/search", {
        query: "product demo",
      });
      const hits = (text.match(/"id"|reel|media|shortcode/gi) || []).length;
      return { ok: status === 200 && hits > 0, detail: `HTTP ${status}, ${bytes}B, ~${hits} hits` };
    },
  },
  {
    name: "ScrapeCreators · YouTube search",
    run: async () => {
      const { status, text, bytes } = await scrape("/v1/youtube/search", {
        query: "screen studio tutorial",
      });
      const hits = (text.match(/videoId|watch\?v=|"title"/gi) || []).length;
      return { ok: status === 200 && hits > 0, detail: `HTTP ${status}, ${bytes}B, ~${hits} hits` };
    },
  },
  {
    name: "ScrapeCreators · Reddit search",
    run: async () => {
      const { status, text, bytes } = await scrape("/v1/reddit/search", {
        query: "screen studio alternative",
      });
      const hits = (text.match(/subreddit|permalink|"title"|ups/gi) || []).length;
      return { ok: status === 200 && hits > 0, detail: `HTTP ${status}, ${bytes}B, ~${hits} hits` };
    },
  },
  {
    name: "TwitterAPI.io · advanced search",
    run: async () => {
      const url = new URL("https://api.twitterapi.io/twitter/tweet/advanced_search");
      url.searchParams.set("query", "screen studio");
      url.searchParams.set("queryType", "Latest");
      const res = await fetch(url, { headers: { "x-api-key": TW_KEY } });
      const text = await res.text();
      const hits = (text.match(/"text"|tweet|"id"/gi) || []).length;
      return { ok: res.status === 200 && hits > 0, detail: `HTTP ${res.status}, ${text.length}B, ~${hits} hits` };
    },
  },
  {
    name: "Algolia HN · comment search (free, no key)",
    run: async () => {
      const url = new URL("https://hn.algolia.com/api/v1/search");
      url.searchParams.set("query", "screen recording demo");
      url.searchParams.set("tags", "comment");
      const res = await fetch(url);
      const json = (await res.json()) as { hits?: unknown[] };
      const n = json.hits?.length ?? 0;
      return { ok: res.status === 200 && n > 0, detail: `HTTP ${res.status}, ${n} comments` };
    },
  },
];

(async () => {
  console.log("\n=== GTM Capability Smoke (no Fly deploy) ===");
  console.log(
    `keys: ScrapeCreators=${SC_KEY ? "set" : "MISSING"} TwitterAPI.io=${TW_KEY ? "set" : "MISSING"}\n`
  );
  let pass = 0;
  for (const c of checks) {
    try {
      const r = await c.run();
      if (r.ok) pass++;
      console.log(`${r.ok ? "✓" : "✗"}  ${c.name.padEnd(42)} ${r.detail}`);
    } catch (e) {
      console.log(`✗  ${c.name.padEnd(42)} ERROR: ${(e as Error).message}`);
    }
  }
  console.log(`\n${pass}/${checks.length} capabilities passing.\n`);
})();
