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

// Palabras que no distinguen a un perro: "La Chula" y "La Güera" no son el mismo.
const RELLENO = new Set(["el", "la", "los", "las", "mi", "don", "dona", "sr", "sra", "lil", "baby"]);

/**
 * La palabra que identifica al perro: la primera que no sea relleno, y solo si
 * tiene 3 letras o más. El equipo captura "Drago Castro" y el cliente escribe
 * "Drago"; "" = no alcanza para decir que son el mismo.
 */
export function claveNombre(nombre: string | null | undefined): string {
  const palabra = normalizePetName(nombre)
    .split(/[^a-z0-9]+/)
    .find((t) => t && !RELLENO.has(t));
  return palabra && palabra.length >= 3 ? palabra : "";
}

/**
 * Como `findPetByName`, pero también atrapa al mismo perro capturado con otro
 * apellido: "SKY" y "Sky Velazquez" eran la misma Chihuahua (sep-2026) y el
 * candado exacto la dejó pasar. Solo para AVISAR y dejar forzar — nunca para
 * reusar una ficha sin preguntar ("Toby" y "Toby II" pueden ser dos perros).
 */
export function findSimilarPetByName<T extends { name: string }>(
  pets: T[],
  name: string
): { pet: T; exacto: boolean } | undefined {
  const exacto = findPetByName(pets, name);
  if (exacto) return { pet: exacto, exacto: true };
  const clave = claveNombre(name);
  if (!clave) return undefined;
  const parecido = pets.find((p) => claveNombre(p.name) === clave);
  return parecido ? { pet: parecido, exacto: false } : undefined;
}
