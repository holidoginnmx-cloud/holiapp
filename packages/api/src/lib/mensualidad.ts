// ─────────────────────────────────────────────────────────────────────────────
//  Mensualidad del sistema — ¿Holidog debe la cuota de sus apps?
//
//  La cobranza NO vive aquí: la lleva Pasta (panel de cobranza del
//  desarrollador). Su endpoint `/api/externo/estado-mensualidad` dice qué
//  mensualidades ya vencieron (el cobro vence el día 15) y siguen sin pagar.
//  Registrar el pago en Pasta es lo que apaga el pop-up de la app y del panel.
//
//  Reglas:
//  - Caché en memoria de 5 min: los ADMIN abren la app muchas veces al día y
//    no hace falta preguntarle a Pasta cada vez.
//  - Si algo falla (faltan las env, Pasta caída, timeout, respuesta rara) se
//    contesta `pendiente: false`. Un problema de cobranza NUNCA debe estorbar
//    la operación del hotel. Los errores NO se cachean como "al corriente" más
//    de lo que dura un intento: se reintenta en el siguiente minuto.
//
//  Si cambia la forma de la respuesta, toca también la ruta de Pasta
//  (`~/Desktop/pasta-stats/app/api/externo/estado-mensualidad/route.ts`).
// ─────────────────────────────────────────────────────────────────────────────

export type CobroMensualidad = {
  periodo: string | null;
  concepto: string;
  saldo: number;
  fechaVencimiento: string;
};

export type DatosPago = { banco: string; titular: string; clabe: string };

export type EstadoMensualidad = {
  pendiente: boolean;
  cobros: CobroMensualidad[];
  datosPago: DatosPago | null;
};

const AL_CORRIENTE: EstadoMensualidad = { pendiente: false, cobros: [], datosPago: null };

const TTL_OK_MS = 5 * 60 * 1000;
const TTL_ERROR_MS = 60 * 1000;
const TIMEOUT_MS = 3000;

let cache: { valor: EstadoMensualidad; vence: number } | null = null;

/** Solo para tests. */
export function resetMensualidadCache(): void {
  cache = null;
}

export async function getEstadoMensualidad(
  fetchImpl: typeof fetch = fetch,
  ahora: number = Date.now(),
): Promise<EstadoMensualidad> {
  if (cache && cache.vence > ahora) return cache.valor;

  const valor = await consultarPasta(fetchImpl);
  cache = { valor: valor ?? AL_CORRIENTE, vence: ahora + (valor ? TTL_OK_MS : TTL_ERROR_MS) };
  return cache.valor;
}

/** null = no se pudo saber (se trata como al corriente). */
async function consultarPasta(fetchImpl: typeof fetch): Promise<EstadoMensualidad | null> {
  const base = process.env.PASTA_URL?.replace(/\/+$/, "");
  const secreto = process.env.PASTA_ESTADO_SECRET;
  const cliente = process.env.PASTA_CLIENTE_ID;
  if (!base || !secreto || !cliente) return null;

  try {
    const res = await fetchImpl(
      `${base}/api/externo/estado-mensualidad?cliente=${encodeURIComponent(cliente)}`,
      {
        headers: { Authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.error("[mensualidad] Pasta HTTP", res.status);
      return null;
    }
    return normalizar(await res.json());
  } catch (err) {
    console.error("[mensualidad] no se pudo consultar Pasta:", err);
    return null;
  }
}

function normalizar(body: unknown): EstadoMensualidad | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.pendiente !== "boolean" || !Array.isArray(b.cobros)) return null;

  const cobros: CobroMensualidad[] = b.cobros
    .filter(
      (c): c is Record<string, unknown> =>
        !!c &&
        typeof c === "object" &&
        typeof (c as any).saldo === "number" &&
        typeof (c as any).fechaVencimiento === "string",
    )
    .map((c) => ({
      periodo: typeof c.periodo === "string" ? c.periodo : null,
      concepto: typeof c.concepto === "string" ? c.concepto : "Mensualidad",
      saldo: c.saldo as number,
      fechaVencimiento: c.fechaVencimiento as string,
    }));

  const dp = b.datosPago as Record<string, unknown> | null | undefined;
  const datosPago =
    dp &&
    typeof dp.banco === "string" &&
    typeof dp.titular === "string" &&
    typeof dp.clabe === "string"
      ? { banco: dp.banco, titular: dp.titular, clabe: dp.clabe }
      : null;

  return { pendiente: b.pendiente && cobros.length > 0, cobros, datosPago };
}
