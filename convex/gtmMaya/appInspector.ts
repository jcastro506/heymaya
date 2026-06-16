import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  generateProductPicture,
  type GroundedFinding,
  type ProductPicture,
} from "./productPicture";
import {
  detectStoreUrl,
  fetchAppleListing,
  storeListingToContext,
  type StoreListing,
} from "../integrations/appStore/storeListing";

export interface AppPageInspection {
  url: string;
  status: number;
  title: string | null;
  description: string | null;
  h1: string | null;
  headings: string[];
  pricingSignals: string[];
  audienceSignals: string[];
  featureSignals: string[];
  ctaSignals: string[];
  screenshot: {
    status: "not_captured";
    reason: string;
  };
}

export interface AppDiagnosis {
  inspectedAt: number;
  appUrl: string;
  pages: AppPageInspection[];
  summary: {
    productPromise: string;
    likelyAudience: string[];
    visibleFeatures: string[];
    conversionSurface: string[];
    missingContext: string[];
  };
  failures: string[];
  /** W1.0 — grounded LLM product picture (founder verifies/corrects via W1.1). */
  picture?: ProductPicture;
}

const COMMON_PATHS = ["/", "/pricing", "/docs", "/blog"] as const;

export const getAppForInspection = internalQuery({
  args: { appId: v.id("gtmApps"), clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ app: Doc<"gtmApps">; accountId: Id<"creators"> } | null> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const app = await ctx.db.get(args.appId);
    if (!app || app.accountId !== creator._id) return null;
    return { app, accountId: creator._id };
  },
});

export const persistAppDiagnosis = internalMutation({
  args: {
    appId: v.id("gtmApps"),
    accountId: v.id("creators"),
    diagnosis: v.any(),
  },
  handler: async (ctx, args): Promise<void> => {
    const app = await ctx.db.get(args.appId);
    if (!app || app.accountId !== args.accountId) {
      throw new Error("persistAppDiagnosis: app/account mismatch.");
    }
    await ctx.db.patch(args.appId, {
      diagnosis: args.diagnosis,
      updatedAt: Date.now(),
    });
  },
});

export const inspectMyGtmApp = action({
  args: { appId: v.id("gtmApps") },
  handler: async (ctx: ActionCtx, args): Promise<AppDiagnosis> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("inspectMyGtmApp requires a signed-in user.");
    const row = await ctx.runQuery(internal.gtmMaya.appInspector.getAppForInspection, {
      appId: args.appId,
      clerkUserId: identity.subject,
    });
    if (!row) throw new Error("GTM app not found for signed-in user.");

    const diagnosis = await inspectApp(row.app.url);
    // W1.0 — augment the regex crawl with a grounded LLM product picture.
    // Soft-fails: on any failure the regex `summary` remains as the fallback.
    const picture = await buildProductPicture(ctx, row.app, diagnosis);
    if (picture) diagnosis.picture = picture;
    await ctx.runMutation(internal.gtmMaya.appInspector.persistAppDiagnosis, {
      appId: args.appId,
      accountId: row.accountId,
      diagnosis,
    });
    return diagnosis;
  },
});

/* -------------------------------------------------------------------------- */
/* W1.0 — grounded product-picture augmentation                               */
/* -------------------------------------------------------------------------- */

/**
 * Build the grounded product picture from the founder's words + the crawled
 * landing page + (mobile) the store listing + cited grounded-search findings.
 * Returns null on any failure or when OPENROUTER_API_KEY is unset, leaving the
 * regex `summary` as the cheap fallback.
 */
async function buildProductPicture(
  ctx: ActionCtx,
  app: Doc<"gtmApps">,
  diagnosis: AppDiagnosis
): Promise<ProductPicture | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  try {
    const [storeListingContext, groundedFindings] = await Promise.all([
      resolveStoreListing(ctx, app),
      resolveGroundedFindings(ctx, app.name),
    ]);
    const { picture } = await generateProductPicture({
      productName: app.name ?? "the product",
      productUrl: app.url,
      founderDifferentiator: app.differentiator ?? null,
      founderWhy: app.founderWhy ?? null,
      crawledSummary: {
        productPromise: diagnosis.summary.productPromise,
        likelyAudience: diagnosis.summary.likelyAudience,
        visibleFeatures: diagnosis.summary.visibleFeatures,
        conversionSurface: diagnosis.summary.conversionSurface,
      },
      storeListingContext,
      groundedFindings,
      apiKey,
      model: process.env.OPENROUTER_DEFAULT_MODEL,
    });
    return picture;
  } catch {
    return null;
  }
}

/**
 * Resolve a store listing from the app's store URLs (or a store-link `url`).
 * Apple via the keyless iTunes Lookup; Play via the "use node" scraper action.
 */
