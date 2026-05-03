/**
 * Unipile API client — covers the LinkedIn surface Composio doesn't.
 *
 * Per `docs/RILEY_GROWTH_PLAN.md` § "Why hybrid", LinkedIn partner-gates
 * DMs / profile-search / connection-requests / post-watch / commenter-text
 * read. Unipile's authenticated-session backend exposes those as a clean
 * REST API. This client wraps that surface so Riley (the growth agent) can
 * call out from her workspace skills.
 *
 * SAFETY: every action that writes to LinkedIn (DM send, comment, connection
 * request) MUST be operator-approved before this client is invoked. Riley
 * drafts → Josh approves via text → action runs. Never autonomous in v0.
 *
 * Auth: `UNIPILE_API_KEY` (account-scoped key from Unipile dashboard) +
 * `UNIPILE_DSN` (per-tenant DSN — Unipile's regional URL like
 * `api3.unipile.com:13335`). Account-id (LinkedIn account session id) is
 * passed per-call since one Unipile workspace can host multiple accounts.
 *
 * Rate limits: Unipile imposes per-account-id rate limits aligned with
 * LinkedIn's normal-user envelope. We add our own caps:
 *   - DM send: <20/day, randomize timing
 *   - Profile search: <100 distinct queries/day
 *   - Connection request: NOT in v0 (deferred until LinkedIn-flagging
 *     experience justifies it)
 *
 * STATUS: SCAFFOLDING — typed surface + zod validators only. No live
 * `fetch` calls yet. Wave B (per `docs/RILEY_GROWTH_PLAN.md` § "Build
 * order") fills these in with real HTTP + retries + structured error
 * mapping. The interface is locked here so the pack-level skills can
 * import + use it without waiting on the implementation.
 */

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Client config                                                               */
/* -------------------------------------------------------------------------- */

export interface UnipileClientOptions {
  /** Unipile account API key (X-API-KEY header). */
  apiKey?: string;
  /** Unipile regional DSN, e.g. `api3.unipile.com:13335`. */
  dsn?: string;
  /** Default LinkedIn account-id (Unipile session id) for this client. */
  defaultAccountId?: string;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class UnipileError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly body: string | null,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "UnipileError";
  }
}

/* -------------------------------------------------------------------------- */
/* Action shapes — typed but not yet implemented                               */
/* -------------------------------------------------------------------------- */

// --- Profile search (covers Josh's #3: build outreach lists) ---------------

export const ProfileSearchParamsSchema = z.object({
  /** LinkedIn search keywords. */
  keywords: z.string().optional(),
  /** Title filter, e.g. "VP of Marketing". */
  title: z.string().optional(),
  /** Company name(s) filter. */
  companies: z.array(z.string()).optional(),
  /** Industry codes (LinkedIn taxonomy). */
  industries: z.array(z.string()).optional(),
  /** Location (city / region / country). */
  location: z.string().optional(),
  /** Page size, max 50 per Unipile. */
  limit: z.number().int().positive().max(50).default(25),
  /** Pagination cursor returned by previous call. */
  cursor: z.string().optional(),
});
export type ProfileSearchParams = z.infer<typeof ProfileSearchParamsSchema>;

export const ProfileSearchResponseSchema = z.object({
  results: z.array(
    z
      .object({
        publicIdentifier: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        headline: z.string().optional(),
        profileUrl: z.string().url(),
        location: z.string().optional(),
        currentCompany: z.string().optional(),
      })
      .passthrough()
  ),
  cursor: z.string().optional(),
});
export type ProfileSearchResponse = z.infer<typeof ProfileSearchResponseSchema>;

// --- DM send (covers Josh's #2: outreach DMs after operator approval) -------

export const SendMessageParamsSchema = z.object({
  /** Recipient public identifier (LinkedIn username slug) OR profile URL. */
  recipient: z.string().min(1),
  /** Message body. */
  text: z.string().min(1).max(8000),
  /** Optional attachment URL (image/file). */
  attachmentUrl: z.string().url().optional(),
});
export type SendMessageParams = z.infer<typeof SendMessageParamsSchema>;

export const SendMessageResponseSchema = z
  .object({
    messageId: z.string(),
    chatId: z.string(),
    sentAt: z.number(),
  })
  .passthrough();
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

// --- DM inbox (covers Josh's nice-to-have: read inbox + draft responses) ---

export const ListChatsParamsSchema = z.object({
  /** Page size, max 50. */
  limit: z.number().int().positive().max(50).default(25),
  /** Pagination cursor. */
  cursor: z.string().optional(),
  /** Only chats with unread messages. */
  unreadOnly: z.boolean().default(false),
});
export type ListChatsParams = z.infer<typeof ListChatsParamsSchema>;

export const ListChatsResponseSchema = z.object({
  chats: z.array(
    z
      .object({
        chatId: z.string(),
        lastMessageAt: z.number(),
        unreadCount: z.number(),
        participantPublicId: z.string(),
        participantName: z.string(),
        lastMessagePreview: z.string().optional(),
      })
      .passthrough()
  ),
  cursor: z.string().optional(),
});
export type ListChatsResponse = z.infer<typeof ListChatsResponseSchema>;

// --- Read commenter text on Josh's posts (covers #4) ------------------------

