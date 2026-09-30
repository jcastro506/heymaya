/**
 * The idea taste test: the operator rates ideas blind, and those ratings become the golden set.
 * Blind means blind (no source, no reasoning, no judge score before rating); nothing is readable or
 * writable without the ops token; a batch imports once; the score is arithmetic on the labels.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { FLAGS, scoreOf } from "../ideaTaste";

const account = { handles: { tiktok: "adinawilliamsss" }, summary: "Jersey City coffee hunts", themes: ["coffee"], note: null };
const item = (source: "maya" | "baseline", text: string, wouldSend = 2) => ({ source, account, text, evidence: source === "maya" ? ["https://www.tiktok.com/@x/video/1"] : [], fitWhy: source === "maya" ? "her walking taste tests beat her normal" : null, judge: { corny: 0, generic: 0, flattering: 0, toolSpeak: 0, specific: 3, wouldSend, note: "", model: "m" }, batch: "fw-test-1" });
const items = [item("maya", "rate the three closest cafes to the PATH, one take each"), item("baseline", "Try a day-in-my-life vlog!", 1), item("maya", "the $4 vs $9 latte blind test on Newark Ave"), item("baseline", "Share your top 5 coffee tips", 3)];

let before: string | undefined;
beforeEach(() => { before = process.env.OPS_TOKEN; process.env.OPS_TOKEN = "tok"; });
afterEach(() => { if (before === undefined) delete process.env.OPS_TOKEN; else process.env.OPS_TOKEN = before; });

describe("idea taste test", () => {
  it("fails closed: no token, a wrong token, or no OPS_TOKEN on the deployment reads and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.eval.ideaTaste.importItems, { batch: "fw-test-1", items });
    expect(await t.query(api.eval.ideaTaste.next, { token: "nope" })).toBeNull();
    expect(await t.query(api.eval.ideaTaste.results, { token: "" })).toBeNull();
    const first = (await t.query(api.eval.ideaTaste.next, { token: "tok" }))!.item!;
    expect(await t.mutation(api.eval.ideaTaste.rate, { token: "nope", id: first.id as never, wouldFilm: true, flags: [] })).toEqual({ ok: false });
    delete process.env.OPS_TOKEN;
    expect(await t.query(api.eval.ideaTaste.next, { token: "tok" })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("evalLabels").collect())).toHaveLength(0);
  });

  it("is blind: the next idea never says who wrote it, why, or what the judge thought", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.eval.ideaTaste.importItems, { batch: "fw-test-1", items });
    const n = (await t.query(api.eval.ideaTaste.next, { token: "tok" }))!;
    expect(n).toMatchObject({ done: false, rated: 0, total: 4, flags: FLAGS });
    expect(Object.keys(n.item!).sort()).toEqual(["account", "evidence", "id", "text"]);
    expect(JSON.stringify(n)).not.toMatch(/baseline|maya"|fitWhy|wouldSend|beat her normal/);
  });

  it("a batch imports once; rating walks every idea; unknown flags are dropped; the reveal scores each source", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(internal.eval.ideaTaste.importItems, { batch: "fw-test-1", items })).toEqual({ imported: 4, skipped: null });
    expect((await t.mutation(internal.eval.ideaTaste.importItems, { batch: "fw-test-1", items })).imported).toBe(0);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const n = (await t.query(api.eval.ideaTaste.next, { token: "tok" }))!;
      seen.push(n.item!.text);
      const mine = items.find((x) => x.text === n.item!.text)!;
      await t.mutation(api.eval.ideaTaste.rate, { token: "tok", id: n.item!.id as never, wouldFilm: mine.source === "maya", flags: mine.source === "maya" ? [] : ["generic", "made up flag"], note: "n" });
    }
    expect(new Set(seen).size).toBe(4);
    expect(await t.query(api.eval.ideaTaste.next, { token: "tok" })).toMatchObject({ done: true, rated: 4, item: null });
    const r = (await t.query(api.eval.ideaTaste.results, { token: "tok" }))!;
    expect(r.maya).toMatchObject({ rated: 2, wouldFilmPct: 100, cleanPct: 100, judgeAgreesPct: 100 });
    expect(r.baseline).toMatchObject({ rated: 2, wouldFilmPct: 0, cleanPct: 0 });
    expect(r.baseline.flags.generic).toBe(100);
    expect(r.baseline.judgeAgreesPct, "the judge liked one baseline idea the operator didn't").toBe(50);
    const labels = await t.run((ctx) => ctx.db.query("evalLabels").collect());
    expect(labels.every((l) => (l.flags ?? []).every((f) => (FLAGS as readonly string[]).includes(f)))).toBe(true);
    expect(await t.query(internal.eval.ideaTaste.exportLabels, {})).toHaveLength(4);
  });

  it("scoreOf is plain arithmetic", () => {
    expect(scoreOf([])).toMatchObject({ rated: 0, wouldFilmPct: 0, judgeAgreesPct: null });
    expect(scoreOf([{ wouldFilm: true, flags: [], judgeWouldSend: 3 }, { wouldFilm: false, flags: ["cheesy"], judgeWouldSend: 3 }])).toMatchObject({ rated: 2, wouldFilmPct: 50, cleanPct: 50, judgeAgreesPct: 50 });
  });
});
