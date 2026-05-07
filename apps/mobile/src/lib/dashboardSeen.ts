import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState, useCallback } from "react";

// Persistencia local de "último contador visto" por usuario+tarjeta.
// Sirve para resaltar tarjetas del dashboard cuando llegan entradas nuevas.
//
// Política:
// - badge = max(0, currentCount - lastSeenCount).
// - Si nunca se vio (primer launch): inicializamos lastSeen con el primer valor
//   recibido para no mostrar un badge falso desde el inicio.
// - markSeen(key, count) lo llama el caller cuando entra al detalle.

function storageKey(userId: string, card: string): string {
  // SecureStore requiere alfanumérico + . _ -
  return `dashSeen_${userId}_${card}`;
}

async function readLastSeen(userId: string, card: string): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(storageKey(userId, card));
    if (raw == null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function writeLastSeen(userId: string, card: string, count: number) {
  try {
    await SecureStore.setItemAsync(storageKey(userId, card), String(count));
  } catch {
    // ignore — el badge solo es UX, fallar silenciosamente no rompe nada
  }
}

/**
 * Hook que computa el badge "nuevos desde la última visita" para cada tarjeta.
 *
 * Pasa un objeto `{ cardKey: currentCount }` y recibe `{ cardKey: badgeNumber }`
 * más una función `markSeen(cardKey)` para limpiar el badge al entrar al detalle.
 */
export function useDashboardSeen(
  userId: string | null,
  counts: Record<string, number | undefined>
): {
  badges: Record<string, number>;
  markSeen: (cardKey: string) => void;
} {
  const [seen, setSeen] = useState<Record<string, number | null>>({});
  // Las claves que ya leímos (o intentamos leer) para no inicializar dos veces.
  const initializedRef = useRef<Set<string>>(new Set());

  // Carga inicial por clave: si aún no existe en SecureStore, la inicializamos
  // con el primer valor disponible para no inflar el badge en el primer login.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      for (const [key, count] of Object.entries(counts)) {
        if (count == null || initializedRef.current.has(key)) continue;
        initializedRef.current.add(key);
        const stored = await readLastSeen(userId, key);
        if (cancelled) return;
        if (stored == null) {
          // Primera vez: tomar el snapshot actual como referencia.
          await writeLastSeen(userId, key, count);
          setSeen((s) => ({ ...s, [key]: count }));
        } else {
          setSeen((s) => ({ ...s, [key]: stored }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, counts]);

  const markSeen = useCallback(
    (cardKey: string) => {
      if (!userId) return;
      const current = counts[cardKey];
      if (current == null) return;
      setSeen((s) => ({ ...s, [cardKey]: current }));
      writeLastSeen(userId, cardKey, current);
    },
    [userId, counts]
  );

  const badges: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts)) {
    if (count == null) {
      badges[key] = 0;
      continue;
    }
    const last = seen[key];
    badges[key] = last == null ? 0 : Math.max(0, count - last);
  }

  return { badges, markSeen };
}
