/**
 * import-legacy.ts — Importación única de los datos históricos de la web admin
 * (esquema español de Supabase) al esquema unificado de Prisma (inglés).
 *
 * Estrategia: se designa la base Supabase EXISTENTE de la web como la DB
 * unificada. Prisma migra sus tablas inglesas DENTRO de esa misma base, donde
 * conviven temporalmente con las tablas legacy en español (clientes, perros,
 * reservaciones, pagos, egresos, config, patrocinios). Este script lee esas
 * tablas legacy vía SQL crudo y escribe en las tablas Prisma. Una vez
 * verificados los totales, las tablas legacy se pueden eliminar.
 *
 * Propiedades:
 *  - IDEMPOTENTE: usa upsert con el UUID legacy preservado como `id`, así que
 *    re-ejecutarlo no duplica filas.
 *  - PRESERVA FKs: mantener el UUID legacy como id deja los enlaces triviales.
 *  - TRAZABLE: todo lo importado queda con originLegacy = true.
 *
 * Uso:
 *   DATABASE_URL=<unified> npx tsx scripts/import-legacy.ts          # importar
 *   DATABASE_URL=<unified> npx tsx scripts/import-legacy.ts --verify # solo verificar
 *
 * Orden FK-safe: clientes → perros → reservaciones → pagos; egresos aparte.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import type {
  PetSize,
  ReservationType,
  ReservationStatus,
  PaymentKind,
  PaymentMethod,
  CostType,
  CartillaStatus,
} from "@prisma/client";

const prisma = new PrismaClient();
const VERIFY_ONLY = process.argv.includes("--verify");

// ---------------------------------------------------------------------------
// Tipos crudos de las filas legacy (tal como existen en las tablas español).
// ---------------------------------------------------------------------------
type Cliente = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  created_at: Date;
  updated_at: Date;
};
type Perro = {
  id: string;
  cliente_id: string;
  nombre: string;
  raza: string | null;
  sexo: "MACHO" | "HEMBRA" | null;
  fecha_nacimiento: Date | null;
  peso_kg: string | null; // numeric llega como string
  foto_url: string | null;
  alergias: string | null;
  comportamiento: string | null;
  notas: string | null;
  domicilio: string | null;
  cartilla_vigente: boolean;
  cartilla_vence: Date | null;
  cartilla_foto_url: string | null;
  desparasitacion_vigente: boolean;
  desparasitacion_vence: Date | null;
  created_at: Date;
  updated_at: Date;
};
type Reservacion = {
  id: string;
  perro_id: string;
  servicio: "HOTEL" | "ESTETICA" | "GUARDERIA";
  fecha_inicio: Date;
  fecha_fin: Date | null;
  hora_check_in: string | Date | null;
  hora_check_out: string | Date | null;
  precio_acordado: string;
  anticipo_acordado: string | null;
  estado: "RESERVADA" | "EN_CURSO" | "FINALIZADA" | "CANCELADA";
  notas: string | null;
  origen_legacy: boolean;
  created_at: Date;
  updated_at: Date;
};
type Pago = {
  id: string;
  reservacion_id: string | null;
  monto: string;
  tipo: "ANTICIPO" | "ABONO" | "RESTANTE";
  fecha: Date;
  metodo_pago: string | null;
  descripcion: string | null;
  created_at: Date;
};
type Egreso = {
  id: string;
  fecha: Date;
  descripcion: string;
  monto: string;
  categoria: string;
  tipo_costo: CostType;
  notas: string | null;
  created_at: Date;
};
type Patrocinio = {
  id: string;
  nombre: string;
  patrocina_bano: boolean;
  patrocina_corral: boolean;
  notas: string | null;
  created_at: Date;
  updated_at: Date;
};
type Config = { cupo_maximo: number; nombre_hotel: string };

// ---------------------------------------------------------------------------
// Helpers de mapeo
// ---------------------------------------------------------------------------

/** Talla: recalcula desde el peso (bandas de la móvil); cae al mapeo de `talla`. */
function mapSize(pesoKg: string | null): PetSize {
  const w = pesoKg != null ? Number(pesoKg) : NaN;
  if (!Number.isNaN(w)) {
    if (w < 5) return "XS";
    if (w < 10) return "S";
    if (w < 20) return "M";
    if (w <= 35) return "L";
    return "XL";
  }
  return "M"; // desconocido → mediano por defecto
}

