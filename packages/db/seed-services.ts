import { prisma } from "./src/index";
import { Prisma } from "@prisma/client";

async function seedServices() {
  const bathService = await prisma.serviceType.upsert({
    where: { code: "BATH" },
    update: { name: "Baño", isActive: true },
    create: { code: "BATH", name: "Baño", isActive: true },
  });

  // Precio del baño base por tamaño de mascota. El precio del deslanado/corte
  // lo define el staff después del servicio según el estado del pelaje y se
  // cobra aparte (no suma al precio base de la variante).
  const BATH_BASE_PRICE: Record<"S" | "M" | "L" | "XL", number> = {
    S: 300,
    M: 350,
    L: 450,
    XL: 600,
  };
  const bathPrices: Record<"S" | "M" | "L" | "XL", [number, number, number, number]> = {
    S:  [BATH_BASE_PRICE.S,  BATH_BASE_PRICE.S,  BATH_BASE_PRICE.S,  BATH_BASE_PRICE.S],
    M:  [BATH_BASE_PRICE.M,  BATH_BASE_PRICE.M,  BATH_BASE_PRICE.M,  BATH_BASE_PRICE.M],
    L:  [BATH_BASE_PRICE.L,  BATH_BASE_PRICE.L,  BATH_BASE_PRICE.L,  BATH_BASE_PRICE.L],
    XL: [BATH_BASE_PRICE.XL, BATH_BASE_PRICE.XL, BATH_BASE_PRICE.XL, BATH_BASE_PRICE.XL],
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
