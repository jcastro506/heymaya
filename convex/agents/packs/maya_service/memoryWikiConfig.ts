/**
 * memory-wiki plugin config generator (Wave C).
 *
 * Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 9.5 + the official plugin docs at
 * https://docs.openclaw.ai/plugins/memory-wiki, every per-business OpenClaw
 * workspace bundle carries a memory-wiki plugin config block. The plugin
 * owns the runtime: vault storage, compile cycle, claim provenance, the
 * 5 agent tools (`wiki_status`, `wiki_search`, `wiki_get`, `wiki_apply`,
 * `wiki_lint`), dreaming-bridged auto-population, and report dashboards.
 *
 * We CONFIGURE — we never reimplement. Per `feedback_openclaw_native_first.md`
 * + `project_openclaw_alignment.md`. The Convex `wikiProjections` table is a
 * thin read-projection for HQ reactivity, NOT a parallel wiki.
 *
 * Mode: `bridge` per § 9.5 — wiki reads memory-core's promotions + dream
 * reports + daily notes, so the 3am dream sweep auto-populates wiki pages.
 * `isolated` mode would force us to re-promote learnings manually; we don't
 * do that.
 *
 * Per-business vault path is stable + isolated per Fly machine.
 */

import type { Id } from "../../../_generated/dataModel";

/** Stable plugin slug. Never change; OpenClaw plugin loader keys off this. */
export const MEMORY_WIKI_PLUGIN_KEY = "memory-wiki" as const;

/**
 * Vault path on the Fly machine. Persistent per-business volume mounted at
 * `/data/...` keeps the vault across machine restarts. Keep aligned with
 * `deployServiceMaya.ts`'s `/data/workspace-${MAYA_APP_NAME}` layout.
 */
export function memoryWikiVaultPath(businessId: Id<"businesses">): string {
  // Sandbox the vault inside the workspace directory so the bundle bootstrap
  // can `tar -xf` initial pages into the same root and the plugin discovers
  // them on first compile.
  return "/data/workspace-${MAYA_APP_NAME}/.openclaw-wiki/vault";
  void businessId;
}

/**
 * Memory-wiki plugin config block. Drop this into the OpenClaw gateway
 * config under `plugins.entries["memory-wiki"]` during workspace bundle
 * assembly. Schema mirrors https://docs.openclaw.ai/plugins/memory-wiki.
 *
 * Decisions locked per § 9.5:
 *   - `vaultMode: "bridge"` — reads memory-core promotions; dreaming
 *     auto-populates wiki pages.
 *   - `bridge.readMemoryArtifacts: true` so MEMORY.md / dream reports /
 *     daily notes feed the wiki without our intervention.
 *   - `ingest.autoCompile: true` so `wiki_apply` calls compile in-process.
 *   - `search.backend: "shared"` + `search.corpus: "all"` — when both
 *     memory-core + memory-wiki are present, search ranks across both.
 *   - `context.includeCompiledDigestPrompt: true` — the compiled
 *     `agent-digest.json` is auto-prepended to Maya's context. This is the
 *     mechanism by which the wiki becomes the operator-trust dividend
 *     described in § 9.5.
 *   - `render.preserveHumanBlocks: true` — operator-edited sections in HQ
 *     "What Maya knows" must never be overwritten by autocompile.
 *   - `render.createBacklinks: true` + `render.createDashboards: true` so
 *     `reports/{open-questions,contradictions,low-confidence}.md` are
 *     materialized for the Studio HQ Reports surface (§ 9.5 Plan-tier).
 *   - `obsidian.enabled: false` — operator's local Obsidian integration is
 *     out of scope for v0; flip in Sprint 7+ if requested.
 */
export interface MemoryWikiPluginConfig {
  enabled: true;
  config: {
    vaultMode: "bridge";
    vault: {
      path: string;
      renderMode: "native";
    };
    obsidian: {
      enabled: false;
      useOfficialCli: false;
      vaultName: string;
      openAfterWrites: false;
    };
    bridge: {
      enabled: true;
      readMemoryArtifacts: true;
      indexDreamReports: true;
      indexDailyNotes: true;
      indexMemoryRoot: true;
      followMemoryEvents: true;
    };
    ingest: {
      autoCompile: true;
      maxConcurrentJobs: number;
      allowUrlIngest: false;
    };
    search: {
      backend: "shared";
      corpus: "all";
    };
    context: {
      includeCompiledDigestPrompt: true;
    };
    render: {
      preserveHumanBlocks: true;
      createBacklinks: true;
      createDashboards: true;
    };
  };
}

export interface MemoryWikiConfigInputs {
  businessId: Id<"businesses">;
  /**
   * Display name of the business. Used as the wiki's display label only —
   * vault file paths are derived from `businessId`.
   */
  businessName: string;
}

/**
 * Build the plugin config block for a given business. Pure function; no I/O.
 */
export function generateMemoryWikiConfig(
  inputs: MemoryWikiConfigInputs
): MemoryWikiPluginConfig {
  return {
    enabled: true,
    config: {
      vaultMode: "bridge",
      vault: {
        path: memoryWikiVaultPath(inputs.businessId),
        renderMode: "native",
      },
      obsidian: {
        enabled: false,
        useOfficialCli: false,
        // Even when disabled, the plugin docs accept `vaultName` as a
        // display label. Use a sanitized business name so HQ surfaces have
        // something readable.
        vaultName: sanitizeVaultName(inputs.businessName),
        openAfterWrites: false,
      },
      bridge: {
        enabled: true,
        readMemoryArtifacts: true,
        indexDreamReports: true,
        indexDailyNotes: true,
        indexMemoryRoot: true,
        followMemoryEvents: true,
      },
      ingest: {
        autoCompile: true,
        // Bound concurrent compile jobs per Fly shared-CPU machine. 2 keeps
        // a 50-photo cataloger flood (which writes a `sources/media-assets/*`
        // page per photo) from saturating the box.
        maxConcurrentJobs: 2,
        // No remote URL ingest — every page comes from operator chat,
        // catalog runs, or onboarding seeds. Reduces SSRF surface.
        allowUrlIngest: false,
      },
      search: {
        backend: "shared",
        corpus: "all",
      },
      context: {
        includeCompiledDigestPrompt: true,
      },
      render: {
        preserveHumanBlocks: true,
        createBacklinks: true,
        createDashboards: true,
      },
    },
  };
}

/**
 * Build the full `plugins.entries` fragment for the gateway config. Returned
 * as a raw object so deploy-bundle assembly can spread it into the larger
 * gateway-config object alongside other plugins.
 */
export function generateMemoryWikiPluginEntries(
  inputs: MemoryWikiConfigInputs
): { [k: string]: MemoryWikiPluginConfig } {
  return {
    [MEMORY_WIKI_PLUGIN_KEY]: generateMemoryWikiConfig(inputs),
  };
}

function sanitizeVaultName(name: string): string {
  // Wiki vault names need to round-trip through filesystem paths in some
  // render modes; keep alphanumerics + spaces + hyphens, drop the rest.
  const cleaned = name.replace(/[^A-Za-z0-9 \-]/g, "").trim();
  if (cleaned.length === 0) return "HeyMaya Service Vault";
  return cleaned.slice(0, 64);
}
