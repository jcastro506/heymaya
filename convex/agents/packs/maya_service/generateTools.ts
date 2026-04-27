/**
 * generateTools — per-business TOOLS.md generator for service-product Maya.
 *
 * Mirror of creator-side `generateToolsMd.ts`. TOOLS.md is *guidance* — it
 * does not control tool availability. Tool availability is set by the
 * OpenClaw runtime config + the skill loader picking up `skills/<slug>/`
 * packages from the workspace, with plan-tier gates enforced server-side
 * via `planFeaturesService(business)`.
 *
 * Plan-tier gating logic (until `convex/lib/planFeaturesService.ts` lands
 * in Sprint 1) is encoded inline here as a static map. The map mirrors
 * § 3 (Pricing) + § 7 (Skills inventory plan-tier columns). When the helper
 * lands, swap the inline map for the canonical helper.
 */

import type { ServiceWorkspaceInputs } from "./types";

export interface ToolsInputs {
  business: ServiceWorkspaceInputs["business"];
  plan: ServiceWorkspaceInputs["plan"];
}

interface ToolEntry {
  name: string;
  surface:
    | "convex-http"
    | "zernio"
    | "composio"
    | "twilio"
    | "elevenlabs"
    | "crm"
    | "media"
    | "memory-wiki";
  description: string;
  /** Tiers where the tool is available. */
  tiers: ReadonlyArray<ServiceWorkspaceInputs["plan"]>;
}

