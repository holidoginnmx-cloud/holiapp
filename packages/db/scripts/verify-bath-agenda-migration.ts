/**
 * Comprueba que la migración de la agenda de estética quedó aplicada.
 * Solo LEE: no escribe nada.
 *
 *   cd packages/db && npx tsx --env-file=.env scripts/verify-bath-agenda-migration.ts
 */

import { prisma } from "../src/index";

type ColRow = { table_name: string; column_name: string; data_type: string };

const ESPERADAS: [string, string][] = [
  ["service_variants", "durationMinutes"],
  ["reservations", "durationMinutes"],
  ["reservations", "scheduleOverridden"],
  ["reservations", "scheduleOverrideReason"],
  ["reservation_addons", "scheduledAt"],
  ["reservation_addons", "durationMinutes"],
  ["bath_config", "slotStepMinutes"],
  ["bath_config", "defaultBathDurationMinutes"],
  ["bath_config", "lastStartHour"],
  ["bath_config", "bufferMinutes"],
];

let fallos = 0;
const ok = (t: string) => console.log(`  ✅ ${t}`);
const mal = (t: string) => {
  fallos++;
  console.log(`  ❌ ${t}`);
};

async function main() {
  console.log("\n1. Columnas nuevas");
  const cols = await prisma.$queryRaw<ColRow[]>`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('service_variants','durationMinutes'),
        ('reservations','durationMinutes'),
        ('reservations','scheduleOverridden'),
        ('reservations','scheduleOverrideReason'),
        ('reservation_addons','scheduledAt'),
        ('reservation_addons','durationMinutes'),
        ('bath_config','slotStepMinutes'),
        ('bath_config','defaultBathDurationMinutes'),
        ('bath_config','lastStartHour'),
        ('bath_config','bufferMinutes')
      )`;
  const presentes = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
  for (const [t, c] of ESPERADAS) {
    presentes.has(`${t}.${c}`) ? ok(`${t}.${c}`) : mal(`${t}.${c} — FALTA`);
  }

  console.log("\n2. Índice de la agenda");
  const idx = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'reservation_addons_scheduledAt_idx'`;
  idx.length > 0
    ? ok("reservation_addons_scheduledAt_idx")
    : mal("reservation_addons_scheduledAt_idx — FALTA");

  console.log("\n3. Configuración de la agenda (bath_config)");
  const cfg = await prisma.bathConfig.findUnique({ where: { id: "singleton" } });
  if (!cfg) {
    mal("no existe la fila singleton");
  } else {
    ok(
      `abre ${cfg.openHour}:00 · sale la estilista ${cfg.closeHour}:00 · ` +
        `horarios cada ${cfg.slotStepMinutes} min · buffer ${cfg.bufferMinutes} min · ` +
        `${cfg.maxConcurrentBaths} a la vez · ${cfg.isActive ? "activa" : "INACTIVA"}`,
    );
    // Hasta qué hora se puede agendar cada duración: la regla del negocio.
    for (const dur of [60, 90, 120]) {
      const ultimo = cfg.closeHour * 60 - dur - cfg.bufferMinutes;
      const tope = cfg.lastStartHour != null ? cfg.lastStartHour * 60 : Infinity;
      const ef = Math.min(ultimo, tope);
      const txt =
        ef >= cfg.openHour * 60
          ? `${String(Math.floor(ef / 60)).padStart(2, "0")}:${String(ef % 60).padStart(2, "0")}`
          : "no cabe";
      console.log(`      servicio de ${dur} min → última cita ${txt}`);
    }
  }

  console.log("\n4. Duraciones sembradas (variantes de BAÑO)");
  const variantes = await prisma.serviceVariant.findMany({
    where: { serviceType: { code: "BATH" }, isActive: true },
    select: { petSize: true, corte: true, deslanado: true, durationMinutes: true },
  });
  if (variantes.length === 0) {
    mal("no hay variantes de BATH");
  } else {
    const sinDuracion = variantes.filter((v) => v.durationMinutes == null);
    sinDuracion.length === 0
      ? ok(`las ${variantes.length} variantes tienen duración`)
      : mal(`${sinDuracion.length} de ${variantes.length} variantes SIN duración`);

    const etiqueta = (v: (typeof variantes)[number]) =>
      v.corte && v.deslanado ? "ambos" : v.corte ? "corte" : v.deslanado ? "deslanado" : "baño";
    const orden = ["baño", "corte", "deslanado", "ambos"];
    for (const size of ["S", "M", "L", "XL"]) {
      const fila = orden
        .map((k) => {
          const v = variantes.find((x) => x.petSize === size && etiqueta(x) === k);
          return `${k} ${v?.durationMinutes ?? "—"}`;
        })
        .join(" · ");
      console.log(`      ${size.padEnd(2)} → ${fila}`);
    }
  }

  console.log("\n5. Citas de estética existentes");
  const [total, conHora, futurasSinHora] = await Promise.all([
    prisma.reservation.count({
      where: { reservationType: "BATH", status: { not: "CANCELLED" } },
    }),
    prisma.reservation.count({
      where: {
        reservationType: "BATH",
        status: { not: "CANCELLED" },
        durationMinutes: { not: null },
      },
    }),
    prisma.reservation.count({
      where: {
        reservationType: "BATH",
        status: { not: "CANCELLED" },
        checkInTime: null,
        appointmentAt: { gte: new Date() },
      },
    }),
  ]);
  console.log(`      ${total} citas no canceladas · ${conHora} con duración registrada`);
  if (futurasSinHora > 0) {
    console.log(
      `  ⚠️  ${futurasSinHora} cita(s) FUTURA(s) sin hora asignada.\n` +
        `      Aparecen en /reservaciones/agenda bajo "Sin hora asignada";\n` +
        `      no ocupan lugar hasta que se les ponga horario.`,
    );
  } else {
    ok("ninguna cita futura quedó sin hora");
  }

  console.log(`\n${fallos === 0 ? "✅" : "❌"} ${fallos} problema(s).\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
