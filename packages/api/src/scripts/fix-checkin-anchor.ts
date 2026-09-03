/**
 * Normaliza el ancla horaria de `checkIn`/`checkOut` de los hospedajes (STAY)
 * a las 00:00 UTC, que es la convención de la API y de la app
 * (packages/db/schema.prisma: "checkIn/checkOut (día a 00:00 UTC)").
 *
 * Contexto: el admin web anclaba esas dos columnas a MEDIODÍA UTC
 * (`timestampDeFecha`). Con la mezcla, la API contaba el día de salida de una
 * reserva capturada en el panel como cuarto ocupado (12:00Z > 00:00Z del día
 * de salida) y el cierre automático corría 12 h desfasado. El panel ya escribe
 * a 00:00Z (`timestampDeDiaEstadia`); esto repara las filas que dejó.
 *
 * Qué hace:
 *   1. Para toda reserva STAY cuyo `checkIn` o `checkOut` no esté exacto a las
 *      00:00:00.000 UTC, lo mueve a las 00:00 UTC del MISMO día UTC. Nunca
 *      cambia la fecha (12:00Z del día 5 → 00:00Z del día 5). No toca
 *      BATH/DAYCARE, `appointmentAt` ni `checkInTime`/`checkOutTime`.
 *   2. Lo inverso para `payments.paidAt`: el mismo panel guardaba la fecha del
 *      cobro capturado a mano como "YYYY-MM-DD" a secas = 00:00:00.000Z exactas
 *      (= 17:00 del día ANTERIOR en Hermosillo). La convención para un cobro
 *      "de un día" es MEDIODÍA UTC, que cae en el mismo día se lea en UTC o en
 *      hora del hotel. Se mueven a las 12:00Z del mismo día UTC. Un cobro real
 *      (Stripe, app) jamás cae en la medianoche exacta al milisegundo, así que
 *      el filtro no alcanza a ninguno; de todos modos se listan uno por uno.
 *
 * Uso (desde packages/api):
 *   npm run fix:checkin-anchor                 # simulación (--dry-run, default)
 *   npm run fix:checkin-anchor -- --apply      # escribe
 *
 *   o directo:
 *   npx tsx --env-file=.env src/scripts/fix-checkin-anchor.ts [--dry-run|--apply]
 *
 * OJO: `.env` de packages/api apunta a LOCAL; para producción hay que pasar el
 * `.env` de packages/db como segundo `--env-file` (el último gana), igual que
 * en fix-mascotas-duplicadas.ts.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Fila = {
  id: string;
  status: string;
  checkIn: Date | null;
  checkOut: Date | null;
};

/** Instante → 00:00 UTC del mismo día UTC. */
function aMedianocheUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function estaAMedianocheUTC(d: Date): boolean {
  return d.getTime() === aMedianocheUTC(d).getTime();
}

