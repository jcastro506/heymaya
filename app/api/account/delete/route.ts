import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

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

  const clerk = await clerkClient();
  await clerk.users.deleteUser(userId);

  return NextResponse.json({
    ok: true,
    deleted: true,
    convexDeleted: purge.deleted,
  });
}
