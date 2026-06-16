# Parches y overrides de dependencias

Este proyecto aplica parches a dependencias vía [`patch-package`](https://github.com/ds300/patch-package)
(corre en `postinstall`: `"postinstall": "patch-package || true"`). Documenta aquí
cada parche y override **por qué existe** y **cuándo se puede quitar**, para que no
se eliminen por accidente ni se queden indefinidamente.

> Tras cualquier `npm install`, `patch-package` re-aplica los parches de `patches/`.
> Si un parche deja de aplicar (cambió la versión de la dependencia), `patch-package`
> avisa: revisa este archivo y regenera el parche con `npx patch-package <paquete>`.

## `patches/react-native+0.81.5.patch`

**Qué hace:** fuerza a `react-native/scripts/react-native-xcode.sh` a empaquetar
**JS crudo** (no bytecode Hermes) en el build nativo de iOS, cambiando
`if [[ $USE_HERMES == false ]]` por `if [[ $USE_HERMES == false || true ]]`.

**Por qué:** `hermesc` 0.81.5 crashea al compilar nuestro bundle con el bug
"Operand must dominate the Instruction" en varias funciones. Enviando JS crudo,
el motor Hermes lo interpreta en runtime y la app arranca igual.

**Costo:** bundle algo más grande y arranque ligeramente más lento (sin
precompilación a bytecode) **solo en el build nativo de iOS**. Nota: `expo export`
(bundle OTA) sí genera `.hbc` normal — el parche solo afecta el script de Xcode.

**Cuándo quitarlo:** cuando una versión de Hermes / Expo SDK corrija el crash del
compilador. Probar quitándolo y haciendo un build EAS de iOS; si `hermesc` ya no
crashea, eliminar el parche.

## `patches/expo-router+6.0.23.patch`

**Qué hace:** elimina la llamada `alert(msg)` dentro de `throwOrAlert` en
`expo-router/build/head/url.js` para builds de producción (deja solo
`console.error`).

**Por qué:** evita que un error interno de `expo-router/head` dispare un `alert()`
nativo intrusivo al usuario final en producción.

**Cuándo quitarlo:** si Expo Router agrega una opción para silenciar ese alert, o
si el code path deja de ser relevante. Es un cambio cosmético de bajo riesgo.

## Override: `expo-crypto` → `~15.0.8` (en `package.json` raíz)

**Qué hace:** fija `expo-crypto` a la versión de SDK 54 (`~15.0.8`) en todo el
árbol de dependencias.

**Por qué:** `expo-auth-session` arrastra un `expo-crypto@55.x` anidado incompatible
con SDK 54. El override + la regla en `apps/mobile/metro.config.js`
(`config.resolver.extraNodeModules["expo-crypto"]`) garantizan que Metro resuelva
siempre la copia correcta.

**Cuándo quitarlo:** al subir de Expo SDK; verificar que `expo-auth-session` ya
dependa de un `expo-crypto` compatible y que `expo start`/build funcionen sin el
override ni la regla de metro.
