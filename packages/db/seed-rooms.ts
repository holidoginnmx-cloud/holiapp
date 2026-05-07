import { prisma } from "./src/index";

// Crea (o actualiza) los cuartos "Cuarto 01" … "Cuarto 20".
// Idempotente: vuelve a correrlo cuantas veces quieras sin duplicar.
// IDs deterministas para que los upserts pisen siempre el mismo registro.
async function seedRooms() {
  const ALL_SIZES = ["XS", "S", "M", "L", "XL"] as const;
  const TOTAL = 20;

  let created = 0;
  let updated = 0;
  for (let i = 1; i <= TOTAL; i++) {
    const num = String(i).padStart(2, "0");
    const id = `seed_room_${num}`;
    const name = `Cuarto ${num}`;

    const existing = await prisma.room.findUnique({ where: { id } });
    await prisma.room.upsert({
      where: { id },
      update: { name },
      create: {
        id,
        name,
        capacity: 1,
        sizeAllowed: [...ALL_SIZES],
        isActive: true,
      },
    });
    if (existing) updated++;
    else created++;
  }

  console.log(`✅ Cuartos: ${created} creados, ${updated} actualizados.`);
}

seedRooms()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
