/**
 * Sprint 11 — Apollo action wrappers + filter helper tests.
 */
import { describe, it, expect } from "vitest";
import { filterPartnershipReady } from "../actions";
import type { ApolloPerson } from "../client";

const samplePeople: ApolloPerson[] = [
  {
    id: "p1",
    title: "Influencer Marketing Manager",
    email: "sarah@patagonia.com",
    email_status: "verified",
  },
  {
    id: "p2",
    title: "VP of Engineering",
    email: "eng@patagonia.com",
    email_status: "verified",
  },
  {
    id: "p3",
    title: "Brand Partnerships Lead",
    email: "bp@patagonia.com",
    email_status: "guessed",
  },
  {
    id: "p4",
    title: "Creator Marketing",
    // No email
  },
  {
    id: "p5",
    title: "Talent Manager",
    email: "talent@patagonia.com",
    email_status: "verified",
  },
];

describe("filterPartnershipReady", () => {
  it("keeps verified emails with partnership-relevant titles", () => {
    const out = filterPartnershipReady(samplePeople);
    const ids = out.map((p) => p.id);
    expect(ids).toContain("p1"); // verified influencer marketing
    expect(ids).toContain("p5"); // verified talent manager
  });

  it("drops people without an email", () => {
    const out = filterPartnershipReady(samplePeople);
    expect(out.find((p) => p.id === "p4")).toBeUndefined();
  });

  it("drops people whose title is unrelated", () => {
    const out = filterPartnershipReady(samplePeople);
    expect(out.find((p) => p.id === "p2")).toBeUndefined();
  });

  it("drops people whose email_status is 'guessed' (bounce risk)", () => {
    const out = filterPartnershipReady(samplePeople);
    expect(out.find((p) => p.id === "p3")).toBeUndefined();
  });

  it("returns empty array on empty input", () => {
    expect(filterPartnershipReady([])).toEqual([]);
  });
});
