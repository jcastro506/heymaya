/**
 * Which platforms Maya works with (operator, 2026-10-12: "Instagram off for now", reversible). One switch, read at
 * the gates, never written into data: turning Instagram back on restores everything (handles, connections, posts).
 *
 * Off unless INSTAGRAM_ENABLED is "1" or "true" (Convex env for the backend, Vercel env for the website).
 * Tests default it on (tests/_clock.setup.ts) so the Instagram paths stay covered; off-mode tests stub it.
 */
export type Platform = "tiktok" | "instagram";

export function instagramOn(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.INSTAGRAM_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export function enabledPlatforms(env: Record<string, string | undefined> = process.env): Platform[] {
  return instagramOn(env) ? ["tiktok", "instagram"] : ["tiktok"];
}

export function platformOn(p: string | undefined | null, env: Record<string, string | undefined> = process.env): boolean {
  return p === "tiktok" || (p === "instagram" && instagramOn(env));
}

/** What she says when someone brings Instagram while it's off. */
export const TIKTOK_ONLY_LINE = "I only work with TikTok right now. Send me the TikTok version and I'm on it.";
