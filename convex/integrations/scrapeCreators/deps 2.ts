/**
 * ScrapeCreators — wrapper plumbing shared by every platform module.
 *
 * Split out of the former 1,746-line `endpoints.ts` (Sprint 1). The public
 * surface is unchanged — `endpoints.ts` re-exports everything — so every
 * existing import keeps working.
 */

import { getDefaultClient, ScrapeCreatorsClient } from "./client";
import {
  RawScrapeCreatorsResultSchema,
  type RawScrapeCreatorsResult,
} from "./schemas";

export interface EndpointDeps {
  client?: ScrapeCreatorsClient;
}

export function clientOf(deps?: EndpointDeps): ScrapeCreatorsClient {
  return deps?.client ?? getDefaultClient();
}

export function rawResult(
  source: string,
  query: Record<string, unknown>,
  raw: unknown
): RawScrapeCreatorsResult {
  return RawScrapeCreatorsResultSchema.parse({ source, query, raw });
}
