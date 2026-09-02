import { httpRouter } from "convex/server";
import { stripeWebhook } from "./billing/webhook";
import { zernioWebhook } from "./connections/zernio";
import { telegramWebhookHttp } from "./telegram/webhook";

/**
 * HTTP routes. Two rules from the scar-tissue list:
 *  - webhooks are PUBLIC routes with their own secret checks, never behind Clerk
 *    (the Stripe webhook 404'd behind auth for months in the old product);
 *  - every handler returns 200 once the secret is verified, even on application
 *    errors, because Telegram and Stripe both retry-poison on non-200.
 */
const http = httpRouter();

http.route({ path: "/telegram/webhook", method: "POST", handler: telegramWebhookHttp });

// Billing (§19.3): public, signature-verified, idempotent; never behind the web deployment's auth.
http.route({ path: "/stripe/webhook", method: "POST", handler: stripeWebhook });

// Connections: Zernio's account events are the authoritative path for attach/detach (§6 Sprint 4).
http.route({ path: "/zernio/webhook", method: "POST", handler: zernioWebhook });

export default http;
