/**
 * Telegram pairing (§18.9.25 screen ③).
 *
 * The chat id this writes is where every future message goes, so the token that
 * sets it is the most security-relevant string in the setup flow.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { seedCreator } from "../../../tests/lib/creatorRow";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { PAIRING_TTL_MS } from "../pairing";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  over: Partial<Doc<"creators">> = {}
): Promise<Id<"creators">> {
  return await t.run(async (ctx) => seedCreator(ctx, suffix, { timezone: "UTC", ...over }));
}

describe("claiming a pairing token", () => {
  it("binds the chat id", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "ok", {
      pairingToken: "tok_live",
      pairingExpiresAt: NOW + PAIRING_TTL_MS,
    });

    const result = await t.mutation(internal.core.pairing.claimPairing, {
      token: "tok_live",
      chatId: "chat_99",
      now: NOW,
    });
    expect(result.paired).toBe(true);

    const row = (await t.run((ctx) => ctx.db.get(creatorId))) as Doc<"creators">;
    expect(row.telegramChatId).toBe("chat_99");
  });

  it("IS ONE-SHOT — a second claim on the same token fails", async () => {
    // A token that stays valid after use can bind somebody else's chat to this
    // account, and the chat id is where every future message goes.
    const t = convexTest(schema, modules);
    await seed(t, "once", {
      pairingToken: "tok_once",
      pairingExpiresAt: NOW + PAIRING_TTL_MS,
    });

    expect(
      (
        await t.mutation(internal.core.pairing.claimPairing, {
          token: "tok_once",
          chatId: "chat_first",
          now: NOW,
        })
      ).paired
    ).toBe(true);

    const second = await t.mutation(internal.core.pairing.claimPairing, {
      token: "tok_once",
      chatId: "chat_attacker",
      now: NOW,
    });
    expect(second.paired).toBe(false);
  });

  it("a second claim cannot REBIND an already-paired chat", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "rebind", {
      pairingToken: "tok_r",
      pairingExpiresAt: NOW + PAIRING_TTL_MS,
    });
    await t.mutation(internal.core.pairing.claimPairing, {
      token: "tok_r",
      chatId: "chat_owner",
      now: NOW,
    });
    await t.mutation(internal.core.pairing.claimPairing, {
      token: "tok_r",
      chatId: "chat_attacker",
      now: NOW,
    });

    const row = (await t.run((ctx) => ctx.db.get(creatorId))) as Doc<"creators">;
    expect(row.telegramChatId).toBe("chat_owner");
  });

  it("an expired token is refused AND cleared", async () => {
    // Cleared so a stale link can't linger as a live row waiting for the clock
    // to be wrong somewhere.
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "expired", {
      pairingToken: "tok_old",
      pairingExpiresAt: NOW - 1,
    });

    const result = await t.mutation(internal.core.pairing.claimPairing, {
      token: "tok_old",
      chatId: "chat_late",
      now: NOW,
    });
    expect(result.paired).toBe(false);
    expect(result.reason).toMatch(/expired/i);

    const row = (await t.run((ctx) => ctx.db.get(creatorId))) as Doc<"creators">;
    expect(row.pairingToken).toBeUndefined();
    expect(row.telegramChatId).toBeUndefined();
  });

  it("an unknown token names the reason rather than failing silently", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "unknown", {
      pairingToken: "tok_real",
      pairingExpiresAt: NOW + PAIRING_TTL_MS,
    });
    const result = await t.mutation(internal.core.pairing.claimPairing, {
      token: "tok_guessed",
      chatId: "chat_x",
      now: NOW,
    });
    expect(result.paired).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("ONE CUSTOMER'S TOKEN NEVER PAIRS ANOTHER'S ACCOUNT", async () => {
    const t = convexTest(schema, modules);
    const mine = await seed(t, "mine", {
      pairingToken: "tok_mine",
      pairingExpiresAt: NOW + PAIRING_TTL_MS,
    });
    const theirs = await seed(t, "theirs", {
      pairingToken: "tok_theirs",
      pairingExpiresAt: NOW + PAIRING_TTL_MS,
    });

    await t.mutation(internal.core.pairing.claimPairing, {
      token: "tok_mine",
      chatId: "chat_mine",
      now: NOW,
    });

    const other = (await t.run((ctx) => ctx.db.get(theirs))) as Doc<"creators">;
    expect(other.telegramChatId).toBeUndefined();
    const own = (await t.run((ctx) => ctx.db.get(mine))) as Doc<"creators">;
    expect(own.telegramChatId).toBe("chat_mine");
  });
});

describe("the token has a real lifetime", () => {
  it("expires in minutes, not days", () => {
    // Long enough to walk to your phone; short enough that a link left open in
    // a browser tab overnight is dead.
    expect(PAIRING_TTL_MS).toBeLessThanOrEqual(30 * 60_000);
    expect(PAIRING_TTL_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
