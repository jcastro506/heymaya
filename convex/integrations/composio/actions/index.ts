/**
 * Barrel export for Composio v3 typed action wrappers.
 *
 * Sprint 5. Importers should pull namespaced groups, e.g.:
 *
 *   import { gmailActions } from "@/convex/integrations/composio/actions";
 *   await gmailActions.sendEmail({ connectedAccountId }, { ... });
 *
 * The namespacing keeps `GMAIL_SEND_EMAIL` etc. discoverable in the IDE
 * autocomplete rather than scattered across loose imports.
 */

import * as gmailActions from "./gmail";
import * as stripeActions from "./stripe";
import * as calendarActions from "./calendar";
import * as linkedinActions from "./linkedin";
import * as twitterActions from "./twitter";

export {
  gmailActions,
  stripeActions,
  calendarActions,
  linkedinActions,
  twitterActions,
};
export * from "./gmail";
export * from "./stripe";
export * from "./calendar";
export * from "./linkedin";
// Twitter exports use namespace-only to avoid name collisions with linkedin
// (both have `createPost`, `getMyInfo`, `CreatePostParams`, etc.). Import
// via `twitterActions.createPost(...)` rather than the bare name.
