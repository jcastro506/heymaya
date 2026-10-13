/**
 * Maya's number (2026-10-13): a tester was sent to the old sandbox line because the line saved at signup
 * always won. A saved line now wins only while it's still one of ours; a retired one is replaced, on the row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { configuredLines, herLine } from "../imessage";
import { mintPairing } from "../pairing";
import type { Doc } from "../../_generated/dataModel";

const OLD = "+16292451530", NEW = "+12052611117";

afterEach(() => { vi.unstubAllEnvs(); });

describe("her number", () => {
  it("a saved line wins only while it's one of ours; nothing configured trusts what's saved", () => {
    expect(herLine(NEW, [NEW])).toEqual({ line: NEW, stale: false });
    expect(herLine(OLD, [NEW])).toEqual({ line: NEW, stale: true });
    expect(herLine(undefined, [NEW])).toEqual({ line: NEW, stale: false });
    expect(herLine(OLD, [])).toEqual({ line: OLD, stale: false });
    expect(herLine(undefined, [])).toEqual({ line: null, stale: false });
    expect(configuredLines({ LINQ_LINE_NUMBER: ` ${NEW}, +15550100000 ` })).toEqual([NEW, "+15550100000"]);
    expect(configuredLines({})).toEqual([]);
  });

  it("pairing never sends anyone to a retired line, and fixes their account", async () => {
    vi.stubEnv("LINQ_LINE_NUMBER", NEW);
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => seedCreator(ctx, "a", { channel: { paired: false, kind: "imessage", line: OLD } }));
    const r = await t.run(async (ctx) => mintPairing(ctx, (await ctx.db.get(id)) as Doc<"creators">));
    expect(r.ok && r.lineNumber).toBe(NEW);
    expect(r.ok && r.deepLink.startsWith(`sms:${NEW}`)).toBe(true);
    expect(((await t.run(async (ctx) => ctx.db.get(id))) as Doc<"creators">).channel.line).toBe(NEW);
  });
});
