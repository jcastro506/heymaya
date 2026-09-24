/**
 * The deals world (2026-09-24), deterministic: no network, no model. The world is the same every
 * time; the time machine only ever moves a deals fixture's rows; every scripted Gmail event drives
 * the right transition through the REAL research/save/draft/approve/send/sync code with the fakes;
 * the runner refuses anything that isn't an isolated fixture on a local deployment.
 *
 * The network is a stub that forwards only this deployment's own /fake/ routes to convex-test's
 * HTTP router, and throws on anything else: a real Tavily, Gmail or ScrapeCreators call fails the test.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { _resetEncryptionKeyCache } from "../../lib/encryption";
import { Draft, Opportunity, followUpEligible, linksProfile } from "../../partnerships/contracts";
import { emailSendEnabled } from "../../partnerships/providerConfig";
import { runTool, DEFAULT_BUDGET, type ToolCallRecord } from "../../agent/tools";
import { BRANDS, CADENCE_FIELDS, INJECTION, REPLIES, byKey, fakeRead, inventedNumbers, worldPage, worldProfile, worldSearch } from "../dealsWorldData";
import { FAKE_BRAND } from "../fakes";
import { STEP_NAMES, changes, configProblem, hasRange, isDealsFixture, shiftKey, stripMoney, type Snapshot } from "../dealsWorld";

const SITE = "https://fixture.convex.site";
const DAY = 86_400_000;

function fakesOn() {
  vi.stubEnv("EVAL_FAKES", "1");
  vi.stubEnv("ENVIRONMENT_NAME", "local");
  vi.stubEnv("CONVEX_SITE_URL", SITE);
  vi.stubEnv("GMAIL_BASE_URL", `${SITE}/fake/gmail`);
  vi.stubEnv("TAVILY_BASE_URL", `${SITE}/fake/tavily`);
  vi.stubEnv("TAVILY_API_KEY", "");
  vi.stubEnv("PARTNERSHIP_EMAIL_SEND_ENABLED", "");
  vi.stubEnv("ENCRYPTION_KEY", btoa("k".repeat(32)));
  _resetEncryptionKeyCache();
}

async function world() {
  fakesOn();
  const t = convexTest(schema, modules);
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    calls.push(u.toString());
    if (u.origin !== SITE) throw new Error(`no real network in tests: ${u.toString()}`);
    return t.fetch(u.pathname + u.search, init);
  });
  const creatorId = await t.mutation(internal.eval.dealsWorld.createFixture, {});
  await t.mutation(internal.eval.partnershipGauntlet.setPlan, { creatorId, status: "comped", tier: "partner", paired: false });
  await t.mutation(internal.eval.dealsWorld.seedWorld, { creatorId });
  await t.action(internal.eval.partnershipGauntlet.connectFakeMailbox, { creatorId });
  const say = async (body: string) => (await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body })).messageId;
  const snap = () => t.query(internal.eval.dealsWorld.snapshot, { creatorId, since: 0 });
  const opp = async (key: string) => (await snap()).opps.find((o) => o.domain === byKey(key).domain)!;
  /** One outreach touch through the real code: draft → exact SEND → the send action → the fake Gmail. */
  async function touch(opportunityId: string, body: string, subject = "Running creator collab") {
    vi.setSystemTime(Date.now() + 60_000); // they answer a minute later, as people do
    const source = await say("send it to them");
    const r = await t.mutation(internal.partnerships.drafts.prepare, { creatorId, sourceMessageId: source, input: { opportunityId, subject, body } }) as { draftId: Id<"partnershipDrafts"> };
    const d = Draft.parse((await t.query(internal.partnerships.drafts.get, { creatorId, draftId: r.draftId })).row.data);
    const approval = await t.mutation(internal.partnerships.drafts.approve, { creatorId, sourceMessageId: await say(`SEND ${d.approvalCode}`) });
    expect(approval.draftId).toBe(r.draftId);
    await t.action(internal.partnerships.delivery.send, { creatorId, draftId: r.draftId });
    return r.draftId;
  }
  /** Research the official page through the fake Tavily, save the email route, send touch 1. */
  async function pitch(key: string) {
    const b = byKey(key);
    const source = await say(`i want paid running work. pitch ${b.name} for me`);
    const research = await t.action(internal.partnerships.research.run, { creatorId, url: b.pages[0].url }) as { results: Array<{ url: string; excerpt: string; checkedAt: number; kind: "extract" }> };
    const saved = await t.mutation(internal.partnerships.store.change, { creatorId, sourceMessageId: source, operation: "save", input: { brandDomain: b.domain, opportunity: {
      brand: b.name, campaign: "Creator program", type: "sponsorship", fit: "Paid running work", unknowns: ["rate"],
      assessment: { verdict: "investigate", goalAlignment: "paid", contentAlignment: "running", audienceFit: "unknown", commercialFit: "paid, rate unknown", concerns: [], creatorEvidence: [{ kind: "message", id: source, quote: "i want paid running work.", reason: "their goal" }] },
      eligibility: "", compensation: "Paid", route: "email", contactEmail: b.email, evidence: [research.results[0]],
    } } }) as { id: string };
    await touch(saved.id, `Hi ${b.name}, I'm Sam, a running creator. Open to a paid collab? Sam`);
    return saved.id;
  }
  const worker = async (ids: string[]) => {
    vi.setSystemTime(Date.now() + 60_000); // the cron runs a minute later
    const since = Date.now();
    await t.mutation(internal.eval.partnershipGauntlet.setPlan, { creatorId, status: "comped", tier: "partner", paired: true });
    for (const id of ids) await t.action(internal.partnerships.delivery.checkOne, { creatorId, opportunityId: id as Id<"partnershipOpportunities"> });
    await t.mutation(internal.eval.partnershipGauntlet.setPlan, { creatorId, status: "comped", tier: "partner", paired: false });
    return (await t.query(internal.eval.dealsWorld.messagesSince, { creatorId, since })).filter((m) => m.direction === "out" && m.kind === "partnership");
  };
  const advance = async (ms: number) => { await t.mutation(internal.eval.dealsWorld.advanceClock, { creatorId, ms }); await t.mutation(internal.eval.fakes.shiftBox, { ms }); };
  const plant = async (key: string, text: string) => {
    vi.setSystemTime(Date.now() + 60_000);
    const o = await opp(key);
    await t.mutation(internal.eval.fakes.reply, { threadId: o.threadId!, text, from: `jordan@${byKey(key).domain}` });
  };
  return { t, creatorId, calls, say, snap, opp, pitch, touch, worker, advance, plant };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-24T15:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("the world is deterministic", () => {
  it("searches, pages and profiles answer the same every time, from the world only", () => {
    expect(worldSearch("running brand that pays creators")).toEqual(worldSearch("running brand that pays creators"));
    expect(worldSearch("running brand that pays creators")[0].url).toBe(FAKE_BRAND.programUrl); // the gauntlet's brand stays first
    expect(worldSearch("stride lab creator program")[0].url).toBe("https://stridelab.co/creators");
    // prior pitches and the hostile page surface only when named
    const generic = worldSearch("paid sponsor for runners").map((r) => r.url).join(" ");
    expect(generic).not.toMatch(/arcadia|fernway|tempo|brightlane/);
    expect(worldSearch("brightlane apparel")[0].url).toBe("https://brightlaneapparel.com/creators");
    expect(worldPage("https://www.cadenceugc.com/apply/")?.content).toContain("Portfolio link with 3 sample videos");
    for (const f of CADENCE_FIELDS) expect(worldPage("https://cadenceugc.com/apply")!.content).toContain(f);
    expect(worldPage("https://nike.com")).toBeNull();
    expect(worldPage("https://brightlaneapparel.com/creators")!.content).toContain(INJECTION);
    expect(FAKE_BRAND.page).toBe(byKey("northline").pages[0].content);
    // the official site links the real account, never the lookalike
    const about = byKey("summit").pages[0].content;
    expect(linksProfile(about, "https://www.instagram.com/summitelectrolytes/")).toBe(true);
    expect(linksProfile(about, "https://www.instagram.com/summit.electrolytes.collabs/")).toBe(false);
    expect(worldProfile("instagram", "@SummitElectrolytes")?.bio).toContain("team@summitelectrolytes.com");
    expect(fakeRead("profile", { platform: "instagram", handle: "summit.electrolytes.collabs" })).toMatchObject({ bio: expect.stringContaining("summitcollabs.payouts@gmail.com"), verified: false });
    expect(() => fakeRead("profile", { platform: "tiktok", handle: "nike" })).toThrow(/wasn't found/);
    expect(() => fakeRead("account.posts", { platform: "tiktok", handle: "stridelab" })).toThrow(/eval world/);
    expect(new Set(BRANDS.map((b) => b.domain)).size).toBe(BRANDS.length);
  });

  it("two fixtures seeded from the world get identical signals and media kits", async () => {
    const a = await world();
    const b = await a.t.mutation(internal.eval.dealsWorld.createFixture, {});
    await a.t.mutation(internal.eval.dealsWorld.seedWorld, { creatorId: b });
    for (const id of [a.creatorId, b]) await a.t.mutation(internal.eval.dealsWorld.watchLane, { creatorId: id, on: true });
    const lanes = await Promise.all([a.creatorId, b].map((creatorId) => a.t.query(internal.partnerships.signals.laneBrands, { creatorId })));
    const kits = await Promise.all([a.creatorId, b].map((creatorId) => a.t.query(internal.partnerships.kit.mediaKit, { creatorId })));
    expect(lanes[0]).toEqual(lanes[1]);
    expect(kits[0]).toEqual(kits[1]);
    expect(lanes[0].map((l) => `${l.handle}:${l.creators.length}`)).toEqual(["northlinerunning:2", "summitelectrolytes:1", "stridelab:1"]);
    expect(lanes[0].some((l) => l.handle === "verdantgreens")).toBe(false); // a tag is not a payment
    expect(kits[0]?.platforms[0]).toMatchObject({ followers: 3400, normalViews: 5100, posts: 10 });
    expect(kits[0]?.taggedByThem.map((x) => x.handle)).toContain("trailfuel");
    // off: the fleet sampler never sees the fictional accounts
    await a.t.mutation(internal.eval.dealsWorld.watchLane, { creatorId: a.creatorId, on: false });
    expect(await a.t.query(internal.partnerships.signals.laneBrands, { creatorId: a.creatorId })).toEqual([]);
  });
});

describe("only fixtures, only locally", () => {
  it("the world's writes and the time machine refuse a customer", async () => {
    const { t } = await world();
    const customer = await t.run((ctx) => seedCreator(ctx, "customer", { plan: { status: "active", tier: "partner", founding: false } }));
    const before = await t.run((ctx) => ctx.db.get(customer));
    await expect(t.mutation(internal.eval.dealsWorld.advanceClock, { creatorId: customer, ms: DAY })).rejects.toThrow(/fixture required/);
    await expect(t.mutation(internal.eval.dealsWorld.seedWorld, { creatorId: customer })).rejects.toThrow(/fixture required/);
    await expect(t.mutation(internal.eval.dealsWorld.watchLane, { creatorId: customer, on: true })).rejects.toThrow(/fixture required/);
    await expect(t.query(internal.eval.dealsWorld.snapshot, { creatorId: customer, since: 0 })).rejects.toThrow(/fixture required/);
    expect(await t.run((ctx) => ctx.db.get(customer))).toEqual(before);
    // a fixture that somehow got a chat or a phone is no longer a fixture
    expect(isDealsFixture({ clerkUserId: "eval:partnership:deals:1", telegramChatId: "123" })).toBe(false);
    expect(isDealsFixture({ clerkUserId: "eval:partnership:1" })).toBe(false); // the gauntlet's fixtures aren't the world's
    expect(isDealsFixture({ clerkUserId: "eval:partnership:deals:1" })).toBe(true);
  });

  it("the runner refuses without the fakes, off a local deployment, or beside the gauntlet", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(internal.eval.dealsWorld.run, {})).rejects.toThrow(/only against the fakes/);
    await expect(t.mutation(internal.eval.dealsWorld.createFixture, {})).rejects.toThrow(/local eval only/);
    fakesOn();
    vi.stubEnv("ENVIRONMENT_NAME", "production");
    expect(configProblem(process.env)).toMatch(/local/);
    await expect(t.action(internal.eval.dealsWorld.run, {})).rejects.toThrow(/local/);
    fakesOn();
    vi.stubEnv("GMAIL_BASE_URL", "https://attacker.example/fake/gmail");
    expect(configProblem(process.env)).toMatch(/GMAIL_BASE_URL/);
    fakesOn();
    expect(configProblem(process.env)).toBeNull();
    await t.mutation(internal.eval.partnershipGauntlet.takeLock, {});
    await expect(t.action(internal.eval.dealsWorld.run, {})).rejects.toThrow(/gauntlet is running/);
    expect(emailSendEnabled({ clerkUserId: "eval:partnership:deals:1" })).toBe(true);
    expect(emailSendEnabled({ clerkUserId: "user_123" })).toBe(false);
    vi.stubEnv("ENVIRONMENT_NAME", "production");
    expect(emailSendEnabled({ clerkUserId: "eval:partnership:deals:1" })).toBe(false);
  });

  it("the time machine moves only this fixture's rows, by exactly the amount", async () => {
    const w = await world();
    const other = await w.t.mutation(internal.eval.dealsWorld.createFixture, {});
    const otherMsg = await w.t.mutation(internal.core.messages.recordInbound, { creatorId: other, surface: "telegram", body: "hi" });
    const otherTs = Date.now();
    const id = await w.pitch("northline");
    const before = await w.snap();
    const msgsBefore = await w.t.query(internal.eval.dealsWorld.messagesSince, { creatorId: w.creatorId, since: 0 });
    await w.advance(5 * DAY);
    const after = await w.snap();
    const o0 = before.opps.find((o) => o.id === id)!, o1 = after.opps.find((o) => o.id === id)!;
    expect(o0.followUpAt! - o1.followUpAt!).toBe(5 * DAY);
    expect(o0.lastOutboundAt! - o1.lastOutboundAt!).toBe(5 * DAY);
    expect(before.drafts[0].createdAt - after.drafts[0].createdAt).toBe(5 * DAY);
    const msgsAfter = await w.t.query(internal.eval.dealsWorld.messagesSince, { creatorId: w.creatorId, since: 0 });
    expect(msgsAfter.map((m) => m.ts)).toEqual(msgsBefore.map((m) => m.ts - 5 * DAY));
    expect((await w.t.run((ctx) => ctx.db.get(otherMsg.messageId)))?.ts).toBe(otherTs); // the other fixture didn't move
    expect((await w.t.query(internal.eval.fakes.box, {})).sent[0].at).toBe(o0.lastOutboundAt! - 5 * DAY);
    expect(followUpEligible(Opportunity.parse((await w.t.run((ctx) => ctx.db.get(id as Id<"partnershipOpportunities">)))!.data), Date.now())).toBe(true);
    await expect(w.t.mutation(internal.eval.dealsWorld.advanceClock, { creatorId: w.creatorId, ms: 61 * DAY })).rejects.toThrow(/60 days/);
  });
});

