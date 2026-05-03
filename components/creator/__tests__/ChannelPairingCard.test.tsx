/**
 * ChannelPairingCard — render-only smoke test.
 *
 * Mirrors `Sparkline.test.ts` structurally: server-side render via
 * react-dom/server, no jsdom. We mock `convex/react` so `useQuery` /
 * `useAction` return synchronous fixtures — the card is plan-tier-driven by
 * `me.plan`, so we render once per plan and assert which Pair buttons are
 * enabled.
 *
 * Server-side enforcement of plan-tier gating is covered in
 * `convex/integrations/openclaw/__tests__/channels.test.ts`. This file
 * only proves the UI surface mirrors that gate (UX hint).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Mock convex/react BEFORE the component import so the symbols are swapped
// in module load order.
vi.mock("convex/react", () => {
  return {
    useQuery: vi.fn(),
    useAction: vi.fn(() => async () => ({})),
  };
});

import { useQuery } from "convex/react";
import {
  ChannelPairingCard,
  type ChannelPairingCardProps,
} from "../ChannelPairingCard";

type Plan = "starter" | "pro" | "studio";

interface MeFixture {
  _id: string;
  plan: Plan;
  channelPreference: "imessage" | "whatsapp" | "sms" | "web";
  phoneNumber?: string;
}

interface PairedRow {
  channel: "imessage" | "whatsapp" | "sms";
  status: "pending" | "active" | "revoked" | "expired";
  phoneNumber: string;
  externalPairingId: string;
  externalIdentifier?: string;
  requestedAt: number;
  pairedAt?: number;
  expiresAt?: number;
  allowedByPlan: boolean;
}

function setUseQueryFixture(me: MeFixture | null, paired: PairedRow[]) {
  // Each useQuery call goes in source order: first me, then listPairedChannels.
  let call = 0;
  (useQuery as unknown as { mockImplementation: (fn: () => unknown) => void })
    .mockImplementation(() => {
      const idx = call++;
      if (idx === 0) return me;
      return paired;
    });
}

function renderCard(
  me: MeFixture | null,
  paired: PairedRow[] = [],
  variant?: "default" | "compact"
): string {
  setUseQueryFixture(me, paired);
  // The component's prop is fully optional (`{ variant?: ... }`), so React's
  // `createElement` overload resolution prefers the no-props variant whose
  // `Attributes` shape excludes our prop type. Cast the props bag through
  // `unknown` to a `Record<string, unknown>` to force the generic overload.
  const props: ChannelPairingCardProps = variant ? { variant } : {};
  return renderToStaticMarkup(
    createElement(ChannelPairingCard, props as unknown as Record<string, unknown>)
  );
}

describe("ChannelPairingCard", () => {
  it("renders a loading shell when `me` is undefined", () => {
    setUseQueryFixture(
      null /* useQuery returns undefined when query is in-flight */,
      []
    );
    // Specifically force undefined for this case
    let call = 0;
    (useQuery as unknown as { mockImplementation: (fn: () => unknown) => void })
      .mockImplementation(() => {
        const idx = call++;
        if (idx === 0) return undefined;
        return undefined;
      });
    const html = renderToStaticMarkup(createElement(ChannelPairingCard));
    expect(html).toContain("channel-pairing-loading");
  });

  /**
   * Helper: extract the full <button ...> opening tag for a given channel.
   * React's renderToStaticMarkup orders attributes alphabetically (or by
   * declaration order — varies by minor version), so we scan back to the
   * preceding `<button` and forward to the closing `>` rather than relying
   * on attribute order.
   */
  function buttonTagFor(html: string, channel: string): string | null {
    const idx = html.indexOf(
      `data-testid="channel-pairing-pair-btn-${channel}"`
    );
    if (idx < 0) return null;
    const start = html.lastIndexOf("<button", idx);
    const end = html.indexOf(">", idx);
    if (start < 0 || end < 0) return null;
    return html.slice(start, end + 1);
  }

  it("PLAN-TIER (Starter, REVISED): all three pair buttons are enabled — channels ungated", () => {
    const html = renderCard(
      {
        _id: "c_starter",
        plan: "starter",
        channelPreference: "web",
      },
      []
    );
    expect(html).toContain("channel-pairing-card");
    for (const channel of ["imessage", "whatsapp", "sms"] as const) {
      const tag = buttonTagFor(html, channel);
      expect(tag, `expected pair btn for ${channel}`).not.toBeNull();
      expect(tag!).not.toContain("disabled=");
    }
  });

  it("PLAN-TIER (Pro): all three pair buttons are enabled", () => {
    const html = renderCard(
      {
        _id: "c_pro",
        plan: "pro",
        channelPreference: "web",
      },
      []
    );
    for (const channel of ["imessage", "whatsapp", "sms"] as const) {
      const tag = buttonTagFor(html, channel);
      expect(tag, `expected pair btn for ${channel}`).not.toBeNull();
      expect(tag!).not.toContain("disabled=");
    }
  });

  it("PLAN-TIER (Studio): all three pair buttons are enabled", () => {
    const html = renderCard(
      {
        _id: "c_studio",
        plan: "studio",
        channelPreference: "web",
      },
      []
    );
    for (const channel of ["imessage", "whatsapp", "sms"] as const) {
      const tag = buttonTagFor(html, channel);
      expect(tag, `expected pair btn for ${channel}`).not.toBeNull();
      expect(tag!).not.toContain("disabled=");
    }
  });

  it("renders existing pairings with status + unpair button on active rows", () => {
    const html = renderCard(
      { _id: "c_pro", plan: "pro", channelPreference: "imessage" },
      [
        {
          channel: "imessage",
          status: "active",
          phoneNumber: "+14155551234",
          externalPairingId: "pair_imessage_active",
          externalIdentifier: "ext_thread_1",
          requestedAt: 1,
          pairedAt: 2,
          allowedByPlan: true,
        },
        {
          channel: "sms",
          status: "revoked",
          phoneNumber: "+14155556666",
          externalPairingId: "pair_sms_revoked",
          requestedAt: 0,
          allowedByPlan: true,
        },
      ]
    );
    // Active row gets an Unpair button
    expect(html).toContain("channel-pairing-unpair-btn-imessage");
    // Revoked row does NOT get an Unpair button
    expect(html).not.toContain("channel-pairing-unpair-btn-sms");
    // Both rows present
    expect(html).toContain("channel-pairing-row-imessage-active");
    expect(html).toContain("channel-pairing-row-sms-revoked");
    // Phone numbers visible
    expect(html).toContain("+14155551234");
    expect(html).toContain("+14155556666");
  });

  it("compact variant renders only active pairing pills (no buttons)", () => {
    const html = renderCard(
      { _id: "c_pro", plan: "pro", channelPreference: "imessage" },
      [
        {
          channel: "imessage",
          status: "active",
          phoneNumber: "+14155551234",
          externalPairingId: "pair_imessage_active",
          externalIdentifier: "ext_thread_1",
          requestedAt: 1,
          pairedAt: 2,
          allowedByPlan: true,
        },
        {
          channel: "sms",
          status: "pending",
          phoneNumber: "+14155556666",
          externalPairingId: "pair_sms_pending",
          requestedAt: 0,
          allowedByPlan: true,
        },
      ],
      "compact"
    );
    expect(html).toContain("channel-pairing-compact");
    // No pair / unpair / phone input
    expect(html).not.toContain("channel-pairing-phone-input");
    expect(html).not.toContain("channel-pairing-pair-btn-imessage");
    expect(html).not.toContain("channel-pairing-unpair-btn-imessage");
    // Active iMessage pill present, pending SMS not (compact only shows active)
    expect(html).toContain("iMessage paired");
    expect(html).not.toContain("SMS paired");
  });
});
