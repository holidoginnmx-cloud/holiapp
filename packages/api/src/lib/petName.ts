/**
 * Nombre de mascota normalizado para COMPARAR — nunca para guardar.
 *
 * Los candados anti-duplicado (POST /pets y el alta de invitado del sitio)
 * buscaban con `equals ... mode: "insensitive"`, que ignora mayúsculas pero no
 * los espacios. El 26-ago-2026 eso partió el expediente de un beagle en dos:
 * la dueña capturó "DUGAN" en un intento y "DUGAN " —con un espacio final— en
 * el siguiente, y el candado no vio el duplicado.
 *
 * Normalizamos igual que compara una persona: sin espacios sobrantes en las
 * orillas, los internos colapsados a uno solo, y sin distinguir mayúsculas ni
 * acentos ("Muñeca" == "muneca", que es como el mismo perro acaba tecleado en
 * dos capturas distintas).
 */
export function normalizePetName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    // Marcas diacríticas del bloque Unicode "Combining Diacritical Marks":
    // quitarlas deja la letra base (é → e). La ñ se vuelve n, que es justo lo
    // que queremos para comparar.
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Busca en `pets` la primera mascota cuyo nombre choca con `name` ya
 * normalizado. Se filtra en memoria a propósito: la lista es la de UN dueño
 * (más las compartidas), o sea unidades, y así la regla vive en un solo lugar
 * en vez de repartirse entre SQL crudo y Prisma.
 */
export function findPetByName<T extends { name: string }>(
  pets: T[],
  name: string
): T | undefined {
  const target = normalizePetName(name);
  if (!target) return undefined;
  return pets.find((p) => normalizePetName(p.name) === target);
}