async function main() {
  const aplicar = process.argv.includes("--apply");
  if (aplicar && process.argv.includes("--dry-run")) {
    throw new Error("--dry-run y --apply son excluyentes");
  }

  // Las columnas son `timestamp` sin zona (Prisma guarda el instante en UTC):
  // date_trunc opera sobre el valor tal cual, sin depender del timezone de la
  // sesión. Se filtra en SQL para no traer todas las reservas.
  const filas = await prisma.$queryRaw<Fila[]>`
    SELECT id, status, "checkIn", "checkOut"
    FROM reservations
    WHERE "reservationType" = 'STAY'
      AND (
        ("checkIn"  IS NOT NULL AND "checkIn"  <> date_trunc('day', "checkIn"))
        OR
        ("checkOut" IS NOT NULL AND "checkOut" <> date_trunc('day', "checkOut"))
      )
    ORDER BY "checkIn"
  `;

  console.log(`Hospedajes con checkIn/checkOut fuera de las 00:00 UTC: ${filas.length}`);

  const cambios: { id: string; data: { checkIn?: Date; checkOut?: Date } }[] = [];
  for (const r of filas) {
    const data: { checkIn?: Date; checkOut?: Date } = {};
    if (r.checkIn && !estaAMedianocheUTC(r.checkIn)) data.checkIn = aMedianocheUTC(r.checkIn);
    if (r.checkOut && !estaAMedianocheUTC(r.checkOut)) data.checkOut = aMedianocheUTC(r.checkOut);
    if (!data.checkIn && !data.checkOut) continue; // ya normalizada (defensa)
    cambios.push({ id: r.id, data });
    const fmt = (d: Date | null | undefined) => (d ? d.toISOString() : "—");
    console.log(
      `   ${r.id} [${r.status}]` +
        (data.checkIn ? `  checkIn ${fmt(r.checkIn)} → ${fmt(data.checkIn)}` : "") +
        (data.checkOut ? `  checkOut ${fmt(r.checkOut)} → ${fmt(data.checkOut)}` : "")
    );
  }

  // ── 2. Cobros capturados a mano a medianoche UTC → mediodía UTC ──────────
  const pagos = await prisma.$queryRaw<
    { id: string; method: string; amount: unknown; paidAt: Date; stripe: string | null }[]
  >`
    SELECT id, method, amount, "paidAt", "stripePaymentIntentId" AS stripe
    FROM payments
    WHERE "paidAt" IS NOT NULL
      AND "paidAt" = date_trunc('day', "paidAt")
    ORDER BY "paidAt"
  `;
  console.log(`\nCobros con paidAt a las 00:00 UTC exactas: ${pagos.length}`);
  for (const p of pagos) {
    const nuevo = new Date(p.paidAt.getTime() + 12 * 3600 * 1000);
    console.log(
      `   ${p.id} [${p.method}${p.stripe ? " · stripe " + p.stripe : ""}] $${String(p.amount)}` +
        `  paidAt ${p.paidAt.toISOString()} → ${nuevo.toISOString()}`
    );
  }

  if (cambios.length === 0 && pagos.length === 0) {
    console.log("\nNada que normalizar.");
    return;
  }

  if (!aplicar) {
    console.log(
      `\n(simulación — ${cambios.length} reservas y ${pagos.length} cobros; ` +
        `corre otra vez con --apply para escribir)`
    );
    return;
  }

  // Un solo UPDATE por tabla (SQL crudo): no toca `updatedAt` (no es un cambio
  // de negocio, es normalizar el ancla) y no depende del número de filas. Con
  // un update por fila en serie, la transacción interactiva de Prisma (5 s por
  // defecto) abortaba con más de unas decenas de reservas contra Supabase.
  // `depositDeadline` (12:00Z del check-in en anticipos del panel) se deja
  // como está: es inerte desde que se eliminó la auto-cancelación.
  let hechos = 0;
  let cobros = 0;
  await prisma.$transaction(async (tx) => {
    if (cambios.length > 0) {
      hechos = await tx.$executeRaw`
        UPDATE reservations
        SET "checkIn"  = date_trunc('day', "checkIn"),
            "checkOut" = date_trunc('day', "checkOut")
        WHERE "reservationType" = 'STAY'
          AND (
            ("checkIn"  IS NOT NULL AND "checkIn"  <> date_trunc('day', "checkIn"))
            OR
            ("checkOut" IS NOT NULL AND "checkOut" <> date_trunc('day', "checkOut"))
          )
      `;
    }
    if (pagos.length > 0) {
      cobros = await tx.$executeRaw`
        UPDATE payments
        SET "paidAt" = "paidAt" + interval '12 hours'
        WHERE "paidAt" IS NOT NULL
          AND "paidAt" = date_trunc('day', "paidAt")
      `;
    }
  }, { timeout: 120_000 });

  const restantes = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n
    FROM reservations
    WHERE "reservationType" = 'STAY'
      AND (
        ("checkIn"  IS NOT NULL AND "checkIn"  <> date_trunc('day', "checkIn"))
        OR
        ("checkOut" IS NOT NULL AND "checkOut" <> date_trunc('day', "checkOut"))
      )
  `;
  const cobrosRestantes = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM payments
    WHERE "paidAt" IS NOT NULL AND "paidAt" = date_trunc('day', "paidAt")
  `;
  console.log(
    `\nListo. Reservas normalizadas: ${hechos} (pendientes: ${Number(restantes[0]?.n ?? 0)}). ` +
      `Cobros movidos a mediodía: ${cobros} (pendientes: ${Number(cobrosRestantes[0]?.n ?? 0)}).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
