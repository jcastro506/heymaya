/**
 * Sprint 11 — Hunter action wrappers + safety helper tests.
 */
import { describe, it, expect } from "vitest";
import { isSafeToSend } from "../actions";

describe("isSafeToSend", () => {
  it("accepts valid + deliverable + non-flagged emails", () => {
    expect(
      isSafeToSend({
        email: "x@y.com",
        status: "valid",
        result: "deliverable",
      })
    ).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(
      isSafeToSend({ email: "x@y.com", status: "invalid" })
    ).toBe(false);
  });

  it("rejects accept_all status (catch-all domain)", () => {
    expect(
      isSafeToSend({ email: "x@y.com", status: "accept_all" })
    ).toBe(false);
  });

  it("rejects disposable", () => {
    expect(
      isSafeToSend({ email: "x@y.com", status: "valid", disposable: true })
    ).toBe(false);
  });

  it("rejects webmail (gmail/yahoo personal)", () => {
    expect(
      isSafeToSend({ email: "x@gmail.com", status: "valid", webmail: true })
    ).toBe(false);
  });

  it("rejects gibberish addresses", () => {
    expect(
      isSafeToSend({ email: "asdf@y.com", status: "valid", gibberish: true })
    ).toBe(false);
  });

  it("rejects undeliverable result", () => {
    expect(
      isSafeToSend({ email: "x@y.com", status: "valid", result: "undeliverable" })
    ).toBe(false);
  });

  it("accepts 'risky' result if status is valid (caller decides risk tolerance)", () => {
    expect(
      isSafeToSend({ email: "x@y.com", status: "valid", result: "risky" })
    ).toBe(true);
  });
});
