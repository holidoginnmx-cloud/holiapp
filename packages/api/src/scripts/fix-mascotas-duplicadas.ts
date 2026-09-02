/**
 * Limpieza puntual del duplicado de "Dugan" (26-ago-2026) y de los nombres de
 * mascota con espacios sobrantes que lo hicieron posible.
 *
 * Contexto: los candados anti-duplicado comparaban el nombre tal cual, así que
 * "DUGAN" y "DUGAN " (con un espacio final) pasaban por perros distintos. La
 * dueña llenó el formulario del sitio dos veces —el primer intento no completó
 * el pago— y quedaron dos fichas del mismo beagle. El código ya está arreglado
 * (packages/api/src/lib/petName.ts); esto repara los datos que alcanzó a dejar.
 *
 * Qué hace:
 *   1. Normaliza el nombre de toda mascota con espacios de sobra (6 filas al
 *      2-sep-2026). Solo toca espacios: no cambia mayúsculas ni acentos.
 *   2. Desactiva la ficha VIEJA de Dugan (isActive=false). No se borra: el
 *      expediente que capturó la dueña en su primer intento sigue consultable,
 *      y así el `onDelete: Restrict` de las relaciones no estorba.
 *
 * La ficha vieja no tiene NADA colgando (0 reservas, 0 vacunas, 0
 * desparasitaciones, 0 co-dueños), así que no hay historial que migrar: la
 * reserva y las 4 vacunas están todas en la ficha que se conserva.
 *
 * Uso (desde packages/api):
 *   npx tsx --env-file=.env --env-file=../db/.env src/scripts/fix-mascotas-duplicadas.ts
 *   npx tsx --env-file=.env --env-file=../db/.env src/scripts/fix-mascotas-duplicadas.ts --aplicar
 *
 * Sin `--aplicar` solo reporta. OJO: el segundo `--env-file` gana, así que esto
 * habla con PRODUCCIÓN (ver packages/db/.env).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Las dos fichas del mismo beagle, de la clienta Claudia Gutiérrez Moloy.
const FICHA_VIEJA = "cmt9oscyw0021pj21xz4zwd1f"; // "DUGAN"  — sin foto, 0 reservas
const FICHA_BUENA = "cmt9rmnex002opj21r424824i"; // "DUGAN " — con foto, 1 reserva, 4 vacunas

// Espacios en las orillas o repetidos en medio.
const NOMBRE_SUCIO = `name <> regexp_replace(btrim(name), '\\s+', ' ', 'g')`;

async function main() {
  const aplicar = process.argv.includes("--aplicar");

  const sucios = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
    `SELECT id, name FROM pets WHERE ${NOMBRE_SUCIO} ORDER BY name`
  );
  console.log(`Nombres con espacios sobrantes: ${sucios.length}`);
  for (const p of sucios) console.log(`   ${JSON.stringify(p.name)}`);

  const fichas = await prisma.pet.findMany({
    where: { id: { in: [FICHA_VIEJA, FICHA_BUENA] } },
    select: {
      id: true,
      name: true,
      isActive: true,
      _count: { select: { reservations: true, vaccines: true, dewormings: true, coOwners: true } },
    },
  });
  console.log("\nFichas de Dugan:");
  for (const f of fichas) {
    const rol = f.id === FICHA_VIEJA ? "se desactiva" : "se conserva";
    console.log(
      `   ${JSON.stringify(f.name)} activo=${f.isActive} (${rol}) — ${JSON.stringify(f._count)}`
    );
  }

  const vieja = fichas.find((f) => f.id === FICHA_VIEJA);
  if (!vieja) {
    console.log("\nLa ficha vieja ya no existe. Nada que hacer.");
    return;
  }
  // Guarda: si alguien le colgó historial a la ficha vieja desde que se
  // diagnosticó esto, desactivarla lo escondería. Mejor parar y revisar.
  const colgando = Object.values(vieja._count).reduce((a, b) => a + b, 0);
  if (colgando > 0) {
    console.log(
      `\nABORTA: la ficha vieja ya tiene ${colgando} registros colgando. ` +
        `Hay que mover ese historial a ${FICHA_BUENA} antes de desactivarla.`
    );
    return;
  }

  if (!aplicar) {
    console.log("\n(simulación — corre otra vez con --aplicar para escribir)");
    return;
  }

  const limpiados = await prisma.$executeRawUnsafe(
    `UPDATE pets SET name = regexp_replace(btrim(name), '\\s+', ' ', 'g'), "updatedAt" = now()
     WHERE ${NOMBRE_SUCIO}`
  );
  await prisma.pet.update({ where: { id: FICHA_VIEJA }, data: { isActive: false } });

  const despues = await prisma.pet.findMany({
    where: { id: { in: [FICHA_VIEJA, FICHA_BUENA] } },
    select: { id: true, name: true, isActive: true },
  });
  console.log(`\nListo. Nombres limpiados: ${limpiados}`);
  for (const f of despues) console.log(`   ${JSON.stringify(f.name)} activo=${f.isActive}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
