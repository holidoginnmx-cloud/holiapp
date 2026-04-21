import { prisma } from "./src/index";
import { Prisma } from "@prisma/client";

async function seedServices() {
  const bathService = await prisma.serviceType.upsert({
    where: { code: "BATH" },
    update: { name: "Baño", isActive: true },
    create: { code: "BATH", name: "Baño", isActive: true },
  });

  // [base, +deslanado, +corte, +ambos]
  const bathPrices: Record<"S" | "M" | "L" | "XL", [number, number, number, number]> = {
    S:  [300, 500, 500,  700],
    M:  [350, 550, 550,  750],
    L:  [450, 650, 650,  850],
    XL: [600, 800, 800, 1000],
  };

  let created = 0;
  for (const [size, [noNo, siNo, noSi, siSi]] of Object.entries(bathPrices) as Array<
    ["S" | "M" | "L" | "XL", [number, number, number, number]]
  >) {
    const variants = [
      { deslanado: false, corte: false, price: noNo },
      { deslanado: true,  corte: false, price: siNo },
      { deslanado: false, corte: true,  price: noSi },
      { deslanado: true,  corte: true,  price: siSi },
    ];
    for (const v of variants) {
      await prisma.serviceVariant.upsert({
        where: {
          serviceTypeId_petSize_deslanado_corte: {
            serviceTypeId: bathService.id,
            petSize: size,
            deslanado: v.deslanado,
            corte: v.corte,
          },
        },
        update: { price: new Prisma.Decimal(v.price), isActive: true },
        create: {
          serviceTypeId: bathService.id,
          petSize: size,
          deslanado: v.deslanado,
          corte: v.corte,
          price: new Prisma.Decimal(v.price),
          isActive: true,
        },
      });
      created++;
    }
  }

  console.log(`✅ Servicio BATH creado con ${created} variantes de precio.`);
}

seedServices()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
