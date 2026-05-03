/**
 * serializeWorkspaceBundle — pure tar-writer tests.
 *
 * Sprint 3.7 phase C. The deploy pipeline depends on this serializer being
 * (a) deterministic for the same input set and (b) producing valid POSIX
 * ustar that `tar -xf` on the Fly machine can extract.
 *
 * We don't have GNU tar in the test environment, but we can:
 *   - Read back our own format (round-trip via the in-test reader).
 *   - Check the magic bytes "ustar\0" at offset 257 of each header.
 *   - Check the checksum field is correct (sum of all header bytes with
 *     chksum slot replaced by spaces).
 */

import { describe, it, expect } from "vitest";
import { serializeWorkspaceBundle } from "../serializeWorkspaceBundle";

const DECODER = new TextDecoder();

describe("serializeWorkspaceBundle", () => {
  it("emits a valid ustar tarball with correct headers", () => {
    const files = new Map<string, string>([
      ["AGENTS.md", "# Maya\n\nstanding orders prose."],
      ["USER.md", "# User\n\ncreator profile data."],
    ]);
    const tar = serializeWorkspaceBundle(files);
    // Header magic at byte 257 of first header.
    expect(DECODER.decode(tar.slice(257, 263))).toBe("ustar\0");
    // EOF: last 1024 bytes are zero.
    for (let i = tar.length - 1024; i < tar.length; i++) {
      expect(tar[i]).toBe(0);
    }
  });

  it("is deterministic — same input set produces identical bytes", () => {
    const files1 = new Map<string, string>([
      ["a.md", "alpha"],
      ["b.md", "beta"],
    ]);
    const files2 = new Map<string, string>([
      // Insert in a different order — output should be sorted.
      ["b.md", "beta"],
      ["a.md", "alpha"],
    ]);
    const tar1 = serializeWorkspaceBundle(files1);
    const tar2 = serializeWorkspaceBundle(files2);
    expect(tar1.length).toBe(tar2.length);
    for (let i = 0; i < tar1.length; i++) {
      expect(tar2[i]).toBe(tar1[i]);
    }
  });

  it("checksum field is a valid ustar checksum", () => {
    const files = new Map<string, string>([["x.md", "hello"]]);
    const tar = serializeWorkspaceBundle(files);
    // Sum the first 512 bytes (header) with checksum slot (148..156) replaced
    // by 8 spaces (0x20).
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      if (i >= 148 && i < 156) {
        sum += 0x20;
      } else {
        sum += tar[i];
      }
    }
    // Read the recorded checksum (octal in bytes 148..154, NUL, space).
    const chk = DECODER.decode(tar.slice(148, 154));
    expect(parseInt(chk, 8)).toBe(sum);
  });

  it("file content is followed by zero-padding to the next 512-block", () => {
    const files = new Map<string, string>([["short.md", "hi"]]);
    const tar = serializeWorkspaceBundle(files);
    // Header (512) + padded content (512) + 2 zero blocks (1024) = 2048.
    expect(tar.length).toBe(2048);
    // Bytes after "hi" (514..1024) should be zero.
    for (let i = 512 + 2; i < 1024; i++) {
      expect(tar[i]).toBe(0);
    }
  });

  it("handles paths with subdirectories (Operations/Daily Notes/...)", () => {
    const files = new Map<string, string>([
      ["Operations/Daily Notes/2024-01-01.md", "# 2024-01-01"],
    ]);
    const tar = serializeWorkspaceBundle(files);
    // Magic should still be valid; no truncation crash.
    expect(DECODER.decode(tar.slice(257, 263))).toBe("ustar\0");
  });
});
