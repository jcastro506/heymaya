/**
 * Connections panel for the Profile screen.
 *
 * Per Service Sprint Plan § 12.6:
 *   - GBP locations (add/remove triggers re-pull + soul.md regen on add)
 *   - CRM (Jobber/HCP/QBO connect/disconnect)
 *   - FB/IG via Composio (Wave C scope keeps this read-only; mutation
 *     handlers ship in Wave C CRM/integration agents)
 *   - Calendar
 *   - Voice (Studio-only)
 *
 * Plan-tier UX: locked features show greyed with "Upgrade to Pro/Studio"
 * inline pitch.
 */

import type { Doc } from "@/convex/_generated/dataModel";
import { Building2, Link2, Mic, Plug } from "lucide-react";

export interface ConnectionsPanelProps {
  gbpLocations: Doc<"gbpLocations">[];
  crmConnections: Doc<"crmConnections">[];
  voiceChannel: Doc<"voiceChannels"> | null;
  zernioConnection: Doc<"zernioConnections"> | null;
  canConnectVoice: boolean;
  canConnectCrm: boolean;
  maxGbpLocations: number;
  testId?: string;
}

export function ConnectionsPanel({
  gbpLocations,
  crmConnections,
  voiceChannel,
  zernioConnection,
  canConnectVoice,
  canConnectCrm,
  maxGbpLocations,
  testId,
}: ConnectionsPanelProps) {
  const activeCrm = crmConnections.find((c) => c.provider !== "none");
  const zernioPlatformCount =
    zernioConnection?.connectedPlatforms.filter((p) => p.status === "active")
      .length ?? 0;

  return (
    <section
      data-testid={testId ?? "biz-connections-panel"}
      className="space-y-3"
    >
      <Row
        icon={<Building2 className="h-4 w-4 text-lime" />}
        title="Google Business Profile"
        body={
          gbpLocations.length === 0
            ? "Not connected. GBP is required for reviews + posts."
            : `${gbpLocations.length} of ${maxGbpLocations} location${
                maxGbpLocations === 1 ? "" : "s"
              } connected`
        }
        statusBadge={
          gbpLocations.length === 0
            ? { label: "Connect", tone: "amber" }
            : { label: "Connected", tone: "lime" }
        }
      />

      <Row
        icon={<Plug className="h-4 w-4 text-lime" />}
        title="CRM"
        body={
          !canConnectCrm
            ? "Upgrade to Pro to connect Jobber, Housecall Pro, or QuickBooks."
            : activeCrm
            ? `${humanProvider(activeCrm.provider)} · last synced ${
                activeCrm.lastSyncAt
                  ? new Date(activeCrm.lastSyncAt).toLocaleDateString()
                  : "—"
              }`
            : "No CRM connected — Maya will use no-CRM mode (text Maya the job)."
        }
        statusBadge={
          !canConnectCrm
            ? { label: "Pro", tone: "muted" }
            : activeCrm
            ? { label: "Connected", tone: "lime" }
            : { label: "Optional", tone: "muted" }
        }
        locked={!canConnectCrm}
      />

      <Row
        icon={<Link2 className="h-4 w-4 text-lime" />}
        title="Social platforms (via Zernio)"
        body={
          zernioPlatformCount === 0
            ? "FB / IG / TikTok / X / LinkedIn — connect through Zernio in onboarding."
            : `${zernioPlatformCount} platform${zernioPlatformCount === 1 ? "" : "s"} active`
        }
        statusBadge={
          zernioPlatformCount === 0
            ? { label: "Optional", tone: "muted" }
            : { label: "Connected", tone: "lime" }
        }
      />

      <Row
        icon={<Mic className="h-4 w-4 text-lime" />}
        title="Voice"
        body={
          !canConnectVoice
            ? "Voice is included on Pro (sampling) and Studio (full)."
            : voiceChannel
            ? `${voiceChannel.twilioPhoneNumber} · ${voiceChannel.monthlyMinutesUsed} min this month`
            : "Provision your Twilio number to let customers call Maya."
        }
        statusBadge={
          !canConnectVoice
            ? { label: "Pro/Studio", tone: "muted" }
            : voiceChannel
            ? { label: "Connected", tone: "lime" }
            : { label: "Set up", tone: "amber" }
        }
        locked={!canConnectVoice}
      />
    </section>
  );
}

function Row({
  icon,
  title,
  body,
  statusBadge,
  locked,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  statusBadge: { label: string; tone: "lime" | "amber" | "muted" };
  locked?: boolean;
}) {
  const toneClass =
    statusBadge.tone === "lime"
      ? "border-lime/40 text-lime"
      : statusBadge.tone === "amber"
      ? "border-amber-300/40 text-amber-200"
      : "border-paper-faint/40 text-paper-faint";
  return (
    <div
      data-testid={`biz-connection-row-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
      data-locked={locked ? "true" : "false"}
      className={`flex items-center justify-between gap-3 rounded-xl border border-[var(--hairline)] bg-ink-3/40 p-4 ${
        locked ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full border border-[var(--hairline)] bg-ink-2">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-paper">{title}</div>
          <p className="mt-0.5 text-xs text-paper-faint">{body}</p>
        </div>
      </div>
      <span
        className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${toneClass}`}
      >
        {statusBadge.label}
      </span>
    </div>
  );
}

function humanProvider(p: Doc<"crmConnections">["provider"]): string {
  switch (p) {
    case "jobber":
      return "Jobber";
    case "hcp":
      return "Housecall Pro";
    case "qbo":
      return "QuickBooks Online";
    case "servicetitan":
      return "ServiceTitan";
    case "none":
      return "None";
  }
}
