/**
 * Cut text to a length without splitting an emoji. `s.slice(0, n)` can leave half of a surrogate
 * pair at the end; Convex's serializer rejects such a string ("unexpected end of hex escape"), and
 * the whole function fails. Found by the living sim (a weekly review crashed) and the first-week sim.
 */
export function clip(s: string, n: number): string {
  const t = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
}

/**
 * Cut a phrase for a person to read: at a word boundary, trailing punctuation dropped, "…" when cut.
 * For titles and hooks shown inside a sentence ("how'd the … shoot go?"): a mid-word cut there read as
 * "turns into a half marath" (product sim, 2026-09-25). Never splits an emoji (uses clip).
 */
export function clipWords(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  const cut = clip(t, n);
  const space = cut.lastIndexOf(" ");
  const head = (space > n * 0.5 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?\-–—'"(]+$/u, "");
  return `${head}…`;
}

/** A phrase quoted mid-sentence: no trailing sentence punctuation, so "…car." never becomes "car.." or "car.,". */
export function bare(s: string): string {
  return s.trim().replace(/[.,;:!]+$/u, "");
}
