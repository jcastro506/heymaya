/**
 * Gmail action wrappers (Composio v3).
 *
 * Sprint 5. Maya's full Gmail surface for the brand-deal desk:
 *   - sendEmail        — outbound reply (used by auto-send threshold path)
 *   - searchThreads    — list threads matching a query (read-only enumeration)
 *   - getThread        — fetch a thread's messages + headers + parsed body
 *   - createDraft      — write a draft without sending (creator approves)
 *   - updateDraft      — patch an existing draft
 *   - applyLabel       — categorize triaged threads in Gmail itself
 *
 * Each wrapper validates its response with Zod. Schemas are intentionally
 * narrow — only the fields Maya consumes. If Composio adds upstream fields
 * the `passthrough()` extension keeps the call working; if it RENAMES one,
 * the parser fails loud and the deal-triage path surfaces an error rather
 * than silently mis-routing email.
 */

import { z } from "zod";
import { runAction } from "../universalRunner";
import type { ComposioClient } from "../client";

/* -------------------------------------------------------------------------- */
/* Shared invocation context                                                   */
/* -------------------------------------------------------------------------- */

export interface GmailActionContext {
  /** Composio's connected-account id for THIS creator's Gmail account. */
  connectedAccountId: string;
  /** Test seam — inject a stub client to bypass HTTP. */
  client?: ComposioClient;
}

/* -------------------------------------------------------------------------- */
/* sendEmail                                                                   */
/* -------------------------------------------------------------------------- */

export const SendEmailParamsSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  /** When set, send as a reply on the existing thread. */
  threadId: z.string().optional(),
  /** Optional in-reply-to RFC822 message-id for proper threading. */
  inReplyTo: z.string().optional(),
});
export type SendEmailParams = z.infer<typeof SendEmailParamsSchema>;

export const SendEmailResponseSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    labelIds: z.array(z.string()).optional(),
  })
  .passthrough();
export type SendEmailResponse = z.infer<typeof SendEmailResponseSchema>;

export async function sendEmail(
  ctx: GmailActionContext,
  params: SendEmailParams
): Promise<SendEmailResponse> {
  const validated = SendEmailParamsSchema.parse(params);
  const result = await runAction({
    provider: "gmail",
    action: "GMAIL_SEND_EMAIL",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: SendEmailResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* searchThreads                                                               */
/* -------------------------------------------------------------------------- */

export const SearchThreadsParamsSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(500).optional(),
  pageToken: z.string().optional(),
});
export type SearchThreadsParams = z.infer<typeof SearchThreadsParamsSchema>;

export const SearchThreadsResponseSchema = z
  .object({
    threads: z
      .array(
        z
          .object({
            id: z.string(),
            snippet: z.string().optional(),
            historyId: z.string().optional(),
          })
          .passthrough()
      )
      .default([]),
    nextPageToken: z.string().optional(),
    resultSizeEstimate: z.number().optional(),
  })
  .passthrough();
export type SearchThreadsResponse = z.infer<typeof SearchThreadsResponseSchema>;

export async function searchThreads(
  ctx: GmailActionContext,
  params: SearchThreadsParams
): Promise<SearchThreadsResponse> {
  const validated = SearchThreadsParamsSchema.parse(params);
  const result = await runAction({
    provider: "gmail",
    action: "GMAIL_SEARCH_THREADS",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: SearchThreadsResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* getThread                                                                   */
/* -------------------------------------------------------------------------- */

export const GetThreadParamsSchema = z.object({
  threadId: z.string().min(1),
  /** "minimal" returns headers only; "full" includes body + attachments. */
  format: z.enum(["minimal", "full", "metadata"]).optional(),
});
export type GetThreadParams = z.infer<typeof GetThreadParamsSchema>;

const GmailHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const GmailAttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  /** Composio v3 typically returns either an attachmentId for follow-up download, or a direct URL. */
  attachmentId: z.string().optional(),
  url: z.string().optional(),
  size: z.number().optional(),
});
export type GmailAttachment = z.infer<typeof GmailAttachmentSchema>;

const GmailMessageSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    internalDate: z.union([z.string(), z.number()]).optional(),
    snippet: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
    headers: z.array(GmailHeaderSchema).optional(),
    /** Plain-text body. Composio v3 typically pre-decodes base64. */
    bodyText: z.string().optional(),
    bodyHtml: z.string().optional(),
    attachments: z.array(GmailAttachmentSchema).optional(),
  })
  .passthrough();