describe("every scripted Gmail event drives the real delivery code", () => {
  it("a bounce and an unsubscribe suppress by code; nobody is nudged; suppressed stays suppressed", async () => {
    const w = await world();
    const f = await w.pitch("fernway"), tm = await w.pitch("tempo");
    expect((await w.t.query(internal.eval.fakes.box, {})).sent).toHaveLength(2);
    await w.plant("fernway", REPLIES.fernwayBounce);
    await w.plant("tempo", REPLIES.tempoUnsubscribe);
    expect(await w.worker([f, tm])).toEqual([]);
    expect((await w.opp("fernway")).status).toBe("suppressed");
    expect((await w.opp("tempo")).status).toBe("suppressed");
    const source = await w.say("try tempo again");
    await expect(w.t.mutation(internal.partnerships.store.change, { creatorId: w.creatorId, sourceMessageId: source, operation: "report", input: { opportunityId: tm, status: "contacted", note: "again" } })).rejects.toThrow(/suppressed/);
    await expect(w.t.mutation(internal.partnerships.drafts.prepare, { creatorId: w.creatorId, sourceMessageId: source, input: { opportunityId: tm, subject: "Running creator collab", body: "again" } })).rejects.toThrow(/No actionable/);
    // only the fake routes were ever fetched
    expect(w.calls.every((u) => u.startsWith(`${SITE}/fake/`))).toBe(true);
  });

  it("a positive reply and a rejection on one day: both read, one partnerships text that day, the other the next day", async () => {
    const w = await world();
    const s = await w.pitch("stridelab"), ar = await w.pitch("arcadia");
    await w.advance(2 * DAY);
    await w.plant("stridelab", REPLIES.stridePositive);
    await w.plant("arcadia", REPLIES.arcadiaRejection);
    const today = await w.worker([s, ar]);
    expect(today.map((m) => m.dedupeKey?.split(":")[0])).toEqual(["partner-reply"]);
    expect((await w.opp("stridelab")).status).toBe("replied");
    expect((await w.opp("arcadia")).status).toBe("replied");
    expect((await w.snap()).events.email_received_untrusted).toBe(2);
    await w.say("ok"); // they answer, the question closes
    await w.advance(DAY);
    const tomorrow = await w.worker([s, ar]);
    expect(tomorrow).toHaveLength(1);
    expect(tomorrow[0].body).toMatch(/Arcadia/);
    // closed on their word: stays in the record, never nudges again
    const source = await w.say("close arcadia out");
    await w.t.mutation(internal.partnerships.store.change, { creatorId: w.creatorId, sourceMessageId: source, operation: "report", input: { opportunityId: ar, status: "declined", note: "They declined this season" } });
    await w.advance(DAY);
    expect(await w.worker([ar])).toEqual([]);
    expect((await w.opp("arcadia")).status).toBe("declined");
  });

  it("the counter goes out in the same thread, replying to the brand's own message", async () => {
    const w = await world();
    const s = await w.pitch("stridelab");
    await w.plant("stridelab", REPLIES.stridePositive);
    await w.worker([s]);
    const thread = (await w.opp("stridelab")).threadId;
    await w.touch(s, "Thanks Jordan! $900 for the bundle with 30 days of usage. Sam");
    const box = await w.t.query(internal.eval.fakes.box, {});
    expect(box.sent).toHaveLength(2);
    expect(box.sent[1].threadId).toBe(thread);
    expect(atob(box.sent[1].raw.replace(/-/g, "+").replace(/_/g, "/"))).toContain("In-Reply-To: <fake_reply_1@stridelab.co>");
    // the counter-offer arrives: replied again, nothing accepted by code
    await w.plant("stridelab", REPLIES.strideCounter);
    await w.say("ok");
    await w.advance(DAY);
    await w.worker([s]);
    expect((await w.opp("stridelab")).status).toBe("replied");
    expect((await w.t.query(internal.eval.fakes.box, {})).sent).toHaveLength(2);
  });

  it("silence: follow-up at day 5, again at day 12 (research then 12 days old), closed at day 19, a third refused", async () => {
    const w = await world();
    const n = await w.pitch("northline");
    await w.advance(5 * DAY + 3_600_000);
    const first = await w.worker([n]);
    expect(first.map((m) => m.dedupeKey?.split(":")[0])).toEqual(["partner-followup"]);
    await w.touch(n, "Just bumping this, Sam");
    expect((await w.opp("northline")).followUpCount).toBe(1);
    await w.advance(7 * DAY + 3_600_000);
    expect((await w.worker([n])).map((m) => m.dedupeKey?.split(":")[0])).toEqual(["partner-followup"]);
    // the regression: this second follow-up was refused as "Research is stale" (evidence now 12 days old)
    await w.touch(n, "Last note from me, Sam");
    const o = await w.opp("northline");
    expect(o.followUpCount).toBe(2);
    expect((await w.t.query(internal.eval.fakes.box, {})).sent.map((m) => m.threadId)).toEqual([o.threadId, o.threadId, o.threadId]);
    await w.advance(7 * DAY + 3_600_000);
    const close = await w.worker([n]);
    expect(close.map((m) => m.dedupeKey?.split(":")[0])).toEqual(["partner-closed"]);
    expect(await w.opp("northline")).toMatchObject({ status: "closed", closedReason: "no_response" });
    expect(await w.worker([n])).toEqual([]);
    const source = await w.say("send northline one more");
    await expect(w.t.mutation(internal.partnerships.drafts.prepare, { creatorId: w.creatorId, sourceMessageId: source, input: { opportunityId: n, subject: "Running creator collab", body: "one more" } })).rejects.toThrow(/No actionable/);
    expect((await w.t.query(internal.eval.fakes.box, {})).sent).toHaveLength(3);
  });

  it("an expired code is refused and a wrong code finds nothing; only the exact live code sends", async () => {
    const w = await world();
    const source = await w.say("pitch northline");
    const r = await w.t.action(internal.partnerships.research.run, { creatorId: w.creatorId, url: FAKE_BRAND.programUrl }) as { results: Array<{ url: string; excerpt: string; checkedAt: number; kind: "extract" }> };
    const saved = await w.t.mutation(internal.partnerships.store.change, { creatorId: w.creatorId, sourceMessageId: source, operation: "save", input: { brandDomain: FAKE_BRAND.domain, opportunity: { brand: FAKE_BRAND.name, campaign: "Creators", type: "sponsorship", fit: "running", unknowns: [], assessment: { verdict: "recommend", goalAlignment: "g", contentAlignment: "c", audienceFit: "a", commercialFit: "m", concerns: [], creatorEvidence: [{ kind: "message", id: source, quote: "pitch northline", reason: "asked" }] }, eligibility: "", compensation: "Paid", route: "email", contactEmail: FAKE_BRAND.email, evidence: [r.results[0]] } } }) as { id: Id<"partnershipOpportunities"> };
    const draft = await w.t.mutation(internal.partnerships.drafts.prepare, { creatorId: w.creatorId, sourceMessageId: source, input: { opportunityId: saved.id, subject: "Hi", body: "A pitch" } }) as { draftId: Id<"partnershipDrafts"> };
    const code = Draft.parse((await w.t.query(internal.partnerships.drafts.get, { creatorId: w.creatorId, draftId: draft.draftId })).row.data).approvalCode;
    expect((await w.t.mutation(internal.partnerships.drafts.approve, { creatorId: w.creatorId, sourceMessageId: await w.say(`SEND ${"0f".repeat(12)}`) })).text).toMatch(/couldn.t find/);
    await w.advance(25 * 3_600_000);
    expect((await w.t.mutation(internal.partnerships.drafts.approve, { creatorId: w.creatorId, sourceMessageId: await w.say(`SEND ${code}`) })).text).toMatch(/no longer available/);
    expect((await w.t.query(internal.eval.fakes.box, {})).sent).toHaveLength(0);
  });
});

