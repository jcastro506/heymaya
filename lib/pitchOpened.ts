/**
 * Tell Maya a pitch is on its way (partnerships/pipeline.opened): the brand counts as contacted and the follow-up
 * clock starts. Called from the browser on purpose: a link preview fetches the page but runs no script, so only a
 * person opening it counts. Waits at most a moment, then Gmail opens regardless (wiring, not copy).
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export async function recordPitchOpened(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return;
  await Promise.race([new ConvexHttpClient(url).mutation(api.partnerships.pipeline.opened, { code }).catch(() => undefined), new Promise((r) => setTimeout(r, 700))]);
}
