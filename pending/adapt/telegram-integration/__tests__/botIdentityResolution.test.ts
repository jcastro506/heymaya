/**
 * `resolveTelegramBotIdentity()` must be allowed to read the environment.
 *
 * ## The bug this exists to prevent
 *
 * The signature is `resolveTelegramBotIdentity(env = process.env)`. Passing an
 * explicit `{}` does not mean "use the default" — it REPLACES the default with
 * an empty environment, so the function reads nothing, finds no token, and
 * returns null. Every time. On every deployment. Regardless of configuration.
 *
 * Three production call sites did exactly that, and because each is guarded by
 * `if (identity)` or a null check, the failure was quiet:
 *
 *   - v2 message delivery → every reply written and never sent, reported as
 *     "the Telegram bot isn't configured" while TELEGRAM_BOT_TOKEN was set.
 *   - v2 typing indicator → never shown.
 *   - v1 pairing confirmation → "Paired. I'll take it from here." has been
 *     silently not sending.
 *
 * Found live 2026-08-04: she answered four messages correctly on the machine
 * and the founder saw none of them.
 *
 * The `{}` form is legitimate in tests, where an empty env is the point.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveTelegramBotIdentity } from "../client";

const CONVEX_ROOT = join(__dirname, "..", "..", "..");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "_generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests may pass an empty env deliberately — that IS the assertion there.
      if (entry === "__tests__") continue;
      sourceFiles(full, found);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}

describe("NO PRODUCTION CALL SITE BLINDS THE RESOLVER", () => {
  it("nobody passes an empty env object", () => {
    const offenders = sourceFiles(CONVEX_ROOT).filter((file) =>
      /resolveTelegramBotIdentity\(\s*\{\s*\}\s*\)/.test(
        readFileSync(file, "utf8")
      )
    );
    expect(
      offenders.map((f) => f.replace(CONVEX_ROOT, "convex")),
      "an empty env means the bot is NEVER configured, on every deployment"
    ).toEqual([]);
  });

  it("an empty env really does resolve to nothing", () => {
    // The other half of the claim. If `{}` resolved fine, the rule above would
    // be cargo-cult rather than a guard.
    expect(resolveTelegramBotIdentity({})).toBeNull();
  });

  it("a populated env resolves", () => {
    expect(
      resolveTelegramBotIdentity({
        TELEGRAM_BOT_TOKEN: "123:abc",
        TELEGRAM_BOT_USERNAME: "HeyMayaBot",
      })
    ).toEqual({ token: "123:abc", username: "HeyMayaBot" });
  });
});
