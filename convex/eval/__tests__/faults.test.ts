/**
 * The outage drill's fault switch must be impossible to trip in production or on a real creator
 * (fail-closed), and when it is on it must fail the way the vendor does, through the real clients.
 * Assertions are on rows, statuses and stable identifiers; never on generated prose.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { REGISTRY } from "../../agent/registry";
import { faultFetch, faultResponse, faultsEnabled, FAULTS, FAULTS_KEY, isFaultableCreator, modelFaultResult, pickFault, type FaultConfig } from "../faults";
import { ScrapeCreatorsClient, ScrapeCreatorsHttpError, ScrapeCreatorsRateLimitError, ScrapeCreatorsTimeoutError } from "../../integrations/scrapeCreators/client";
import { watchMedia } from "../../integrations/gemini/client";
import { isOverloaded } from "../../agent/opinion";

const ENV_KEYS = ["ENVIRONMENT_NAME", "SCRAPE_FIXTURES", "MODEL_FAKE", "CONVEX_CLOUD_URL"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => { saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const cfg = (over: Partial<FaultConfig> = {}): FaultConfig => ({ faults: ["scrape_402"], creatorIds: ["c1"], expiresAt: Date.now() + 60_000, ...over });

describe("fail-closed: where a fault can never fire", () => {
  it("production, an unset environment name, and a production deployment URL are all off", () => {
    expect(faultsEnabled({})).toBe(false);
    expect(faultsEnabled({ ENVIRONMENT_NAME: "" })).toBe(false);
    expect(faultsEnabled({ ENVIRONMENT_NAME: "production" })).toBe(false);
    expect(faultsEnabled({ ENVIRONMENT_NAME: "local", CONVEX_CLOUD_URL: "https://resilient-mandrill-621.convex.cloud" })).toBe(false);
    expect(faultsEnabled({ ENVIRONMENT_NAME: "local", CONVEX_CLOUD_URL: "https://impressive-roadrunner-997.convex.cloud" })).toBe(true);
  });

  it("only an eval creator with no phone and no chat is faultable", () => {
    expect(isFaultableCreator({ clerkUserId: "eval-run:drill-1", telegramChatId: undefined, phone: undefined })).toBe(true);
    expect(isFaultableCreator({ clerkUserId: "eval:partnership:1", telegramChatId: undefined, phone: undefined })).toBe(true);
    expect(isFaultableCreator({ clerkUserId: "user_2abc", telegramChatId: undefined, phone: undefined })).toBe(false);
    expect(isFaultableCreator({ clerkUserId: "eval-run:x", telegramChatId: "123", phone: undefined })).toBe(false);
    expect(isFaultableCreator({ clerkUserId: "eval-run:x", telegramChatId: undefined, phone: "+15550000000" })).toBe(false);
    expect(isFaultableCreator({ clerkUserId: "eval-load:x", telegramChatId: undefined, phone: undefined })).toBe(false);
    expect(isFaultableCreator(null)).toBe(false);
  });

  it("an expired config, an unlisted creator, or no creator at all gets no fault", () => {
    expect(pickFault(cfg({ expiresAt: Date.now() - 1 }), "scrapecreators", Date.now(), { creatorId: "c1" })).toBeNull();
    expect(pickFault(cfg(), "scrapecreators", Date.now(), { creatorId: "c2" })).toBeNull();
    expect(pickFault(cfg(), "scrapecreators", Date.now(), {})).toBeNull();
    expect(pickFault(null, "scrapecreators", Date.now(), { creatorId: "c1" })).toBeNull();
    expect(pickFault(cfg(), "scrapecreators", Date.now(), { creatorId: "c1" })).toBe("scrape_402");
    expect(pickFault(cfg(), "gemini", Date.now(), { creatorId: "c1" })).toBeNull();
  });

  it("writer faults hit the writer's models only; classifier faults hit the classifier only; the critic is untouched", () => {
    const c = cfg({ faults: ["writer_5xx", "classifier_timeout"] });
    expect(pickFault(c, "openrouter", Date.now(), { creatorId: "c1", purpose: "converse", model: REGISTRY.writer.primary })).toBe("writer_5xx");
    expect(pickFault(c, "openrouter", Date.now(), { creatorId: "c1", purpose: "converse_fallback", model: REGISTRY.writer.fallback })).toBe("writer_5xx");
    expect(pickFault(c, "openrouter", Date.now(), { creatorId: "c1", purpose: "classify", model: REGISTRY.screener.primary })).toBe("classifier_timeout");
    expect(pickFault(c, "openrouter", Date.now(), { creatorId: "c1", purpose: "critic", model: REGISTRY.critic.primary })).toBeNull();
  });

  it("the query answers null in production and for a real creator even when the row names them", async () => {
    process.env.ENVIRONMENT_NAME = "local";
    const t = convexTest(schema, modules);
    const real = await t.run((ctx) => seedCreator(ctx, "real"));
    const drill = await t.run((ctx) => seedCreator(ctx, "drill", { clerkUserId: "eval-run:drill-x" }));
    await t.run((ctx) => ctx.db.insert("syncState", { key: FAULTS_KEY, value: JSON.stringify({ faults: ["scrape_402"], creatorIds: [real, drill], expiresAt: Date.now() + 60_000 }), updatedAt: Date.now() }));
    expect(await t.query(internal.eval.faults.active, { creatorId: real, vendor: "scrapecreators" })).toBeNull();
    expect(await t.query(internal.eval.faults.active, { creatorId: drill, vendor: "scrapecreators" })).toBe("scrape_402");
    process.env.ENVIRONMENT_NAME = "production";
    expect(await t.query(internal.eval.faults.active, { creatorId: drill, vendor: "scrapecreators" })).toBeNull();
  });

  it("set refuses production, unknown faults and a real creator", async () => {
    const t = convexTest(schema, modules);
    const real = await t.run((ctx) => seedCreator(ctx, "real"));
    const drill = await t.run((ctx) => seedCreator(ctx, "drill", { clerkUserId: "eval-run:drill-x" }));
    process.env.ENVIRONMENT_NAME = "production";
    await expect(t.mutation(internal.eval.faults.set, { faults: ["scrape_402"], creatorIds: [drill] })).rejects.toThrow(/off on this deployment/);
    process.env.ENVIRONMENT_NAME = "local";
    await expect(t.mutation(internal.eval.faults.set, { faults: ["nope"], creatorIds: [drill] })).rejects.toThrow(/unknown fault/);
    await expect(t.mutation(internal.eval.faults.set, { faults: ["scrape_402"], creatorIds: [real] })).rejects.toThrow(/not an isolated eval creator/);
    const c = await t.mutation(internal.eval.faults.set, { faults: ["scrape_402"], creatorIds: [drill], ttlMinutes: 999 });
    expect(c.expiresAt - Date.now()).toBeLessThanOrEqual(2 * 60 * 60_000); // capped at two hours
    expect((await t.mutation(internal.eval.faults.clear, {})).cleared).toBe(true);
  });

  it("a real creator's read is untouched while a drill fault is on for someone else", async () => {
    process.env.ENVIRONMENT_NAME = "local";
    process.env.SCRAPE_FIXTURES = "spec";
    const t = convexTest(schema, modules);
    const real = await t.run((ctx) => seedCreator(ctx, "real"));
    const drill = await t.run((ctx) => seedCreator(ctx, "drill", { clerkUserId: "eval-run:drill-x" }));
    await t.mutation(internal.eval.faults.set, { faults: ["scrape_402"], creatorIds: [drill] });
    const r = await t.action(internal.reads.read.read, { kind: "post.info", params: { platform: "tiktok", url: "https://www.tiktok.com/@runwithcarly/video/7395965676629888274" }, creatorId: real });
    expect(r.value).toBeTruthy();
    await expect(t.action(internal.reads.read.read, { kind: "post.info", params: { platform: "tiktok", url: "https://www.tiktok.com/@runwithcarly/video/7395965676629888274" }, creatorId: drill })).rejects.toThrow(/402/);
  });
});

describe("a failing vendor, as the real clients see it", () => {
  const client = (f: (typeof FAULTS)[number]) => new ScrapeCreatorsClient({ apiKey: "k", fetchImpl: faultFetch(f), sleep: async () => undefined });
  it("ScrapeCreators: 402 is terminal, 429 and hangs exhaust the retries with their own error types", async () => {
    await expect(client("scrape_402").request("/v1/x")).rejects.toBeInstanceOf(ScrapeCreatorsHttpError);
    await expect(client("scrape_429").request("/v1/x")).rejects.toBeInstanceOf(ScrapeCreatorsRateLimitError);
    await expect(client("scrape_500").request("/v1/x")).rejects.toBeInstanceOf(ScrapeCreatorsHttpError);
    await expect(client("scrape_timeout").request("/v1/x")).rejects.toBeInstanceOf(ScrapeCreatorsTimeoutError);
  });

  it("Gemini: an overload reads as overloaded (so the second model is tried); a hang is a named timeout", async () => {
    const media = { bytes: new ArrayBuffer(8), mimeType: "video/mp4" };
    const over = await watchMedia({ model: "m", apiKey: "k", prompt: "p", media, fetchImpl: faultFetch("gemini_overload") });
    expect(over.ok).toBe(false);
    expect(isOverloaded(over.ok ? "" : over.reason)).toBe(true);
    const hang = await watchMedia({ model: "m", apiKey: "k", prompt: "p", media, fetchImpl: faultFetch("gemini_timeout") });
    expect(hang.ok ? "" : hang.reason).toMatch(/timed out/);
  });

  it("every fault has a response or a hang, and the model faults read like OpenRouter's client", () => {
    for (const f of FAULTS) expect(faultResponse(f)).toBeTruthy();
    expect(modelFaultResult("writer_timeout").reason).toBe("openrouter timed out");
    expect(modelFaultResult("classifier_5xx").reason).toMatch(/^openrouter 503/);
  });
});

describe("a watch that hangs ends (it used to hold the action to the 10-minute limit)", () => {
  it("watchMedia gives up after its timeout with a named reason", async () => {
    const hanging = ((_: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch;
    const r = await watchMedia({ model: "m", apiKey: "k", prompt: "p", media: { bytes: new ArrayBuffer(8), mimeType: "video/mp4" }, fetchImpl: hanging, timeoutMs: 30 });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toMatch(/timed out/);
  });
});
