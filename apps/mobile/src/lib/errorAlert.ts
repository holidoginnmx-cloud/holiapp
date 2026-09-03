import { Alert } from "react-native";
import {
  esSesionExpirada,
  mensajeDeError,
  tituloDeError,
} from "@/lib/errorMessages";

export type OpcionesDeAlerta = {
  /** Título del Alert. Por defecto se deduce del error ("Sin conexión", …). */
  titulo?: string;
  /** Mensaje propio de la pantalla cuando el error no dice nada útil. */
  respaldo?: string;
  /** Se ejecuta al cerrar la alerta. */
  onClose?: () => void;
};

/**
 * Muestra un error de API como `Alert`, ya traducido.
 *
 * Lo importante que hace y que los 84 `Alert.alert("Error", e.message)` no
 * hacían: si el 401 ya disparó el cierre de sesión, NO saca alerta. Esa alerta
 * saldría encima de la navegación al login (y multiplicada por cada query que
 * falló a la vez), dejando al usuario cerrando avisos sobre la pantalla de
 * inicio de sesión.
 *
 * Devuelve true si llegó a mostrar algo.
 */
export function alertaDeError(error: unknown, opts?: OpcionesDeAlerta): boolean {
  if (esSesionExpirada(error)) return false;
  Alert.alert(
    opts?.titulo ?? tituloDeError(error),
    mensajeDeError(error, opts?.respaldo),
    opts?.onClose ? [{ text: "Entendido", onPress: opts.onClose }] : undefined,
  );
  return true;
}
