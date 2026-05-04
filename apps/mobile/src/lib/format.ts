/**
 * Capitalize the first letter of each word, lowercasing the rest.
 * Use for display of person/pet names where input may be inconsistent
 * (e.g. "JUAN perez" → "Juan Perez", "fido" → "Fido").
 *
 * Safe for:
 * - undefined / null / empty (returns "")
 * - extra whitespace (collapsed to single space)
 * - hyphens and apostrophes (capitalizes after them too: "ann-marie" → "Ann-Marie")
 */
export function formatName(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) =>
      word
        .split(/([-'])/)
        .map((part) =>
          part.length > 0 && part !== "-" && part !== "'"
            ? part.charAt(0).toUpperCase() + part.slice(1)
            : part,
        )
        .join(""),
    )
    .join(" ");
}

/**
 * Format a full name from firstName + lastName, applying capitalization.
 * Returns empty string if both are missing.
 */
export function formatFullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const parts = [formatName(firstName), formatName(lastName)].filter(Boolean);
  return parts.join(" ");
}

/**
 * Returns YYYY-MM-DD for a date stored as @db.Date in Postgres.
 *
 * Why: Prisma deserializes `@db.Date` as ISO with `T00:00:00.000Z` (UTC midnight).
 * In a local timezone west of UTC (e.g. Hermosillo UTC-7), `new Date(iso).toDateString()`
 * shifts to the previous calendar day. Reading the UTC components preserves the
 * intended day that was stored.
 */
export function utcDayKey(date: string | Date): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Returns YYYY-MM-DD for the user's current local date.
 * Pair with `utcDayKey()` to compare a `@db.Date` value against "today" reliably.
 */
export function localDayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Convert a UTC-midnight ISO (as stored in `@db.Date`) into a local Date that
 * represents the *same calendar day* — useful for seeding date pickers from
 * server values without being shifted to the previous day in west-of-UTC zones.
 */
export function localDateFromUTCDay(iso: string | Date): Date {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Serialize a locally-picked Date as UTC midnight of that calendar day.
 *
 * Why: `Date.toISOString()` includes the local time-of-day, which on the server
 * (after `new Date(iso)`) can land on the previous or next calendar day in any
 * other timezone. Anchoring at UTC midnight guarantees that the day the user
 * tapped is the day the backend stores.
 */
export function toUTCDayISO(d: Date): string {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
  ).toISOString();
}

/**
 * Format a phone number for display as a Mexican mobile: `+52 (662) 429 6727`.
 *
 * Accepts any input — ignores non-digits, strips a leading `52` country code if
 * the user typed it, and progressively formats as the user types so the field
 * stays readable mid-edit.
 */
export function formatPhoneInput(input: string | null | undefined): string {
  if (!input) return "";
  let digits = String(input).replace(/\D/g, "");
  // Strip leading "52" only if user already typed past 10 local digits
  if (digits.length > 10 && digits.startsWith("52")) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 10);
  if (digits.length === 0) return "";
  let out = "+52 (" + digits.slice(0, Math.min(3, digits.length));
  if (digits.length >= 3) out += ")";
  if (digits.length > 3) out += " " + digits.slice(3, Math.min(6, digits.length));
  if (digits.length > 6) out += " " + digits.slice(6, 10);
  return out;
}

/**
 * Strip a phone string down to a `tel:` URI safe value (digits + optional +).
 * Use when handing the phone to `Linking.openURL` so dialers don't choke on
 * spaces or parens.
 */
export function phoneToTelUri(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = String(input).trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return (hasPlus ? "+" : "") + digits;
}