async function resolveStoreListing(
  ctx: ActionCtx,
  app: Doc<"gtmApps">
): Promise<string | null> {
  const candidates = [app.appStoreUrl, app.playStoreUrl, app.url].filter(
    (u): u is string => typeof u === "string" && u.length > 0
  );
  for (const candidate of candidates) {
    const detected = detectStoreUrl(candidate);
    if (!detected) continue;
    let listing: StoreListing | null = null;
    if (detected.source === "app_store") {
      listing = await fetchAppleListing(detected.id);
    } else {
      listing = await ctx.runAction(
        internal.integrations.appStore.playScraper.fetchPlayListingAction,
        { packageName: detected.id }
      );
    }
    if (listing) return storeListingToContext(listing);
  }
  return null;
}

/** Run a grounded "what is <product>" search; soft-fails to []. */
async function resolveGroundedFindings(
  ctx: ActionCtx,
  productName: string | undefined
): Promise<GroundedFinding[]> {
  if (!productName) return [];
  try {
    const res = await ctx.runAction(internal.gtmMaya.webSearch.webSearch, {
      query: `what is ${productName}`,
      limit: 6,
    });
    return res.results.map((r) => ({
      title: r.title,
      url: r.url,
      excerpt: r.excerpt,
    }));
  } catch {
    return [];
  }
}

export async function inspectApp(
  appUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<AppDiagnosis> {
  const root = normalizeRootUrl(appUrl);
  const pages: AppPageInspection[] = [];
  const failures: string[] = [];

  for (const path of COMMON_PATHS) {
    const url = new URL(path, root).toString();
    try {
      const res = await fetchWithTimeout(fetchImpl, url, 10_000);
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        pages.push(emptyPage(url, res.status, "non-html response"));
        continue;
      }
      const html = await res.text();
      pages.push(inspectAppHtml(url, res.status, html));
    } catch (err) {
      failures.push(`${url}: ${(err as Error).message}`);
    }
  }

  return {
    inspectedAt: Date.now(),
    appUrl: root,
    pages,
    summary: summarizePages(pages),
    failures,
  };
}

export function inspectAppHtml(
  url: string,
  status: number,
  html: string
): AppPageInspection {
  const text = htmlToText(html);
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = metaContent(html, "description");
  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean)
    .slice(0, 10);

  return {
    url,
    status,
    title: cleanNullable(title),
    description: cleanNullable(description),
    h1: cleanNullable(h1),
    headings,
    pricingSignals: findSignals(text, [
      "pricing",
      "$",
      "free trial",
      "monthly",
      "annual",
      "plan",
    ]),
    audienceSignals: findSignals(text, [
      "founder",
      "creator",
      "team",
      "developer",
      "agency",
      "startup",
      "customer",
      "builder",
    ]),
    featureSignals: findFeatureSignals(text),
    ctaSignals: findSignals(text, [
      "start",
      "sign up",
      "book a demo",
      "join",
      "try",
      "get started",
    ]),
    screenshot: {
      status: "not_captured",
      reason: "Sprint 4 server inspector records metadata; browser screenshot capture is reserved for the Playwright live smoke.",
    },
  };
}

function summarizePages(pages: AppPageInspection[]): AppDiagnosis["summary"] {
  const primary = pages.find((page) => page.h1 || page.description || page.title);
  return {
    productPromise:
      primary?.h1 ??
      primary?.description ??
      primary?.title ??
      "No clear product promise found on crawled pages.",
    likelyAudience: unique(
      pages.flatMap((page) => page.audienceSignals)
    ).slice(0, 8),
    visibleFeatures: unique(
      pages.flatMap((page) => page.featureSignals)
    ).slice(0, 10),
    conversionSurface: unique(
      pages.flatMap((page) => page.ctaSignals)
    ).slice(0, 8),
    missingContext: [
      pages.some((page) => page.pricingSignals.length > 0)
        ? null
        : "pricing not visible",
      pages.some((page) => page.ctaSignals.length > 0)
        ? null
        : "clear CTA not visible",
      pages.some((page) => page.audienceSignals.length > 0)
        ? null
        : "audience not explicit",
    ].filter((item): item is string => Boolean(item)),
  };
}

function normalizeRootUrl(value: string): string {
  const parsed = new URL(value);
  return `${parsed.protocol}//${parsed.host}/`;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "text/html" },
    });
  } finally {
    clearTimeout(timer);
  }
}

function emptyPage(
  url: string,
  status: number,
  reason: string
): AppPageInspection {
  return {
    url,
    status,
    title: null,
    description: null,
    h1: null,
    headings: [],
    pricingSignals: [],
    audienceSignals: [],
    featureSignals: [],
    ctaSignals: [],
    screenshot: { status: "not_captured", reason },
  };
}

function metaContent(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return firstMatch(
    html,
    new RegExp(
      `<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    )
  );
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? cleanText(match[1]) : null;
}

function htmlToText(html: string): string {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).toLowerCase();
}

function cleanNullable(value: string | null): string | null {
  if (!value) return null;
  const cleaned = cleanText(value);
  return cleaned || null;
}

function cleanText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findSignals(text: string, needles: string[]): string[] {
  return needles.filter((needle) => text.includes(needle.toLowerCase()));
}

function findFeatureSignals(text: string): string[] {
  return findSignals(text, [
    "dashboard",
    "calendar",
    "automation",
    "analytics",
    "workflow",
    "integration",
    "api",
    "report",
    "agent",
    "message",
  ]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
