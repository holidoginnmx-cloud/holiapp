/**
 * Recalcula `pets.size` a partir del peso con la ÚNICA escala de talla
 * (`sizeFromWeight` de @holidoginn/shared: S ≤ 5 kg · M ≤ 15 · L ≤ 24 · XL).
 *
 * Contexto: la talla se escribía con TRES escalas según quién capturó la
 * ficha — shared (app móvil/API), `calcularSize` del admin web (XS < 5, S < 10,
 * M < 20, L ≤ 35) y lo que mandara el cliente. Como `size` gobierna
 * `rooms.sizeAllowed` y la variante de baño, un perro de 12 kg podía ser "S"
 * en el panel y "M" en la app. Desde esta entrega el API deriva la talla del
 * peso en toda escritura (routes/pets.ts, lib/guestPet.ts); esto repara las
 * fichas que ya estaban.
 *
 * Qué hace: para toda mascota CON peso, si `size` no coincide con
 * `sizeFromWeight(weight)`, la actualiza. Las mascotas sin peso no se tocan
 * (no hay de dónde derivar). Un solo UPDATE por SQL.
 *
 * ⚠️ ANTES DE APLICARLO, LEE ESTO. `size` no es una etiqueta: es el filtro con
 * el que se asigna cuarto (`rooms.sizeAllowed`). La escala de shared NO
 * coincide con la que documenta el enum en schema.prisma (XS <5, S 5-10,
 * M 10-20, L 20-35, XL >35), que es con la que se configuraron los cuartos.
 * En el padrón de sep-2026 esto reclasificaba 83 fichas, y las 30 que pasan de
 * L a XL (24-35 kg) dejaban de caber en los cuartos 09-18: el hotel perdería
 * capacidad para ellas. Correrlo es una DECISIÓN DE OPERACIÓN, no de código:
 * o se acepta esa reclasificación, o antes se amplía el `sizeAllowed` de esos
 * cuartos. La simulación imprime el reparto exacto para decidir.
 *
 * Las mascotas con una estancia CONFIRMED o CHECKED_IN cuyo cuarto no admita
 * la talla nueva se listan aparte y NO se tocan (misma regla que
 * `lib/petSize.ts` en las escrituras del API): normalizar la escala nunca debe
 * sacar a un perro del cuarto donde está durmiendo.
 *
 * `updatedAt` SÍ cambia: `pets` tiene un trigger BEFORE UPDATE
 * (`trg_pets_updated_at`) que lo sella aunque el UPDATE no lo mencione.
 *
 * Uso (desde packages/api):
 *   npm run fix:pet-sizes                 # simulación (--dry-run, default)
 *   npm run fix:pet-sizes -- --apply      # escribe
 *
 *   o directo:
 *   npx tsx --env-file=.env src/scripts/fix-pet-sizes.ts [--dry-run|--apply]
 *
 * OJO: `.env` de packages/api apunta a LOCAL; para producción hay que pasar el
 * `.env` de packages/db como segundo `--env-file` (el último gana), igual que
 * en fix-checkin-anchor.ts.
 */
import { PrismaClient } from "@prisma/client";
import { SIZE_RANGES_KG, sizeFromWeight } from "@holidoginn/shared";

const prisma = new PrismaClient();

type Fila = {
  id: string;
  name: string;
  weight: number;
  size: string;
  isActive: boolean;
};

/**
 * La misma escala que `sizeFromWeight`, pero en SQL, para que el UPDATE sea
 * uno solo y no dependa del número de filas. Se arma desde SIZE_RANGES_KG
 * para que no pueda divergir de shared.
 */
function sizeCaseSql(): string {
  const whens = SIZE_RANGES_KG.filter((r) => r.upToKg != null)
    .map((r) => `WHEN weight <= ${r.upToKg} THEN '${r.size}'`)
    .join(" ");
  const last = SIZE_RANGES_KG[SIZE_RANGES_KG.length - 1].size;
  return `(CASE ${whens} ELSE '${last}' END)::"PetSize"`;
}

