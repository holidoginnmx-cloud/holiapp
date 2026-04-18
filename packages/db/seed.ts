import { prisma } from "./src/index";
import { Prisma } from "@prisma/client";

// ─── Helpers ──────────────────────────────────────────────
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const daysFromNow = (d: number) => new Date(now.getTime() + d * 86_400_000);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const monthsAgo = (m: number) => {
  const date = new Date(now);
  date.setMonth(date.getMonth() - m);
  return date;
};
const monthsFromNow = (m: number) => {
  const date = new Date(now);
  date.setMonth(date.getMonth() + m);
  return date;
};
const dateOnly = (d: Date) => new Date(d.toISOString().split("T")[0] + "T00:00:00.000Z");

// ─── Clerk IDs (test accounts) ───────────────────────────
const CLERK = {
  javier: "user_3BmX57VDMl0Hurc7cuf1r50g1n6",
  jessica: "user_3BmXSo06ppZq6HhujQmIFLhQsTM",
  jose: "user_3BmXdIbwxduP5tpTrVZcZKQ0cOr",
};

// ─── Deterministic IDs ───────────────────────────────────
const ID = {
  // Users
  javier: "seed_user_javier",
  jessica: "seed_user_jessica",
  jose: "seed_user_jose",
  // Pets
  luna: "seed_pet_luna",
  rocky: "seed_pet_rocky",
  bella: "seed_pet_bella",
  // Vaccines
  vaxLunaRabia: "seed_vax_luna_rabia",
  vaxLunaDhpp: "seed_vax_luna_dhpp",
  vaxRockyRabia: "seed_vax_rocky_rabia",
  vaxRockyBordetella: "seed_vax_rocky_bordetella",
  vaxBellaRabia: "seed_vax_bella_rabia",
  vaxBellaDhpp: "seed_vax_bella_dhpp",
  vaxBellaBordetella: "seed_vax_bella_bordetella",
  // Rooms
  suiteVip: "seed_room_suite_vip",
  cuartoMedA: "seed_room_mediano_a",
  cuartoPeqB: "seed_room_pequeno_b",
  // Reservations
  res1: "seed_res_luna_active",
  res2: "seed_res_rocky_past",
  res3: "seed_res_bella_confirmed",
  res4: "seed_res_luna_pending",
  res5: "seed_res_bella_past",
  res6: "seed_res_luna_cancelled",
  res7: "seed_res_luna_past",
  // Stay Updates
  update1: "seed_update_luna_1",
  update2: "seed_update_luna_2",
  update3: "seed_update_luna_3",
  update4: "seed_update_luna_4",
  update5: "seed_update_luna_5",
  update6: "seed_update_bella_past_1",
  // Payments
  pay1: "seed_pay_res1_anticipo",
  pay2: "seed_pay_res2_completo",
  pay3: "seed_pay_res5_completo",
  pay4: "seed_pay_res6_reembolso",
  pay5: "seed_pay_res7_completo",
  // Notifications
  notif1: "seed_notif_checkin",
  notif2: "seed_notif_update",
  notif3: "seed_notif_confirmed",
  notif4: "seed_notif_payment",
  notif5: "seed_notif_daily_report",
  notif6: "seed_notif_checkout",
  notif7: "seed_notif_general",
  notif8: "seed_notif_reminder",
  // Daily Checklists
  cl1: "seed_checklist_res1_day1",
  cl2: "seed_checklist_res1_day2",
  cl3: "seed_checklist_res5_day1",
  cl4: "seed_checklist_res5_day2",
  cl5: "seed_checklist_res5_day3",
  // Behavior Tags
  bt1: "seed_btag_luna_sociable",
  bt2: "seed_btag_luna_calm",
  bt3: "seed_btag_bella_shy",
  bt4: "seed_btag_bella_anxious",
  // Staff Alert
  alert1: "seed_alert_bella_not_eating",
  // Review
  review1: "seed_review_res5",
};

