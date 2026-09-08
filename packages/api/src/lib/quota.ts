/**
 * Cuotas en memoria de proceso, por llave arbitraria.
 *
 * Vivía dentro de `routes/users.ts` sirviendo solo al flujo de claim; se extrajo
 * aquí cuando el código de vinculación empezó a mandarse por SMS, porque ahí
 * cada intento CUESTA DINERO y hacía falta limitar también por número destino,
 * no solo por usuario.
 *
 * Por qué no basta la IP (el motivo original): los teléfonos salen por CG-NAT de
 * la operadora y varios clientes comparten IP, así que un límite por IP los
 * castiga a todos; y a la inversa, un solo usuario podía enumerar teléfonos.
 *
 * Es memoria de proceso: la API corre en una sola instancia y se pierde en cada
 * deploy. Para el SMS eso está asumido — el daño ya está acotado porque solo se
 * puede mandar a números que YA existen como ficha sin cuenta, y el freno de
 * gasto que sí sobrevive a los reinicios es el límite de facturación de Twilio.
 */

const quotas = new Map<string, { count: number; resetAt: number }>();

const MAX_ENTRIES = 5000;

/** Borra las entradas ya vencidas, que no protegen nada. */
function sweepExpired(now: number): void {
  for (const [key, val] of quotas) {
    if (val.resetAt <= now) quotas.delete(key);
  }
}

/** ¿Queda cupo para esta llave? Consume uno si sí. */
export function takeQuota(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = quotas.get(key);
  if (cur && cur.resetAt > now) {
    if (cur.count >= max) return false;
    cur.count += 1;
    return true;
  }
  // Llave nueva (o vencida). Antes de crearla hay que hacer sitio.
  if (quotas.size >= MAX_ENTRIES) {
    sweepExpired(now);
    // Si sigue lleno de entradas VIVAS, se niega en vez de desalojar. Desalojar
    // por antigüedad sería explotable: las entradas más viejas son justo las
    // que llevan más tiempo frenando a alguien, así que bastaría con generar
    // ruido para expulsar la cuota que estorba y volver a mandar SMS. 5000
    // llaves vivas en una ventana no es tráfico de este negocio, es abuso, y
    // ante la duda no se envía.
    if (quotas.size >= MAX_ENTRIES) {
      console.warn("[quota] mapa saturado — se niega la llave nueva");
      return false;
    }
  }
  quotas.set(key, { count: 1, resetAt: now + windowMs });
  return true;
}

/** Solo para los tests: deja el estado limpio entre casos. */
export function resetQuotas(): void {
  quotas.clear();
}