async function main() {
  const aplicar = process.argv.includes("--apply");
  if (aplicar && process.argv.includes("--dry-run")) {
    throw new Error("--dry-run y --apply son excluyentes");
  }

  const filas = await prisma.$queryRaw<Fila[]>`
    SELECT id, name, weight, size::text AS size, "isActive"
    FROM pets
    WHERE weight IS NOT NULL
    ORDER BY "createdAt"
  `;

  const todos = filas
    .map((p) => ({ ...p, nuevo: sizeFromWeight(p.weight) }))
    .filter((p) => p.nuevo !== p.size);

  // Mascotas con estancia activa cuyo cuarto NO admite la talla nueva: se
  // quedan como están (ver el aviso de la cabecera).
  const protegidas = await prisma.$queryRaw<{ id: string; name: string; cuarto: string }[]>`
    SELECT DISTINCT p.id, p.name, r.name AS cuarto
    FROM reservations res
    JOIN pets  p ON p.id = res."petId"
    JOIN rooms r ON r.id = res."roomId"
    WHERE res.status IN ('CONFIRMED', 'CHECKED_IN')
      AND p.weight IS NOT NULL
      AND NOT (
        (CASE
           WHEN p.weight <= 5  THEN 'S'
           WHEN p.weight <= 15 THEN 'M'
           WHEN p.weight <= 24 THEN 'L'
           ELSE 'XL'
         END)::"PetSize" = ANY (r."sizeAllowed")
      )
  `;
  const protegidasIds = new Set(protegidas.map((p) => p.id));
  const cambios = todos.filter((p) => !protegidasIds.has(p.id));

  console.log(
    `Mascotas con peso: ${filas.length}. Con talla distinta a la escala de shared: ${todos.length}`
  );
  for (const p of cambios) {
    console.log(
      `   ${p.id}  ${p.name}${p.isActive ? "" : " (inactiva)"}  ${p.weight} kg  ${p.size} → ${p.nuevo}`
    );
  }
  if (protegidas.length > 0) {
    console.log(
      `\nNO se tocan (estancia activa en un cuarto que no admite la talla nueva): ${protegidas.length}`
    );
    for (const p of protegidas) console.log(`   ${p.name} — ${p.cuarto}`);
  }

  // Reparto por transición, para decidir con números (ver la cabecera).
  const porTransicion = new Map<string, number>();
  for (const p of cambios) {
    const k = `${p.size} → ${p.nuevo}`;
    porTransicion.set(k, (porTransicion.get(k) ?? 0) + 1);
  }
  console.log("\nReparto:");
  for (const [k, n] of [...porTransicion].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k}: ${n}`);
  }

  if (cambios.length === 0) {
    console.log("\nNada que normalizar.");
    return;
  }

  if (!aplicar) {
    console.log(
      `\n(simulación — ${cambios.length} mascotas; corre otra vez con --apply para escribir)`
    );
    return;
  }

  // Un solo UPDATE (SQL crudo): recalcula con la MISMA escala en SQL, solo
  // toca las filas cuya talla difiere y respeta a las protegidas.
  const caseSql = sizeCaseSql();
  const excluir =
    protegidas.length > 0
      ? `AND id NOT IN (${protegidas.map((p) => `'${p.id}'`).join(", ")})`
      : "";
  const hechos = await prisma.$executeRawUnsafe(`
    UPDATE pets
    SET size = ${caseSql}
    WHERE weight IS NOT NULL
      AND size <> ${caseSql}
      ${excluir}
  `);

  const restantes = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT count(*)::bigint AS n
    FROM pets
    WHERE weight IS NOT NULL
      AND size <> ${caseSql}
  `);
  console.log(
    `\nListo. Tallas normalizadas: ${hechos} (pendientes: ${Number(restantes[0]?.n ?? 0)}).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