describe("the fixture's vendors are the fakes, and nothing else changes", () => {
  it("research: no real key needed; a known brand is refused before a credit; the bio email is accepted, the lookalike's refused", async () => {
    const w = await world();
    await w.pitch("arcadia");
    const before = await w.snap();
    const known = await w.t.action(internal.partnerships.research.run, { creatorId: w.creatorId, query: "arcadia socks ambassador program" }) as { existingRelationship?: unknown };
    expect(known.existingRelationship).toBeDefined();
    expect((await w.snap()).research.calls).toBe(before.research.calls);
    expect((await w.snap()).costs.tavilyCalls).toBe(before.costs.tavilyCalls);
    const site = await w.t.action(internal.partnerships.research.run, { creatorId: w.creatorId, url: "https://summitelectrolytes.com/about" }) as { results: Array<Record<string, unknown>> };
    const real = await w.t.action(internal.partnerships.research.run, { creatorId: w.creatorId, profile: "instagram:summitelectrolytes" }) as { results: Array<Record<string, unknown>> };
    const fake = await w.t.action(internal.partnerships.research.run, { creatorId: w.creatorId, profile: "instagram:summit.electrolytes.collabs" }) as { results: Array<Record<string, unknown>> };
    const source = await w.say("summit keeps paying people i follow. i want paid deals");
    const base = { brand: "Summit Electrolytes", campaign: "Creators", type: "sponsorship", fit: "paid", unknowns: [], assessment: { verdict: "investigate", goalAlignment: "g", contentAlignment: "c", audienceFit: "a", commercialFit: "m", concerns: [], creatorEvidence: [{ kind: "message", id: source, quote: "i want paid deals", reason: "goal" }] }, eligibility: "", compensation: "Paid", route: "email" };
    await expect(w.t.mutation(internal.partnerships.store.change, { creatorId: w.creatorId, sourceMessageId: source, operation: "save", input: { brandDomain: "summitelectrolytes.com", opportunity: { ...base, contactEmail: "summitcollabs.payouts@gmail.com", evidence: [site.results[0], fake.results[0]] } } })).rejects.toThrow(/Email is not present/);
    const ok = await w.t.mutation(internal.partnerships.store.change, { creatorId: w.creatorId, sourceMessageId: source, operation: "save", input: { brandDomain: "summitelectrolytes.com", opportunity: { ...base, contactEmail: "team@summitelectrolytes.com", evidence: [site.results[0], real.results[0]] } } }) as { id?: string };
    expect(ok.id).toBeTruthy();
    expect(w.calls.every((u) => u.startsWith(`${SITE}/fake/`))).toBe(true);
    expect(w.calls.some((u) => u.includes("scrapecreators"))).toBe(false);
  });

  it("web_search/web_read for a fixture reach the fake; a customer still reaches the real endpoint", async () => {
    const w = await world();
    const r = await w.t.action(internal.agent.web.search, { creatorId: w.creatorId, query: "stride lab creator program" });
    expect(r.ok && r.results[0].url).toBe("https://stridelab.co/creators");
    const page = await w.t.action(internal.agent.web.read, { creatorId: w.creatorId, url: "https://verdantgreens.com/collabs" });
    expect(page.ok && page.results[0].excerpt).toMatch(/only offer gifted product/);
    const customer = await w.t.run((ctx) => seedCreator(ctx, "web-customer"));
    vi.stubEnv("TAVILY_API_KEY", "real-key");
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { seen.push(url); return new Response(JSON.stringify({ results: [] })); });
    await w.t.action(internal.agent.web.search, { creatorId: customer, query: "running brands" });
    expect(seen).toEqual(["https://api.tavily.com/search"]);
  });

  it("the profile tool for a fixture answers from the world, never the vendor or the shared cache", async () => {
    const w = await world();
    const r = await w.t.action(internal.reads.read.read, { kind: "profile", params: { platform: "instagram", handle: "summitelectrolytes" }, creatorId: w.creatorId });
    expect(r.value).toMatchObject({ handle: "summitelectrolytes", followerCount: 48_200 });
    expect(await w.t.run((ctx) => ctx.db.query("readCache").collect())).toEqual([]);
    await expect(w.t.action(internal.reads.read.read, { kind: "account.posts", params: { platform: "tiktok", handle: "stridelab" }, creatorId: w.creatorId })).rejects.toThrow(/eval world/);
    expect(w.calls).toEqual([]);
  });

  it("the draft tool now carries application answers, only for the form's real questions", async () => {
    const w = await world();
    const source = await w.say("help me apply to cadence ugc, i want paid ugc work");
    const page = await w.t.action(internal.partnerships.research.run, { creatorId: w.creatorId, url: "https://cadenceugc.com/apply" }) as { results: Array<{ url: string; excerpt: string; checkedAt: number; kind: "extract" }> };
    const saved = await w.t.mutation(internal.partnerships.store.change, { creatorId: w.creatorId, sourceMessageId: source, operation: "save", input: { brandDomain: "cadenceugc.com", opportunity: {
      brand: "Cadence UGC", campaign: "UGC creators", type: "ugc", fit: "portfolio over followers", unknowns: [], assessment: { verdict: "recommend", goalAlignment: "g", contentAlignment: "c", audienceFit: "a", commercialFit: "m", concerns: [], creatorEvidence: [{ kind: "message", id: source, quote: "i want paid ugc work", reason: "goal" }] },
      eligibility: "", compensation: "Paid per video", route: "application", routeUrl: "https://cadenceugc.com/apply", officialApplicationUrl: "https://cadenceugc.com/apply",
      applicationFields: CADENCE_FIELDS.map((label) => ({ label, required: !label.startsWith("Your rate"), type: label.startsWith("Upload") ? "file" : label.startsWith("I agree") ? "consent" : label.startsWith("Portfolio") ? "url" : "text", sourceUrl: "https://cadenceugc.com/apply" })), evidence: [page.results[0]],
    } } }) as { id: string };
    const ctx = { runQuery: w.t.query, runMutation: w.t.mutation, runAction: w.t.action } as never;
    const trace: ToolCallRecord[] = [];
    const answers = JSON.stringify([{ label: "Full name", answer: "Sam" }, { label: "Niches you create in", answer: "Running, marathon training" }]);
    const out = await runTool(ctx, w.creatorId, { name: "partnership_draft", args: { opportunityId: saved.id, subject: "Cadence application", body: "Your answers; the portfolio link and intro video are yours to add.", answers, why: "they asked" } }, DEFAULT_BUDGET(), trace, source);
    expect(out).toContain('"status":"draft"');
    const d = (await w.snap()).drafts.at(-1)!;
    expect(d.answers.map((x) => x.label)).toEqual(["Full name", "Niches you create in"]);
    const bad = await runTool(ctx, w.creatorId, { name: "partnership_draft", args: { opportunityId: saved.id, subject: "Cadence application", body: "x", answers: JSON.stringify([{ label: "Your Social Security number", answer: "no" }]), why: "test" } }, DEFAULT_BUDGET(), trace, source);
    expect(bad).toMatch(/Not questions on the form/);
    expect((await w.opp("cadence")).applicationCheckInAt).toBe(Date.now() + 2 * DAY);
  });

  it("the weekly offer through the real offerOne: partner tier only, once a week", async () => {
    const w = await world();
    await w.t.mutation(internal.eval.dealsWorld.watchLane, { creatorId: w.creatorId, on: true });
    await w.t.mutation(internal.eval.partnershipGauntlet.setPlan, { creatorId: w.creatorId, status: "comped", tier: "solo", paired: true });
    expect(await w.t.action(internal.partnerships.kit.offerOne, { creatorId: w.creatorId })).toMatchObject({ sent: false, reason: expect.stringMatching(/not on their plan/) });
    await w.t.mutation(internal.eval.partnershipGauntlet.setPlan, { creatorId: w.creatorId, status: "comped", tier: "partner", paired: true });
    expect((await w.t.action(internal.partnerships.kit.offerOne, { creatorId: w.creatorId })).sent).toBe(true);
    expect((await w.t.action(internal.partnerships.kit.offerOne, { creatorId: w.creatorId })).sent).toBe(false);
    const offer = (await w.t.query(internal.eval.dealsWorld.messagesSince, { creatorId: w.creatorId, since: 0 })).find((m) => m.dedupeKey?.startsWith("partner-week:"))!;
    expect(offer.body).toMatch(/@northlinerunning \(paid 2 creators/);
    expect(offer.body).not.toMatch(/verdant|trailfuel/);
    // the kit page: public numbers only, and a revoked link is dead
    const on = await w.t.mutation(internal.partnerships.kitPage.kitLinkFor, { creatorId: w.creatorId, on: true });
    const slug = on.url!.split("/k/")[1];
    expect(JSON.stringify(await w.t.query(api.partnerships.kitPage.publicKit, { slug }))).not.toMatch(/paidOnly|trailfuel|eval\.invalid/);
    await w.t.mutation(internal.partnerships.kitPage.kitLinkFor, { creatorId: w.creatorId, on: false });
    expect(await w.t.query(api.partnerships.kitPage.publicKit, { slug })).toBeNull();
  });
});

