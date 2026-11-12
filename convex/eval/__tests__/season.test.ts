/**
 * The season sim's pure parts: the life script any creator can live, the temperament lookup, a season row
 * read from day notes, and the taste grader's JSON held to what the report reads.
 */
import { describe, expect, it } from "vitest";
import { seasonScript, temperamentOf } from "../livingSim";
import { PARTNER_TEMPERAMENTS, parseTaste, seasonRow, tasteModel } from "../season";
import { PERSONAS, actorModel } from "../personas";
import { REGISTRY } from "../../agent/registry";

describe("the season's life", () => {
  it("spreads the beats over the season and ends on the three probes, in order", () => {
    const s = seasonScript(90);
    expect(s.map((e) => e.kind)).toEqual(["life", "rule", "slump", "life", "life", "brand", "shift", "probe", "probe", "probe"]);
    expect(s.every((e, i) => i === 0 || e.day >= s[i - 1].day)).toBe(true);
    expect(s.at(-1)!.day).toBe(90);
    // Nothing runner-specific: each creator's own version is written from their captions.
    expect(s.filter((e) => e.kind !== "probe").every((e) => e.brief && !/marathon|running|race/i.test(e.brief))).toBe(true);
  });

  it("knows every temperament, and nothing else", () => {
    for (const p of PERSONAS) expect(temperamentOf(p.id)?.id).toBe(p.id);
    expect(temperamentOf("nobody")).toBeNull();
    expect(temperamentOf(undefined)).toBeNull();
  });

  it("puts both plans in a season", () => {
    const partner = PERSONAS.filter((p) => PARTNER_TEMPERAMENTS.has(p.id)).length;
    expect(partner).toBeGreaterThan(0);
    expect(partner).toBeLessThan(PERSONAS.length);
  });

  it("grades her work on a family that is neither her writer nor the people", () => {
    const fam = (m: string) => m.split("/")[0];
    expect(fam(tasteModel({}))).not.toBe(fam(REGISTRY.writer.primary));
    expect(fam(tasteModel({}))).not.toBe(fam(actorModel({})));
  });
});

describe("a season row", () => {
  const day = (d: number, out: number, mood: number | null, action = "none") => ({ d, snap: { outProactive: out, out, outKinds: Array(out).fill("scout"), ideasTotal: d, ideasSaved: 1 }, actor: { mood, why: `day ${d}`, action, answered: mood !== null } });

  it("counts her texts a week, mood by month, and asks for less", () => {
    const days = [day(1, 2, 4), day(2, 1, 4, "less"), day(8, 0, 3), day(31, 1, 2)];
    const r = seasonRow(days, 35);
    expect(r.herTextsPerWeek).toEqual([3, 0, 0, 0, 1]);
    expect(r.maxInADay).toBe(2);
    expect(r.askedLess).toBe(1);
    expect(r.moodByMonth).toEqual([3.7, 2]);
    expect(r.leftDay).toBeNull();
  });

  it("counts anything she sent after they texted STOP", () => {
    const days = [day(1, 1, 3), { ...day(2, 0, 1, "stop"), left: { d: 2, why: "too much" } }, { ...day(3, 1, null), left: { d: 2, why: "too much" } }];
    const r = seasonRow(days, 3);
    expect(r.leftDay).toBe(2);
    expect(r.leftWhy).toBe("too much");
    expect(r.textsAfterStop).toBe(1);
  });
});

describe("the taste grader's answer", () => {
  it("is clamped and typed, whatever it wrote", () => {
    const t = parseTaste('ok here: {"items":[{"n":1,"good":7,"tacky":true,"filmable":"yes","fits":-1,"flag":"tacky","note":"forced hype"},{"n":"2","good":"2"}],"overall":"fine"}');
    expect(t.items[0]).toMatchObject({ n: 1, good: 3, tacky: true, filmable: null, fits: 0, flag: "tacky" });
    expect(t.items[1]).toMatchObject({ n: 2, good: 2, tacky: false });
    expect(t.overall).toBe("fine");
    expect(parseTaste("nonsense")).toEqual({ items: [], overall: "" });
  });
});

describe("a season day is lived in the morning", () => {
  it("finds a zone at mid-morning for any hour of the day", async () => {
    const { hourIn, morningZone } = await import("../livingSim");
    for (let h = 0; h < 24; h++) {
      const now = Date.UTC(2026, 10, 12, h, 17);
      const z = morningZone(now);
      expect(hourIn(z, now), `${h}:00 UTC → ${z}`).toBeGreaterThanOrEqual(8);
      expect(hourIn(z, now)).toBeLessThanOrEqual(12);
    }
  });
});
