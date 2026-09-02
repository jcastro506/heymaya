import { httpRouter } from "convex/server";
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

export default http;
