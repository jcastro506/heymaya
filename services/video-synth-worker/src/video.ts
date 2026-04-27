/**
 * yt-dlp wrapper — downloads a creator post's video to a local temp file.
 *
 * Direct port of `MayaClaude/hey-maya/server/src/lib/video.ts`, extended with
 * per-platform impersonation flags (TikTok requires --impersonate chrome-131;
 * Instagram requires Referer header injection; YouTube generally needs a
 * cookies file in production but works without one for public videos).
 *
 * Cleanup: caller is responsible for invoking `cleanupVideo` in a finally
 * block. Each tempfile name embeds Date.now() + a counter so concurrent
 * downloads from the same request don't collide.
 *
 * Security: every value passed into `execFile` is an argv element — we NEVER
 * shell-interpolate user URLs. yt-dlp itself parses the URL.
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

const execFileP = promisify(execFile);

export const TMP_DIR = process.env.WORKER_TMP_DIR ?? "/tmp/heymaya-videos";

export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x"
  | "twitter"
  | "facebook"
  | "unknown";

export interface DownloadResult {
  ok: boolean;
  filePath?: string;
  error?: string;
  /** Wall-clock seconds the download took. */
  elapsedSec: number;
}

/** Bounded counter so per-request parallel downloads don't pick the same name. */
let __counter = 0;
function nextCounter(): number {
  __counter = (__counter + 1) % 1_000_000;
  return __counter;
}

function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

/**
 * Per-platform argv extension. Returns the EXTRA argv elements only — the
 * common output / quiet / no-warnings args are added once in `downloadVideo`.
 *
 * TikTok / Instagram are the platforms where v0 sees the most failures
 * without these flags:
 *   • TikTok: --impersonate chrome-131 sidesteps the empty-response wall TT
 *     puts up for plain HTTP libcurl traffic. Confirmed via yt-dlp issue
 *     #11400 + community guidance, current as of 2026-04 yt-dlp builds.
 *   • Instagram: Reels need a Referer matching the canonical reel URL or
 *     Instagram returns a 401 without surfacing why. The header is the same
 *     for all reels — bake it in.
 *   • YouTube: works without flags for public Shorts/long-form. If we ever
 *     hit age-gate or login-walled videos we'll need a cookies file (not v0).
 */
function platformArgs(platform: Platform, videoUrl: string): string[] {
  switch (platform) {
    case "tiktok":
      return ["--impersonate", "chrome-131"];
    case "instagram":
      return [
        "--add-header",
        `Referer: https://www.instagram.com/`,
        // IG sometimes redirects to login; --user-agent matching a real
        // browser sidesteps a couple of the soft walls.
        "--user-agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      ];
    case "youtube":
      // Prefer mp4 with audio for downstream Gemini compat.
      return ["--format", "mp4/best[ext=mp4]/best"];
    case "linkedin":
    case "x":
    case "twitter":
    case "facebook":
    case "unknown":
    default:
      void videoUrl;
      return [];
  }
}

/**
 * Detect whether the URL is a TikTok photo/slideshow post. yt-dlp can't
 * download these as video and they're not useful for multimodal hook
 * synthesis anyway — skip them at the source.
 */
function isUnsupportedPost(platform: Platform, videoUrl: string): boolean {
  if (platform === "tiktok" && videoUrl.includes("/photo/")) {
    return true;
  }
  return false;
}

export interface DownloadOptions {
  /** Per-call timeout in ms. Default 60s. */
  timeoutMs?: number;
  /** Test seam — inject a fake exec implementation. */
  execImpl?: typeof execFileP;
  /** Override temp dir (mainly for tests). */
  tmpDir?: string;
}

/**
 * Download one video to a local temp mp4. Returns `{ok:false}` for skipped /
 * failed downloads — we NEVER throw from this function; the caller treats
 * a skipped post as text-only-fallback in the prompt.
 */
export async function downloadVideo(
  platform: Platform,
  videoUrl: string,
  opts: DownloadOptions = {}
): Promise<DownloadResult> {
  const start = Date.now();
  const tmpDir = opts.tmpDir ?? TMP_DIR;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const exec = opts.execImpl ?? execFileP;

  if (isUnsupportedPost(platform, videoUrl)) {
    return {
      ok: false,
      error: `unsupported-post-type:${platform}`,
      elapsedSec: 0,
    };
  }

  if (opts.tmpDir) {
    if (!existsSync(opts.tmpDir)) mkdirSync(opts.tmpDir, { recursive: true });
  } else {
    ensureTmpDir();
  }

  const filename = `vid_${Date.now()}_${nextCounter()}.mp4`;
  const outputPath = path.join(tmpDir, filename);

  const argv = [
    "-o",
    outputPath,
    "--no-warnings",
    "--quiet",
    // Don't write thumbnails / info json files alongside.
    "--no-write-info-json",
    "--no-write-thumbnail",
    // Prefer mp4 universally so Gemini Files API doesn't have to remux.
    "--merge-output-format",
    "mp4",
    ...platformArgs(platform, videoUrl),
    videoUrl,
  ];

  try {
    await exec("yt-dlp", argv, {
      timeout: timeoutMs,
      // yt-dlp can be chatty on stderr; cap at 2MB so a misbehaving extractor
      // can't OOM us via stderr alone.
      maxBuffer: 2 * 1024 * 1024,
    });
    if (!existsSync(outputPath)) {
      return {
        ok: false,
        error: "yt-dlp-no-output-file",
        elapsedSec: (Date.now() - start) / 1000,
      };
    }
    return {
      ok: true,
      filePath: outputPath,
      elapsedSec: (Date.now() - start) / 1000,
    };
  } catch (err) {
    // Defensive cleanup of any partial file.
    cleanupVideo(outputPath);
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: truncate(message, 400),
      elapsedSec: (Date.now() - start) / 1000,
    };
  }
}

/**
 * Best-effort delete. Never throws — we always want to keep going through
 * the cleanup loop even if one file is gone or locked.
 */
export function cleanupVideo(filePath: string | undefined | null): void {
  if (!filePath) return;
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // ignore — temp dir is wiped on container restart anyway
  }
}

/**
 * Remove ALL files in TMP_DIR — used as a defense-in-depth cleanup at the
 * end of each request so a half-cleaned previous request can't accumulate
 * disk pressure across many invocations on a long-lived machine.
 */
export function cleanupTmpDirOlderThan(maxAgeSec: number, tmpDir: string = TMP_DIR): void {
  try {
    if (!existsSync(tmpDir)) return;
    const cutoff = Date.now() - maxAgeSec * 1000;
    for (const name of readdirSync(tmpDir)) {
      const full = path.join(tmpDir, name);
      try {
        const st = statSync(full);
        if (st.isFile() && st.mtimeMs < cutoff) {
          unlinkSync(full);
        }
      } catch {
        // ignore per-file errors
      }
    }
  } catch {
    // ignore
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "...[truncated]";
}
