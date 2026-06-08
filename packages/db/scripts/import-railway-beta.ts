/**
 * import-railway-beta.ts — Migra las cuentas/datos BETA de la DB de Railway
 * (esquema Prisma "viejo", 6 migraciones atrás) a la DB unificada en Supabase.
 *
 * Por qué existe: la móvil tenía datos beta reales (equipo + testers) en Railway.
 * Se migran cuentas + roles + perros + reservas + pagos + addons + consentimientos.
 * Se OMITEN notifications/push_tokens (transitorios).
 *
 * Lectura: Railway vía Prisma $queryRaw con `select *` (tolera el esquema viejo;
 * las columnas que no existen en Railway quedan undefined → Prisma usa default).
 * Escritura: Supabase vía Prisma upsert (idempotente por id). FKs a tablas
 * re-sembradas en Supabase (rooms/service_variants con ids distintos) se anulan
 * o remapean.
 *
 * Uso:
 *   RAILWAY_URL=<railway> SB_URL=<supabase-session-pooler> npx tsx scripts/import-railway-beta.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const RAILWAY_URL = process.env.RAILWAY_URL;
const SB_URL = process.env.SB_URL;
if (!RAILWAY_URL || !SB_URL) {
  console.error("❌ Faltan RAILWAY_URL y/o SB_URL en el entorno.");
  process.exit(1);
}

const rail = new PrismaClient({ datasourceUrl: RAILWAY_URL });
const sb = new PrismaClient({ datasourceUrl: SB_URL });

const mask = (u: string) => u.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@");

const migratedUserIds = new Set<string>();
const migratedReservationIds = new Set<string>();

async function migrateUsers(): Promise<number> {
  const rows = await rail.$queryRaw<any[]>`select * from users`;
  let ok = 0;
  for (const u of rows) {
    try {
      await sb.user.upsert({
        where: { id: u.id },
        update: { role: u.role },
        create: {
          id: u.id,
          clerkId: u.clerkId,
          email: u.email,
          phone: u.phone,
          firstName: u.firstName,
          lastName: u.lastName,
          avatarUrl: u.avatarUrl,
          role: u.role,
          isActive: u.isActive ?? true,
          creditBalance: u.creditBalance ?? new Prisma.Decimal(0),
          lastCreditEntryAt: u.lastCreditEntryAt ?? null,
          originLegacy: false,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        },
      });
      migratedUserIds.add(u.id);
      ok++;
    } catch (e: any) {
      if (e?.code === "P2002") {
        const existing = await sb.user.findUnique({ where: { email: u.email } });
        if (existing) {
          await sb.user.update({
            where: { id: existing.id },
            data: { clerkId: u.clerkId ?? existing.clerkId, role: u.role },
          });
          migratedUserIds.add(existing.id);
          console.log(`  ↪ email ${u.email} ya existía (legacy); vinculado clerkId + rol ${u.role}`);
          ok++;
        }
      } else {
        throw e;
      }
    }
  }
  return ok;
}

async function migratePets(): Promise<number> {
  const rows = await rail.$queryRaw<any[]>`select * from pets`;
  let ok = 0;
  for (const p of rows) {
    if (!migratedUserIds.has(p.ownerId)) continue;
    const reviewer =
      p.cartillaReviewedById && migratedUserIds.has(p.cartillaReviewedById)
        ? p.cartillaReviewedById
        : null;
    await sb.pet.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        ownerId: p.ownerId,
        name: p.name,
        breed: p.breed ?? null,
        size: p.size,
        birthDate: p.birthDate ?? null,
        weight: p.weight ?? null,
        photoUrl: p.photoUrl ?? null,
        notes: p.notes ?? null,
        sex: p.sex ?? null,
        behavior: p.behavior ?? null,
        walkPreference: p.walkPreference ?? null,
        healthIssues: p.healthIssues ?? null,
        isNeutered: p.isNeutered ?? false,
        vetName: p.vetName ?? null,
        vetPhone: p.vetPhone ?? null,
        vetEmergency24h: p.vetEmergency24h ?? false,
        feedingSchedule: p.feedingSchedule ?? null,
        foodType: p.foodType ?? null,
        diet: p.diet ?? null,
        personality: p.personality ?? null,
        cartillaUrl: p.cartillaUrl ?? null,
        cartillaStatus: p.cartillaStatus ?? null,
        cartillaReviewedById: reviewer,
        isActive: p.isActive ?? true,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    });
    ok++;
  }
  return ok;
}

async function migrateReservations(): Promise<number> {
  const rows = await rail.$queryRaw<any[]>`select * from reservations`;
  let ok = 0;
  for (const r of rows) {
    if (!migratedUserIds.has(r.ownerId)) continue;
    const staffId = r.staffId && migratedUserIds.has(r.staffId) ? r.staffId : null;
    await sb.reservation.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        reservationType: r.reservationType ?? "STAY",
        checkIn: r.checkIn ?? null,
        checkOut: r.checkOut ?? null,
        appointmentAt: r.appointmentAt ?? null,
        status: r.status,
        totalDays: r.totalDays ?? null,
        totalAmount: r.totalAmount,
        notes: r.notes ?? null,
        medicationNotes: r.medicationNotes ?? null,
        legalAccepted: r.legalAccepted ?? false,
        groupId: r.groupId ?? null,
        paymentType: r.paymentType ?? null,
        depositDeadline: r.depositDeadline ?? null,
        roomId: null, // rooms re-sembradas en Supabase con ids distintos
        staffId,
        ownerId: r.ownerId,
        petId: r.petId,
        originLegacy: false,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      },
    });
    migratedReservationIds.add(r.id);
    ok++;
  }
  return ok;
}

async function migratePayments(): Promise<number> {
  const rows = await rail.$queryRaw<any[]>`select * from payments`;
  let ok = 0;
  for (const p of rows) {
    if (!migratedReservationIds.has(p.reservationId)) continue;
    const userId = p.userId && migratedUserIds.has(p.userId) ? p.userId : null;
    await sb.payment.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        kind: "FULL",
        reference: p.reference ?? null,
        stripePaymentIntentId: p.stripePaymentIntentId ?? null,
        paidAt: p.paidAt ?? null,
        notes: p.notes ?? null,
        reservationId: p.reservationId,
        userId,
        originLegacy: false,
        createdAt: p.createdAt,
      },
    });
    ok++;
  }
  return ok;
}

async function migrateAddons(): Promise<number> {
  const railVars = await rail.$queryRaw<any[]>`select * from service_variants`;
  const railKey = new Map<string, string>();
  for (const v of railVars) railKey.set(v.id, `${v.petSize}|${v.deslanado}|${v.corte}`);
  const sbVars = await sb.serviceVariant.findMany();
  const sbByKey = new Map<string, string>();
  for (const v of sbVars) sbByKey.set(`${v.petSize}|${v.deslanado}|${v.corte}`, v.id);

  const rows = await rail.$queryRaw<any[]>`select * from reservation_addons`;
  let ok = 0;
  let skipped = 0;
  for (const a of rows) {
    if (!migratedReservationIds.has(a.reservationId)) {
      skipped++;
      continue;
    }
    const key = railKey.get(a.variantId);
    const sbVariantId = key ? sbByKey.get(key) : undefined;
    if (!sbVariantId) {
      skipped++;
      continue;
    }
    await sb.reservationAddon.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id,
        unitPrice: a.unitPrice,
        paidWith: a.paidWith,
        completedAt: a.completedAt ?? null,
        createdAt: a.createdAt,
        reservationId: a.reservationId,
        variantId: sbVariantId,
        paymentId: null,
      },
    });
    ok++;
  }
  if (skipped) console.log(`  (addons omitidos sin variante equivalente / reserva no migrada: ${skipped})`);
  return ok;
}

async function migrateLegal(): Promise<number> {
  const rows = await rail.$queryRaw<any[]>`select * from legal_acceptances`;
  let ok = 0;
  for (const l of rows) {
    if (!migratedUserIds.has(l.userId)) continue;
    await sb.legalAcceptance.upsert({
      where: { id: l.id },
      update: {},
      create: {
        id: l.id,
        userId: l.userId,
        documentType: l.documentType,
        version: l.version,
        acceptedAt: l.acceptedAt,
        ipAddress: l.ipAddress ?? null,
        userAgent: l.userAgent ?? null,
      },
    });
    ok++;
  }
  return ok;
}

async function main() {
  console.log(`▶ Railway → ${mask(RAILWAY_URL!)}`);
  console.log(`▶ Supabase → ${mask(SB_URL!)}\n`);
  console.log(`  users:              ${await migrateUsers()}`);
  console.log(`  pets:               ${await migratePets()}`);
  console.log(`  reservations:       ${await migrateReservations()}`);
  console.log(`  payments:           ${await migratePayments()}`);
  console.log(`  reservation_addons: ${await migrateAddons()}`);
  console.log(`  legal_acceptances:  ${await migrateLegal()}`);

  const admins = await sb.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  const staff = await sb.user.findMany({ where: { role: "STAFF" }, select: { email: true } });
  console.log(`\n  ADMINs en Supabase: ${admins.map((a) => a.email).join(", ") || "(ninguno)"}`);
  console.log(`  STAFF en Supabase:  ${staff.map((s) => s.email).join(", ") || "(ninguno)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await rail.$disconnect();
    await sb.$disconnect();
  });
