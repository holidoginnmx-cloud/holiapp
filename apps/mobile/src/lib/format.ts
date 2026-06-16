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
  // Drop our own "+52" prefix first; otherwise its "52" digits get folded back
  // into the parsed local number on every keystroke and the field locks onto
  // "+52 (525) ...".
  const raw = String(input).replace(/^\s*\+52/, "");
  let digits = raw.replace(/\D/g, "");
  // Handle paste of an E.164-style "52XXXXXXXXXX" without the "+".
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

/**
 * True when `email` is an internal placeholder rather than a real address.
 *
 * Owners imported from the legacy admin (`legacy+<id>@holidoginn.local`) or
 * created as walk-ins from the web (`walkin+<uuid>@holidoginn.local`) get a
 * synthetic address when no real email is known. These are never routable and
 * must not be shown to users. Real addresses use `@holidoginn.com`; deleted
 * users use `@holidoginn.deleted` — neither matches.
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith("@holidoginn.local");
}

/**
 * Email to display, or "" when it is an internal placeholder (legacy/walk-in
 * synthetic address) or missing. An empty result means the owner has no real
 * email — render `NO_EMAIL_LABEL` in its place.
 */
export function displayEmail(email: string | null | undefined): string {
  if (!email) return "";
  return isPlaceholderEmail(email) ? "" : email.trim();
}

/** User-facing fallback shown when an owner has no real email on file. */
export const NO_EMAIL_LABEL = "Sin correo registrado";

/**
 * Returns a human-friendly section label for a date relative to "now":
 * "Hoy", "Ayer", weekday name (within last 7 days), or full date.
 * Uses local timezone — pair with grouping logic that buckets by local day.
 */
export function dayGroupLabel(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const dayKey = (x: Date) =>
    `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);

  if (dayKey(d) === dayKey(now)) return "Hoy";
  if (dayKey(d) === dayKey(yest)) return "Ayer";

  const diffDays = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (diffDays < 7) {
    const label = d.toLocaleDateString("es-MX", { weekday: "long" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

// =============================================================
//  Formato de moneda, fecha y hora — fuente única (es-MX)
//
//  Antes había ~170 llamadas dispersas a `toLocaleString`/`toLocaleDateString`
//  con opciones ligeramente distintas. Estas funciones centralizan los patrones
//  reales para mantener consistencia y facilitar i18n futura.
//
//  Timezone:
//  - Las fechas se formatean en la zona horaria del dispositivo por defecto,
//    igual que hacía el código original. Pasa `{ timeZone: "UTC" }` para valores
//    `@db.Date` (DailyChecklist.date, Expense.date) que llegan como medianoche
//    UTC y deben leerse en UTC para no mostrar el día anterior (UTC-7 en Hmo).
//  - Las horas se formatean SIEMPRE en `America/Hermosillo` (zona del negocio),
//    que es lo correcto sin importar el dispositivo. Pasa `{ hour12: false }`
//    para el formato de 24 h.
// =============================================================

const MX_LOCALE = "es-MX";
const HMO_TZ = "America/Hermosillo";

type DateFmtOpts = { timeZone?: string };

/**
 * Formato de moneda MXN para mostrar: `$1,234`. Sin decimales (los importes son
 * enteros en la app). Coacciona strings/Decimal a número y devuelve `$0` ante
 * valores no numéricos en vez de `$NaN`. El símbolo `$` va incluido.
 */
export function formatCurrency(
  amount: number | string | null | undefined,
): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "$0";
  return `$${n.toLocaleString(MX_LOCALE)}`;
}

/**
 * Igual que `formatCurrency` pero SIN el símbolo `$` — para sitios donde el `$`
 * lo aporta el layout/etiqueta circundante. Devuelve `0` ante valores inválidos.
 */
export function formatNumber(
  amount: number | string | null | undefined,
): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(MX_LOCALE);
}

/** `16 jun` */
export function formatDayShort(
  date: string | Date,
  opts?: DateFmtOpts,
): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    day: "numeric",
    month: "short",
    ...opts,
  });
}

/** `16 jun 2026` */
export function formatDayShortYear(
  date: string | Date,
  opts?: DateFmtOpts,
): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...opts,
  });
}

/** `16 de junio` */
export function formatDayLong(date: string | Date, opts?: DateFmtOpts): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    day: "numeric",
    month: "long",
    ...opts,
  });
}

/** `16 de junio de 2026` */
export function formatDayLongYear(
  date: string | Date,
  opts?: DateFmtOpts,
): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...opts,
  });
}

/** `martes, 16 de junio` */
export function formatDateLong(date: string | Date, opts?: DateFmtOpts): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...opts,
  });
}

/** `junio de 2026` */
export function formatMonthYear(
  date: string | Date,
  opts?: DateFmtOpts,
): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    month: "long",
    year: "numeric",
    ...opts,
  });
}

/** `mar` */
export function formatWeekdayShort(
  date: string | Date,
  opts?: DateFmtOpts,
): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    weekday: "short",
    ...opts,
  });
}

/** `martes` */
export function formatWeekdayLong(
  date: string | Date,
  opts?: DateFmtOpts,
): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    weekday: "long",
    ...opts,
  });
}

/** `mar 16 de jun` (día corto con día de semana) */
export function formatWeekdayDayShort(
  date: string | Date,
  opts?: DateFmtOpts,
): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...opts,
  });
}

/** `16 jun, 01:30 p.m.` (fecha corta + hora) */
export function formatDateTimeShort(
  date: string | Date,
  opts?: DateFmtOpts,
): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  });
}

/** `16 jun 2026, 01:30 p.m.` (fecha corta con año + hora) */
export function formatDateTimeShortYear(
  date: string | Date,
  opts?: DateFmtOpts,
): string {
  return new Date(date).toLocaleDateString(MX_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  });
}

/**
 * Hora `01:30 p.m.` (o `13:30` con `hour12: false`), en zona del negocio
 * (`America/Hermosillo`). Pasa `timeZone` para anular la zona.
 */
export function formatTime(
  date: string | Date,
  opts?: { hour12?: boolean; timeZone?: string },
): string {
  return new Date(date).toLocaleTimeString(MX_LOCALE, {
    timeZone: HMO_TZ,
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  });
}
