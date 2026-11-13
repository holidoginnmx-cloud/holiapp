/**
 * Deja en `data` solo las llaves que de verdad vinieron en el body.
 *
 * `UpdateUserSchema` es `CreateUserSchema.partial()`, y el de alta trae
 * `role.default("OWNER")` e `isActive.default(true)`: zod aplica esos defaults
 * aunque el campo sea opcional, así que un PATCH con solo `{ firstName }`
 * escribía también `role: OWNER, isActive: true` — degradaba a un empleado a
 * cliente al corregirle el nombre, y reactivaba fichas dadas de baja
 * (detectado en revisión, nov-2026). Un PATCH no inventa valores.
 */
export function pickSentKeys<T extends Record<string, unknown>>(
  data: T,
  body: unknown
): Partial<T> {
  const sent = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(data).filter(([k]) => Object.prototype.hasOwnProperty.call(sent, k))
  ) as Partial<T>;
}
