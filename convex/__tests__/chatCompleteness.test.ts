/**
 * §17.1 chat completeness: every control on the thin UI has a chat path. A control
 * without one here fails; a path named here must exist as a function.
 */
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";

const REGISTRY: Array<{ control: string; web: string; chat: string }> = [
  { control: "quiet hours", web: "ui.updateSettings", chat: "internal.agent.manage.setQuietHours" },
  { control: "tone", web: "ui.updateSettings", chat: "internal.agent.manage.setTone" },
  { control: "niche / what I make", web: "ui.updateSettings", chat: "internal.agent.manage.setNiche" },
  { control: "add an admired account", web: "onboarding.admired.add", chat: "internal.agent.manage.addAdmired" },
  { control: "stop watching an account", web: "onboarding.admired.remove", chat: "internal.agent.converse.setWatch" },
  { control: "correct what she knows", web: "ui.correct", chat: "internal.agent.remember.addRule" },
  { control: "revoke a house rule", web: "ui.revokeRule", chat: "internal.agent.commands.apply" }, // "forget that"
  { control: "pass on an idea", web: "ui.passIdea", chat: "internal.taste.events.record" }, // the not-me button
  { control: "posted it", web: "taste.events.markPosted", chat: "internal.scout.matchPost.apply" }, // yes, that's it
  { control: "confirm / move / delete a block", web: "ui.blockControl", chat: "internal.calendar.blocks.confirm" },
  { control: "pause / resume", web: "billing.checkout.openPortal", chat: "internal.agent.commands.apply" },
  { control: "delete account", web: "account.deletion.requestDelete", chat: "internal.agent.commands.apply" }, // points at Settings by design
];

function resolve(path: string): unknown {
  const [root, ...rest] = path.split(".");
  let cur: unknown = root === "internal" ? internal : api;
  for (const k of root === "internal" ? rest : [root, ...rest]) cur = (cur as Record<string, unknown> | undefined)?.[k];
  return cur;
}

describe("chat completeness", () => {
  it("every web control names a chat path, and both exist", () => {
    for (const r of REGISTRY) {
      expect(resolve(r.web), `${r.control}: web ${r.web}`).toBeDefined();
      expect(resolve(r.chat), `${r.control}: chat ${r.chat}`).toBeDefined();
    }
  });
});
