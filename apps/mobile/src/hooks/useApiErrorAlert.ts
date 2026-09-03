import { useCallback } from "react";
import { alertaDeError, type OpcionesDeAlerta } from "@/lib/errorAlert";

/**
 * Azúcar para pantallas: `const mostrarError = useApiErrorAlert();` y luego
 * `onError: (e) => mostrarError(e, { respaldo: "No se pudo guardar" })`.
 *
 * La referencia es estable, así que se puede pasar a un `useMutation` sin
 * recrear la mutación en cada render.
 *
 * Si no estás dentro de un componente, usa `alertaDeError` directamente: es la
 * misma función.
 */
export function useApiErrorAlert() {
  return useCallback(
    (error: unknown, opts?: OpcionesDeAlerta) => alertaDeError(error, opts),
    [],
  );
}
