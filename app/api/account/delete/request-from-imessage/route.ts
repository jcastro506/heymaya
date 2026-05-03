import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function bridgeSecret(): string {
  const secret = process.env.WEBHOOK_INTERNAL_SECRET;
  if (!secret) throw new Error("WEBHOOK_INTERNAL_SECRET is not configured.");
  return secret;
}

type Body = {
  channel?: "imessage" | "whatsapp" | "sms";
  phoneNumber?: string;
};

export async function POST(req: NextRequest) {
  const inboundSecret = req.headers.get("x-maya-webhook-secret");
  if (!inboundSecret || inboundSecret !== process.env.WEBHOOK_INTERNAL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.channel || !body.phoneNumber) {
    return NextResponse.json(
      { error: "channel and phoneNumber are required." },
      { status: 400 }
    );
  }

  const result = await convex.mutation(
    api.accountDeletion.requestDeletionByPhonePublic,
    {
      secret: bridgeSecret(),
      channel: body.channel,
      phoneNumber: body.phoneNumber,
    }
  );

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
