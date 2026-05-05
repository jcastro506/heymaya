import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { FlyClient, FlyError } from "@/convex/lib/flyClient";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function bridgeSecret(): string {
  const secret = process.env.WEBHOOK_INTERNAL_SECRET;
  if (!secret) throw new Error("WEBHOOK_INTERNAL_SECRET is not configured.");
  return secret;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { confirmation?: unknown };
  try {
    body = (await req.json()) as { confirmation?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.confirmation !== "DELETE MAYA") {
    return NextResponse.json(
      { error: "Type DELETE MAYA to confirm account deletion." },
      { status: 400 }
    );
  }

  const purge = await convex.mutation(api.accountDeletion.purgeByClerkUserIdPublic, {
    secret: bridgeSecret(),
    clerkUserId: userId,
    source: "web",
  });

  const flyCleanup = await destroyMayaFlyApps(purge.flyAppIds ?? []);

  const clerk = await clerkClient();
  await clerk.users.deleteUser(userId);

  return NextResponse.json({
    ok: true,
    deleted: true,
    convexDeleted: purge.deleted,
    flyCleanup,
  });
}

async function destroyMayaFlyApps(flyAppIds: readonly string[]) {
  const uniqueAppIds = [...new Set(flyAppIds.filter(Boolean))];
  if (uniqueAppIds.length === 0) {
    return { attempted: 0, destroyed: 0, skipped: 0, errors: [] };
  }
  if (!process.env.FLY_API_TOKEN) {
    return {
      attempted: 0,
      destroyed: 0,
      skipped: uniqueAppIds.length,
      errors: uniqueAppIds.map((appId) => ({
        appId,
        message: "FLY_API_TOKEN is not configured.",
      })),
    };
  }

  const fly = new FlyClient();
  const errors: Array<{ appId: string; message: string }> = [];
  let destroyed = 0;
  for (const appId of uniqueAppIds) {
    try {
      await fly.destroyApp(appId);
      destroyed += 1;
    } catch (error) {
      if (error instanceof FlyError && error.status === 404) {
        continue;
      }
      errors.push({
        appId,
        message: error instanceof Error ? error.message : "Fly cleanup failed.",
      });
    }
  }
  return {
    attempted: uniqueAppIds.length,
    destroyed,
    skipped: 0,
    errors,
  };
}
