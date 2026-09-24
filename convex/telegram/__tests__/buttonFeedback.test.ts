/**
 * A button tap must acknowledge itself before the work runs.
 *
 * The operator tapped "watch them", saw nothing, tapped again, then typed "yes" — three
 * inputs for one decision. The work HAD run both times: the account was added and the
 * confirmation delivered. What was missing was any immediate sign that the tap registered,
 * because Telegram leaves the keyboard in place and the reply arrives seconds later as a
 * separate message.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const webhook = readFileSync(new URL("../webhook.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../../integrations/telegram/client.ts", import.meta.url), "utf8");

describe("a button tap answers itself", () => {
  it("shows a toast rather than an empty acknowledgement", () => {
    expect(webhook).toMatch(/answerCallbackQuery\(identity, cb\.id, label\)/);
    expect(webhook, "the toast should differ for a yes and a no").toMatch(/endsWith\(":no"\)/);
  });

  it("takes the buttons off, so the message cannot be tapped twice", () => {
    expect(webhook).toMatch(/clearMessageButtons\(identity, chatId/);
    expect(client).toMatch(/editMessageReplyMarkup/);
  });

  it("acknowledges BEFORE scheduling the work, not after", () => {
    const ack = webhook.indexOf("answerCallbackQuery(identity, cb.id, label)");
    const work = webhook.indexOf("internal.core.telegram.handleInbound");
    expect(ack).toBeGreaterThan(-1);
    expect(ack, "a tap answered after the job runs is a tap that felt broken").toBeLessThan(work);
  });
});
