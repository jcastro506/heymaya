/**
 * K1: the end-to-end deals story, deterministically: the same code path the model drives (her tools,
 * through `runTool`), for all three personas, against the fake market and the fake Gmail. The live run
 * (eval/dealsE2E:run) puts the real model in the loop; this proves the pipes hold without one.
 * Categories: fail-closed (real mode never in production or with the fakes on; nothing is sent),
 * cross-tenant (a persona's per-brand link leads only with its own posts), sibling coherence (the
 * personas' brands are in the market; the offer names the brand the lane pays), adversarial (a draft
 * that breaks a pitch rule is refused through the same tool door).
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { _resetEncryptionKeyCache } from "../../lib/encryption";
import { runTool, DEFAULT_BUDGET, type ToolCallRecord } from "../../agent/tools";
import { craftChecks, modeProblem } from "../dealsE2E";
import { E2E_BRANDS, PERSONAS, personaByKey } from "../dealsE2EData";
import { byKey, worldPage, worldSearch } from "../dealsWorldData";

const SITE = "https://fixture.convex.site";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("where each mode may run (fail-closed)", () => {
  it("fakes only on a local deployment with the fakes on; real never in production, never with the fakes, never without a research key", () => {
    expect(modeProblem("fakes", { EVAL_FAKES: "1", ENVIRONMENT_NAME: "local" })).toBeNull();
    expect(modeProblem("fakes", { EVAL_FAKES: "1", ENVIRONMENT_NAME: "staging" })).toMatch(/local/);
    expect(modeProblem("real", { ENVIRONMENT_NAME: "dev", TAVILY_API_KEY: "k" })).toBeNull();
    expect(modeProblem("real", { ENVIRONMENT_NAME: "production", TAVILY_API_KEY: "k" })).toMatch(/production/);
    expect(modeProblem("real", { ENVIRONMENT_NAME: "prod", TAVILY_API_KEY: "k" })).toMatch(/production/);
    expect(modeProblem("real", { TAVILY_API_KEY: "k" })).toMatch(/unset/);
    expect(modeProblem("real", { ENVIRONMENT_NAME: "dev", TAVILY_API_KEY: "k", EVAL_FAKES: "1" })).toMatch(/fakes OFF/);
    expect(modeProblem("real", { ENVIRONMENT_NAME: "dev" })).toMatch(/TAVILY/);
    expect(modeProblem("real", { ENVIRONMENT_NAME: "dev", TAVILY_API_KEY: "k", TAVILY_BASE_URL: "https://x.convex.site/fake/tavily" })).toMatch(/unset/);
  });
});

describe("the personas' world (sibling coherence)", () => {
  it("every persona's brand is in the market, found by a plain search, with its pages extractable", () => {
    for (const p of PERSONAS) {
      const b = [...E2E_BRANDS].find((x) => x.key === p.brandKey) ?? byKey(p.brandKey);
      expect(worldSearch(`${b.name} creator program`)[0].url).toBe(b.pages[0].url);
      for (const page of b.pages) expect(worldPage(page.url)?.content).toBeTruthy();
      if (p.key !== "sam") expect(p.lanePosts.filter((l) => l.paid).every((l) => l.mentions.includes(p.brandHandle))).toBe(true);
      if (p.expectRoute === "email") expect(b.email).toBeTruthy();
    }
  });
  it("the craft checks read the deal type", () => {
    expect(craftChecks("Hi Panforge, I'm Leo. Could you send a pan for a seasoning video?", "Panforge Cookware", "leo").every((c) => c.ok)).toBe(true);
    expect(craftChecks("Hi team, we should talk. Rates? Dates?", "Panforge Cookware", "leo").filter((c) => !c.ok).map((c) => c.name)).toEqual(expect.arrayContaining(["names the brand", "one concrete idea", "one ask", "fits a gifting/affiliate deal"]));
  });
});

function fakesOn() {
  vi.stubEnv("EVAL_FAKES", "1");
  vi.stubEnv("ENVIRONMENT_NAME", "local");
  vi.stubEnv("CONVEX_SITE_URL", SITE);
  vi.stubEnv("GMAIL_BASE_URL", `${SITE}/fake/gmail`);
  vi.stubEnv("TAVILY_BASE_URL", `${SITE}/fake/tavily`);
  vi.stubEnv("TAVILY_API_KEY", "");
  vi.stubEnv("PARTNERSHIP_EMAIL_SEND_ENABLED", "true");
  vi.stubEnv("ENCRYPTION_KEY", btoa("k".repeat(32)));
  _resetEncryptionKeyCache();
}

/** The story, through her tools: offer → research → save → kit → per-brand link → draft. Nothing sent. */
async function story(key: "sam" | "priya" | "leo") {
  fakesOn();
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.origin !== SITE) throw new Error(`no real network in tests: ${u.toString()}`);
    return t.fetch(u.pathname + u.search, init);
  });
  const p = personaByKey(key);
  const b = [...E2E_BRANDS].find((x) => x.key === p.brandKey) ?? byKey(p.brandKey);
  const creatorId = await t.mutation(internal.eval.dealsE2E.createPersona, { persona: key, mode: "fakes" });
  await t.mutation(internal.eval.dealsE2E.seedPersona, { creatorId, persona: key, lane: true });
  await t.action(internal.eval.partnershipGauntlet.connectFakeMailbox, { creatorId });
  await t.mutation(internal.eval.partnershipGauntlet.setPlan, { creatorId, status: "comped", tier: "partner", paired: true });
  const offer = await t.action(internal.partnerships.kit.offerOne, { creatorId });
  await t.mutation(internal.eval.partnershipGauntlet.setPlan, { creatorId, status: "comped", tier: "partner", paired: false });
  const rows = () => t.query(internal.eval.dealsE2E.rows, { creatorId });
  const offerText = (await rows()).messages.find((m) => (m.dedupeKey ?? "").startsWith("partner-week:"))?.body ?? "";
  const source = (await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: p.script.yes })).messageId;
  const ctx = { runQuery: t.query, runMutation: t.mutation, runAction: t.action, scheduler: { runAfter: async () => undefined } } as never;
  const tool = (name: string, args: Record<string, unknown>) => runTool(ctx, creatorId, { name, args: { why: "the story", ...args } }, DEFAULT_BUDGET(), [] as ToolCallRecord[], source as Id<"messages">);

  // research: the brand's own page (the application page for a UGC form)
  const page = b.pages.at(p.expectRoute === "application" ? -1 : 0)!;
  const research = JSON.parse(await tool("partnership_research", { url: page.url })) as { results: Array<{ url: string; excerpt: string; checkedAt: number; kind: "extract" }> };
  const fields = p.expectRoute === "application" ? page.content.split("\n").filter((l) => /^\d+\./.test(l)).map((l) => ({ label: l.replace(/^\d+\.\s*/, "").replace(/\s*\((required|optional)\)$/, ""), required: /required/.test(l), type: /agree/i.test(l) ? "consent" : /link/i.test(l) ? "url" : "text", sourceUrl: page.url })) : [];
  const saved = JSON.parse(await tool("partnership_update", { operation: "save", input: JSON.stringify({ brandDomain: b.domain, opportunity: {
    brand: b.name, campaign: "Creator program", type: p.key === "priya" ? "ugc" : p.key === "leo" ? "gifting" : "sponsorship", fit: `${b.name} pays creators in their lane.`, unknowns: ["rate"],
    assessment: { verdict: "recommend", goalAlignment: "what they asked for", contentAlignment: "their niche", audienceFit: "unknown", commercialFit: "per the page", concerns: [], creatorEvidence: [{ kind: "message", id: source, quote: p.script.yes, reason: "their yes" }] },
    eligibility: "", compensation: "per the page", route: p.expectRoute, ...(p.expectRoute === "email" ? { contactEmail: b.email } : { routeUrl: page.url, officialApplicationUrl: page.url, applicationFields: fields }), evidence: [research.results[0]],
  } }) })) as { id: Id<"partnershipOpportunities"> };

  const kitText = await tool("media_kit", {});
  const own = (await rows()).ownUrls;
  const link = await tool("kit_for_brand", { opportunityId: saved.id, postUrls: [own[0]], idea: "one concrete video idea for them, in the creator's own style" });
  const kitLink = /https:\/\/\S+\/k\/[a-z0-9]+/.exec(link)?.[0] ?? "";
  return { t, p, b, creatorId, saved, offer, offerText, kitText, link, kitLink, own, rows, tool };
}