function mapSexo(sexo: Perro["sexo"]): string | null {
  if (sexo === "MACHO") return "M";
  if (sexo === "HEMBRA") return "F";
  return null;
}

function mapServicio(s: Reservacion["servicio"]): ReservationType {
  return s === "HOTEL" ? "STAY" : s === "ESTETICA" ? "BATH" : "DAYCARE";
}

function mapEstado(e: Reservacion["estado"]): ReservationStatus {
  switch (e) {
    case "RESERVADA":
      return "CONFIRMED";
    case "EN_CURSO":
      return "CHECKED_IN";
    case "FINALIZADA":
      return "CHECKED_OUT";
    case "CANCELADA":
      return "CANCELLED";
  }
}

function mapPagoTipo(t: Pago["tipo"]): PaymentKind {
  return t; // ANTICIPO | ABONO | RESTANTE son idénticos en PaymentKind
}

/** metodo_pago es texto libre → enum PaymentMethod (default CASH). */
function mapMetodo(m: string | null): PaymentMethod {
  const v = (m ?? "").trim().toLowerCase();
  if (/(transfer|transferencia|spei|deposito|depósito)/.test(v)) return "TRANSFER";
  if (/(tarjeta|card|credito|crédito|debito|débito)/.test(v)) return "CARD";
  if (/stripe/.test(v)) return "STRIPE";
  if (/(efectivo|cash|contado)/.test(v)) return "CASH";
  return "CASH";
}

function mapCartilla(vigente: boolean): CartillaStatus | null {
  return vigente ? "APPROVED" : null;
}

/** Combina una fecha (date) con una hora; default 12:00. Robusto al tipo de
 *  `time`: Prisma devuelve columnas `time` como Date (no string). Se construye
 *  en UTC desde los componentes de la fecha para que el día no se corra por
 *  zona horaria (las fechas legacy son DATE = medianoche UTC). */
