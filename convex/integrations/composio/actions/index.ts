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

export { gmailActions, stripeActions, calendarActions };
export * from "./gmail";
export * from "./stripe";
export * from "./calendar";
