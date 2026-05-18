import { redirect } from "next/navigation";

/**
 * `/business` — discontinued.
 *
 * The service-business (trades) product was retired on 2026-05-18: Google
 * Business Profile API access was an unworkable dependency. The creator
 * product is now the single public surface, so this route permanently
 * redirects home. Service-business Convex tables/functions are preserved
 * in the codebase (hidden, not deleted) but have no public marketing page.
 *
 * The full prior trades landing is recoverable from git history
 * (pre-`heymaya/creators-only-landing`) if the product is ever revived.
 */
export default function BusinessHome(): never {
  redirect("/");
}
