/** Server-side read of a creator's public media kit by its slug (wiring, not copy). */
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { PublicKit } from "@/convex/partnerships/kitPage";

export async function readPublicKit(slug: string): Promise<PublicKit | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return await new ConvexHttpClient(url).query(api.partnerships.kitPage.publicKit, { slug }).catch(() => null);
}
