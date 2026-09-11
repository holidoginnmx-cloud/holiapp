import * as SecureStore from "expo-secure-store";

/**
 * Invitación a medio aceptar.
 *
 * La liga llega en el peor momento posible: a alguien que todavía no tiene
 * cuenta, o que la tiene pero antes de entrar le toca el claim, los
 * consentimientos o el tour, que hacen `router.replace` y se llevan de corbata
 * la pantalla de la invitación. Por eso la pantalla guarda aquí lo que traía
 * al abrirse, y el gate de onboarding (app/_layout.tsx) la vuelve a abrir
 * cuando ya no le queda ningún paso por mostrar.
 *
 * Se borra cuando la persona DECIDE: acepta, dice "ahora no", o sale de la
 * pantalla con la sesión ya iniciada (salir también es decidir). Sin sesión se
 * conserva: está yendo a registrarse.
 *
 * Hay un espejo en memoria porque el borrado de SecureStore es asíncrono y el
 * gate lee justo al volver a las pestañas: sin el espejo, el "atrás" podía
 * leer la llave antes de que se borrara y volver a abrir la invitación.
 *
 * Es global y no por usuario a propósito: la invitación es para quien tiene el
 * teléfono en la mano, entre o no con otra cuenta.
 */
const KEY = "pending-pet-invite";

/** undefined = todavía no se ha leído de SecureStore en esta sesión. */
let memo: string | null | undefined;

export async function savePendingInvite(key: string): Promise<void> {
  memo = key;
  await SecureStore.setItemAsync(KEY, key).catch(() => {});
}

export async function readPendingInvite(): Promise<string | null> {
  if (memo !== undefined) return memo;
  memo = await SecureStore.getItemAsync(KEY).catch(() => null);
  return memo;
}

export async function clearPendingInvite(): Promise<void> {
  memo = null;
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}
