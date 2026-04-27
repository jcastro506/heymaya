/**
 * GBP integration — barrel.
 *
 * Sprint 1 (service product). The single import surface every skill /
 * behavior / Convex action MUST use to talk to Google Business Profile.
 *
 * Per service plan § 3 layer table (operator decision 2026-04-27): v0
 * routes everything through Zernio. Direct GBP API code (parked at
 * `./direct/`) becomes the post-partner-access upgrade — at that point
 * this file's two `export *` lines flip:
 *
 *   // v0 (NOW):
 *   export * from "./zernio";
 *
 *   // post-partner-access upgrade (LATER):
 *   // export * from "./direct";
 *
 * The interface-isolation contract guarantees that swap is the ONLY change
 * required outside `convex/integrations/{zernio,gbp/direct}/`. If you find
 * yourself adding a NEW import from `convex/integrations/zernio/` to
 * non-integration code, STOP and route through this barrel instead.
 */

export * from "./zernio";
// export * from "./direct"; // ENABLE when partner access lands; see ./direct/README.md
