import { prisma } from "../src/index";

async function run() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("localhost") && !url.includes("127.0.0.1")) {
    console.error("❌ Abortando: DATABASE_URL no apunta a localhost.");
    console.error(`   URL actual: ${url.replace(/:[^@]*@/, ":***@")}`);
    console.error("   Si de verdad quieres correr esto contra otra DB,");
    console.error("   edita el script y quita esta protección.");
    process.exit(1);
  }

  console.log("🧹 Limpieza para pruebas — DB:", url.replace(/:[^@]*@/, ":***@"));
  console.log("");

  const before = {
    reservations: await prisma.reservation.count(),
    payments: await prisma.payment.count(),
    staffAlerts: await prisma.staffAlert.count(),
    dailyChecklists: await prisma.dailyChecklist.count(),
    stayUpdates: await prisma.stayUpdate.count(),
    behaviorTags: await prisma.behaviorTag.count(),
    reviews: await prisma.review.count(),
    reservationAddons: await prisma.reservationAddon.count(),
    changeRequests: await prisma.reservationChangeRequest.count(),
    creditLedger: await prisma.creditLedger.count(),
    vaccines: await prisma.vaccine.count(),
    dewormings: await prisma.deworming.count(),
    notifications: await prisma.notification.count(),
    stripeEvents: await prisma.stripeEvent.count(),
    petsWithCartilla: await prisma.pet.count({ where: { cartillaStatus: { not: null } } }),
    usersWithCredit: await prisma.user.count({ where: { creditBalance: { gt: 0 } } }),
  };

  console.log("📊 Antes:");
  for (const [k, v] of Object.entries(before)) console.log(`   ${k.padEnd(22)} ${v}`);
  console.log("");

  await prisma.$transaction(async (tx) => {
    // Orden: hijos -> padres. Reservation_addons y change_requests bajan en
    // cascada al borrar la reservación, pero los limpio explícitamente para
    // que los conteos del reporte cuadren.
    await tx.creditLedger.deleteMany({});
    await tx.behaviorTag.deleteMany({});
    await tx.review.deleteMany({});
    await tx.staffAlert.deleteMany({});
    await tx.dailyChecklist.deleteMany({});
    await tx.stayUpdate.deleteMany({});
    await tx.reservationAddon.deleteMany({});
    await tx.reservationChangeRequest.deleteMany({});
    await tx.payment.deleteMany({});
    await tx.reservation.deleteMany({});

    await tx.vaccine.deleteMany({});
    await tx.deworming.deleteMany({});

    await tx.notification.deleteMany({});
    await tx.stripeEvent.deleteMany({});

    await tx.pet.updateMany({
      data: {
        cartillaUrl: null,
        cartillaPhotos: [],
        cartillaStatus: null,
        cartillaReviewedAt: null,
        cartillaReviewedById: null,
        cartillaRejectionReason: null,
      },
    });

    await tx.user.updateMany({
      data: {
        creditBalance: 0,
        lastCreditEntryAt: null,
      },
    });
  });

  const after = {
    reservations: await prisma.reservation.count(),
    payments: await prisma.payment.count(),
    staffAlerts: await prisma.staffAlert.count(),
    dailyChecklists: await prisma.dailyChecklist.count(),
    stayUpdates: await prisma.stayUpdate.count(),
    behaviorTags: await prisma.behaviorTag.count(),
    reviews: await prisma.review.count(),
    reservationAddons: await prisma.reservationAddon.count(),
    changeRequests: await prisma.reservationChangeRequest.count(),
    creditLedger: await prisma.creditLedger.count(),
    vaccines: await prisma.vaccine.count(),
    dewormings: await prisma.deworming.count(),
    notifications: await prisma.notification.count(),
    stripeEvents: await prisma.stripeEvent.count(),
    petsWithCartilla: await prisma.pet.count({ where: { cartillaStatus: { not: null } } }),
    usersWithCredit: await prisma.user.count({ where: { creditBalance: { gt: 0 } } }),
  };

  console.log("✅ Después:");
  for (const [k, v] of Object.entries(after)) console.log(`   ${k.padEnd(22)} ${v}`);
  console.log("");

  const preserved = {
    users: await prisma.user.count(),
    pets: await prisma.pet.count(),
    rooms: await prisma.room.count(),
    pushTokens: await prisma.pushToken.count(),
    vaccineCatalog: await prisma.vaccineCatalog.count(),
    serviceTypes: await prisma.serviceType.count(),
    legalAcceptances: await prisma.legalAcceptance.count(),
  };
  console.log("📦 Conservado:");
  for (const [k, v] of Object.entries(preserved)) console.log(`   ${k.padEnd(22)} ${v}`);
}

run()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
