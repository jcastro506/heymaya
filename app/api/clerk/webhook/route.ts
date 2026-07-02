import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { destroyMayaFlyApps } from "@/lib/destroyMayaFlyApps";

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
    // The live product is the GTM agent ("Maya"), so a new signup defaults to
    // `accountType: "gtm-agent"` — startGtmOnboarding then creates the agent row
    // when the user reaches /onboarding/gtm. (Was "service-business", the now-
    // dead trades product — a fresh signup was landing in the wrong product.)
    // When the creator product is re-enabled the flag yields a bare row (the
    // account-type picker sets it). createFromClerkPublic only ever SETS a
    // missing accountType, never overwrites a live one.
    const accountType =
      process.env.NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT === "true"
        ? undefined
        : ("gtm-agent" as const);
    await convex.mutation(api.creators.createFromClerkPublic, {
      secret: bridgeSecret(),
      clerkUserId: data.id,
      email,
      accountType,
    });
  }

  // S7 — user.deleted backstop. If a user is deleted in Clerk directly
  // (bypassing our in-app /api/account/delete flow), this guarantees the
  // full purge still runs: cascade-delete all their data (incl. the ~47
  // GTM tables, cross-tenant learnings exempt) AND destroy their Fly
  // machine — otherwise inbound Telegram keeps hitting a live Maya that no
  // longer has an account behind it. Idempotent: creator-not-found is a
  // clean no-op, so Clerk retries are safe.
  if (evt.type === "user.deleted") {
    const data = evt.data as { id?: string; deleted?: boolean };
    if (data.id) {
      const purge = await convex.mutation(
        api.accountDeletion.purgeByClerkUserIdPublic,
        { secret: bridgeSecret(), clerkUserId: data.id, source: "web" }
      );
      const flyAppIds = "flyAppIds" in purge ? purge.flyAppIds : [];
      await destroyMayaFlyApps(flyAppIds ?? []);
    }
  }

  return NextResponse.json({ ok: true });
}
