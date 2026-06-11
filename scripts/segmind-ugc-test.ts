/**
 * Segmind UGC-workflow smoke test (S0 quality spike).
 *
 * Fires a real Pixelflow workflow call (model image + product image + product
 * description -> UGC output), polls to completion, downloads every output asset
 * to ./segmind-test-output/, and reports latency + the raw result so we can
 * (a) eyeball the quality and (b) get a real timing data point for the scale plan.
 *
 * RUN:
 *   export SEGMIND_API_KEY=sk_...           # never hard-code the key
 *   npx tsx scripts/segmind-ugc-test.ts
 *
 * Optional overrides (env):
 *   SEGMIND_WORKFLOW_URL   - the workflow endpoint (defaults to the one provided)
 *   MODEL_IMAGE_URL        - the model/person image
 *   PRODUCT_IMAGE_URL      - the product image
 *   INPUT_PROMPT           - the product description / brief
 *
 * Notes baked in from research:
 *   - Workflow endpoint uses `Authorization: Bearer <key>` (NOT x-api-key).
 *   - Async: POST returns { poll_url }, GET poll_url every ~7s until COMPLETED/FAILED.
 *   - `result.output` is a JSON *string* -> parse it, then pull asset URLs.
 *   - Output URLs may be short-lived -> we download immediately.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API_KEY = process.env.SEGMIND_API_KEY;
const WORKFLOW_URL =
  process.env.SEGMIND_WORKFLOW_URL ??
  "https://api.segmind.com/workflows/v2/6a212a5325d09e2ed3925e18-v1";

const DATA = {
  model_input_image:
    process.env.MODEL_IMAGE_URL ??
    "https://segmind-inference-inputs.s3.amazonaws.com/3aeeaa02-0a44-4a69-a0bc-6795d076fce9-81386-output.jpg",
  product_input_image:
    process.env.PRODUCT_IMAGE_URL ??
    "https://segmind-inference-inputs.s3.amazonaws.com/386ecc78-442c-4b00-ae81-992420996383-ae990-output.jpg",
  input_prompt:
    process.env.INPUT_PROMPT ??
    `MindRelax – Smart Head Massager
Experience professional-grade relaxation at home with the MindRelax Smart Head Massager. Designed for modern stress relief, it combines intelligent technology with a premium build to deliver a deeply soothing massage whenever you need it most.
Key Features:
Deep Kneading Nodes — Multi-finger massage nodes replicate the feel of real hands, targeting the scalp, neck, and temples for thorough tension relief.
Multiple Modes & Intensity Levels — Switch between massage modes and adjust intensity using the dedicated Power, Mode, and Intensity buttons to personalise every session.
OLED Smart Display — A crisp built-in screen shows your battery level, active massage mode, and Bluetooth status in real time, so you're always in control.
Bluetooth Connectivity — Pair wirelessly with your smartphone to access personalised massage programs and settings right from your phone.
Long-Lasting Battery — A built-in rechargeable battery keeps you going through multiple sessions, with live charge percentage always visible on the display.
Premium Ergonomic Design — Lightweight and comfortable to hold, the MindRelax features a soft-touch white shell with brushed silver accents — built for both performance and style.
Ideal for stress relief, scalp care, relaxation before sleep, or unwinding after a long day. The MindRelax brings the spa experience to your fingertips.`,
};

const OUT_DIR = join(process.cwd(), "segmind-test-output");
const POLL_INTERVAL_MS = 7_000;
const MAX_POLL_MS = 15 * 60_000; // 15 min safety ceiling

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}` };
}

/** Recursively collect every http(s) URL string from a parsed output object. */
function collectUrls(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) acc.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectUrls(v, acc);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectUrls(v, acc);
  }
  return acc;
}

async function downloadAsset(url: string, idx: number): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext =
    (res.headers.get("content-type")?.split("/")[1] ?? "bin").split(";")[0];
  const file = join(OUT_DIR, `output-${idx}.${ext}`);
  await writeFile(file, buf);
  return `${file} (${(buf.length / 1024).toFixed(0)} KB, ${res.headers.get("content-type")})`;
}

async function poll(pollUrl: string): Promise<unknown> {
  const start = Date.now();
  let polls = 0;
  while (true) {
    if (Date.now() - start > MAX_POLL_MS) throw new Error("poll timeout");
    const res = await fetch(pollUrl, { headers: authHeaders() });
    const result = (await res.json()) as {
      status?: string;
      output?: string;
      error?: string;
    };
    polls++;
    process.stdout.write(
      `  poll #${polls} (${Math.round((Date.now() - start) / 1000)}s) -> ${result.status ?? "?"}\n`
    );
    if (result.status === "COMPLETED") {
      return typeof result.output === "string"
        ? JSON.parse(result.output)
        : result.output;
    }
    if (result.status === "FAILED") {
      throw new Error(result.error ?? "generation failed");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error("✖ SEGMIND_API_KEY is not set. `export SEGMIND_API_KEY=sk_...`");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`▶ POST ${WORKFLOW_URL}`);
  const t0 = Date.now();

  const res = await fetch(WORKFLOW_URL, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(DATA),
  });

  if (!res.ok) {
    console.error(`✖ submit failed: HTTP ${res.status}\n${await res.text()}`);
    process.exit(1);
  }

  const queued = (await res.json()) as { poll_url?: string; [k: string]: unknown };
  console.log("✓ queued:", JSON.stringify(queued));
  if (!queued.poll_url) {
    console.error("✖ no poll_url in response — cannot poll");
    process.exit(1);
  }

  const outputs = await poll(queued.poll_url);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ COMPLETED in ${elapsed}s`);
  console.log("raw output:", JSON.stringify(outputs, null, 2));

  const urls = collectUrls(outputs);
  if (urls.length === 0) {
    console.log("⚠ no asset URLs found in output — inspect raw output above.");
    return;
  }
  console.log(`\n⬇ downloading ${urls.length} asset(s) to ${OUT_DIR}/ ...`);
  for (let i = 0; i < urls.length; i++) {
    console.log(`  ${await downloadAsset(urls[i], i)}`);
  }
  console.log(`\n✅ Done. Total wall time: ${elapsed}s. Open ${OUT_DIR}/ to judge quality.`);
}

main().catch((err) => {
  console.error("✖", err instanceof Error ? err.message : err);
  process.exit(1);
});
