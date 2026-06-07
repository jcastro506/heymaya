import { describe, expect, it } from "vitest";
import {
  sanitizeOutboundText,
  validateOutboundText,
} from "../outboundFirewall";

describe("sanitizeOutboundText — mechanical AI-tell repair (operator DMs)", () => {
  it("replaces em-dashes with commas and the result PASSES the firewall", () => {
    const dirty = "Hey, Maya here — saw the pitch — plant care for anxious owners.";
    const clean = sanitizeOutboundText(dirty);
    expect(clean).not.toMatch(/[—–]/);
    // The repaired text must now pass the deterministic firewall (no AI-tells).
    expect(validateOutboundText(clean).ok).toBe(true);
  });

  it("repairs spaced-hyphen dashes but keeps numeric ranges", () => {
    expect(sanitizeOutboundText("you share - I post")).toBe("you share, I post");
    expect(sanitizeOutboundText("post 3 - 5 times")).toContain("3 - 5");
  });

  it("turns colon-as-header into a period", () => {
    expect(sanitizeOutboundText("Today: I post for you")).toBe(
      "Today. I post for you"
    );
    expect(validateOutboundText(sanitizeOutboundText("The play: replies")).ok).toBe(true);
  });

  it("leaves URLs and times untouched", () => {
    const t = "see https://greg.app at 9:30 today";
    expect(sanitizeOutboundText(t)).toBe(t);
  });

  it("leaves already-clean text unchanged", () => {
    const clean = "Hey. Maya here. Digging into where your buyers hang out now.";
    expect(sanitizeOutboundText(clean)).toBe(clean);
  });

  it("handles a realistic bounced hello end-to-end", () => {
    const hello =
      "Hey — Maya here. Saw it: a plant-care app for people who keep killing their plants — I'm digging into where those buyers hang out now.";
    const before = validateOutboundText(hello);
    expect(before.ok).toBe(false); // would have bounced
    const repaired = sanitizeOutboundText(hello);
    expect(validateOutboundText(repaired).ok).toBe(true); // now sends
  });
});
