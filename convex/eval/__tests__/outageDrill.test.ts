/**
 * The outage drill itself, deterministic: the real flows on the fake model and the spec fixtures,
 * with faults injected through the real guard, cell by cell, then the report. ScrapeCreators 402
 * (out of credits: it silently broke scout and watching on dev on 2026-09-24) is a first-class case.
 * Assertions are on the report's structure and verdicts, never on prose.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { resetFixtureClients } from "../../reads/read";
import { assessCell, FLOWS, flowsFor, judgeCell, matrixOf, SCENARIOS, type Cell, type Observed } from "../outageDrill";
import { FAULTS } from "../faults";

const ENV_KEYS = ["ENVIRONMENT_NAME", "SCRAPE_FIXTURES", "MODEL_FAKE", "EVAL_FAKES"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.ENVIRONMENT_NAME = "local";
  process.env.SCRAPE_FIXTURES = "spec";
  process.env.MODEL_FAKE = "1";
  delete process.env.EVAL_FAKES;
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } resetFixtureClients(); });

const TT = "https://www.tiktok.com/@runwithcarly/video/7395965676629888274";
const IG = "https://www.instagram.com/reel/DbrZ8lIlxma/";

type Report = { status: string; summary: { pass: number; fail: number; na: number }; matrix: Record<string, Record<string, string>>; failures: Array<{ scenario: string; flow: string; why: string[] }>; cells: Array<Cell & { verdict: { pass: boolean | null; why: string[] } }> };

async function drill(scenarios: string[], flows?: string[]) {
  const t = convexTest(schema, modules);
  const videoFileId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "video/mp4" })));
  const r = await t.action(internal.eval.outageDrill.start, { scenarios, flows, turnMode: "inline", tiktokLink: TT, instagramLink: IG, videoFileId, runId: "drill-test" });
  for (let i = 0; i < r.cells; i++) await t.action(internal.eval.outageDrill.runCell, { runId: r.runId, i });
  await t.action(internal.eval.outageDrill.finishRun, { runId: r.runId });
  const report = (await t.query(internal.eval.outageDrill.report, { runId: r.runId, cells: true })) as Report;
  const faultsLeft = await t.query(internal.eval.faults.current, {});
  return { t, r, report, faultsLeft };
}

describe("the plan", () => {
  it("every fault is a scenario, plus the bad day; each runs the flows its vendor can reach", () => {
    for (const f of FAULTS) expect(SCENARIOS[f]).toEqual([f]);
    expect(SCENARIOS.bad_day.length).toBeGreaterThan(3);
    expect(flowsFor("bad_day")).toEqual([...FLOWS]);
    expect(flowsFor("scrape_402")).toEqual(expect.arrayContaining(["scout", "sampler", "sweep", "tiktok_link", "instagram_link"]));
    expect(flowsFor("gmail_5xx")).toEqual(["email_send"]);
    expect(flowsFor("classifier_timeout")).toEqual(["text"]);
  });
});

describe("the verdict", () => {
  const empty: Observed = { outbound: [], jobs: [], health: [], failedModelCalls: 0, predictions: 0, finishes: 0, ideas: 0, signalsWritten: 0, insights: [], drafts: [], fakeSent: 0, cache: [] };
  const base = { scenario: "writer_5xx", faults: ["writer_5xx" as const], hits: { "writer_5xx:converse": 1 }, before: null, after: null, ms: 1 };
  it("a waiting creator who heard nothing fails; one who heard an honest line passes; an unreached fault is n/a", () => {
    const silent = assessCell({ ...base, flow: "text", ended: "named_failure", endDetail: "dead", inboundId: "m1", observed: empty });
    expect(judgeCell(silent).pass).toBe(false);
    const told = assessCell({ ...base, flow: "text", ended: "named_failure", endDetail: "dead", inboundId: "m1", observed: { ...empty, outbound: [{ kind: "status", key: "turn-dead:m1", head: "x", body: "x" }] } });
    expect(judgeCell(told).pass).toBe(true);
    const unreached = assessCell({ ...base, hits: {}, flow: "text", ended: "result", endDetail: "ok", inboundId: "m1", observed: empty });
    expect(judgeCell(unreached).pass).toBeNull();
  });
  it("a prediction written while the writer was down, a duplicate text, and a day-long memory of an outage each fail", () => {
    const o: Observed = { ...empty, predictions: 1, outbound: [{ kind: "opinion", key: "opinion:m1", head: "a", body: "a" }, { kind: "opinion", key: "opinion:m1b", head: "a", body: "a" }], cache: [{ ref: "drill:post.info", stored: false, freshEmpty: false, error: true, rememberedLong: true }] };
    const c = assessCell({ ...base, flow: "tiktok_link", ended: "result", endDetail: "", inboundId: "m1", observed: o });
    const why = judgeCell(c).why.join(" | ");
    expect(why).toMatch(/fake success/);
    expect(why).toMatch(/sent twice/);
    expect(why).toMatch(/cached wrongly/);
    expect(matrixOf([c]).summary).toEqual({ pass: 0, fail: 1, na: 0 });
  });
});

describe("the drill, run", () => {
  it("ScrapeCreators out of credits (402): every flow ends, the waiting creator is told it's ours, the operator gets a row, nothing is cached or retired", async () => {
    const { report, faultsLeft } = await drill(["scrape_402"], ["scout", "sampler", "sweep", "text", "tiktok_link", "instagram_link"]);
    expect(report.status).toBe("finished");
    expect(faultsLeft.config).toBeNull(); // the switch is off after the run
    const cells = Object.fromEntries(report.cells.map((c) => [c.flow, c]));
    for (const flow of ["scout", "sampler", "sweep", "tiktok_link", "instagram_link"]) {
      expect(cells[flow].reached, flow).toBe(true);
      expect(cells[flow].verdict.pass, `${flow}: ${cells[flow].verdict.why.join("; ")}`).toBe(true);
      expect(cells[flow].badCache, flow).toEqual([]);
      expect(cells[flow].wrongMarks, flow).toEqual([]);
    }
    // Out of credits reaches the operator from whichever flow hit it first, the scout included (it used to degrade silently).
    for (const flow of ["scout", "sampler", "sweep", "tiktok_link", "instagram_link"]) expect(cells[flow].operator.health, flow).toContain("scrapecreators/credit-balance:drill");
    expect(cells.sampler.operator.health).toContain("scrapecreators/read:creator:drill");
    expect(cells.sweep.operator.health).toContain("scrapecreators/read:creator:drill");
    expect(cells.tiktok_link.heard.map((h) => h.kind)).toEqual(["opinion"]);
    expect(cells.instagram_link.heard.map((h) => h.kind)).toEqual(["opinion"]);
    for (const c of report.cells) expect(["stuck", "silent"]).not.toContain(c.ended);
  });

  it("the bad day: every flow ends in a result, a retry or a named failure, and no cell fails", async () => {
    const { report } = await drill(["bad_day"]);
    expect(report.cells.map((c) => c.flow).sort()).toEqual([...FLOWS].sort());
    for (const c of report.cells) expect(["stuck", "silent"], `${c.flow}: ${c.endDetail}`).not.toContain(c.ended);
    expect(report.failures, JSON.stringify(report.failures, null, 1)).toEqual([]);
    const cells = Object.fromEntries(report.cells.map((c) => [c.flow, c]));
    expect(cells.email_send.ended).toBe("skipped"); // the fake Gmail needs EVAL_FAKES on a local deployment
    expect(cells.analytics.operator.health).toContain("zernio/account insights:drill");
    expect(cells.web_search.ended).toBe("named_failure");
  }, 60_000); // the Zernio client really backs off between its three attempts

  it("the writer down: waiting turns are answered honestly and the scout's failure reaches the operator", async () => {
    const { report } = await drill(["writer_5xx"], ["scout", "text", "tiktok_link"]);
    expect(report.failures, JSON.stringify(report.failures, null, 1)).toEqual([]);
    const cells = Object.fromEntries(report.cells.map((c) => [c.flow, c]));
    expect(cells.scout.operator.health).toContain("openrouter/scout:drill");
    expect(cells.text.heard.map((h) => h.key.split(":")[0])).toEqual(["turn-dead"]);
  });
});
