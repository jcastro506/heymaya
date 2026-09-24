import { NextResponse } from "next/server";

/**
 * Liveness for the web app (listed as public in proxy.ts). Says only that this build is up and
 * which Convex deployment it was built against; no secrets, no database call.
 */
export function GET() {
  const convex = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const deployment = /^https:\/\/([a-z0-9-]+)\.convex\.cloud/.exec(convex)?.[1] ?? null;
  return NextResponse.json({ ok: true, convexDeployment: deployment, commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null });
}
