import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export async function GET(req: NextRequest) {
  try {
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" });
    const code = req.nextUrl.searchParams.get("code"), state = req.nextUrl.searchParams.get("state");
    if (!token || !code || !state || !process.env.NEXT_PUBLIC_CONVEX_URL) throw new Error("Incomplete connection");
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
    client.setAuth(token);
    await client.action(api.partnerships.mailbox.exchange, { code, state });
    return NextResponse.redirect(new URL("/app/settings?email=connected", req.url));
  } catch {
    return NextResponse.redirect(new URL("/app/settings?email_error=connection", req.url));
  }
}
