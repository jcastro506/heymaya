import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export async function GET(req: NextRequest) {
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/sign-in?redirect_url=%2Fapp%2Fsettings", req.url));
  try {
    const token = await getToken({ template: "convex" });
    if (!token || !process.env.NEXT_PUBLIC_CONVEX_URL) throw new Error("No session");
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
    client.setAuth(token);
    return NextResponse.redirect(await client.mutation(api.partnerships.mailbox.connect, {}));
  } catch {
    return NextResponse.redirect(new URL("/app/settings?email_error=connection", req.url));
  }
}