async function seed() {
  const counts: Record<string, number> = {};

  // ═══════════════════════════════════════════════════════
  //  1. USUARIOS
  // ═══════════════════════════════════════════════════════
  const userFields = [
    {
      id: ID.javier,
      clerkId: CLERK.javier,
      email: "javier@holidoginn.com",
      firstName: "Javier",
      lastName: "Oviedo",
      role: "ADMIN" as const,
      phone: "+52 55 0000 0000",
    },
    {
      id: ID.jessica,
      clerkId: CLERK.jessica,
      email: "jessica@gmail.com",
      firstName: "Jessica",
      lastName: "Cadena",
      role: "STAFF" as const,
      phone: "+52 55 0000 0001",
    },
    {
      id: ID.jose,
      clerkId: CLERK.jose,
      email: "josecortez@gmail.com",
      firstName: "Jose",
      lastName: "Cortez",
      role: "OWNER" as const,
      phone: "+52 55 0000 0002",
    },
  ];

  for (const u of userFields) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        ...(u.clerkId ? { clerkId: u.clerkId } : {}),
      },
      create: u,
    });
  }
  counts["Users"] = userFields.length;

  // ═══════════════════════════════════════════════════════
  //  2. MASCOTAS
  // ═══════════════════════════════════════════════════════
  const petFields = [
    {
      id: ID.luna,
      name: "Luna",
      breed: "Golden Retriever",
      size: "L" as const,
      weight: 28,
      birthDate: new Date("2022-03-15"),
      notes: "Muy sociable, le encanta jugar con agua",
      isNeutered: true,
      emergencyContactName: "Roberto Garcia",
      emergencyContactPhone: "+52 55 9876 0001",
      vetName: "Dr. Ramírez",
      vetPhone: "+52 55 5555 0100",
      diet: "Croquetas premium Royal Canin Golden Retriever, 2 tazas por comida, 2 veces al día. Alérgica al pollo crudo.",
      personality: "Muy sociable y juguetona. Le encanta el agua y perseguir pelotas. Se lleva bien con todos los perros.",
      ownerId: ID.jose,
    },
    {
      id: ID.rocky,
      name: "Rocky",
      breed: "Bulldog Francés",
      size: "S" as const,
      weight: 9,
      birthDate: new Date("2023-07-10"),
      notes: "Ronca mucho al dormir, necesita aire acondicionado",
      isNeutered: true,
      emergencyContactName: "Ana Martinez",
      emergencyContactPhone: "+52 55 9876 0002",
      vetName: "Dra. Sánchez",
      vetPhone: "+52 55 5555 0200",
      diet: "Hills Science Diet Small Paws, 1/2 taza por comida, 2 veces al día. Sensible del estómago.",
      personality: "Tranquilo y un poco terco. Le gusta dormir mucho. Se pone ansioso con ruidos fuertes.",
      ownerId: ID.jose,
    },
    {
      id: ID.bella,
      name: "Bella",
      breed: "Chihuahua",
      size: "XS" as const,
      weight: 2.5,
      birthDate: new Date("2021-11-02"),
      notes: "Nerviosa con perros grandes, separar en paseos",
      isNeutered: false,
      emergencyContactName: "Roberto Garcia",
      emergencyContactPhone: "+52 55 9876 0001",
      vetName: "Dr. Torres",
      vetPhone: "+52 55 5555 0300",
      diet: "Royal Canin Chihuahua, 1/4 taza por comida, 3 veces al día. No dar golosinas con azúcar.",
      personality: "Nerviosa con perros grandes pero cariñosa con personas. Le gusta estar en brazos. Ladra mucho al principio pero se calma rápido.",
      ownerId: ID.jose,
    },
  ];

  for (const p of petFields) {
    await prisma.pet.upsert({
      where: { id: p.id },
      update: {
        name: p.name,
        breed: p.breed,
        weight: p.weight,
        notes: p.notes,
        isNeutered: p.isNeutered,
        emergencyContactName: p.emergencyContactName,
        emergencyContactPhone: p.emergencyContactPhone,
        vetName: p.vetName,
        vetPhone: p.vetPhone,
        diet: p.diet,
        personality: p.personality,
      },
      create: p,
    });
  }
  counts["Pets"] = petFields.length;

  // ═══════════════════════════════════════════════════════
  //  3. VACUNAS
  // ═══════════════════════════════════════════════════════
  const vaccineFields = [
    // Luna
    {
      id: ID.vaxLunaRabia,
      name: "Rabia",
      appliedAt: monthsAgo(6),
      expiresAt: monthsFromNow(6),
      vetName: "Dr. Ramírez",
      petId: ID.luna,
    },
    {
      id: ID.vaxLunaDhpp,
      name: "DHPP",
      appliedAt: monthsAgo(3),
      expiresAt: monthsFromNow(9),
      vetName: "Dr. Ramírez",
      petId: ID.luna,
    },
    // Rocky
    {
      id: ID.vaxRockyRabia,
      name: "Rabia",
      appliedAt: monthsAgo(4),
      expiresAt: monthsFromNow(8),
      vetName: "Dra. Sánchez",
      petId: ID.rocky,
    },
    {
      id: ID.vaxRockyBordetella,
      name: "Bordetella",
      appliedAt: monthsAgo(2),
      expiresAt: monthsFromNow(10),
      vetName: "Dra. Sánchez",
      petId: ID.rocky,
    },
    // Bella
    {
      id: ID.vaxBellaRabia,
      name: "Rabia",
      appliedAt: monthsAgo(10),
      expiresAt: monthsFromNow(2),
      vetName: "Dr. Torres",
      petId: ID.bella,
    },
    {
      id: ID.vaxBellaDhpp,
      name: "DHPP",
      appliedAt: monthsAgo(11),
      expiresAt: daysFromNow(30),
      vetName: "Dr. Torres",
      petId: ID.bella,
    },
    {
      id: ID.vaxBellaBordetella,
      name: "Bordetella",
      appliedAt: monthsAgo(5),
      expiresAt: monthsFromNow(7),
      vetName: "Dr. Torres",
      petId: ID.bella,
    },
  ];

  for (const v of vaccineFields) {
    await prisma.vaccine.upsert({
      where: { id: v.id },
      update: { name: v.name, appliedAt: v.appliedAt, expiresAt: v.expiresAt },
      create: v,
    });
  }
  counts["Vaccines"] = vaccineFields.length;

  // ═══════════════════════════════════════════════════════
  //  4. CUARTOS
  // ═══════════════════════════════════════════════════════
  const roomFields = [
    {
      id: ID.suiteVip,
      name: "Suite VIP",
      description: "Suite premium con cama ortopédica, cámara en vivo y patio privado",
      capacity: 1,
      sizeAllowed: ["XL" as const, "L" as const],
      pricePerDay: new Prisma.Decimal(450),
    },
    {
      id: ID.cuartoMedA,
      name: "Cuarto Mediano A",
      description: "Cuarto cómodo con ventilación y espacio para jugar",
      capacity: 1,
      sizeAllowed: ["M" as const, "S" as const],
      pricePerDay: new Prisma.Decimal(280),
    },
    {
      id: ID.cuartoPeqB,
      name: "Cuarto Pequeño B",
      description: "Cuarto acogedor ideal para mascotas pequeñas, capacidad doble",
      capacity: 2,
      sizeAllowed: ["S" as const, "XS" as const],
      pricePerDay: new Prisma.Decimal(200),
    },
  ];

  for (const r of roomFields) {
    await prisma.room.upsert({
      where: { id: r.id },
      update: { name: r.name, pricePerDay: r.pricePerDay, capacity: r.capacity },
      create: r,
    });
  }
  counts["Rooms"] = roomFields.length;

  // ═══════════════════════════════════════════════════════
  //  5. RESERVACIONES
  // ═══════════════════════════════════════════════════════

  // res1 — Luna en Suite VIP (CHECKED_IN, activa)
  const res1CheckIn = daysAgo(2);
  const res1CheckOut = daysFromNow(3);
  const res1TotalDays = 5;
  const res1TotalAmount = new Prisma.Decimal(450).mul(res1TotalDays);

  await prisma.reservation.upsert({
    where: { id: ID.res1 },
    update: { status: "CHECKED_IN", totalDays: res1TotalDays, totalAmount: res1TotalAmount },
    create: {
      id: ID.res1,
      checkIn: res1CheckIn,
      checkOut: res1CheckOut,
      status: "CHECKED_IN",
      totalDays: res1TotalDays,
      totalAmount: res1TotalAmount,
      notes: "Luna necesita paseo a las 7am y 6pm",
      legalAccepted: true,
      ownerId: ID.jose,
      petId: ID.luna,
      roomId: ID.suiteVip,
      staffId: ID.jessica,
    },
  });

  // res2 — Rocky en Cuarto Mediano A (CHECKED_OUT, Carlos)
  const res2CheckIn = daysAgo(14);
  const res2CheckOut = daysAgo(11);
  const res2TotalDays = 3;
  const res2TotalAmount = new Prisma.Decimal(280).mul(res2TotalDays);

  await prisma.reservation.upsert({
    where: { id: ID.res2 },
    update: { status: "CHECKED_OUT", totalDays: res2TotalDays, totalAmount: res2TotalAmount },
    create: {
      id: ID.res2,
      checkIn: res2CheckIn,
      checkOut: res2CheckOut,
      status: "CHECKED_OUT",
      totalDays: res2TotalDays,
      totalAmount: res2TotalAmount,
      notes: "Rocky necesita aire acondicionado constante",
      legalAccepted: true,
      ownerId: ID.jose,
      petId: ID.rocky,
      roomId: ID.cuartoMedA,
      staffId: ID.jessica,
    },
  });

  // res3 — Bella en Cuarto Pequeño B (CONFIRMED, próxima)
  const res3CheckIn = daysFromNow(10);
  const res3CheckOut = daysFromNow(14);
  const res3TotalDays = 4;
  const res3TotalAmount = new Prisma.Decimal(200).mul(res3TotalDays);

  await prisma.reservation.upsert({
    where: { id: ID.res3 },
    update: { status: "CONFIRMED", totalDays: res3TotalDays, totalAmount: res3TotalAmount },
    create: {
      id: ID.res3,
      checkIn: res3CheckIn,
      checkOut: res3CheckOut,
      status: "CONFIRMED",
      totalDays: res3TotalDays,
      totalAmount: res3TotalAmount,
      notes: "Bella necesita manta extra, es friolenta",
      legalAccepted: true,
      ownerId: ID.jose,
      petId: ID.bella,
      roomId: ID.cuartoPeqB,
    },
  });

  // res4 — Luna en Suite VIP (PENDING, futura)
  const res4CheckIn = daysFromNow(45);
  const res4CheckOut = daysFromNow(50);
  const res4TotalDays = 5;
  const res4TotalAmount = new Prisma.Decimal(450).mul(res4TotalDays);

  await prisma.reservation.upsert({
    where: { id: ID.res4 },
    update: { status: "PENDING", totalDays: res4TotalDays, totalAmount: res4TotalAmount },
    create: {
      id: ID.res4,
      checkIn: res4CheckIn,
      checkOut: res4CheckOut,
      status: "PENDING",
      totalDays: res4TotalDays,
      totalAmount: res4TotalAmount,
      notes: "Vacaciones de verano, mismo cuarto que la vez pasada",
      legalAccepted: true,
      ownerId: ID.jose,
      petId: ID.luna,
      roomId: ID.suiteVip,
    },
  });

  // res5 — Bella en Cuarto Pequeño B (CHECKED_OUT, pasada con review)
  const res5CheckIn = daysAgo(25);
  const res5CheckOut = daysAgo(21);
  const res5TotalDays = 4;
  const res5TotalAmount = new Prisma.Decimal(200).mul(res5TotalDays);

  await prisma.reservation.upsert({
    where: { id: ID.res5 },
    update: { status: "CHECKED_OUT", totalDays: res5TotalDays, totalAmount: res5TotalAmount },
    create: {
      id: ID.res5,
      checkIn: res5CheckIn,
      checkOut: res5CheckOut,
      status: "CHECKED_OUT",
      totalDays: res5TotalDays,
      totalAmount: res5TotalAmount,
      notes: "Primera estancia de Bella",
      legalAccepted: true,
      ownerId: ID.jose,
      petId: ID.bella,
      roomId: ID.cuartoPeqB,
      staffId: ID.jessica,
    },
  });

  // res6 — Luna en Suite VIP (CANCELLED)
  const res6CheckIn = daysAgo(60);
  const res6CheckOut = daysAgo(55);
  const res6TotalDays = 5;
  const res6TotalAmount = new Prisma.Decimal(450).mul(res6TotalDays);

  await prisma.reservation.upsert({
    where: { id: ID.res6 },
    update: { status: "CANCELLED", totalDays: res6TotalDays, totalAmount: res6TotalAmount },
    create: {
      id: ID.res6,
      checkIn: res6CheckIn,
      checkOut: res6CheckOut,
      status: "CANCELLED",
      totalDays: res6TotalDays,
      totalAmount: res6TotalAmount,
      notes: "Cancelada por viaje imprevisto",
      legalAccepted: true,
      ownerId: ID.jose,
      petId: ID.luna,
      roomId: ID.suiteVip,
    },
  });

  // res7 — Luna en Suite VIP (CHECKED_OUT, pasada sin review)
  const res7CheckIn = daysAgo(40);
  const res7CheckOut = daysAgo(35);
  const res7TotalDays = 5;
  const res7TotalAmount = new Prisma.Decimal(450).mul(res7TotalDays);

  await prisma.reservation.upsert({
    where: { id: ID.res7 },
    update: { status: "CHECKED_OUT", totalDays: res7TotalDays, totalAmount: res7TotalAmount },
    create: {
      id: ID.res7,
      checkIn: res7CheckIn,
      checkOut: res7CheckOut,
      status: "CHECKED_OUT",
      totalDays: res7TotalDays,
      totalAmount: res7TotalAmount,
      notes: "Segunda estancia de Luna, todo perfecto",
      legalAccepted: true,
      ownerId: ID.jose,
      petId: ID.luna,
      roomId: ID.suiteVip,
      staffId: ID.jessica,
    },
  });

  counts["Reservations"] = 7;

  // ═══════════════════════════════════════════════════════
  //  6. STAY UPDATES
  // ═══════════════════════════════════════════════════════
  const updateFields = [
    {
      id: ID.update3,
      caption: "Luna jugando con su pelota favorita en el patio",
      mediaUrl: "https://placehold.co/800x600?text=Luna+Jugando+Patio",
      mediaType: "image",
      reservationId: ID.res1,
      petId: ID.luna,
      staffId: ID.jessica,
      createdAt: daysAgo(2),
    },
    {
      id: ID.update1,
      caption: "¡Luna disfrutando su paseo matutino por el jardín! 🐾",
      mediaUrl: "https://placehold.co/800x600?text=Luna+Paseo+Matutino",
      mediaType: "image",
      reservationId: ID.res1,
      petId: ID.luna,
      staffId: ID.jessica,
      createdAt: daysAgo(1),
    },
    {
      id: ID.update4,
      caption: "Hora del baño! Luna se portó de maravilla",
      mediaUrl: "https://placehold.co/800x600?text=Luna+Hora+Bano",
      mediaType: "image",
      reservationId: ID.res1,
      petId: ID.luna,
      staffId: ID.jessica,
      createdAt: hoursAgo(18),
    },
    {
      id: ID.update5,
      caption: "Luna socializando con Max, su nuevo amigo",
      mediaUrl: "https://placehold.co/800x600?text=Luna+Socializando",
      mediaType: "video",
      reservationId: ID.res1,
      petId: ID.luna,
      staffId: ID.jessica,
      createdAt: hoursAgo(3),
    },
    {
      id: ID.update2,
      caption: "Luna descansando después de jugar con sus juguetes favoritos",
      mediaUrl: "https://placehold.co/800x600?text=Luna+Descansando",
      mediaType: "image",
      reservationId: ID.res1,
      petId: ID.luna,
      staffId: ID.jessica,
      createdAt: new Date(),
    },
    {
      id: ID.update6,
      caption: "Bella descansando en su camita después del paseo",
      mediaUrl: "https://placehold.co/800x600?text=Bella+Descansando",
      mediaType: "image",
      reservationId: ID.res5,
      petId: ID.bella,
      staffId: ID.jessica,
      createdAt: daysAgo(23),
    },
  ];

  for (const u of updateFields) {
    await prisma.stayUpdate.upsert({
      where: { id: u.id },
      update: { caption: u.caption, mediaUrl: u.mediaUrl, staffId: u.staffId },
      create: u,
    });
  }
  counts["StayUpdates"] = updateFields.length;

  // ═══════════════════════════════════════════════════════
  //  7. PAGOS
  // ═══════════════════════════════════════════════════════

  // res1 — anticipo $500 (PARTIAL)
  await prisma.payment.upsert({
    where: { id: ID.pay1 },
    update: { amount: new Prisma.Decimal(500), status: "PARTIAL" },
    create: {
      id: ID.pay1,
      amount: new Prisma.Decimal(500),
      method: "TRANSFER",
      status: "PARTIAL",
      reference: "SPEI-20260324-001",
      paidAt: daysAgo(3),
      notes: "Anticipo para reservar Suite VIP",
      reservationId: ID.res1,
      userId: ID.jose,
    },
  });

  // res2 — pago completo $840 (PAID, Carlos)
  await prisma.payment.upsert({
    where: { id: ID.pay2 },
    update: { amount: res2TotalAmount, status: "PAID" },
    create: {
      id: ID.pay2,
      amount: res2TotalAmount,
      method: "CARD",
      status: "PAID",
      reference: "CARD-20260312-001",
      paidAt: daysAgo(11),
      notes: "Pago completo al check-out",
      reservationId: ID.res2,
      userId: ID.jose,
    },
  });

  // res5 — pago completo $800 (PAID, Bella pasada)
  await prisma.payment.upsert({
    where: { id: ID.pay3 },
    update: { amount: res5TotalAmount, status: "PAID" },
    create: {
      id: ID.pay3,
      amount: res5TotalAmount,
      method: "CARD",
      status: "PAID",
      reference: "CARD-20260305-001",
      paidAt: daysAgo(21),
      notes: "Pago completo de estancia de Bella",
      reservationId: ID.res5,
      userId: ID.jose,
    },
  });

  // res6 — reembolso $2,250 (REFUNDED, cancelada)
  await prisma.payment.upsert({
    where: { id: ID.pay4 },
    update: { amount: res6TotalAmount, status: "REFUNDED" },
    create: {
      id: ID.pay4,
      amount: res6TotalAmount,
      method: "TRANSFER",
      status: "REFUNDED",
      reference: "REFUND-20260129-001",
      paidAt: daysAgo(58),
      notes: "Reembolso por cancelación",
      reservationId: ID.res6,
      userId: ID.jose,
    },
  });

  // res7 — pago completo $2,250 (PAID, Luna pasada)
  await prisma.payment.upsert({
    where: { id: ID.pay5 },
    update: { amount: res7TotalAmount, status: "PAID" },
    create: {
      id: ID.pay5,
      amount: res7TotalAmount,
      method: "CASH",
      status: "PAID",
      reference: "CASH-20260218-001",
      paidAt: daysAgo(35),
      notes: "Pago en efectivo al check-out",
      reservationId: ID.res7,
      userId: ID.jose,
    },
  });

  counts["Payments"] = 5;

  // ═══════════════════════════════════════════════════════
  //  8. DAILY CHECKLISTS
  // ═══════════════════════════════════════════════════════

  // res1 — Luna activa, día 1 (ayer)
  await prisma.dailyChecklist.upsert({
    where: { reservationId_date: { reservationId: ID.res1, date: dateOnly(daysAgo(1)) } },
    update: { energy: "HIGH", mood: "EXCITED" },
    create: {
      id: ID.cl1,
      date: dateOnly(daysAgo(1)),
      energy: "HIGH",
      socialization: "SOCIAL",
      rest: "GOOD",
      mealsCompleted: true,
      walksCompleted: true,
      bathroomBreaks: true,
      playtime: true,
      socializationDone: true,
      mood: "EXCITED",
      feedingNotes: "Comió toda su ración sin problema",
      behaviorNotes: "Muy juguetona, se lleva bien con todos",
      additionalNotes: "Excelente primer día completo",
      photosCount: 3,
      videosCount: 1,
      reservationId: ID.res1,
      staffId: ID.jessica,
    },
  });

  // res1 — Luna activa, día 2 (hoy)
  await prisma.dailyChecklist.upsert({
    where: { reservationId_date: { reservationId: ID.res1, date: dateOnly(now) } },
    update: { energy: "MEDIUM", mood: "HAPPY" },
    create: {
      id: ID.cl2,
      date: dateOnly(now),
      energy: "MEDIUM",
      socialization: "SOCIAL",
      rest: "GOOD",
      mealsCompleted: true,
      mealsNotes: "Dejó un poco de la comida de la tarde",
      walksCompleted: true,
      bathroomBreaks: true,
      playtime: true,
      socializationDone: true,
      mood: "HAPPY",
      additionalNotes: "Día tranquilo, disfrutó mucho el patio",
      photosCount: 2,
      videosCount: 0,
      reservationId: ID.res1,
      staffId: ID.jessica,
    },
  });

  // res5 — Bella pasada, día 1 (adaptación, triste)
  await prisma.dailyChecklist.upsert({
    where: { reservationId_date: { reservationId: ID.res5, date: dateOnly(daysAgo(24)) } },
    update: { energy: "LOW", mood: "SAD" },
    create: {
      id: ID.cl3,
      date: dateOnly(daysAgo(24)),
      energy: "LOW",
      socialization: "ISOLATED",
      rest: "FAIR",
      mealsCompleted: false,
      mealsNotes: "No quiso comer en la mañana",
      walksCompleted: true,
      bathroomBreaks: true,
      playtime: false,
      socializationDone: false,
      mood: "SAD",
      feedingNotes: "Apenas comió la mitad de su ración",
      behaviorNotes: "Se ve nerviosa, se esconde",
      additionalNotes: "Primer día, periodo de adaptación normal",
      photosCount: 1,
      videosCount: 0,
      reservationId: ID.res5,
      staffId: ID.jessica,
    },
  });

  // res5 — Bella pasada, día 2 (mejorando)
  await prisma.dailyChecklist.upsert({
    where: { reservationId_date: { reservationId: ID.res5, date: dateOnly(daysAgo(23)) } },
    update: { energy: "MEDIUM", mood: "NEUTRAL" },
    create: {
      id: ID.cl4,
      date: dateOnly(daysAgo(23)),
      energy: "MEDIUM",
      socialization: "SELECTIVE",
      rest: "GOOD",
      mealsCompleted: true,
      walksCompleted: true,
      bathroomBreaks: true,
      playtime: true,
      socializationDone: false,
      mood: "NEUTRAL",
      feedingNotes: "Comió bien ambas raciones",
      behaviorNotes: "Más tranquila, acepta caricias",
      additionalNotes: "Mejorando notablemente",
      photosCount: 2,
      videosCount: 0,
      reservationId: ID.res5,
      staffId: ID.jessica,
    },
  });

  // res5 — Bella pasada, día 3 (feliz)
  await prisma.dailyChecklist.upsert({
    where: { reservationId_date: { reservationId: ID.res5, date: dateOnly(daysAgo(22)) } },
    update: { energy: "MEDIUM", mood: "HAPPY" },
    create: {
      id: ID.cl5,
      date: dateOnly(daysAgo(22)),
      energy: "MEDIUM",
      socialization: "SELECTIVE",
      rest: "GOOD",
      mealsCompleted: true,
      walksCompleted: true,
      bathroomBreaks: true,
      playtime: true,
      socializationDone: true,
      mood: "HAPPY",
      behaviorNotes: "Se acercó a socializar un poco",
      additionalNotes: "Bella ya se siente en casa",
      photosCount: 2,
      videosCount: 1,
      reservationId: ID.res5,
      staffId: ID.jessica,
    },
  });

  counts["DailyChecklists"] = 5;

  // ═══════════════════════════════════════════════════════
  //  9. BEHAVIOR TAGS
  // ═══════════════════════════════════════════════════════
  const behaviorTagFields = [
    {
      id: ID.bt1,
      tag: "SOCIABLE" as const,
      notes: "Se lleva excelente con otros perros de todos los tamaños",
      stayId: ID.res1,
      petId: ID.luna,
      staffId: ID.jessica,
    },
    {
      id: ID.bt2,
      tag: "CALM" as const,
      notes: "Obediente y tranquila durante paseos",
      stayId: ID.res1,
      petId: ID.luna,
      staffId: ID.jessica,
    },
    {
      id: ID.bt3,
      tag: "SHY" as const,
      notes: "Se esconde los primeros días, necesita tiempo de adaptación",
      stayId: ID.res5,
      petId: ID.bella,
      staffId: ID.jessica,
    },
    {
      id: ID.bt4,
      tag: "ANXIOUS" as const,
      notes: "Se pone nerviosa con perros grandes cerca",
      stayId: ID.res5,
      petId: ID.bella,
      staffId: ID.jessica,
    },
  ];

  for (const bt of behaviorTagFields) {
    await prisma.behaviorTag.upsert({
      where: { id: bt.id },
      update: { tag: bt.tag, notes: bt.notes },
      create: bt,
    });
  }
  counts["BehaviorTags"] = behaviorTagFields.length;

  // ═══════════════════════════════════════════════════════
  //  10. STAFF ALERTS
  // ═══════════════════════════════════════════════════════
  await prisma.staffAlert.upsert({
    where: { id: ID.alert1 },
    update: { isResolved: true },
    create: {
      id: ID.alert1,
      type: "NOT_EATING",
      description: "Bella no quiso comer en la mañana de su primer día. Monitoreando.",
      isResolved: true,
      resolvedAt: daysAgo(23),
      reservationId: ID.res5,
      petId: ID.bella,
      staffId: ID.jessica,
    },
  });
  counts["StaffAlerts"] = 1;

  // ═══════════════════════════════════════════════════════
  //  11. REVIEWS
  // ═══════════════════════════════════════════════════════
  await prisma.review.upsert({
    where: { reservationId: ID.res5 },
    update: { rating: 5 },
    create: {
      id: ID.review1,
      rating: 5,
      comment:
        "Excelente servicio! Bella llegó un poco nerviosa pero el equipo la cuidó increíblemente bien. Los reportes diarios me dieron mucha tranquilidad. Definitivamente volveremos.",
      reservationId: ID.res5,
      ownerId: ID.jose,
    },
  });
  counts["Reviews"] = 1;

  // ═══════════════════════════════════════════════════════
  //  12. NOTIFICACIONES
  // ═══════════════════════════════════════════════════════
  const notifFields = [
    {
      id: ID.notif7,
      type: "GENERAL" as const,
      title: "Bienvenida a HolidogInn",
      body: "Gracias por confiar en nosotros para el cuidado de tus mascotas. ¡Bienvenida a la familia HDI!",
      isRead: true,
      data: null,
      userId: ID.jose,
      createdAt: daysAgo(60),
    },
    {
      id: ID.notif4,
      type: "PAYMENT_RECEIVED" as const,
      title: "Pago recibido",
      body: "Hemos recibido tu pago de $800 para la estancia de Bella. ¡Gracias!",
      isRead: true,
      data: { reservationId: ID.res5 },
      userId: ID.jose,
      createdAt: daysAgo(21),
    },
    {
      id: ID.notif6,
      type: "CHECK_OUT" as const,
      title: "Check-out completado",
      body: "Bella ha completado su estancia. ¡Esperamos verte pronto!",
      isRead: true,
      data: { reservationId: ID.res5 },
      userId: ID.jose,
      createdAt: daysAgo(21),
    },
    {
      id: ID.notif1,
      type: "CHECK_IN" as const,
      title: "Check-in confirmado",
      body: "Luna ha sido registrada en la Suite VIP. ¡Que disfrute su estancia!",
      isRead: false,
      data: { reservationId: ID.res1 },
      userId: ID.jose,
      createdAt: daysAgo(2),
    },
    {
      id: ID.notif3,
      type: "RESERVATION_CONFIRMED" as const,
      title: "Reservación confirmada",
      body: "Tu reservación para Bella en Cuarto Pequeño B ha sido confirmada. ¡Te esperamos!",
      isRead: false,
      data: { reservationId: ID.res3 },
      userId: ID.jose,
      createdAt: daysAgo(1),
    },
    {
      id: ID.notif2,
      type: "NEW_UPDATE" as const,
      title: "Nueva foto de Luna",
      body: "El equipo de HolidogInn ha compartido una nueva foto de Luna.",
      isRead: false,
      data: { reservationId: ID.res1, stayUpdateId: ID.update2 },
      userId: ID.jose,
      createdAt: hoursAgo(1),
    },
    {
      id: ID.notif5,
      type: "DAILY_REPORT" as const,
      title: "Reporte diario de Luna",
      body: "El equipo ha completado el reporte del día de Luna. ¡Todo bien!",
      isRead: false,
      data: { reservationId: ID.res1 },
      userId: ID.jose,
      createdAt: new Date(),
    },
    {
      id: ID.notif8,
      type: "RESERVATION_REMINDER" as const,
      title: "Recordatorio de reservación",
      body: "La estancia de Bella en Cuarto Pequeño B comienza en 10 días. No olvides traer su cartilla de vacunación.",
      isRead: false,
      data: { reservationId: ID.res3 },
      userId: ID.jose,
      createdAt: new Date(),
    },
  ];

  for (const n of notifFields) {
    await prisma.notification.upsert({
      where: { id: n.id },
      update: { title: n.title, body: n.body, isRead: n.isRead },
      create: n,
    });
  }
  counts["Notifications"] = notifFields.length;

  // ═══════════════════════════════════════════════════════
  //  SERVICE TYPES + VARIANTS (Baño)
  // ═══════════════════════════════════════════════════════
  const bathService = await prisma.serviceType.upsert({
    where: { code: "BATH" },
    update: { name: "Baño", isActive: true },
    create: { code: "BATH", name: "Baño", isActive: true },
  });
  counts["ServiceTypes"] = 1;

  // Matriz: [petSize] → [base, +deslanado, +corte, +ambos]
  const bathPrices: Record<"S" | "M" | "L" | "XL", [number, number, number, number]> = {
    S: [300, 500, 500, 700],
    M: [350, 550, 550, 750],
    L: [450, 650, 650, 850],
    XL: [600, 800, 800, 1000],
  };

  const variantRows: Array<{
    petSize: "S" | "M" | "L" | "XL";
    deslanado: boolean;
    corte: boolean;
    price: number;
  }> = [];
  for (const [size, [noNo, siNo, noSi, siSi]] of Object.entries(bathPrices) as Array<
    ["S" | "M" | "L" | "XL", [number, number, number, number]]
  >) {
    variantRows.push({ petSize: size, deslanado: false, corte: false, price: noNo });
    variantRows.push({ petSize: size, deslanado: true, corte: false, price: siNo });
    variantRows.push({ petSize: size, deslanado: false, corte: true, price: noSi });
    variantRows.push({ petSize: size, deslanado: true, corte: true, price: siSi });
  }

  for (const v of variantRows) {
    await prisma.serviceVariant.upsert({
      where: {
        serviceTypeId_petSize_deslanado_corte: {
          serviceTypeId: bathService.id,
          petSize: v.petSize,
          deslanado: v.deslanado,
          corte: v.corte,
        },
      },
      update: { price: new Prisma.Decimal(v.price), isActive: true },
      create: {
        serviceTypeId: bathService.id,
        petSize: v.petSize,
        deslanado: v.deslanado,
        corte: v.corte,
        price: new Prisma.Decimal(v.price),
        isActive: true,
      },
    });
  }
  counts["ServiceVariants"] = variantRows.length;

  // ═══════════════════════════════════════════════════════
  //  RESUMEN
  // ═══════════════════════════════════════════════════════
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  console.log("\n✅ Seed completado exitosamente\n");
  console.log("┌────────────────────┬──────────┐");
  console.log("│ Tabla              │ Registros│");
  console.log("├────────────────────┼──────────┤");
  for (const [table, count] of Object.entries(counts)) {
    console.log(`│ ${table.padEnd(19)}│ ${String(count).padStart(9)}│`);
  }
  console.log("├────────────────────┼──────────┤");
  console.log(`│ ${"TOTAL".padEnd(19)}│ ${String(total).padStart(9)}│`);
  console.log("└────────────────────┴──────────┘");
}

seed()
  .catch((e) => {
    console.error("❌ Error ejecutando seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
