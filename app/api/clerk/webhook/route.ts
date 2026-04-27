import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * Bridge secret for the public wrapper around `creators.createFromClerk`.
 * See `convex/lib/webhookSecret.ts` for setup.
 */
function bridgeSecret(): string {
  const s = process.env.WEBHOOK_INTERNAL_SECRET;
  if (!s) {
    throw new Error("WEBHOOK_INTERNAL_SECRET is not configured.");
  }
  return s;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 500 });
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "missing svix headers" }, { status: 400 });
  }

  const payload = await req.text();
  const wh = new Webhook(secret);
  let evt: { type: string; data: Record<string, unknown> };
  try {
    evt = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as { type: string; data: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  if (evt.type === "user.created") {
    const data = evt.data as {
      id: string;
      email_addresses?: Array<{ email_address: string }>;
    };
    const email = data.email_addresses?.[0]?.email_address;
    if (!email) {
      return NextResponse.json({ error: "no email on user" }, { status: 400 });
    }
    // Service-product Sprint 0 cleanup follow-up: when the creator product is
    // disabled (the default in production), every new signup defaults to
    // `accountType: "service-business"` — the public surface is service-only
    // until `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT === "true"` flips dual-track
    // signup back on. The Convex `createFromClerkPublic` mutation accepts the
    // optional accountType field; older / creator-product builds simply
    // ignore it.
    const accountType =
      process.env.NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT === "true"
        ? undefined
        : ("service-business" as const);
    await convex.mutation(api.creators.createFromClerkPublic, {
      secret: bridgeSecret(),
      clerkUserId: data.id,
      email,
      accountType,
    });
  }

  return NextResponse.json({ ok: true });
}
