/**
 * serializeWorkspaceBundle — pack a `Map<filename, content>` into a deterministic
 * POSIX `ustar` tarball the Fly machine extracts on first boot.
 *
 * Sprint 3.7 phase C. Phase A's `assembleWorkspaceBundle` returns a Map of
 * file paths -> markdown content. The deploy pipeline needs a single binary
 * blob to upload to Convex storage; the Fly bootstrap script downloads that
 * blob and unpacks it into the OpenClaw workspace dir.
 *
 * Format choice: uncompressed POSIX ustar.
 *   - `tar -xf` is on every Fly base image; no `unzip` install dance.
 *   - No third-party dep (zip-writers and tar-stream all exist on npm; we
 *     don't need them — ustar is ~70 lines of code).
 *   - Deterministic for the same file set (we zero out mtime, uid, gid, etc).
 *   - The bootstrap script can `tar -xf` into the workspace dir directly.
 *   - Compression is optional and adds nondeterminism (gzip headers carry
 *     timestamps); skip it. Workspace bundles are ~50KB total — not worth
 *     the trouble.
 *
 * Determinism:
 *   - Files emitted in sorted-key order.
 *   - All header timestamps fixed at 0 (epoch).
 *   - All uid/gid fixed at 0; uname/gname fixed at "openclaw".
 *   - File mode fixed at 0644 (regular files), 0755 (directories).
 *   - Checksum field is the standard ustar checksum (sum of all header bytes
 *     with the checksum field treated as 8 spaces).
 */

const BLOCK_SIZE = 512;
const NAME_FIELD = 100;
const PREFIX_FIELD = 155;

const TEXT_ENCODER = new TextEncoder();

/**
 * Build a deterministic ustar tarball from a `{ path -> utf-8 content }` map.
 * Returns a `Uint8Array` ready to upload to Convex storage.
 */
export function serializeWorkspaceBundle(files: Map<string, string>): Uint8Array {
  // Sort keys for determinism — same input set always yields same bytes.
  const sortedKeys = [...files.keys()].sort();

  // Pre-encode every payload so we can size the output buffer exactly.
  const encoded: Array<{ path: string; bytes: Uint8Array }> = sortedKeys.map(
    (path) => ({ path, bytes: TEXT_ENCODER.encode(files.get(path) ?? "") })
  );

  let totalSize = 0;
  for (const { bytes } of encoded) {
    totalSize += BLOCK_SIZE; // header
    totalSize += roundUpToBlock(bytes.length);
  }
  totalSize += BLOCK_SIZE * 2; // two zero-blocks for ustar EOF

  const out = new Uint8Array(totalSize);
  let offset = 0;
  for (const { path, bytes } of encoded) {
    writeUstarHeader(out, offset, path, bytes.length);
    offset += BLOCK_SIZE;
    out.set(bytes, offset);
    offset += roundUpToBlock(bytes.length);
  }
  // Final two zero blocks — already zero-initialized, just advance.
  offset += BLOCK_SIZE * 2;

  return out;
}

function roundUpToBlock(n: number): number {
  return Math.ceil(n / BLOCK_SIZE) * BLOCK_SIZE;
}

/**
 * Write a 512-byte ustar header at `out[offset..offset+512]` for `name` with
 * payload size `size`. Mutates `out` in place.
 *
 * Field layout per `man tar` POSIX ustar format:
 *   0..100   name        (null-terminated; remainder split into prefix)
 *   100..108 mode        (octal, null-terminated)
 *   108..116 uid         (octal, null-terminated)
 *   116..124 gid         (octal, null-terminated)
 *   124..136 size        (octal, null-terminated)
 *   136..148 mtime       (octal, null-terminated)
 *   148..156 chksum      (8 ascii chars: octal then NUL then space)
 *   156      typeflag    ('0' for regular file)
 *   157..257 linkname
 *   257..263 magic       "ustar\0"
 *   263..265 version     "00"
 *   265..297 uname       (null-terminated)
 *   297..329 gname
 *   329..337 devmajor
 *   337..345 devminor
 *   345..500 prefix      (path prefix if name > 100 bytes)
 *   500..512 padding (zeros)
 */