function combineDateTime(date: Date, time: string | Date | null): Date {
  const base = new Date(date);
  let h = 12,
    m = 0,
    s = 0;
  if (typeof time === "string" && time.includes(":")) {
    const p = time.split(":");
    h = parseInt(p[0], 10) || 0;
    m = parseInt(p[1] ?? "0", 10) || 0;
    s = parseInt(p[2] ?? "0", 10) || 0;
  } else if (time instanceof Date) {
    h = time.getUTCHours();
    m = time.getUTCMinutes();
    s = time.getUTCSeconds();
  }
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), h, m, s)
  );
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** ¿Existe la tabla legacy en la DB? (la importación se salta si no.) */
async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    select to_regclass(${name}) is not null as exists`;
  return rows[0]?.exists ?? false;
}

// ---------------------------------------------------------------------------
// Importadores por entidad
// ---------------------------------------------------------------------------

const seenEmails = new Set<string>();

async function importClientes(): Promise<number> {
  const rows = await prisma.$queryRaw<Cliente[]>`select * from clientes`;
  for (const c of rows) {
    // Email real si está libre; si no, placeholder único por id (habilita el
    // claim-by-email del middleware de auth cuando el cliente se registre).
    let email = (c.email ?? "").trim().toLowerCase();
    if (!email || seenEmails.has(email)) {
      email = `legacy+${c.id}@holidoginn.local`;
    }
    seenEmails.add(email);

    await prisma.user.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        clerkId: null,
        email,
        phone: c.telefono,
        firstName: c.nombre,
        lastName: "—",
        role: "OWNER",
        originLegacy: true,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      },
    });
  }
  return rows.length;
}

async function importPerros(): Promise<number> {
  const rows = await prisma.$queryRaw<Perro[]>`select * from perros`;
  for (const p of rows) {
    // Notas: concatenar alergias, comportamiento y domicilio en `notes`.
    const notesParts = [
      p.notas,
      p.alergias ? `Alergias: ${p.alergias}` : null,
      p.domicilio ? `Domicilio: ${p.domicilio}` : null,
    ].filter(Boolean);

    await prisma.pet.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        ownerId: p.cliente_id,
        name: p.nombre,
        breed: p.raza,
        size: mapSize(p.peso_kg),
        sex: mapSexo(p.sexo),
        birthDate: p.fecha_nacimiento,
        weight: p.peso_kg != null ? Number(p.peso_kg) : null,
        photoUrl: p.foto_url,
        behavior: p.comportamiento,
        notes: notesParts.length ? notesParts.join(" · ") : null,
        cartillaUrl: p.cartilla_foto_url,
        cartillaStatus: mapCartilla(p.cartilla_vigente),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      },
    });

    // Desparasitación legacy → una fila Deworming si está vigente/con fecha.
    if (p.desparasitacion_vigente || p.desparasitacion_vence) {
      await prisma.deworming.upsert({
        where: { id: `legacy-dw-${p.id}` },
        update: {},
        create: {
          id: `legacy-dw-${p.id}`,
          petId: p.id,
          type: "BOTH",
          appliedAt: p.updated_at,
          expiresAt: p.desparasitacion_vence,
          notes: "Importado del histórico (estado de desparasitación).",
        },
      });
    }
  }
  return rows.length;
}

async function importReservaciones(): Promise<number> {
  const rows = await prisma.$queryRaw<Reservacion[]>`select * from reservaciones`;
  // owner de la reserva = dueño del perro
  const perros = await prisma.$queryRaw<{ id: string; cliente_id: string }[]>`
    select id, cliente_id from perros`;
  const ownerByPerro = new Map(perros.map((p) => [p.id, p.cliente_id]));

  for (const r of rows) {
    const ownerId = ownerByPerro.get(r.perro_id);
    if (!ownerId) continue; // perro huérfano, se omite
    const type = mapServicio(r.servicio);
    const isStay = type === "STAY";

    const checkIn = isStay ? combineDateTime(r.fecha_inicio, r.hora_check_in) : null;
    const checkOut =
      isStay && r.fecha_fin ? combineDateTime(r.fecha_fin, r.hora_check_out) : null;
    const appointmentAt = !isStay
      ? combineDateTime(r.fecha_inicio, r.hora_check_in)
      : null;
    const totalDays = isStay && r.fecha_fin ? daysBetween(r.fecha_inicio, r.fecha_fin) : null;

    await prisma.reservation.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        ownerId,
        petId: r.perro_id,
        reservationType: type,
        status: mapEstado(r.estado),
        checkIn,
        checkOut,
        appointmentAt,
        totalDays,
        totalAmount: new Prisma.Decimal(r.precio_acordado),
        depositAgreed:
          r.anticipo_acordado != null && Number(r.anticipo_acordado) > 0
            ? new Prisma.Decimal(r.anticipo_acordado)
            : null,
        notes: r.notas,
        originLegacy: true,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  }
  return rows.length;
}

async function importPagos(): Promise<number> {
  const rows = await prisma.$queryRaw<Pago[]>`select * from pagos where reservacion_id is not null`;
  // userId del pago = owner de la reserva
  const reservas = await prisma.$queryRaw<{ id: string; ownerId: string }[]>`
    select id, "ownerId" from reservations`;
  const ownerByReserva = new Map(reservas.map((r) => [r.id, r.ownerId]));

  for (const pg of rows) {
    const reservationId = pg.reservacion_id!;
    if (!ownerByReserva.has(reservationId)) continue; // reserva no migrada
    const noteParts = [pg.descripcion, pg.metodo_pago ? `Método: ${pg.metodo_pago}` : null]
      .filter(Boolean)
      .join(" · ");

    await prisma.payment.upsert({
      where: { id: pg.id },
      update: {},
      create: {
        id: pg.id,
        reservationId,
        userId: ownerByReserva.get(reservationId) ?? null,
        amount: new Prisma.Decimal(pg.monto),
        method: mapMetodo(pg.metodo_pago),
        status: "PAID", // los pagos legacy ya fueron cobrados
        kind: mapPagoTipo(pg.tipo),
        paidAt: pg.fecha,
        notes: noteParts || null,
        originLegacy: true,
        createdAt: pg.created_at,
      },
    });
  }
  return rows.length;
}

async function importEgresos(): Promise<number> {
  const rows = await prisma.$queryRaw<Egreso[]>`select * from egresos`;
  for (const e of rows) {
    await prisma.expense.upsert({
      where: { id: e.id },
      update: {},
      create: {
        id: e.id,
        date: e.fecha,
        description: e.descripcion,
        amount: new Prisma.Decimal(e.monto),
        category: e.categoria,
        costType: e.tipo_costo,
        notes: e.notas,
        originLegacy: true,
        createdAt: e.created_at,
      },
    });
  }
  return rows.length;
}

async function importPatrocinios(): Promise<number> {
  if (!(await tableExists("patrocinios"))) return 0;
  const rows = await prisma.$queryRaw<Patrocinio[]>`select * from patrocinios`;
  for (const s of rows) {
    await prisma.sponsor.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        name: s.nombre,
        sponsorsBath: s.patrocina_bano,
        sponsorsKennel: s.patrocina_corral,
        notes: s.notas,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      },
    });
  }
  return rows.length;
}

async function importConfig(): Promise<void> {
  if (!(await tableExists("config"))) return;
  const rows = await prisma.$queryRaw<Config[]>`
    select cupo_maximo, nombre_hotel from config where id = 1`;
  const cfg = rows[0];
  if (!cfg) return;
  await prisma.hotelConfig.upsert({
    where: { id: "singleton" },
    update: { hotelName: cfg.nombre_hotel, maxCapacity: cfg.cupo_maximo },
    create: { id: "singleton", hotelName: cfg.nombre_hotel, maxCapacity: cfg.cupo_maximo },
  });
}

type Tarifa = { codigo: string; precio: string };

/** Preserva los precios reales de HOTEL/ProBARF de `tarifas` en LodgingPricing.
 *  Las tarifas de ESTÉTICA dependen de la matriz deslanado/corte (ServiceVariant)
 *  y se siembran con db:seed:services; aquí solo se portan las de hospedaje. */
async function importTarifas(): Promise<number> {
  if (!(await tableExists("tarifas"))) return 0;
  const rows = await prisma.$queryRaw<Tarifa[]>`select codigo, precio from tarifas`;
  const byCode = new Map(rows.map((t) => [t.codigo, t.precio]));
  const pick = (code: string): Prisma.Decimal | undefined => {
    const v = byCode.get(code);
    return v != null ? new Prisma.Decimal(v) : undefined;
  };

  const data: Prisma.LodgingPricingUpdateInput = {};
  const small = pick("HOTEL_NORMAL");
  const large = pick("HOTEL_XL");
  const pSmall = pick("HOTEL_PROBARF_NORMAL");
  const pLarge = pick("HOTEL_PROBARF_XL");
  if (small) data.pricePerDaySmall = small;
  if (large) data.pricePerDayLarge = large;
  if (pSmall) data.priceProbarfSmall = pSmall;
  if (pLarge) data.priceProbarfLarge = pLarge;

  // Asegura que el singleton exista, luego aplica los precios legacy.
  await prisma.lodgingPricing.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  if (Object.keys(data).length > 0) {
    await prisma.lodgingPricing.update({ where: { id: "singleton" }, data });
  }
  return rows.length;
}

/** Host de DATABASE_URL con la contraseña enmascarada (para confirmar visualmente
 *  contra qué base se está corriendo y evitar apuntar a la DB equivocada). */
function maskedDbHost(): string {
  const url = process.env.DATABASE_URL ?? "(sin DATABASE_URL)";
  return url.replace(/\/\/([^:]+):[^@]+@/, "//$1:****@");
}

// ---------------------------------------------------------------------------
// Verificación: CONTEOS por id (exactos) + TOTALES monetarios apples-to-apples.
// Los conteos detectan pérdida silenciosa de filas (perros/reservas/pagos que
// el import descarta). Los totales comparan SOLO lo que el import realmente
// toma (pagos con reservación) y reportan aparte los huérfanos.
// ---------------------------------------------------------------------------
async function verify(): Promise<boolean> {
  // --- Totales monetarios (mismo filtro que el import) ---------------------
  const [legacyIngresos] = await prisma.$queryRaw<{ total: string }[]>`
    select coalesce(sum(monto), 0)::text as total from pagos where reservacion_id is not null`;
  const [orphanPagos] = await prisma.$queryRaw<{ n: number; total: string }[]>`
    select count(*)::int as n, coalesce(sum(monto), 0)::text as total
    from pagos where reservacion_id is null`;
  const [legacyEgresos] = await prisma.$queryRaw<{ total: string }[]>`
    select coalesce(sum(monto), 0)::text as total from egresos`;

  const nuevoIngresos = await prisma.payment.aggregate({ _sum: { amount: true }, where: { originLegacy: true } });
  const nuevoEgresos = await prisma.expense.aggregate({ _sum: { amount: true }, where: { originLegacy: true } });

  const li = Number(legacyIngresos?.total ?? 0);
  const ni = Number(nuevoIngresos._sum.amount ?? 0);
  const le = Number(legacyEgresos?.total ?? 0);
  const ne = Number(nuevoEgresos._sum.amount ?? 0);
  const ingresosOk = Math.abs(li - ni) < 0.01;
  const egresosOk = Math.abs(le - ne) < 0.01;

  // --- Conteos por id (cada fila importada preserva el UUID legacy) --------
  const counts = await prisma.$queryRaw<{ entidad: string; legacy: number; importado: number }[]>`
    select 'clientes->users'::text as entidad,
           (select count(*)::int from clientes)                                               as legacy,
           (select count(*)::int from users u where u.id in (select id::text from clientes))  as importado
    union all
    select 'perros->pets',
           (select count(*)::int from perros),
           (select count(*)::int from pets p where p.id in (select id::text from perros))
    union all
    select 'reservaciones->reservations',
           (select count(*)::int from reservaciones),
           (select count(*)::int from reservations r where r.id in (select id::text from reservaciones))
    union all
    select 'pagos(c/reserva)->payments',
           (select count(*)::int from pagos where reservacion_id is not null),
           (select count(*)::int from payments pay where pay.id in (select id::text from pagos))
    union all
    select 'egresos->expenses',
           (select count(*)::int from egresos),
           (select count(*)::int from expenses e where e.id in (select id::text from egresos))`;

  let countsOk = true;
  console.log("── Verificación de conteos (por id) ─────────────────────");
  for (const c of counts) {
    const ok = Number(c.legacy) === Number(c.importado);
    if (!ok) countsOk = false;
    console.log(
      `${c.entidad.padEnd(30)} legacy: ${String(c.legacy).padStart(5)}  |  importado: ${String(c.importado).padStart(5)}  ${ok ? "✅" : "❌"}`
    );
  }

  console.log("── Verificación de totales ($) ──────────────────────────");
  console.log(`Ingresos (pagos c/reserva) legacy: ${li.toFixed(2)}  |  nuevo: ${ni.toFixed(2)}  ${ingresosOk ? "✅" : "❌"}`);
  console.log(`Egresos                    legacy: ${le.toFixed(2)}  |  nuevo: ${ne.toFixed(2)}  ${egresosOk ? "✅" : "❌"}`);

  const orphanN = Number(orphanPagos?.n ?? 0);
  if (orphanN > 0) {
    console.log("── ⚠️  Pagos huérfanos (reservacion_id NULL) ────────────");
    console.log(`Hay ${orphanN} pago(s) sin reservación, suma $${Number(orphanPagos.total).toFixed(2)}, que el import OMITE a propósito.`);
    console.log("Decide explícitamente qué hacer con ese ingreso suelto ANTES de eliminar las tablas legacy (FASE H).");
  }

  const ok = countsOk && ingresosOk && egresosOk;
  console.log(ok ? "\n✅ Conteos y totales cuadran." : "\n❌ Hay discrepancias — NO continúes al cutover.");
  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`▶ DATABASE_URL → ${maskedDbHost()}\n`);

  if (!(await tableExists("clientes"))) {
    console.error(
      "❌ No se encontró la tabla legacy `clientes`. Asegúrate de apuntar " +
        "DATABASE_URL a la DB unificada que contiene las tablas legacy en español."
    );
    process.exit(1);
  }

  if (VERIFY_ONLY) {
    const ok = await verify();
    process.exit(ok ? 0 : 1);
  }

  console.log("▶ Importando datos históricos al esquema unificado…\n");
  console.log(`  clientes     → users:        ${await importClientes()}`);
  console.log(`  perros       → pets:         ${await importPerros()}`);
  console.log(`  reservaciones→ reservations: ${await importReservaciones()}`);
  console.log(`  pagos        → payments:     ${await importPagos()}`);
  console.log(`  egresos      → expenses:     ${await importEgresos()}`);
  console.log(`  patrocinios  → sponsors:     ${await importPatrocinios()}`);
  console.log(`  tarifas      → lodging_pricing: ${await importTarifas()}`);
  await importConfig();
  console.log("  config       → hotel_config: ok\n");

  const ok = await verify();
  if (!ok) {
    console.error("\n❌ Los totales NO cuadran. Revisa antes de eliminar las tablas legacy.");
    process.exit(1);
  }
  console.log("\n✅ Importación completa y verificada. Las tablas legacy pueden eliminarse tras validar el dashboard.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
