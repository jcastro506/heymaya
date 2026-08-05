/**
 * The inbound file path.
 *
 * She asked for a screen recording. The founder sent one. Until this path
 * existed, **nothing happened** — the switchboard forked on `message.text`, and
 * on a media message `text` is always undefined.
 *
 * These tests are mostly about message SHAPE, because every real bug here is a
 * shape bug: two different things arriving as `video/mp4`, a GIF that is also a
 * document, an album that is five updates pretending to be one.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  extractFile,
  oversizeMessage,
  TELEGRAM_MAX_BYTES,
  ALBUM_SETTLE_MS,
} from "../telegramFiles";
import type { TelegramInboundMessage } from "../../integrations/telegram/client";
import type { Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 14, 0, 0);

function msg(over: Partial<TelegramInboundMessage>): TelegramInboundMessage {
  return {
    message_id: 1,
    date: NOW / 1000,
    chat: { id: 42, type: "private" },
    ...over,
  };
}

const file = (id: string, size?: number) => ({
  file_id: id,
  file_unique_id: `u_${id}`,
  file_size: size,
});

describe("⭐ EXTRACTING THE FILE", () => {
  it("takes the LARGEST photo, not the first", () => {
    // Telegram sends PhotoSize ascending. Taking [0] gets a thumbnail — which
    // still classifies as a product screenshot and is useless to render from.
    const got = extractFile(
      msg({
        photo: [
          { ...file("thumb"), width: 90, height: 60 },
          { ...file("mid"), width: 320, height: 213 },
          { ...file("full"), width: 1280, height: 853 },
        ],
      })
    );
    expect(got?.fileId).toBe("full");
  });

  it("⭐ A GIF IS MATCHED BEFORE THE DOCUMENT IT ALSO IS", () => {
    // An animation message carries BOTH `animation` and `document`. Checking
    // document first files every GIF as a generic file and throws away the
    // fact that it's motion we can pull frames from.
    const got = extractFile(
      msg({
        animation: { ...file("anim"), mime_type: "video/mp4" },
        document: { ...file("anim_doc"), mime_type: "video/mp4" },
      })
    );
    expect(got?.fileId).toBe("anim");
    expect(got?.kindHint).toBe("screen_recording");
  });

  it("⭐ A VIDEO NOTE IS NEVER A SCREEN RECORDING", () => {
    // THE expensive one. A video_note is the round selfie bubble, and its mime
    // is video/mp4 exactly like a real screen recording. `kindFor` maps every
    // video mime to screen_recording, so filing it that way sets
    // `libraryHealth.hasRecording` — which suppresses the ask PERMANENTLY.
    //
    // The founder would never be asked for product footage again, on the
    // strength of a three-second wave at the camera.
    const got = extractFile(msg({ video_note: { ...file("note"), duration: 3 } }));
    expect(got?.kindHint).toBe("video");
    expect(got?.kindHint).not.toBe("screen_recording");
  });

  it("a real video is a screen recording", () => {
    expect(extractFile(msg({ video: { ...file("v"), mime_type: "video/mp4" } }))?.kindHint)
      .toBe("screen_recording");
  });

  it("a document has no kind hint — the mime decides", () => {
    // A screenshot sent "as a file" keeps its pixels rather than being
    // recompressed to JPEG, so this is the BETTER way to send one.
    const got = extractFile(
      msg({ document: { ...file("d"), mime_type: "image/png", file_name: "export.png" } })
    );
    expect(got?.kindHint).toBeUndefined();
  });

  it("a plain text message carries no file", () => {
    expect(extractFile(msg({ text: "hey" }))).toBeNull();
  });

  it("carries the size Telegram already told us", () => {
    // Present on the message, before any download — which is how an oversize
    // file is refused without spending the transfer.
    expect(extractFile(msg({ video: { ...file("v", 34_000_000) } }))?.sizeBytes)
      .toBe(34_000_000);
  });
});

describe("⭐ THE 20MB WALL IS ON THE HAPPY PATH", () => {
  it("names the size and offers the way through", () => {
    // A 60-second screen recording — the exact thing she asks for — routinely
    // exceeds this. It's a common path, not an edge case, and it must never
    // read like a bug in her.
    const text = oversizeMessage(34 * 1024 * 1024);
    expect(text).toMatch(/34MB/);
    expect(text).toMatch(/20MB/);
    expect(text).toMatch(/shorter/i);
  });

  it("refuses before downloading, and says so once per file", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    for (let i = 0; i < 2; i += 1) {
      await t.action(internal.maya.telegramFiles.ingestInboundFile, {
        customerId,
        chatId: "42",
        fileId: "big",
        fileUniqueId: "u_big",
        sizeBytes: 34 * 1024 * 1024,
        ackKey: "u_big",
      });
    }
    const sent = await outbound(t, customerId);
    // Re-sending the same too-big file is the same conversation. Saying it
    // twice is nagging, so the key is the FILE, not the moment.
    expect(sent.filter((m) => m.dedupeKey === "oversize:u_big")).toHaveLength(1);
    expect(sent[0].body).toMatch(/20MB/);
  });

  it("the cap is Telegram's, not ours", () => {
    expect(TELEGRAM_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("⭐ ONE ACK PER ACT", () => {
  it("an album of four earns ONE receipt, and it counts them", async () => {
    // Telegram sends four separate updates sharing a media_group_id. Acking
    // per update means four "got it"s for one act of sending.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const since = Date.now();
    for (let i = 0; i < 4; i += 1) {
      await addAsset(t, customerId, { classifiedAs: "product_screenshot" });
    }
    for (let i = 0; i < 4; i += 1) {
      await t.action(internal.maya.telegramFiles.acknowledgeUpload, {
        customerId,
        ackKey: "album_1",
        since,
      });
    }
    const sent = await outbound(t, customerId);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatch(/all 4/);
  });

  it("⭐ A RECORDING IS ACKNOWLEDGED AS THE THING SHE ASKED FOR", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const since = Date.now();
    await addAsset(t, customerId, { kind: "screen_recording" });
    await t.action(internal.maya.telegramFiles.acknowledgeUpload, {
      customerId,
      ackKey: "solo",
      since,
    });
    const [ack] = await outbound(t, customerId);
    expect(ack.body).toMatch(/frames and b-roll|real thing/i);
    // It must NOT promise a post — whether one gets made depends on the idea
    // bank and the budget, neither of which this path can see (§2.7).
    expect(ack.body).not.toMatch(/I'll post|posting (it|this) today/i);
  });

  it("⭐ SAYS SO WHEN WHAT LANDED STILL ISN'T ENOUGH", async () => {
    // Eight illustrations is a full-looking library that can't ground a single
    // post. Saying "got all 8" and stopping lets them find that out later, in
    // a video made of stock art.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const since = Date.now();
    for (let i = 0; i < 8; i += 1) {
      await addAsset(t, customerId, { classifiedAs: "illustration" });
    }
    await t.action(internal.maya.telegramFiles.acknowledgeUpload, {
      customerId,
      ackKey: "album_2",
      since,
    });
    const [ack] = await outbound(t, customerId);
    expect(ack.body).toMatch(/all 8/);
    expect(ack.body).toMatch(/screen recording/i);
  });

  it("nothing landed means no receipt — the failure already spoke", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const res = await t.action(internal.maya.telegramFiles.acknowledgeUpload, {
      customerId,
      ackKey: "empty",
      since: Date.now(),
    });
    expect(res.acked).toBe(false);
    expect(await outbound(t, customerId)).toHaveLength(0);
  });

  it("the settle delay is long enough for an album to land", () => {
    // Telegram delivers an album within about a second.
    expect(ALBUM_SETTLE_MS).toBeGreaterThanOrEqual(2_000);
  });
});

describe("⭐ CROSS-TENANT", () => {
  it("one founder's upload never acks into another's chat", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    const b = await seed(t, "b");
    const since = Date.now();
    await addAsset(t, a, { classifiedAs: "product_screenshot" });
    // Same ackKey on purpose: media_group_id is Telegram's, not ours, and two
    // tenants could collide. The dedupe index is scoped by customer.
    await t.action(internal.maya.telegramFiles.acknowledgeUpload, {
      customerId: a, ackKey: "same", since,
    });
    await t.action(internal.maya.telegramFiles.acknowledgeUpload, {
      customerId: b, ackKey: "same", since,
    });
    expect(await outbound(t, a)).toHaveLength(1);
    // b has no assets, so b gets nothing — and critically, a's ack did not
    // consume b's dedupe key.
    expect(await outbound(t, b)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

async function seed(
  t: ReturnType<typeof convexTest>,
  tag = "files"
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${tag}`,
      email: `${tag}@example.com`,
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function addAsset(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  over: { kind?: "image" | "screen_recording"; classifiedAs?: string } = {}
) {
  await t.mutation(internal.maya.media.record, {
    customerId,
    kind: over.kind ?? "image",
    source: "telegram",
    storageKey: `k-${Math.random()}`,
    contentType: "image/png",
    classifiedAs: over.classifiedAs,
  });
}


async function outbound(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">
) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("messages").collect()).filter(
      (m) => m.customerId === customerId && m.direction === "out"
    )
  );
}
