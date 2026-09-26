/** Server-side read of a creator's public media kit by its slug, and the per-brand open (wiring, not copy). */
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { PublicKit } from "@/convex/partnerships/kitPage";

export async function readPublicKit(slug: string): Promise<PublicKit | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return await new ConvexHttpClient(url).query(api.partnerships.kitPage.publicKit, { slug }).catch(() => null);
}

/**
 * K1: a view of a per-brand link. The server decides whether it counts (after the pitch went out,
 * never a preview bot); a signed-in viewer is passed along so the creator's own look never counts.
 */
export async function recordKitOpen(slug: string, userAgent: string | null): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return;
  const client = new ConvexHttpClient(url);
  try {
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" });
    if (token) client.setAuth(token);
  } catch {
    // Signed out, or no session support on this request: an anonymous view.
  }
  await client.mutation(api.partnerships.kitSettings.recordOpen, { slug, userAgent: userAgent ?? undefined }).catch(() => undefined);
}
