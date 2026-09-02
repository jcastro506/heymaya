import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * Deletion, step 8 (plan §16.5): the typed confirmation reaches Convex, which
 * freezes the account and runs steps 2–7; this route waits for the rows to be gone,
 * then deletes the Clerk user, so a login can never resurrect a purged creator.
 * PostHog person deletion needs a personal API key and is an operator step for now.
 */
export async function POST(req: NextRequest) {
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.json({ ok: false, reason: "not signed in" }, { status: 401 });
  const { confirm } = (await req.json().catch(() => ({}))) as { confirm?: string };
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const clerkToken = await getToken({ template: "convex" });
  if (!convexUrl || !clerkToken) return NextResponse.json({ ok: false, reason: "not configured" }, { status: 500 });
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(clerkToken);

  const r = await client.mutation(api.account.deletion.requestDelete, { confirm: confirm ?? "" });
  if (!r.ok || !r.creatorId) return NextResponse.json({ ok: false, reason: r.reason ?? "refused" }, { status: 400 });

  // Wait for the purge (bounded), then drop the identity.
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    gone = (await client.action(api.account.deletion.gone, { creatorId: r.creatorId }).catch(() => ({ gone: false }))).gone;
  }
  try {
    const clerk = await clerkClient();
    await clerk.users.deleteUser(userId);
  } catch (e) {
    return NextResponse.json({ ok: true, rowsGone: gone, identity: `clerk delete failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}` });
  }
  return NextResponse.json({ ok: true, rowsGone: gone, identity: "deleted" });
}
