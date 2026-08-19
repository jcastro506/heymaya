/**
 * Meta Ad Library — the competitor-ad perception layer.
 *
 * ⚠️ **UNVERIFIED UNTIL THE SMOKE SUITE SAYS OTHERWISE.** These paths come from
 * docs.scrapecreators.com, not from a live call. The only prior evidence any of
 * this works is a probe dated 2026-06-04 against the FROZEN product — 14 weeks
 * stale — and TikTok Ad Library appeared in that document's prose but not in its
 * verified matrix. `vendorSmoke/registry.ts` carries checks for these; treat the
 * shapes below as a hypothesis until they are green.
 *
 * ## Why this is worth having at all
 *
 * Meta's own Ad Library API serves POLITICAL AND ISSUE ADS ONLY, and only in
 * the EU/UK. Commercial ads — every consumer app our founders compete with —
 * are visible in the web UI and not available through that API anywhere. So a
 * paid intermediary is the only route, and this is the one we already buy.
 *
 * ## The signal is longevity, not existence
 *
 * Anyone can boost a post for twenty dollars, and that ad looks identical in a
 * library to one running for months. What matters is HOW LONG an ad has run and
 * how many variants exist — a company kills a losing ad fast, so an old ad is a
 * tested one. Any consumer of this module must rank on that, not on presence.
 */

import { clientOf, rawResult, type EndpointDeps } from "../deps";

export const facebook = {
  /**
   * Find an advertiser by name. The join Meta's library needs: it searches by
   * PAGE, and everything we know about a competitor starts as a product name.
   *
   * ⚠️ This is the step that does not exist anywhere else in the product.
   * `competitors.ts` tracks TikTok HANDLES; Meta needs a page. Nothing bridges
   * those, and nothing can until this returns something.
   */
  async searchCompanies(
    query: string,
    deps?: EndpointDeps
  ): Promise<ReturnType<typeof rawResult>> {
    const raw = await clientOf(deps).request<unknown>(
      "/v1/facebook/adLibrary/search/companies",
      { query: { query } }
    );
    return rawResult("facebook_adlibrary_search_companies", { query }, raw);
  },

  /** Every ad a page is currently running. The haul we rank by longevity. */
  async companyAds(
    pageId: string,
    deps?: EndpointDeps
  ): Promise<ReturnType<typeof rawResult>> {
    const raw = await clientOf(deps).request<unknown>(
      "/v1/facebook/adLibrary/company/ads",
      { query: { pageId } }
    );
    return rawResult("facebook_adlibrary_company_ads", { pageId }, raw);
  },

  /** Keyword search across the library, when we have no page to start from. */
  async searchAds(
    query: string,
    deps?: EndpointDeps
  ): Promise<ReturnType<typeof rawResult>> {
    const raw = await clientOf(deps).request<unknown>(
      "/v1/facebook/adLibrary/search/ads",
      { query: { query } }
    );
    return rawResult("facebook_adlibrary_search_ads", { query }, raw);
  },

  /**
   * ⭐ The transcript of an ad — the most valuable half.
   *
   * The script carries the offer, the hook, and the objection it answers, and
   * that travels between products in a way the edit does not. §7.5.3: copy the
   * STRUCTURE, never the claims.
   */
  async adTranscript(
    adId: string,
    deps?: EndpointDeps
  ): Promise<ReturnType<typeof rawResult>> {
    const raw = await clientOf(deps).request<unknown>(
      "/v1/facebook/adLibrary/ad/transcript",
      { query: { id: adId } }
    );
    return rawResult("facebook_adlibrary_ad_transcript", { id: adId }, raw);
  },
};
