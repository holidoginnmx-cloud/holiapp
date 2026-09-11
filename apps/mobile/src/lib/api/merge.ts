import type { Pet, User } from "@holidoginn/shared";
import { apiFetch } from "./client";

// ─── Juntar lo capturado dos veces (solo ADMIN) ──────────────

/** El perro `fromId` se junta en `intoId`, que se queda con su historial y
 * recibe lo del otro. `useSourceName`: quedarse con el nombre de `fromId`. */
export const mergePets = (fromId: string, intoId: string, useSourceName: boolean) =>
  apiFetch<Pet>(`/admin/pets/${fromId}/merge`, {
    method: "POST",
    body: JSON.stringify({ intoId, useSourceName }),
  });

/** La ficha de cliente `fromId` (sin app) se junta en `intoId`, que se queda.
 * `telefono`: de cuál se queda el teléfono cuando las dos tienen uno. */
export const mergeClients = (fromId: string, intoId: string, telefono: "from" | "into" = "into") =>
  apiFetch<User>(`/admin/users/${fromId}/merge`, {
    method: "POST",
    body: JSON.stringify({ intoId, telefono }),
  });
