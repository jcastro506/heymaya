/**
 * Stripe action wrappers (Composio v3) — READ-ONLY.
 *
 * Sprint 5. Maya treats Stripe as a *data source* only. She never charges,
 * refunds, or cancels — those are creator-controlled. This file exposes only
 * read endpoints (balance / payouts / invoices) used by the revenue snapshot
 * (playbook § Revenue snapshot, Mon 9am).
 *
 * If a future sprint needs a write (e.g. issuing a refund on a brand
 * dispute), it should be a separate, explicitly-named wrapper file with its
 * own plan-tier gate — never extend this file silently.
 */

import { z } from "zod";
import { runAction } from "../universalRunner";
import type { ComposioClient } from "../client";

export interface StripeActionContext {
  connectedAccountId: string;
  client?: ComposioClient;
}

/* -------------------------------------------------------------------------- */
/* getBalance                                                                  */
/* -------------------------------------------------------------------------- */

export const GetBalanceResponseSchema = z
  .object({
    available: z
      .array(
        z.object({
          amount: z.number(),
          currency: z.string(),
        })
      )
      .default([]),
    pending: z
      .array(
        z.object({
          amount: z.number(),
          currency: z.string(),
        })
      )
      .default([]),
  })
  .passthrough();
export type GetBalanceResponse = z.infer<typeof GetBalanceResponseSchema>;

export async function getBalance(
  ctx: StripeActionContext
): Promise<GetBalanceResponse> {
  const result = await runAction({
    provider: "stripe",
    action: "STRIPE_RETRIEVE_BALANCE",
    params: {},
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: GetBalanceResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* listPayouts                                                                 */
/* -------------------------------------------------------------------------- */

export const ListPayoutsParamsSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  /** Unix seconds — Stripe API convention (not ms). */
  arrivalDateGte: z.number().int().nonnegative().optional(),
  arrivalDateLte: z.number().int().nonnegative().optional(),
  status: z.enum(["paid", "pending", "in_transit", "canceled", "failed"]).optional(),
});
export type ListPayoutsParams = z.infer<typeof ListPayoutsParamsSchema>;

export const ListPayoutsResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string(),
            amount: z.number(),
            currency: z.string(),
            status: z.string(),
            arrivalDate: z.number().optional(),
            description: z.string().nullable().optional(),
          })
          .passthrough()
      )
      .default([]),
    hasMore: z.boolean().optional(),
  })
  .passthrough();
export type ListPayoutsResponse = z.infer<typeof ListPayoutsResponseSchema>;

export async function listPayouts(
  ctx: StripeActionContext,
  params: ListPayoutsParams = {}
): Promise<ListPayoutsResponse> {
  const validated = ListPayoutsParamsSchema.parse(params);
  const result = await runAction({
    provider: "stripe",
    action: "STRIPE_LIST_PAYOUTS",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: ListPayoutsResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* listInvoices                                                                */
/* -------------------------------------------------------------------------- */

export const ListInvoicesParamsSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  status: z.enum(["draft", "open", "paid", "uncollectible", "void"]).optional(),
  customer: z.string().optional(),
});
export type ListInvoicesParams = z.infer<typeof ListInvoicesParamsSchema>;

export const ListInvoicesResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string(),
            amountDue: z.number(),
            amountPaid: z.number(),
            currency: z.string(),
            status: z.string(),
            dueDate: z.number().nullable().optional(),
            customer: z.string().nullable().optional(),
            number: z.string().nullable().optional(),
          })
          .passthrough()
      )
      .default([]),
    hasMore: z.boolean().optional(),
  })
  .passthrough();
export type ListInvoicesResponse = z.infer<typeof ListInvoicesResponseSchema>;

export async function listInvoices(
  ctx: StripeActionContext,
  params: ListInvoicesParams = {}
): Promise<ListInvoicesResponse> {
  const validated = ListInvoicesParamsSchema.parse(params);
  const result = await runAction({
    provider: "stripe",
    action: "STRIPE_LIST_INVOICES",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: ListInvoicesResponseSchema,
    client: ctx.client,
  });
  return result.data;
}
