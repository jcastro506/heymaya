/**
 * Their name, handled with care (2026-10-02): she greets people by first name, so a wrong one is worse
 * than none. Only a name that looks like a name is kept; a handle, an email, a number or a placeholder
 * is not a name, and we never guess one from a handle.
 */

const JUNK = new Set(["user", "null", "undefined", "none", "unknown", "test", "admin", "guest", "anonymous", "name", "first", "last"]);

/** Pure: one clean name part ("ADINA" → "Adina", "mary-jane" → "Mary-Jane"), or null when it isn't one. */
export function cleanNamePart(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().split(/\s+/)[0] ?? "";
  if (t.length < 1 || t.length > 24) return null;
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(t)) return null; // letters, apostrophes and hyphens only: no digits, dots, @ or _
  if (JUNK.has(t.toLowerCase())) return null;
  const word = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  // Keep a deliberate mix ("DeShawn", "McKenzie"); fix the all-lower and all-upper cases.
  const mixed = t !== t.toLowerCase() && t !== t.toUpperCase();
  return mixed ? t : t.split(/(?<=[-'’])/).map(word).join("");
}

/** Pure: first and last name from a sign-in identity (Clerk's given_name / family_name, else the full name). */
export function namesFromIdentity(identity: { givenName?: string; familyName?: string; name?: string }): { firstName?: string; lastName?: string } {
  const parts = (identity.name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = cleanNamePart(identity.givenName) ?? cleanNamePart(parts[0]);
  const lastName = cleanNamePart(identity.familyName) ?? (parts.length > 1 ? cleanNamePart(parts[parts.length - 1]) : null);
  return { ...(firstName ? { firstName } : {}), ...(lastName && lastName !== firstName ? { lastName } : {}) };
}