const TOOL_REGISTRY: ReadonlyArray<ToolEntry> = [
  // Convex HTTP surface — `lc_maya_service.*` endpoints (parallel to creator's `lc_maya.*`).
  {
    name: "lc_maya_service.read_jobs",
    surface: "convex-http",
    description: "Read `serviceJobs` for a business + date range. Cross-tenant gated server-side.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "lc_maya_service.read_reviews",
    surface: "convex-http",
    description: "Read `reviews` for a business with optional unreplied filter.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "lc_maya_service.write_review_request",
    surface: "convex-http",
    description: "Create or update a `reviewRequests` row. Idempotent on `(jobId, kind)`.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "lc_maya_service.write_gbp_draft",
    surface: "convex-http",
    description: "Persist a GBP post draft to `gbpPosts` with `status='pending_approval'`.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "lc_maya_service.write_review_draft",
    surface: "convex-http",
    description: "Persist a `reviews.draftReply`. Never auto-publishes — operator approval required.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "lc_maya_service.read_media_assets",
    surface: "convex-http",
    description: "Read `mediaAssets` library for repurposing + content rejuvenation.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "lc_maya_service.write_media_catalog",
    surface: "convex-http",
    description: "Write `mediaAssets.catalog` after a `maya-service-asset-cataloger` run.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "lc_maya_service.write_packet",
    surface: "convex-http",
    description: "Persist a `packetGenerations` row + PDF storage URL. Studio-only.",
    tiers: ["studio"],
  },
  {
    name: "lc_maya_service.read_revenue",
    surface: "convex-http",
    description: "Pull CRM jobs.completed + invoices.paid for revenue snapshot. Pro+ only.",
    tiers: ["pro", "studio"],
  },
  {
    name: "lc_maya_service.health_zernio",
    surface: "convex-http",
    description: "Zernio MCP reachability probe. Used in BOOT.md.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "lc_maya_service.health_crm",
    surface: "convex-http",
    description: "CRM adapter reachability probe. Pro+ only.",
    tiers: ["pro", "studio"],
  },
  // Zernio publish + GBP read/write/reply.
  {
    name: "zernio.gbp.local_post.create",
    surface: "zernio",
    description:
      "Create a Google Business Profile local post. Supports scrollable photo carousels (5+ images = one scrollable post).",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "zernio.gbp.review.reply",
    surface: "zernio",
    description:
      "Post a review reply to GBP. **Operator approval required at all tiers — locked.** Maya only calls this after `reviews.replyStatus='approved'`.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "zernio.facebook.post.create",
    surface: "zernio",
    description: "Publish a Facebook post (1-3 image carousel + caption). Pro+ only.",
    tiers: ["pro", "studio"],
  },
  {
    name: "zernio.instagram.post.create",
    surface: "zernio",
    description: "Publish an Instagram post (single or carousel). Pro+ only. Requires polished media.",
    tiers: ["pro", "studio"],
  },
  {
    name: "zernio.tiktok.post.create",
    surface: "zernio",
    description: "Publish a TikTok video. Studio-only. Vertical short-form only.",
    tiers: ["studio"],
  },
  // Composio Gmail / Calendar.
  {
    name: "composio.gmail.messages.send",
    surface: "composio",
    description:
      "Send an email via the operator's Gmail. Subject to citation firewall + brand-voice apply. Pro+ only.",
    tiers: ["pro", "studio"],
  },
  {
    name: "composio.gmail.messages.list",
    surface: "composio",
    description: "Read Gmail inbox for the brand-email triage cycle. Pro+ only.",
    tiers: ["pro", "studio"],
  },
  {
    name: "composio.calendar.events.list",
    surface: "composio",
    description:
      "Read operator's Google Calendar for the daily 1-14 day lookahead + activeHours derivation. Pro+ only.",
    tiers: ["pro", "studio"],
  },
  // Twilio voice + SMS (outbound only via OpenClaw plugin).
  {
    name: "twilio.sms.send",
    surface: "twilio",
    description:
      "Send an outbound SMS to the operator (lead-response alarm, brief push, approval ping). Rate-limit middleware caps at 4 unsolicited/day.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "twilio.voice.outbound",
    surface: "twilio",
    description: "Outbound notification call to the operator (Studio voice tier). Studio-only.",
    tiers: ["studio"],
  },
  {
    name: "elevenlabs.agent.handoff",
    surface: "elevenlabs",
    description:
      "Inbound voice handler — Maya is the custom-LLM endpoint behind ElevenLabs Agents. `thinkingBudget=0` forced for sub-300ms TTFB. Studio-only.",
    tiers: ["studio"],
  },
  // CRM (Pro+ only) — Nango-mediated for v0.
  {
    name: "crm.jobs.read",
    surface: "crm",
    description: "Read normalized CRM jobs (Jobber / HCP / QBO / ServiceTitan) via Nango. Pro+ only.",
    tiers: ["pro", "studio"],
  },
  {
    name: "crm.invoices.read",
    surface: "crm",
    description: "Read normalized CRM invoices for revenue snapshot. Pro+ only.",
    tiers: ["pro", "studio"],
  },
  {
    name: "crm.customers.read",
    surface: "crm",
    description: "Read normalized CRM customers for review-request contact info. Pro+ only.",
    tiers: ["pro", "studio"],
  },
  // Media bridge.
  {
    name: "media.r2.upload",
    surface: "media",
    description:
      "R2 attachment bridge — operator-sent photos/videos via iMessage/WhatsApp/SMS-MMS land here. Maya consumes public URLs only (sidesteps SSRF guards per R3 § 2).",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "media.gemini.files.process",
    surface: "media",
    description: "Gemini Files API for multimodal vision (asset cataloging, photo curation).",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "media.ffmpeg.edit",
    surface: "media",
    description:
      "FFmpeg + Gemini editor pipeline (§ 12.5.7) for IG Reels + TikTok video edits. Studio-only.",
    tiers: ["studio"],
  },
  // Memory-wiki plugin (OpenClaw native, bridge mode) — § 9.5. Plan-agnostic
  // infrastructure: every tier gets the plugin. Read-access in HQ varies by
  // tier, enforced in HQ query layer, not at this tool surface.
  {
    name: "wiki_status",
    surface: "memory-wiki",
    description:
      "Display current vault mode, health status, and Obsidian CLI availability. Plan-agnostic.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "wiki_search",
    surface: "memory-wiki",
    description:
      "Search wiki pages and (when configured for shared corpus) the memory-core corpus. Plan-agnostic.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "wiki_get",
    surface: "memory-wiki",
    description:
      "Read wiki pages by vault path (e.g. `concepts/local-positioning`, `entities/competitors/<slug>`). Falls back to shared memory corpus on miss. Primary read surface for the citation firewall — every Maya draft routes through `wiki_get` to verify provenance.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "wiki_apply",
    surface: "memory-wiki",
    description:
      "Targeted synthesis/metadata mutation on a wiki page without rewriting the whole page. Used by skills that learn new facts (asset cataloger writes per-asset entity pages; review-reply drafter writes per-review source pages; etc.). Compile happens in-process; the Convex `wikiProjections` mirror is updated asynchronously by an HTTP webhook the plugin emits.",
    tiers: ["starter", "pro", "studio"],
  },
  {
    name: "wiki_lint",
    surface: "memory-wiki",
    description:
      "Run structural validation, detect provenance gaps and contradictions. Surfaces results into `reports/{contradictions,low-confidence,claim-health,stale-pages}.md` for the Studio Reports dashboard.",
    tiers: ["starter", "pro", "studio"],
  },
];