export const ListPostCommentsParamsSchema = z.object({
  /** LinkedIn post URN. */
  postUrn: z.string().startsWith("urn:li:"),
  limit: z.number().int().positive().max(50).default(25),
  cursor: z.string().optional(),
});
export type ListPostCommentsParams = z.infer<
  typeof ListPostCommentsParamsSchema
>;

export const ListPostCommentsResponseSchema = z.object({
  comments: z.array(
    z
      .object({
        commentId: z.string(),
        commenterPublicId: z.string(),
        commenterName: z.string(),
        text: z.string(),
        createdAt: z.number(),
      })
      .passthrough()
  ),
  cursor: z.string().optional(),
});
export type ListPostCommentsResponse = z.infer<
  typeof ListPostCommentsResponseSchema
>;

// --- Watch a target person's posts (covers #6) ------------------------------

export const ListUserPostsParamsSchema = z.object({
  /** Target's public identifier (LinkedIn username slug). */
  publicIdentifier: z.string().min(1),
  /** Only posts after this unix-ms. */
  sinceMs: z.number().optional(),
  limit: z.number().int().positive().max(50).default(10),
});
export type ListUserPostsParams = z.infer<typeof ListUserPostsParamsSchema>;

export const ListUserPostsResponseSchema = z.object({
  posts: z.array(
    z
      .object({
        postUrn: z.string(),
        text: z.string(),
        createdAt: z.number(),
        reactionCount: z.number().optional(),
        commentCount: z.number().optional(),
        url: z.string().url().optional(),
      })
      .passthrough()
  ),
});
export type ListUserPostsResponse = z.infer<typeof ListUserPostsResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

const NOT_IMPLEMENTED_NOTE =
  "Wave B will replace this stub with a live fetch + zod-validated response. See docs/RILEY_GROWTH_PLAN.md.";

export class UnipileClient {
  private readonly apiKey: string;
  private readonly dsn: string;
  private readonly defaultAccountId: string | undefined;
  /** Reserved for Wave B HTTP wiring (`fetch(this.endpoint(...), ...)`). */
  protected readonly fetchImpl: typeof fetch;

  constructor(opts: UnipileClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.UNIPILE_API_KEY;
    const dsn = opts.dsn ?? process.env.UNIPILE_DSN;
    if (!apiKey) {
      throw new Error(
        "UnipileClient: UNIPILE_API_KEY not set. Provide opts.apiKey or set the env var."
      );
    }
    if (!dsn) {
      throw new Error(
        "UnipileClient: UNIPILE_DSN not set. Provide opts.dsn or set the env var."
      );
    }
    this.apiKey = apiKey;
    this.dsn = dsn;
    this.defaultAccountId =
      opts.defaultAccountId ?? process.env.UNIPILE_LINKEDIN_ACCOUNT_ID;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Build the Unipile API URL for a path. */
  endpoint(path: string): string {
    return `https://${this.dsn}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  }

  /** Stub — Wave B replaces with real HTTP. */
  async profileSearch(
    _params: ProfileSearchParams,
    _accountId: string = this.requireAccountId()
  ): Promise<ProfileSearchResponse> {
    throw new UnipileError(
      `profileSearch not implemented. ${NOT_IMPLEMENTED_NOTE}`,
      null,
      null,
      false
    );
  }

  async sendMessage(
    _params: SendMessageParams,
    _accountId: string = this.requireAccountId()
  ): Promise<SendMessageResponse> {
    throw new UnipileError(
      `sendMessage not implemented. ${NOT_IMPLEMENTED_NOTE}`,
      null,
      null,
      false
    );
  }

  async listChats(
    _params: ListChatsParams,
    _accountId: string = this.requireAccountId()
  ): Promise<ListChatsResponse> {
    throw new UnipileError(
      `listChats not implemented. ${NOT_IMPLEMENTED_NOTE}`,
      null,
      null,
      false
    );
  }

  async listPostComments(
    _params: ListPostCommentsParams,
    _accountId: string = this.requireAccountId()
  ): Promise<ListPostCommentsResponse> {
    throw new UnipileError(
      `listPostComments not implemented. ${NOT_IMPLEMENTED_NOTE}`,
      null,
      null,
      false
    );
  }

  async listUserPosts(
    _params: ListUserPostsParams,
    _accountId: string = this.requireAccountId()
  ): Promise<ListUserPostsResponse> {
    throw new UnipileError(
      `listUserPosts not implemented. ${NOT_IMPLEMENTED_NOTE}`,
      null,
      null,
      false
    );
  }

  /** Throw helpful error if no accountId resolved (per-call or default). */
  private requireAccountId(): string {
    if (!this.defaultAccountId) {
      throw new UnipileError(
        "UnipileClient: no LinkedIn account-id supplied. Set UNIPILE_LINKEDIN_ACCOUNT_ID env var or pass per-call.",
        null,
        null,
        false
      );
    }
    return this.defaultAccountId;
  }

  /** Surface the configured DSN for logs / diagnostics. */
  getDsn(): string {
    return this.dsn;
  }

  /** Surface the configured api-key fingerprint (first 8 chars only). */
  getApiKeyFingerprint(): string {
    return this.apiKey.slice(0, 8);
  }
}
