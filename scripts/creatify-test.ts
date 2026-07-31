/**
 * Creatify URL-to-Video test — the "brief → finished edited ad" API.
 * This is the capability Captions keeps app-only: give a product, Creatify
 * writes the script AND assembles the edited 9:16 UGC ad (avatar + b-roll +
 * captions + music). We run our Tidy example through it and judge realism.
 *
 * Two modes:
 *   - AUTO  (default): Creatify writes the script from the link metadata.
 *   - HYBRID (OVERRIDE_SCRIPT set): Maya writes the script, Creatify renders
 *     the full edit — pairs our scripting strength with their pipeline.
 *
 * RUN (keys from the Creatify dashboard — API access needs the Business plan):
 *   CREATIFY_API_ID=xxx CREATIFY_API_KEY=yyy npx tsx scripts/creatify-test.ts
 *
 * Optional env:
 *   PRODUCT_URL   the URL to scrape (default a real photo-cleaner app so the
 *                 auto-script has genuine metadata to work from)
 *   OVERRIDE_SCRIPT  set to force HYBRID mode with Maya's script
 *   TIDY_IMAGE_URL   a hosted product screenshot to attach to the link
 *   VISUAL_STYLE  default DynamicProductTemplate
 *   SCRIPT_STYLE  default DontWorryWriter
 *   VIDEO_LENGTH  default 15
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ID = process.env.CREATIFY_API_ID;
const KEY = process.env.CREATIFY_API_KEY;
const BASE = "https://api.creatify.ai";
const OUT = join(process.cwd(), "creatify-test-output");

const PRODUCT_URL = process.env.PRODUCT_URL ?? "https://gemini.google.com"; // placeholder; override with a real product page
const OVERRIDE_SCRIPT = process.env.OVERRIDE_SCRIPT; // set => HYBRID (Maya's script)
const TIDY_IMAGE_URL = process.env.TIDY_IMAGE_URL ?? "https://tmpfiles.org/dl/wIwAnVm0s3jm/hero.png";
const VISUAL_STYLE = process.env.VISUAL_STYLE ?? "DynamicProductTemplate";
const SCRIPT_STYLE = process.env.SCRIPT_STYLE ?? "DontWorryWriter";
const VIDEO_LENGTH = Number(process.env.VIDEO_LENGTH ?? "15");

// Set REFERENCE_VIDEO_URL to run AD CLONE mode instead: copy a winning TikTok's
// structure/pacing/style onto our product. This is the "copy the winning video"
// capability — feed a proven ad as the reference, get our product in its format.
const REFERENCE_VIDEO_URL = process.env.REFERENCE_VIDEO_URL;

function headers(): Record<string, string> {
  return { "content-type": "application/json", "X-API-ID": ID as string, "X-API-KEY": KEY as string };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createTidyLink(): Promise<string> {
  console.log(`▶ POST /api/links/  (${PRODUCT_URL})`);
  const lk = await fetch(`${BASE}/api/links/`, { method: "POST", headers: headers(), body: JSON.stringify({ url: PRODUCT_URL }) });
  const lkj = (await lk.json()) as Record<string, unknown>;
  if (!lk.ok) { console.error(`✖ links HTTP ${lk.status}:`, JSON.stringify(lkj, null, 2)); process.exit(1); }
  const linkId = lkj.id as string;
  console.log(`✓ link ${linkId}`);
  console.log(`▶ PUT /api/links/${linkId}/  (Tidy metadata + screenshot)`);
  await fetch(`${BASE}/api/links/${linkId}/`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({
      title: "Tidy — Tinder for your camera roll",
      description:
        "Tidy turns cleaning your camera roll into a game. Swipe left to delete, swipe right to keep. Clear thousands of photos in minutes and free up storage instantly.",
      image_urls: [TIDY_IMAGE_URL],
    }),
  });
  return linkId;
}

async function pollDownload(getUrl: string, outName: string, t0: number): Promise<void> {
  let v: Record<string, unknown> = {};
  while (true) {
    if (Date.now() - t0 > 12 * 60_000) throw new Error("timeout");
    await sleep(8_000);
    v = (await (await fetch(getUrl, { headers: headers() })).json()) as Record<string, unknown>;
    const st = v.status as string;
    const pr = v.progress as number | undefined;
    process.stdout.write(`  poll (${Math.round((Date.now() - t0) / 1000)}s) -> ${st}${pr != null ? ` ${Math.round(pr * 100)}%` : ""}\n`);
    if (st === "done") break;
    if (st === "failed") { console.error("✖ failed:", v.failed_reason ?? JSON.stringify(v)); process.exit(1); }
  }
  const url = (v.video_output ?? v.output ?? v.video_url) as string;
  if (!url) { console.log("⚠ no output url:", JSON.stringify(v).slice(0, 500)); return; }
  const dl = await fetch(url);
  await writeFile(join(OUT, outName), Buffer.from(await dl.arrayBuffer()));
  console.log(`\n✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s (credits=${v.credits_used}) → creatify-test-output/${outName}`);
}

async function main(): Promise<void> {
  if (!ID || !KEY) { console.error("✖ need CREATIFY_API_ID + CREATIFY_API_KEY (dashboard → API, Business plan)"); process.exit(1); }
  await mkdir(OUT, { recursive: true });
  const t0 = Date.now();

  // AD CLONE MODE — copy a winning reference ad's format onto Tidy.
  if (REFERENCE_VIDEO_URL) {
    const linkId = await createTidyLink();
    console.log(`▶ POST /api/ads_clone/  — cloning ${REFERENCE_VIDEO_URL}`);
    const ac = await fetch(`${BASE}/api/ads_clone/`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ link: linkId, video_url: REFERENCE_VIDEO_URL, aspect_ratio: "9x16" }),
    });
    const acj = (await ac.json()) as Record<string, unknown>;
    if (!ac.ok) { console.error(`✖ ads_clone HTTP ${ac.status}:`, JSON.stringify(acj, null, 2)); process.exit(1); }
    const cid = acj.id as string;
    console.log(`✓ ad-clone task ${cid}  status=${acj.status}`);
    await pollDownload(`${BASE}/api/ads_clone/${cid}/`, "creatify-adclone.mp4", t0);
    return;
  }

  // 1) Create link from the product URL — Creatify scrapes title/desc/images.
  console.log(`▶ POST /api/links/  (${PRODUCT_URL})`);
  const lk = await fetch(`${BASE}/api/links/`, { method: "POST", headers: headers(), body: JSON.stringify({ url: PRODUCT_URL }) });
  const lkj = (await lk.json()) as Record<string, unknown>;
  if (!lk.ok) { console.error(`✖ links HTTP ${lk.status}:`, JSON.stringify(lkj, null, 2)); process.exit(1); }
  const linkId = lkj.id as string;
  console.log(`✓ link ${linkId}  title="${String(lkj.title ?? "").slice(0, 60)}"`);

  // 2) Override metadata so the ad is genuinely about Tidy (our sample product).
  console.log(`▶ PUT /api/links/${linkId}/  (Tidy metadata + screenshot)`);
  await fetch(`${BASE}/api/links/${linkId}/`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({
      title: "Tidy — Tinder for your camera roll",
      description:
        "Tidy turns cleaning your camera roll into a game. Swipe left to delete, swipe right to keep. Clear thousands of photos in minutes and free up storage instantly. The fun, fast way to fix a messy camera roll.",
      image_urls: [TIDY_IMAGE_URL],
    }),
  });

  // 3) Generate the edited ad.
  const mode = OVERRIDE_SCRIPT ? "HYBRID (Maya script)" : "AUTO (Creatify script)";
  console.log(`▶ POST /api/link_to_videos/  — ${mode}, ${VISUAL_STYLE}/${SCRIPT_STYLE}, ${VIDEO_LENGTH}s 9x16 TikTok`);
  const gen = await fetch(`${BASE}/api/link_to_videos/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      link: linkId,
      visual_style: VISUAL_STYLE,
      script_style: SCRIPT_STYLE,
      aspect_ratio: "9x16",
      video_length: VIDEO_LENGTH,
      language: "en",
      target_audience: "Gen Z and millennials with thousands of unorganized photos clogging their phone storage",
      target_platform: "Tiktok",
      ...(OVERRIDE_SCRIPT ? { override_script: OVERRIDE_SCRIPT } : {}),
      no_caption: false,
      no_cta: false,
      no_stock_broll: false,
    }),
  });
  const genj = (await gen.json()) as Record<string, unknown>;
  if (!gen.ok) { console.error(`✖ generate HTTP ${gen.status}:`, JSON.stringify(genj, null, 2)); process.exit(1); }
  const vidId = genj.id as string;
  console.log(`✓ video ${vidId}  status=${genj.status}`);

  // 4) Poll to completion.
  let v: Record<string, unknown> = {};
  while (true) {
    if (Date.now() - t0 > 12 * 60_000) throw new Error("timeout");
    await sleep(8_000);
    v = (await (await fetch(`${BASE}/api/link_to_videos/${vidId}/`, { headers: headers() })).json()) as Record<string, unknown>;
    const st = v.status as string;
    const pr = v.progress as number | undefined;
    process.stdout.write(`  poll (${Math.round((Date.now() - t0) / 1000)}s) -> ${st}${pr != null ? ` ${Math.round(pr * 100)}%` : ""}\n`);
    if (st === "done") break;
    if (st === "failed") { console.error("✖ failed:", v.failed_reason ?? JSON.stringify(v)); process.exit(1); }
  }

  const url = v.video_output as string;
  if (!url) { console.log("⚠ no video_output:", JSON.stringify(v).slice(0, 400)); return; }
  const dl = await fetch(url);
  await writeFile(join(OUT, "creatify-tidy.mp4"), Buffer.from(await dl.arrayBuffer()));
  console.log(`\n✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s (credits_used=${v.credits_used}) → creatify-test-output/creatify-tidy.mp4`);
}
main().catch((e) => { console.error("✖", e instanceof Error ? e.message : e); process.exit(1); });