describe("the story for each persona, through her tools (nothing sent)", () => {
  for (const key of ["sam", "priya", "leo"] as const) {
    it(`${key}: the lane's brand is offered, researched, saved, given a per-brand kit link and a draft that waits for the code`, async () => {
      const s = await story(key);
      expect(s.offer.sent).toBe(true);
      expect(s.offerText).toContain(`@${s.p.brandHandle}`);
      expect(s.kitText).toMatch(/followers/);
      expect(s.kitLink).toMatch(/\/k\/[a-z0-9]{8,40}$/);
      if (s.p.expectRoute === "email") {
        const bad = await s.tool("partnership_draft", { opportunityId: s.saved.id, subject: "Collaboration opportunity", body: "hi, 99K followers here. Rates? Dates?" });
        expect(bad).toMatch(/Redraft before review/);
        const good = await s.tool("partnership_draft", { opportunityId: s.saved.id, subject: `${s.b.name.split(" ")[0]} x ${s.p.name}: one video idea`, body: `Hi ${s.b.name} team, I'm ${s.p.name}. I make ${s.p.niche.toLowerCase()} videos, and I'd love to make one for you: a short, honest first-try video with your product. Open to me sending the concept? My kit: ${s.kitLink} ${s.p.name}` });
        expect(good).toContain('"status":"draft"');
      } else {
        const r = await s.tool("partnership_draft", { opportunityId: s.saved.id, subject: "Dewdrop application", body: "Your answers; the rate is yours to add.", answers: JSON.stringify([{ label: "Full name", answer: "Priya" }, { label: "Portfolio link", answer: s.kitLink }, { label: "Your skin type", answer: "sensitive" }]) });
        expect(r).toContain('"status":"draft"');
      }
      const after = await s.rows();
      const d = after.drafts.at(-1)!;
      expect(d.data.status).toBe("draft");
      expect(after.variants[0].postUrls.every((u) => s.own.includes(u))).toBe(true);
      expect((await s.t.query(internal.eval.fakes.box, {})).sent).toHaveLength(0);
    });
  }
  it("a persona's per-brand link can't lead with another persona's post (cross-tenant)", async () => {
    const leo = await story("leo");
    const priyaPost = "https://www.instagram.com/reel/evale2e_pr2/";
    expect(await leo.tool("kit_for_brand", { opportunityId: leo.saved.id, postUrls: [priyaPost], idea: "an idea that borrows someone else's post" })).toMatch(/refused: Not one of their posts/);
  });
});