export function generateTools(inputs: ToolsInputs): string {
  const { plan } = inputs;
  const enabled = TOOL_REGISTRY.filter((t) => t.tiers.includes(plan));
  const gated = TOOL_REGISTRY.filter((t) => !t.tiers.includes(plan));

  const sections: string[] = [];
  sections.push("# TOOLS.md");
  sections.push("");
  sections.push(
    "Documentation of the surfaces Maya talks to. **This file is guidance only — it does not control tool availability.** Tool availability is set by the OpenClaw runtime config + the skill loader discovering `skills/<slug>/SKILL.md` packages, with plan-tier gates enforced server-side in `planFeaturesService(business)` (fail-closed)."
  );
  sections.push("");

  // Group enabled tools by surface for readability.
  const surfaces: Array<ToolEntry["surface"]> = [
    "convex-http",
    "zernio",
    "composio",
    "twilio",
    "elevenlabs",
    "crm",
    "media",
    "memory-wiki",
  ];
  const SURFACE_TITLES: Record<ToolEntry["surface"], string> = {
    "convex-http": "1. Convex HTTP endpoints (`lc_maya_service.*`)",
    zernio: "2. Zernio MCP (multi-platform social + GBP)",
    composio: "3. Composio universal runner (Gmail / Calendar)",
    twilio: "4. Twilio (SMS + outbound voice)",
    elevenlabs: "5. ElevenLabs Agents (inbound voice)",
    crm: "6. CRM adapter (Nango-mediated)",
    media: "7. Media pipeline (R2 + Gemini Files + FFmpeg)",
    "memory-wiki": "8. Memory-wiki plugin (OpenClaw native, bridge mode)",
  };

  sections.push(`## Tools enabled on ${plan} tier`);
  sections.push("");
  for (const surface of surfaces) {
    const entries = enabled.filter((t) => t.surface === surface);
    if (entries.length === 0) continue;
    sections.push(`### ${SURFACE_TITLES[surface]}`);
    sections.push("");
    sections.push("| Tool | Description |");
    sections.push("|---|---|");
    for (const e of entries) {
      sections.push(`| \`${e.name}\` | ${e.description} |`);
    }
    sections.push("");
  }

  if (gated.length > 0) {
    sections.push("## Tools NOT available on this tier (plan-tier gated)");
    sections.push("");
    sections.push(
      "If I try to call any of these, the gate fails closed and I surface a one-sentence upgrade nudge. I do not pretend to do the call and silently fail."
    );
    sections.push("");
    sections.push("| Tool | Required tier |");
    sections.push("|---|---|");
    for (const e of gated) {
      const minTier = e.tiers.includes("pro") ? "Pro+" : "Studio";
      sections.push(`| \`${e.name}\` | ${minTier} |`);
    }
    sections.push("");
  }

  sections.push("## What this file is NOT");
  sections.push("");
  sections.push(
    "- Not a tool registry. The skill loader is. This file is for human (and Maya's) reading comprehension."
  );
  sections.push(
    "- Not a permissions document. Plan-tier gating is enforced server-side in `planFeaturesService(business)` (fail-closed). Maya cannot self-bypass via tool calls."
  );
  sections.push(
    "- Not exhaustive. Surface evolves; canonical lives in `convex/http.ts` (endpoints), the Zernio MCP manifest, the Composio v3 docs, and the Nango connector specs."
  );
  sections.push("");

  return sections.join("\n");
}
