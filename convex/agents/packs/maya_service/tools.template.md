# TOOLS.md

This file is the SOURCE TEMPLATE consumed by `generateTools.ts`. The generator emits a per-tier rendered TOOLS.md from the static `TOOL_REGISTRY` filtered against `plan` + plan-tier-gated tool sets surfaced as "not available on this tier."

Tool surfaces:
1. Convex HTTP endpoints (`lc_maya_service.*`)
2. Zernio MCP (multi-platform social + GBP)
3. Composio universal runner (Gmail / Calendar)
4. Twilio (SMS + outbound voice)
5. ElevenLabs Agents (inbound voice — Studio only)
6. CRM adapter (Nango-mediated — Pro+ only)
7. Media pipeline (R2 + Gemini Files + FFmpeg)

## What this file is NOT

- Not a tool registry. The skill loader is.
- Not a permissions document. `planFeaturesService(business)` is the source of truth, server-side, fail-closed.
- Not exhaustive. Surface evolves; canonical lives in `convex/http.ts` (endpoints), Zernio MCP manifest, Composio v3 docs, Nango connector specs.
