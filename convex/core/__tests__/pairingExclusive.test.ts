/**
 * One Telegram chat belongs to exactly one creator.
 *
 * Inbound routing resolves a chat with `.first()`, so two creators on one chat means
 * replies land on whichever row the index returns and both send proactive messages to the
 * same person. That happened on the dev deployment and the operator got a jumble of both.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const CHAT = "8376373926";

describe("pairing is exclusive", () => {
  it("re-pairing a chat moves it and unpairs the previous creator", async () => {
    const t = convexTest(schema, modules);
    const first = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: false } }));
    const second = await t.run((ctx) => seedCreator(ctx, "b", { channel: { paired: false } }));

    await t.mutation(internal.onboarding.dev.pairChat, { creatorId: first, chatId: CHAT });
    await t.mutation(internal.onboarding.dev.pairChat, { creatorId: second, chatId: CHAT });

    const a = await t.run((ctx) => ctx.db.get(first));
    const b = await t.run((ctx) => ctx.db.get(second));
    expect(b?.channel.paired, "the newly paired creator holds the chat").toBe(true);
    expect(b?.telegramChatId).toBe(CHAT);
    expect(a?.channel.paired, "the previous creator must be released").toBe(false);
    expect(a?.telegramChatId, "and must not still point at the chat").toBeUndefined();
  });

  it("exactly one creator ever answers to a chat", async () => {
    const t = convexTest(schema, modules);
    const ids = [];
    for (const k of ["a", "b", "c"]) ids.push(await t.run((ctx) => seedCreator(ctx, k, { channel: { paired: false } })));
    for (const id of ids) await t.mutation(internal.onboarding.dev.pairChat, { creatorId: id, chatId: CHAT });
    const onChat = (await t.run((ctx) => ctx.db.query("creators").collect())).filter((c) => c.telegramChatId === CHAT);
    expect(onChat).toHaveLength(1);
    expect(onChat[0]._id).toBe(ids[2]);
  });
});
