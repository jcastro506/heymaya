import { httpRouter } from "convex/server";
import { shareHttp, widgetHttp } from "./share";
import { tavily as tavilyFake, gmail as gmailFake } from "./eval/fakes";
import { linq as linqFake } from "./eval/fakeLinq";
import { gcal as gcalFake } from "./eval/fakeGoogle";
import { stripeWebhook } from "./billing/webhook";
import { zernioWebhook } from "./connections/zernio";
import { telegramWebhookHttp } from "./telegram/webhook";
import { imessageWebhookHttp } from "./imessage/webhook";
import { linqWebhookHttp } from "./imessage/linqWebhook";

/**
 * HTTP routes. Two rules from the scar-tissue list:
 *  - webhooks are PUBLIC routes with their own secret checks, never behind Clerk
 *    (the Stripe webhook 404'd behind auth for months in the old product);
 *  - every handler returns 200 once the secret is verified, even on application
 *    errors, because Telegram and Stripe both retry-poison on non-200.
 */
const http = httpRouter();

http.route({ path: "/telegram/webhook", method: "POST", handler: telegramWebhookHttp });

// §23: the phone channel (iMessage, RCS, SMS), fed by our relay, signed with our secret.
http.route({ path: "/imessage/webhook", method: "POST", handler: imessageWebhookHttp });
http.route({ path: "/linq/webhook", method: "POST", handler: linqWebhookHttp });

// Billing (§19.3): public, signature-verified, idempotent; never behind the web deployment's auth.
http.route({ path: "/stripe/webhook", method: "POST", handler: stripeWebhook });

// M5: the share extension ("Send to Maya"), authenticated by the creator-scoped share token.
http.route({ path: "/share", method: "POST", handler: shareHttp });
// M6: the home-screen widget reads its own data with the same token.
http.route({ path: "/widget", method: "GET", handler: widgetHttp });

// Connections: Zernio's account events are the authoritative path for attach/detach (§6 Sprint 4).
http.route({ path: "/zernio/webhook", method: "POST", handler: zernioWebhook });

// Eval fakes (2026-09-12): served only when EVAL_FAKES=1, reached only through TAVILY_BASE_URL / GMAIL_BASE_URL.
http.route({ pathPrefix: "/fake/tavily/", method: "POST", handler: tavilyFake });
http.route({ pathPrefix: "/fake/gmail/", method: "GET", handler: gmailFake });
http.route({ pathPrefix: "/fake/gmail/", method: "POST", handler: gmailFake });
http.route({ pathPrefix: "/fake/linq/", method: "GET", handler: linqFake });
http.route({ pathPrefix: "/fake/linq/", method: "POST", handler: linqFake });
// A fake Google Calendar for the calendar sims (eval/fakeGoogle), reached only through GOOGLE_CALENDAR_BASE_URL.
for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) http.route({ pathPrefix: "/fake/gcal/", method, handler: gcalFake });

export default http;