function writeUstarHeader(
  out: Uint8Array,
  offset: number,
  path: string,
  size: number
): void {
  // Split path into name + prefix if it overflows the 100-byte name field.
  const { name, prefix } = splitPath(path);

  writeAscii(out, offset + 0, name, NAME_FIELD);
  writeOctal(out, offset + 100, 0o644, 8);
  writeOctal(out, offset + 108, 0, 8);
  writeOctal(out, offset + 116, 0, 8);
  writeOctal(out, offset + 124, size, 12);
  writeOctal(out, offset + 136, 0, 12); // mtime fixed at 0
  // chksum field: temporarily fill with spaces while computing.
  for (let i = 148; i < 156; i++) out[offset + i] = 0x20;
  out[offset + 156] = 0x30; // '0' typeflag = regular file
  writeAscii(out, offset + 157, "", 100);
  writeAscii(out, offset + 257, "ustar\0", 6);
  writeAscii(out, offset + 263, "00", 2);
  writeAscii(out, offset + 265, "openclaw", 32);
  writeAscii(out, offset + 297, "openclaw", 32);
  writeOctal(out, offset + 329, 0, 8);
  writeOctal(out, offset + 337, 0, 8);
  writeAscii(out, offset + 345, prefix, PREFIX_FIELD);

  // Compute checksum: sum of all 512 header bytes (with chksum slot = spaces).
  let checksum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) checksum += out[offset + i];
  // Write checksum: 6 octal digits + NUL + space.
  const chk = checksum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) out[offset + 148 + i] = chk.charCodeAt(i);
  out[offset + 154] = 0x00;
  out[offset + 155] = 0x20;
}

function splitPath(path: string): { name: string; prefix: string } {
  if (TEXT_ENCODER.encode(path).length <= NAME_FIELD) {
    return { name: path, prefix: "" };
  }
  // Find the last '/' such that the prefix fits in 155 bytes and the name
  // fits in 100 bytes. POSIX ustar requires the split on a directory boundary.
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== "/") continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (
      TEXT_ENCODER.encode(prefix).length <= PREFIX_FIELD &&
      TEXT_ENCODER.encode(name).length <= NAME_FIELD
    ) {
      return { name, prefix };
    }
  }
  // Path doesn't have a usable split — let's truncate hard rather than crash.
  // We don't expect this path in v0 (workspace filenames are short).
  throw new Error(
    `serializeWorkspaceBundle: path '${path}' too long for ustar (max 100 bytes name + 155 bytes prefix).`
  );
}

function writeAscii(
  out: Uint8Array,
  offset: number,
  value: string,
  fieldSize: number
): void {
  const bytes = TEXT_ENCODER.encode(value);
  if (bytes.length > fieldSize) {
    throw new Error(
      `serializeWorkspaceBundle: ascii field overflow (${bytes.length} > ${fieldSize})`
    );
  }
  out.set(bytes, offset);
  // Remainder of field is already zero (Uint8Array init).
}

function writeOctal(
  out: Uint8Array,
  offset: number,
  value: number,
  fieldSize: number
): void {
  // Standard ustar: octal digits, right-aligned, padded with leading '0' (0x30),
  // null-terminated (last byte is NUL). Field size includes the NUL.
  const octalDigits = fieldSize - 1;
  const str = value.toString(8).padStart(octalDigits, "0");
  if (str.length > octalDigits) {
    throw new Error(
      `serializeWorkspaceBundle: octal field overflow (value=${value}, max digits=${octalDigits})`
    );
  }
  for (let i = 0; i < octalDigits; i++) {
    out[offset + i] = str.charCodeAt(i);
  }
  out[offset + octalDigits] = 0x00;
}
