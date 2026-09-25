/**
 * Cut text to a length without splitting an emoji. `s.slice(0, n)` can leave half of a surrogate
 * pair at the end; Convex's serializer rejects such a string ("unexpected end of hex escape"), and
 * the whole function fails. Found by the living sim (a weekly review crashed) and the first-week sim.
 */
export function clip(s: string, n: number): string {
  const t = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
}