describe("the judges' pure parts", () => {
  it("numbers are grounded against the kit; money and ranges are recognised; row changes read plainly", () => {
    expect(inventedNumbers("3.4k followers, normal around 4,900 views, my 29.8k marathon video", [3400, 4900, 29800])).toEqual([]);
    expect(inventedNumbers("50k followers and a 12% engagement rate", [3400, 4900])).toEqual([50_000, 12].filter((n) => n >= 10));
    expect(inventedNumbers("2 TikToks and 1 Reel in 2026", [])).toEqual([]);
    expect(shiftKey("partner-followup:abc:1790258400000", 1000)).toBe("partner-followup:abc:1790258399000");
    expect(shiftKey("partner-deliverable:abc:Reel: final:1790258400000", 1000)).toBe("partner-deliverable:abc:Reel: final:1790258399000");
    expect(shiftKey("partner-week:2026-09-21", 1000)).toBe("partner-week:2026-09-21");
    expect(shiftKey("reply:abc", 1000)).toBe("reply:abc");
    expect(hasRange("somewhere around $350–$600 for the bundle")).toBe(true);
    expect(hasRange("between $400 and $700")).toBe(true);
    expect(hasRange("charge $500")).toBe(false);
    expect(stripMoney("$350-$600 based on 4,900 views")).not.toMatch(/350|600/);
    const empty: Snapshot = { opps: [], drafts: [], events: {}, profile: null, research: { calls: 0, queries: [] }, costs: { modelUsd: 0, tavilySimulatedUsd: 0, tavilyCalls: 0, scrapeCredits: 0 }, kitSlug: null, plan: { status: "comped", paired: false } };
    const opp = { id: "o1", domain: "stridelab.co", brand: "Stride Lab", type: "sponsorship", status: "contacted", route: "email", followUpCount: 0, applicationCheckIns: 0, fields: [], evidence: [], verdict: "recommend" };
    const later: Snapshot = { ...empty, opps: [{ ...opp, status: "replied" }], research: { calls: 2, queries: [] } };
    expect(changes({ ...empty, opps: [opp] }, later, 1, 2)).toEqual(["Stride Lab: contacted → replied", "research calls 0 → 2", "fake Gmail sent 1 email"]);
  });
  it("the run covers every behaviour the operator asked for", () => {
    for (const s of ["setup", "weekly_offer", "who_pays", "known_brand", "find_email_brand", "bio_email", "lookalike", "gifting_only", "tiktok_shop", "adversarial_page", "scam_dm", "ugc_application", "pitch_draft", "wrong_codes", "expired_code_then_send", "second_pitch", "bounce_and_unsubscribe", "replies_arrive", "relay_replies", "close_rejection", "rate_help", "counter_send", "ugc_check_in_before", "ugc_submitted", "counter_offer_terms", "follow_up_1", "follow_up_2", "closed_no_response", "third_follow_up_refused", "ugc_check_in_after", "media_kit_link", "who_contacted", "quiet_after_close"]) expect(STEP_NAMES).toContain(s);
  });
});
