import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

describe("a customer never receives an ops line (live 2026-09-06)", () => {
  const prev = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  beforeAll(() => { process.env.TELEGRAM_OPERATOR_CHAT_ID = "8376373926"; });
  afterAll(() => { if (prev === undefined) delete process.env.TELEGRAM_OPERATOR_CHAT_ID; else process.env.TELEGRAM_OPERATOR_CHAT_ID = prev; });

  it("when the operator chat belongs to a creator, the alert is refused and the refusal is on the record", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true }, telegramChatId: "8376373926" }));
    const now = Date.now();
    await t.run((ctx) => ctx.db.insert("vendorHealth", { vendor: "scrapecreators", check: "reconcile", ok: false, detail: "vendor 194 vs ledger 60", at: now - 60_000 }));
    expect(await t.query(internal.core.alerts.isCustomerChat, { chatId: "8376373926" })).toBe(true);
    expect(await t.query(internal.core.alerts.isCustomerChat, { chatId: "999" })).toBe(false);
    const r = await t.action(internal.core.alerts.run, {});
    expect(r.text, "there was something to say").toMatch(/smoke failed/);
    expect(r.sent, "but not to a person").toBe(false);
    const record = (await t.run((ctx) => ctx.db.query("vendorHealth").collect())).find((h) => h.vendor === "alerts");
    expect(JSON.stringify(record?.detail)).toMatch(/refused: operator chat belongs to a creator/);
  });
});