export type GmailMessage = z.infer<typeof GmailMessageSchema>;

export const GetThreadResponseSchema = z
  .object({
    id: z.string(),
    historyId: z.string().optional(),
    messages: z.array(GmailMessageSchema).default([]),
  })
  .passthrough();
export type GetThreadResponse = z.infer<typeof GetThreadResponseSchema>;

export async function getThread(
  ctx: GmailActionContext,
  params: GetThreadParams
): Promise<GetThreadResponse> {
  const validated = GetThreadParamsSchema.parse(params);
  const result = await runAction({
    provider: "gmail",
    action: "GMAIL_FETCH_THREAD",
    params: { ...validated, format: validated.format ?? "full" },
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: GetThreadResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* createDraft / updateDraft                                                   */
/* -------------------------------------------------------------------------- */

export const CreateDraftParamsSchema = SendEmailParamsSchema;
export type CreateDraftParams = z.infer<typeof CreateDraftParamsSchema>;

export const CreateDraftResponseSchema = z
  .object({
    id: z.string(),
    message: z
      .object({
        id: z.string(),
        threadId: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
export type CreateDraftResponse = z.infer<typeof CreateDraftResponseSchema>;

export async function createDraft(
  ctx: GmailActionContext,
  params: CreateDraftParams
): Promise<CreateDraftResponse> {
  const validated = CreateDraftParamsSchema.parse(params);
  const result = await runAction({
    provider: "gmail",
    action: "GMAIL_CREATE_DRAFT",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: CreateDraftResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

export const UpdateDraftParamsSchema = CreateDraftParamsSchema.extend({
  draftId: z.string().min(1),
});
export type UpdateDraftParams = z.infer<typeof UpdateDraftParamsSchema>;

export async function updateDraft(
  ctx: GmailActionContext,
  params: UpdateDraftParams
): Promise<CreateDraftResponse> {
  const validated = UpdateDraftParamsSchema.parse(params);
  const result = await runAction({
    provider: "gmail",
    action: "GMAIL_UPDATE_DRAFT",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: CreateDraftResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* applyLabel                                                                  */
/* -------------------------------------------------------------------------- */

export const ApplyLabelParamsSchema = z.object({
  threadId: z.string().min(1),
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
});
export type ApplyLabelParams = z.infer<typeof ApplyLabelParamsSchema>;

export const ApplyLabelResponseSchema = z
  .object({
    id: z.string(),
    labelIds: z.array(z.string()).optional(),
  })
  .passthrough();
export type ApplyLabelResponse = z.infer<typeof ApplyLabelResponseSchema>;

export async function applyLabel(
  ctx: GmailActionContext,
  params: ApplyLabelParams
): Promise<ApplyLabelResponse> {
  const validated = ApplyLabelParamsSchema.parse(params);
  if (
    (!validated.addLabelIds || validated.addLabelIds.length === 0) &&
    (!validated.removeLabelIds || validated.removeLabelIds.length === 0)
  ) {
    throw new Error(
      "applyLabel: at least one of addLabelIds / removeLabelIds must be non-empty."
    );
  }
  const result = await runAction({
    provider: "gmail",
    action: "GMAIL_MODIFY_THREAD_LABELS",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: ApplyLabelResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Header helpers — used by webhook + triage to flatten Gmail's header array  */
/* -------------------------------------------------------------------------- */

export function headerValue(
  message: Pick<GmailMessage, "headers">,
  name: string
): string | null {
  if (!message.headers) return null;
  const lower = name.toLowerCase();
  const found = message.headers.find((h) => h.name.toLowerCase() === lower);
  return found ? found.value : null;
}

/** Extract the email address (and optional display name) from a `From:` header. */
export function parseFromHeader(value: string): {
  email: string;
  name: string | null;
  domain: string;
} {
  // "Display Name <user@example.com>" OR bare "user@example.com"
  const angle = /<([^>]+)>/.exec(value);
  const email = angle ? angle[1] : value.trim();
  const namePart = angle ? value.slice(0, angle.index).trim().replace(/^"|"$/g, "") : null;
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1).toLowerCase() : "";
  return {
    email: email.toLowerCase(),
    name: namePart && namePart.length > 0 ? namePart : null,
    domain,
  };
}
