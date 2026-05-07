import { prisma } from "./src/index";

async function main() {
  const items = [
    { code: "RABIES_1Y", displayName: "Rabia (1 año)", defaultDurationDays: 365 },
    { code: "RABIES_3Y", displayName: "Rabia (3 años)", defaultDurationDays: 1095 },
    { code: "DHPP_1Y", displayName: "DHPP (1 año)", defaultDurationDays: 365 },
    { code: "DHPP_3Y", displayName: "DHPP (3 años)", defaultDurationDays: 1095 },
    { code: "BORDETELLA_INJ", displayName: "Bordetella inyectable", defaultDurationDays: 365 },
    { code: "BORDETELLA_ORAL", displayName: "Bordetella oral", defaultDurationDays: 180 },
    { code: "LEPTOSPIROSIS", displayName: "Leptospirosis", defaultDurationDays: 365 },
    { code: "INFLUENZA", displayName: "Influenza canina", defaultDurationDays: 365 },
    { code: "PARVOVIRUS", displayName: "Parvovirus (refuerzo)", defaultDurationDays: 365 },
  ];
  for (const c of items) {
    await prisma.vaccineCatalog.upsert({
      where: { code: c.code },
      update: { displayName: c.displayName, defaultDurationDays: c.defaultDurationDays },
      create: c,
    });
  }
  const all = await prisma.vaccineCatalog.findMany({ orderBy: { displayName: "asc" } });
  console.log(`Sembrados ${all.length} tipos de vacuna:`);
  for (const v of all) {
    console.log(`  - ${v.displayName} (${v.code}) -> ${v.defaultDurationDays} dias`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
