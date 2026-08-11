/**
 * ⭐ §6.4.2 lists "nagging more than once" as a Never.
 *
 * ⚠️ And `shouldAsk` is a STATE, not a counter — it stays true for as long as
 * the library is thin. Every surface that gated on it alone would therefore
 * re-ask forever: the weekly review every week, the upload reply on every file.
 *
 * The library being thin is a **fact**. How many times we mention it is a
 * **decision**. Separating those is the whole point of this module.
 */

import { describe, expect, it } from "vitest";
import {
  ASSET_ASK_COOLDOWN_MS,
  MAX_ASSET_ASKS,
  askStateFor,
  parseAssetAsk,
} from "../media";

const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);

describe("askStateFor", () => {
  it("is silent when the library is fine", () => {
    // Never pester the ~half of founders whose site already has screenshots.
    expect(askStateFor({ shouldAsk: false, prior: null, now: NOW })).toBe("silent");
    expect(
      askStateFor({ shouldAsk: false, prior: { askedAt: NOW, mentions: 1 }, now: NOW })
    ).toBe("silent");
  });

  it("asks the first time", () => {
    expect(askStateFor({ shouldAsk: true, prior: null, now: NOW })).toBe("ask");
  });

  /**
   * One follow-up is defensible — the first ask may have landed on a busy day.
   * A third is a system that has stopped listening.
   */
  it("mentions once more, then goes quiet", () => {
    expect(
      askStateFor({ shouldAsk: true, prior: { askedAt: NOW, mentions: 1 }, now: NOW })
    ).toBe("mention");
    expect(
      askStateFor({ shouldAsk: true, prior: { askedAt: NOW, mentions: 2 }, now: NOW })
    ).toBe("silent");
    expect(MAX_ASSET_ASKS).toBe(2);
  });

  it("never escalates past silent, however long the library stays empty", () => {
    for (const mentions of [2, 5, 50]) {
      expect(
        askStateFor({ shouldAsk: true, prior: { askedAt: NOW, mentions }, now: NOW })
      ).toBe("silent");
    }
  });

  /**
   * ⭐ Circumstances change. A founder who ignored this in March may happily
   * send a recording in June after a redesign — permanent silence never finds
   * out.
   */
  it("tries again after the cooldown, as a fresh ask", () => {
    const later = NOW + ASSET_ASK_COOLDOWN_MS + 1;
    expect(
      askStateFor({ shouldAsk: true, prior: { askedAt: NOW, mentions: 9 }, now: later })
    ).toBe("ask");
  });

  it("does not reset a day early", () => {
    const nearly = NOW + ASSET_ASK_COOLDOWN_MS - 1;
    expect(
      askStateFor({ shouldAsk: true, prior: { askedAt: NOW, mentions: 2 }, now: nearly })
    ).toBe("silent");
  });
});

describe("parseAssetAsk", () => {
  it("survives junk rather than re-asking on a parse failure", () => {
    // ⚠️ Returning null here means "never asked", which would restart the
    // nag. Worth knowing that's the failure direction.
    expect(parseAssetAsk(undefined)).toBeNull();
    expect(parseAssetAsk("not json")).toBeNull();
    expect(parseAssetAsk('{"mentions":3}')).toBeNull();
  });

  it("defaults a missing count to one, not zero", () => {
    // A stamp with no count still means we asked at least once.
    expect(parseAssetAsk(JSON.stringify({ askedAt: NOW }))).toEqual({
      askedAt: NOW,
      mentions: 1,
    });
  });
});
