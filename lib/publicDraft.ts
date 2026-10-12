/** Server-side read of a pitch draft for the one-tap send page, by its code (wiring, not copy). */
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { PublicDraft } from "@/convex/partnerships/drafts";

export async function readPublicDraft(code: string): Promise<PublicDraft | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return await new ConvexHttpClient(url).query(api.partnerships.drafts.publicDraft, { code }).catch(() => null);
}
