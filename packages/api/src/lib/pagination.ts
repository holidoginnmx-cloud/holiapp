/**
 * Paginación por cursor para las lecturas pesadas del API.
 *
 * Por qué existe: `GET /reservations` traía TODO el historial del hotel en
 * cada cambio de foco de la app, y `GET /notifications/:userId` la bandeja
 * completa cada 30 segundos. Con pocos clientes se aguanta; con muchos se cae.
 *
 * REGLA DE COMPATIBILIDAD (no negociable mientras haya binarios viejos allá
 * afuera): si la petición NO trae `limit` ni `cursor`, la respuesta debe salir
 * EXACTAMENTE como salía antes — un arreglo pelón, sin envoltorio y sin tope.
 * El OTA tarda días en llegar a todos los teléfonos; el que no lo tenga sigue
 * pidiendo sin parámetros y no se puede enterar del cambio. La paginación se
 * activa solo cuando el cliente la pide explícitamente.
 *
 * El cursor es el `id` de la última fila de la página anterior. Se paginan
 * consultas ordenadas por `createdAt desc` MÁS `id desc` como desempate: sin
 * ese segundo criterio el orden no es determinista (dos filas creadas en el
 * mismo milisegundo bailan entre página y página) y el cursor de Prisma
 * necesita un orden estable para no saltarse ni repetir filas.
 */

/** Página por defecto cuando el cliente manda `cursor` pero no `limit`. */
export const DEFAULT_PAGE_LIMIT = 50;

/** Tope duro: un cliente no puede pedir páginas arbitrariamente grandes. */
export const MAX_PAGE_LIMIT = 200;

export type PageRequest =
  | { paginated: false }
  | { paginated: true; limit: number; cursor?: string };

export type PageParse =
  | { ok: true; page: PageRequest }
  | { ok: false; error: string };

/** Los ids son cuid/uuid; cualquier otra cosa es basura o un intento de inyección. */
const CURSOR_RE = /^[A-Za-z0-9_-]{1,64}$/;

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Lee `?limit=` y `?cursor=` del querystring.
 *
 * - Sin ninguno de los dos → `{ paginated: false }` (respuesta legacy).
 * - `limit` inválido (no entero, o < 1) → error 400: si el cliente creyó estar
 *   paginando y le devolvemos todo, el bug se esconde justo donde duele.
 * - `limit` mayor al tope → se recorta al tope (no es error del cliente).
 * - `cursor` sin `limit` → pagina con `defaultLimit`.
 */
export function parsePageRequest(
  query: { limit?: string | number | undefined; cursor?: string | undefined },
  opts: { defaultLimit?: number; maxLimit?: number } = {}
): PageParse {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = opts.maxLimit ?? MAX_PAGE_LIMIT;

  const rawLimit = query.limit;
  const rawCursor = query.cursor;

  if (isBlank(rawLimit) && isBlank(rawCursor)) {
    return { ok: true, page: { paginated: false } };
  }

  let limit = defaultLimit;
  if (!isBlank(rawLimit)) {
    const n = typeof rawLimit === "number" ? rawLimit : Number(String(rawLimit).trim());
    if (!Number.isInteger(n) || n < 1) {
      return {
        ok: false,
        error: `El parámetro "limit" debe ser un entero entre 1 y ${maxLimit}`,
      };
    }
    limit = Math.min(n, maxLimit);
  }

  let cursor: string | undefined;
  if (!isBlank(rawCursor)) {
    const c = String(rawCursor).trim();
    if (!CURSOR_RE.test(c)) {
      return { ok: false, error: 'El parámetro "cursor" no es un id válido' };
    }
    cursor = c;
  }

  return { ok: true, page: { paginated: true, limit, cursor } };
}

/**
 * Argumentos de Prisma para la página. Pide UNA fila de más: es como se sabe
 * si hay siguiente página sin pagar un `count()` sobre toda la tabla.
 *
 * Cuando no hay paginación devuelve `{}`, para que el `findMany` de siempre
 * quede byte por byte igual al de antes.
 */
export function prismaPageArgs(page: PageRequest): {
  take?: number;
  cursor?: { id: string };
  skip?: number;
} {
  if (!page.paginated) return {};
  return {
    take: page.limit + 1,
    // `skip: 1` porque el cursor apunta a la ÚLTIMA fila ya entregada: sin él
    // la primera fila de cada página vendría repetida.
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  };
}

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * Corta la fila extra y saca el cursor siguiente.
 *
 * OJO: se le pasan las filas CRUDAS, antes de cualquier filtro de la ruta (por
 * ejemplo el que descarta reservas con FK huérfana). El cursor tiene que ser
 * el id de la última fila LEÍDA; si saliera de la lista ya filtrada y esa
 * última fila estuviera rota, la siguiente página empezaría más atrás y
 * repetiría todo un tramo.
 */
export function buildPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? last.id : null,
    hasMore,
  };
}
