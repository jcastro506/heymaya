/**
 * Where the money is (2026-10-12, deals): TikTok Shop products in a creator's lane, and brands running ads there
 * (TikTok's and Meta's public ad libraries). A brand spending on ads in their lane has a budget for content;
 * a product selling in their lane is an affiliate or UGC opening. Trimmed to what the deal scout needs.
 */
import { clientOf, type EndpointDeps } from "../deps";

export interface ShopProduct { productId: string; title: string; price: string | null; sold: number | null; rating: number | null; reviews: number | null; shop: string | null; url: string | null }
export interface AdLead { advertiser: string; text: string | null; firstShown: number | null; lastShown: number | null; active: boolean | null; url: string | null; platform: "tiktok" | "meta"; /** Run with a creator (Meta's branded content): the strongest sign they pay creators. */ withCreator?: boolean }

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null; };
const charged = (raw: unknown) => { const c = (raw as { credits_charged?: unknown } | null)?.credits_charged; return typeof c === "number" ? { credits_charged: c } : {}; };

/** Pure: TikTok Shop search results, trimmed. */
export function shopProducts(raw: unknown): ShopProduct[] {
  const list = ((raw as { products?: unknown[] } | null)?.products ?? []) as Array<Record<string, unknown>>;
  return list.slice(0, 20).map((p) => {
    const price = (p.product_price_info ?? {}) as Record<string, unknown>;
    const seo = (p.seo_url ?? {}) as Record<string, unknown>;
    return {
      productId: String(p.product_id ?? ""), title: str(p.title)?.slice(0, 140) ?? "",
      price: str(price.sale_price_format) ? `${str(price.currency_symbol) ?? "$"}${str(price.sale_price_format)}` : null,
      sold: num((p.sold_info as Record<string, unknown> | undefined)?.sold_count), rating: num((p.rate_info as Record<string, unknown> | undefined)?.score),
      reviews: num((p.rate_info as Record<string, unknown> | undefined)?.review_count), shop: str((p.seller_info as Record<string, unknown> | undefined)?.shop_name),
      url: str(seo.canonical_url),
    };
  }).filter((p) => p.productId && p.title);
}

/** Pure: TikTok ad library results, trimmed to the advertisers. */
export function tiktokAds(raw: unknown): AdLead[] {
  const list = ((raw as { ads?: unknown[] } | null)?.ads ?? []) as Array<Record<string, unknown>>;
  return list.slice(0, 20).map((a) => ({ advertiser: str(a.name) ?? "", text: null, firstShown: num(a.first_shown_date), lastShown: num(a.last_shown_date), active: null, url: str(a.url), platform: "tiktok" as const })).filter((a) => a.advertiser);
}

/** Pure: Meta ad library results, trimmed to the advertisers and what the ad says. */
export function metaAds(raw: unknown): AdLead[] {
  const r = raw as { searchResults?: unknown[]; results?: unknown[]; ads?: unknown[] } | null;
  const list = (r?.searchResults ?? r?.results ?? r?.ads ?? []) as Array<Record<string, unknown>>;
  return list.slice(0, 20).map((a) => {
    const snap = (a.snapshot ?? {}) as Record<string, unknown>;
    const body = (snap.body ?? {}) as Record<string, unknown>;
    return {
      advertiser: str(a.page_name) ?? str(snap.page_name) ?? "", text: (str(body.text) ?? str(snap.title))?.slice(0, 200) ?? null,
      firstShown: num(a.start_date) !== null ? num(a.start_date)! * (num(a.start_date)! < 1e12 ? 1000 : 1) : null,
      lastShown: num(a.end_date) !== null ? num(a.end_date)! * (num(a.end_date)! < 1e12 ? 1000 : 1) : null,
      active: typeof a.is_active === "boolean" ? a.is_active : null, url: str(a.ad_archive_id) ? `https://www.facebook.com/ads/library/?id=${a.ad_archive_id}` : null, platform: "meta" as const,
      withCreator: Boolean(snap.branded_content),
    };
  }).filter((a) => a.advertiser);
}

export const commerce = {
  async shopSearch(query: string, deps?: EndpointDeps) {
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/shop/search", { query: { query } });
    return { products: shopProducts(raw), ...charged(raw) };
  },
  async tiktokAdLibrary(query: string, deps?: EndpointDeps) {
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/ad-library/search", { query: { query } });
    return { ads: tiktokAds(raw), ...charged(raw) };
  },
  async metaAdLibrary(query: string, deps?: EndpointDeps) {
    const raw = await clientOf(deps).request<unknown>("/v1/facebook/adLibrary/search/ads", { query: { query, country: "US", status: "ACTIVE", media_type: "VIDEO", trim: true } });
    return { ads: metaAds(raw), ...charged(raw) };
  },
};
