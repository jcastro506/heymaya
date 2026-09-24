/**
 * A signal's URL survives being judged.
 *
 * The URL used to be parsed back out of the `why` sentence, and recording a verdict
 * overwrites `why` with the model's reason. So the second time a signal was looked at, its
 * link was gone and she wrote a scout message about a post the creator could not open.
 * Caught by the eval gate's has_link check, which is the first thing the gate paid for.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const URL_ = "https://www.tiktok.com/@nadyaokamoto/video/7679839729281502477";

describe("a signal keeps its link", () => {
  it("a verdict overwrites the reason but never the url", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const signalId = await t.run((ctx) => ctx.db.insert("signals", {
      creatorId, kind: "breakout", url: URL_, sourcePostIds: ["7679839729281502477"],
      score: 10.15, corroboration: { accounts: 2, soundRising: false }, verdict: "pending",
      why: `10.15× this account's normal at 9h (935,000 views); ${URL_}`,
      thresholdsVersion: "t", createdAt: Date.now(),
    }));

    await t.mutation(internal.scout.gate.setVerdicts, { verdicts: [{ signalId, verdict: "dropped", why: "generic airport travel vlog, not their format" }] });

    const after = await t.run((ctx) => ctx.db.get(signalId));
    expect(after?.why, "the reason is the model's to rewrite").toBe("generic airport travel vlog, not their format");
    expect(after?.url, "the link is not").toBe(URL_);
  });

  it("every signal writer records the url, so none of them can lose it", async () => {
    const { readFileSync } = await import("node:fs");
    const writers = ["sampler", "sweep", "formats", "sounds", "readback"];
    for (const w of writers) {
      const src = readFileSync(new URL(`../${w}.ts`, import.meta.url), "utf8");
      const insert = src.slice(src.indexOf('insert("signals"'));
      expect(insert.slice(0, 600), `${w}.ts must store the url on the signal`).toMatch(/url:/);
    }
  });
});
