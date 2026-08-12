/**
 * ⭐ An unreadable vendor response must be an ERROR, not an empty list.
 *
 * ## The failure mode
 *
 * Every one of these parsers already had the right guard:
 *
 * ```ts
 * const parsed = Schema.safeParse(raw);
 * if (!parsed.success) throw new ZernioApiError(...)
 * ```
 *
 * ⚠️ And it was **unreachable**. `accounts: z.array(...).default([])` means an
 * object with no `accounts` key parses *successfully* as `{ accounts: [] }`, so
 * `safeParse` never fails for an object payload. The throw was decoration.
 *
 * Callers read an empty account list as "the founder disconnected everything",
 * and an empty comment list as "nobody said anything". So a vendor contract
 * change would not raise — it would quietly mark every channel gone and make
 * her stop replying.
 *
 * ## Why required, and not just "be careful"
 *
 * ⭐ VERIFIED LIVE 2026-08-12 before changing anything, because the opposite
 * mistake is worse: if the vendor omitted the key when a result set is empty,
 * requiring it would turn a normal quiet inbox into a hard error.
 *
 * It does not. `GET /api/v1/inbox/conversations` with **zero** results still
 * returned `data: []` — the key present, the array empty. Same for
 * `/api/v1/accounts`, `/api/v1/accounts/health` and
 * `/api/v1/accounts/follower-stats`. The vendor always sends the key, so a
 * missing one genuinely means "we no longer understand this response".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(
  path.join(
    __dirname,
    "..",
    "convex",
    "integrations",
    "zernio",
    "endpoints.ts",
  ),
  "utf8",
);

/**
 * Pull one schema's body out of the file by name.
 *
 * ⚠️ Bounded by the next top-level declaration, NOT by the first
 * `.passthrough()`. Several of these schemas nest a `.passthrough()` inside a
 * sub-object (`summary` on the health response), so cutting at the first one
 * silently truncates the body before the field under test — and every
 * assertion then passes or fails for the wrong reason.
 */
function schemaBody(name: string): string {
  const start = source.indexOf(`const ${name} = z`);
  expect(start, `${name} not found — was it renamed?`).toBeGreaterThan(-1);
  const next = source.indexOf("\nconst ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

/**
 * The schemas whose array IS the payload — where "empty" is a claim the
 * product acts on destructively.
 */
const LOAD_BEARING: Array<{ schema: string; field: string; why: string }> = [
  {
    schema: "AccountsListResponseSchema",
    field: "accounts",
    why: "an empty list reads as 'the founder disconnected every channel'",
  },
  {
    schema: "AccountHealthResponseSchema",
    field: "accounts",
    why: "same list, same destructive reading",
  },
  {
    schema: "FollowerStatsResponseSchema",
    field: "accounts",
    why: "empty means 'no follower history', which feeds the ladder and the benchmarks",
  },
  {
    schema: "InboxCommentsResponseSchema",
    field: "data",
    why: "empty means 'nobody commented', so she silently stops replying",
  },
  {
    schema: "ConversationsResponseSchema",
    field: "data",
    why: "same — silence that looks like an empty inbox",
  },
];

describe("vendor responses fail loudly, not emptily", () => {
  for (const { schema, field, why } of LOAD_BEARING) {
    it(`${schema}.${field} is required — ${why}`, () => {
      const body = schemaBody(schema);
      const line = body
        .split("\n")
        .find((l) => l.trim().startsWith(`${field}:`));

      expect(line, `${schema} has no \`${field}\` field`).toBeTruthy();
      /**
       * ⚠️ `.default([])` here makes the `if (!parsed.success)` guard below it
       * unreachable for object payloads — the parse succeeds and reports zero
       * results. Whatever the vendor sent, the product would believe it.
       */
      expect(
        line,
        `${schema}.${field} must NOT carry .default([]) — ${why}. ` +
          `Verified live 2026-08-12: this endpoint always sends the key, ` +
          `returning an empty array rather than omitting it.`,
      ).not.toMatch(/\.default\(/);
    });
  }

  it("still tolerates a genuinely empty result", () => {
    /**
     * The other direction, and the reason this was verified live first. An
     * empty array must remain valid — otherwise a founder with no comments
     * yet gets an error instead of a quiet inbox, and day one is exactly when
     * every one of these lists is empty.
     */
    for (const { schema, field } of LOAD_BEARING) {
      const line = schemaBody(schema)
        .split("\n")
        .find((l) => l.trim().startsWith(`${field}:`));
      expect(line).toMatch(/z\.array\(/);
      // Required, not non-empty. `.min(1)` would break day one.
      expect(line).not.toMatch(/\.min\(/);
    }
  });

  it("leaves counts and metadata alone", () => {
    /**
     * Strictness is narrowed to the fields whose absence causes harm.
     * `summary` on the health response is a set of COUNTS — nothing
     * destructive follows from it being missing, so it keeps its default.
     *
     * Widening this to "everything must be required" broke an unrelated
     * frozen-product test whose mock omitted `summary`, for no safety gain.
     */
    expect(schemaBody("AccountHealthResponseSchema")).toMatch(
      /summary[\s\S]*?\.default\(\{\}\)/,
    );
  });
});

/**
 * ⭐ The behavioural half. Everything above reads the source; this proves the
 * parser actually rejects, which is the claim that matters.
 */
describe("listAccounts rejects a payload it doesn't understand", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  }

  it("⚠️ throws instead of reporting zero accounts", async () => {
    const { ZernioClient } =
      await import("../convex/integrations/zernio/client");
    const { listAccounts } =
      await import("../convex/integrations/zernio/endpoints");

    // A plausible contract change: same status, different envelope.
    stubFetch({ data: { items: [] } });

    await expect(
      listAccounts(new ZernioClient({ apiKey: "k" }), { profileId: "p" }),
    ).rejects.toThrow(/Unexpected accounts payload/i);
  });

  it("still returns an empty list when the vendor genuinely has none", async () => {
    const { ZernioClient } =
      await import("../convex/integrations/zernio/client");
    const { listAccounts } =
      await import("../convex/integrations/zernio/endpoints");

    // Key present, array empty — a real day-one response. Must NOT throw.
    stubFetch({ accounts: [], hasAnalyticsAccess: false });

    await expect(
      listAccounts(new ZernioClient({ apiKey: "k" }), { profileId: "p" }),
    ).resolves.toEqual([]);
  });
});
