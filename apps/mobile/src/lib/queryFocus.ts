import { focusManager } from "@tanstack/react-query";
import { AppState } from "react-native";

// React Query trae su detección de "foco de ventana" pensada para web
// (document.visibilityState), que en React Native no existe: sin este puente,
// `refetchOnWindowFocus` es INERTE aunque se ponga en true. Este módulo lo
// cablea a AppState para que volver de background cuente como enfocar.
//
// Importarlo tiene efecto SOLO donde se pide explícitamente: el default global
// sigue siendo `refetchOnWindowFocus: false` (ver lib/queryClient.ts), así que
// la frescura es opt-in con LIVE_OPS (ver lib/queryOptions.ts) y nada de lo
// demás empieza a refetchear al reabrir la app.
//
// Efecto de módulo a propósito (no un hook): la suscripción debe vivir tanto
// como el proceso, y no depende del árbol de React. Se importa una vez desde
// app/_layout.tsx. NO mezclar con el AppState del keep-fresh del token de Clerk
// que vive en ese archivo: ése limpia intervals y tiene su propio ciclo de vida.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (state) => {
    handleFocus(state === "active");
  });
  return () => sub.remove();
});
