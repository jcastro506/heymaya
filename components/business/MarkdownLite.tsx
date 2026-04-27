/**
 * Re-export wrapper for the shared MarkdownLite renderer.
 *
 * The creator-side `components/creator/MarkdownLite.tsx` is the canonical
 * implementation; the service-business HQ uses an identical brief format
 * (Maya's morning brief is the same shape regardless of product). Rather
 * than duplicate ~190 lines we re-export the creator file here so the
 * service product UI uses the same tested code path. If the brief format
 * ever diverges, this wrapper is the seam where divergence lands.
 */

export { MarkdownLite } from "../creator/MarkdownLite";
