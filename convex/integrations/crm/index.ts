/**
 * CRM integration barrel — re-exports for the service-product CRM stack.
 *
 * Wave C / Sprint 4-5. The CRM agent owns Nango + Jobber + HCP + the no-CRM
 * NER extractor. The QBO agent will land `quickbooks.ts` in this directory
 * (separate scope, separate agent). The defensive `export * from "./quickbooks"`
 * line below is COMMENTED OUT to avoid colliding with the QBO agent's
 * additions; uncomment after QBO agent's PR merges.
 *
 * The barrel keeps imports clean for downstream consumers:
 *   import { NangoClient, normalizeJobberJob, detectHcpPlan } from "../crm";
 *
 * It also makes the Wave-C scope visible at-a-glance for future agents.
 */

// Nango — managed-OAuth aggregator + webhook helpers.
export * from "./nango";

// Jobber CRM (Sprint 4).
export * from "./jobber";

// Housecall Pro CRM (Sprint 5).
export * from "./housecallpro";

// No-CRM NER extractor (Persona A primary path).
export * from "./nerExtractor";

// QBO agent owns this file — barrel re-exports added when their PR lands.
// reason: parallel-agent file scoping; QBO agent will add "./quickbooks" here.
// export * from "./quickbooks";
