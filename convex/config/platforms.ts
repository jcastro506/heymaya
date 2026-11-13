/**
 * Maya works with TikTok only (operator, 2026-11-13: "we're tiktok only, not instagram anymore. the product shouldn't
 * be using or referencing it at all"). Was a switch (INSTAGRAM_ENABLED, off since 2026-10-13); now fixed off.
 * The schema still accepts "instagram" on old rows; nothing reads, offers or mentions it.
 */
export type Platform = "tiktok" | "instagram";

export function instagramOn(_env: Record<string, string | undefined> = process.env): boolean {
  return false;
}

export function enabledPlatforms(_env: Record<string, string | undefined> = process.env): Platform[] {
  return ["tiktok"];
}

export function platformOn(p: string | undefined | null, _env: Record<string, string | undefined> = process.env): boolean {
  return p === "tiktok";
}

/** What she says when someone brings an Instagram link. */
export const TIKTOK_ONLY_LINE = "I only work with TikTok. Send me the TikTok version and I'm on it.";
