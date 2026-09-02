import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/** The export offered before deletion (plan §16.5): their rows as one JSON file. */
export async function GET() {
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.json({ ok: false, reason: "not signed in" }, { status: 401 });
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const clerkToken = await getToken({ template: "convex" });
  if (!convexUrl || !clerkToken) return NextResponse.json({ ok: false, reason: "not configured" }, { status: 500 });
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(clerkToken);
  const data = await client.query(api.account.deletion.exportMine, {});
  if (!data) return NextResponse.json({ ok: false, reason: "no account" }, { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="maya-export-${new Date().toISOString().slice(0, 10)}.json"` } });
}
