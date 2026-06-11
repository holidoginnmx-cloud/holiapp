import { useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Text as SvgText, TSpan } from "react-native-svg";
import { PawPrint } from "./PawPrint";
import { DogBed } from "./DogBed";

/* ────────────────────────────────────────────────────────────────────────
 * AJUSTES — todo lo que normalmente querrás tocar vive aquí arriba.
 * ──────────────────────────────────────────────────────────────────────── */

/** Colores de marca (fondo blanco, texto teal, naranja para huella + cama). */
const COLOR = {
  background: "#FFFFFF",
  text: "#1A4D5C",
  accent: "#E89A2C",
} as const;

/** Tamaños del logotipo en su espacio de diseño (luego se escala a pantalla). */
const SIZE = {
  base: 58, // "holi" / "inn" (Baloo 2)
  script: 66, // "d" / "g" (Pacifico)
  paw: 48, // huella que hace de "o"
  bedW: 80,
  bedH: 89,
};

/**
 * Layout del wordmark en SVG (unidades = px; viewBox 1:1 con width/height para no
 * escalar). El texto va en <Text>/<TSpan> de react-native-svg, que NO recorta los
 * glifos por "cajas de línea" como el <Text> de RN → por eso la "d" y la "g" ya
 * NO se cortan (el Svg solo recorta a su frame width×height, que dejamos holgado).
 * Cada línea tiene UNA baseline (atributo y) → "holi/d/g" quedan alineados.
 *
 * Todos estos números están también en el preview HTML (mismos valores) para que
 * los afines viéndolo en el navegador.
 */
const WORD = {
  // Fila 1 "holidog": holi (Baloo) + d (Pacifico) + hueco + g (Pacifico).
  // h=116 deja ~12px bajo la cola de la "g" (con 110 quedaban 6px, justo).
  line1: { w: 260, h: 116, baselineY: 74 },
  // Fila 2 "inn".
  line2: { w: 110, h: 74, baselineY: 54 },
  pawGap: 39, // hueco (dx) entre "d" y "g" donde cae la huella
  pawLeft: 117, // posición X de la huella (overlay) dentro de la fila 1
  pawBottom: 38, // posición Y (desde abajo) de la huella dentro de la fila 1
  // Cama: posición ABSOLUTA dentro de la fila 2 (no afecta a "inn" al moverla).
  bedLeft: 77, // X de la cama relativa al inicio de "inn"
  bedTop: -5, // Y de la cama (desde arriba de la fila 2); +baja, −sube
};

/**
 * Espaciado entre letras del bold ("holi"/"inn"), como el logo original.
 *
 * ⚠️ Es STRING ("-3.5") a propósito: react-native-svg 15.12.1 tiene un BUG en
 * iOS (RNSVGFontData.mm) — si `letterSpacing` se pasa como NÚMERO, lo asigna por
 * error a `wordSpacing` y el texto NO se aprieta (en web/Android sí). Pasarlo
 * como string cae por la rama correcta y sí aplica. No lo cambies a número.
 */
const LETTER_SPACING = "-3.5";

/**
 * Desplazamiento para CENTRAR el dibujo en pantalla. La caja de layout del logo
 * es más ancha que el dibujo real (marco SVG holgado), así que al centrar la caja
 * el dibujo queda corrido a la izquierda; esto lo recoloca. Afínalo en el HTML
 * (botón "Centrar" o sliders Logo X/Y).
 */
const LOGO_NUDGE = { x: 30, y: 0 };

/** Duración nominal total (ms). El prop `duration` reescala todas las fases. */
const DEFAULT_DURATION = 4500;

/**
 * Línea de tiempo (ms a duración por defecto). Se multiplican por `k` para
 * respetar el prop `duration`. Editar aquí cambia el ritmo de cada fase.
 */
const T = {
  textFade: 800, // fade-in del texto
  pawStart: 650, // cuándo entra la huella
  bedStart: 1700, // cuándo empieza a "llenarse" la cama
  bedFill: 1500, // cuánto dura el llenado
  glowStart: 3300,
  glow: 900,
  end: 4400, // cuándo se dispara onAnimationComplete
};

const REFERENCE_WIDTH = 390; // ancho de pantalla de referencia para escalar

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max);

export interface AnimatedSplashProps {
  /** Se invoca una vez cuando termina la animación (útil para ocultar el splash). */
  onAnimationComplete?: () => void;
  /** Duración total aproximada en ms (reescala todas las fases). */
  duration?: number;
  /** Repetir en bucle. `onAnimationComplete` se dispara solo en el 1er ciclo. */
  loop?: boolean;
  /** Brillo/pulso sutil sobre los elementos naranjas al final. */
  glow?: boolean;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  /** Familias tipográficas (deben estar cargadas vía expo-font). */
  boldFontFamily?: string;
  scriptFontFamily?: string;
  style?: ViewStyle;
}

export function AnimatedSplash({
  onAnimationComplete,
  duration = DEFAULT_DURATION,
  loop = false,
  glow = true,
  backgroundColor = COLOR.background,
  textColor = COLOR.text,
  accentColor = COLOR.accent,
  boldFontFamily = "Baloo2_800ExtraBold",
  scriptFontFamily = "Pacifico_400Regular",
  style,
}: AnimatedSplashProps) {
  const { width: screenW } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // Escala uniforme del logo según el ancho de pantalla (respeta proporciones).
  const scale = clamp(screenW / REFERENCE_WIDTH, 0.78, 1.35);

  // Valores animados (UI thread).
  const textOpacity = useSharedValue(0);
  const pawOpacity = useSharedValue(0);
  const pawY = useSharedValue(-SIZE.paw * 1.7);
  const pawSquash = useSharedValue(1);
  const bedFill = useSharedValue(0);
  const glowV = useSharedValue(0);
  const done = useSharedValue(0);

  const completedRef = useRef(false);
  const fireComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onAnimationComplete?.();
  }, [onAnimationComplete]);

  const play = useCallback(() => {
    const k = duration / DEFAULT_DURATION;

    // Reduce-motion: saltamos a estado final, sin brincos.
    if (reduceMotion) {
      textOpacity.value = withTiming(1, { duration: 250 });
      pawOpacity.value = withTiming(1, { duration: 250 });
      pawY.value = 0;
      pawSquash.value = 1;
      bedFill.value = withTiming(1, { duration: 350 }, (fin) => {
        if (fin) runOnJS(fireComplete)();
      });
      return;
    }

    // Reset.
    textOpacity.value = 0;
    pawOpacity.value = 0;
    pawY.value = -SIZE.paw * 1.7;
    pawSquash.value = 1;
    bedFill.value = 0;
    glowV.value = 0;
    done.value = 0;

    // 1) Texto: fade-in suave y luego completamente estático.
    textOpacity.value = withTiming(1, {
      duration: T.textFade * k,
      easing: Easing.out(Easing.cubic),
    });

    // 2) Huella: cae y rebota 2-3 veces ("brinquito") hasta asentarse.
    pawOpacity.value = withDelay(
      T.pawStart * k,
      withTiming(1, { duration: 120 * k })
    );
    pawY.value = withDelay(
      T.pawStart * k,
      withSequence(
        withTiming(0, { duration: 300 * k, easing: Easing.in(Easing.cubic) }),
        withTiming(-SIZE.paw * 0.55, { duration: 200 * k, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 180 * k, easing: Easing.in(Easing.quad) }),
        withTiming(-SIZE.paw * 0.24, { duration: 140 * k, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 120 * k, easing: Easing.in(Easing.quad) })
      )
    );
    // Squash sutil en cada aterrizaje (le da vida al brinco).
    pawSquash.value = withDelay(
      T.pawStart * k,
      withSequence(
        withTiming(1, { duration: 300 * k }),
        withTiming(0.82, { duration: 60 * k }),
        withTiming(1, { duration: 140 * k }),
        withTiming(0.9, { duration: 60 * k }),
        withTiming(1, { duration: 120 * k })
      )
    );

    // 3) Cama: se "llena" de abajo hacia arriba.
    bedFill.value = withDelay(
      T.bedStart * k,
      withTiming(1, { duration: T.bedFill * k, easing: Easing.inOut(Easing.cubic) })
    );

    // 4) Glow sutil sobre los naranjas (opcional).
    if (glow) {
      glowV.value = withDelay(
        T.glowStart * k,
        withSequence(
          withTiming(1, { duration: (T.glow / 2) * k, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: (T.glow / 2) * k, easing: Easing.inOut(Easing.quad) })
        )
      );
    }

    // Fin: timer dedicado que dispara el callback y, si loop, reinicia.
    done.value = withDelay(
      T.end * k,
      withTiming(1, { duration: 1 }, (fin) => {
        if (fin) {
          runOnJS(fireComplete)();
          if (loop) runOnJS(play)();
        }
      })
    );
  }, [
    duration,
    glow,
    loop,
    reduceMotion,
    bedFill,
    glowV,
    done,
    pawOpacity,
    pawSquash,
    pawY,
    textOpacity,
    fireComplete,
  ]);

  useEffect(() => {
    play();
    return () => {
      cancelAnimation(textOpacity);
      cancelAnimation(pawOpacity);
      cancelAnimation(pawY);
      cancelAnimation(pawSquash);
      cancelAnimation(bedFill);
      cancelAnimation(glowV);
      cancelAnimation(done);
    };
    // play es estable salvo cambio de props relevantes.
  }, [play, textOpacity, pawOpacity, pawY, pawSquash, bedFill, glowV, done]);

  /* ── Estilos animados ── */
  const textStyle = useAnimatedStyle(() => ({ opacity: textOpacity.value }));

  const pawStyle = useAnimatedStyle(() => ({
    opacity: pawOpacity.value,
    transform: [
      { translateY: pawY.value },
      { scaleY: pawSquash.value },
      { scaleX: 2 - pawSquash.value }, // conserva volumen al hacer squash
      { scale: 1 + glowV.value * 0.06 },
    ],
  }));

  const bedClipStyle = useAnimatedStyle(() => ({
    height: SIZE.bedH * bedFill.value,
  }));

  const bedGlowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + glowV.value * 0.05 }],
  }));

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor }, style]}>
      <View
        style={{
          transform: [
            { translateX: LOGO_NUDGE.x },
            { translateY: LOGO_NUDGE.y },
            { scale },
          ],
        }}
      >
        {/* Fila 1: "holidog" en SVG (holi Baloo + d/g Pacifico, una baseline →
            sin recorte) + la huella como overlay animado sobre el hueco d–g. */}
        <View style={styles.row}>
          <Animated.View style={textStyle}>
            <Svg
              width={WORD.line1.w}
              height={WORD.line1.h}
              viewBox={`0 0 ${WORD.line1.w} ${WORD.line1.h}`}
            >
              <SvgText x={0} y={WORD.line1.baselineY} fill={textColor} textAnchor="start">
                <TSpan fontFamily={boldFontFamily} fontSize={SIZE.base} letterSpacing={LETTER_SPACING}>
                  holi
                </TSpan>
                <TSpan fontFamily={scriptFontFamily} fontSize={SIZE.script}>
                  d
                </TSpan>
                <TSpan dx={WORD.pawGap} fontFamily={scriptFontFamily} fontSize={SIZE.script}>
                  g
                </TSpan>
              </SvgText>
            </Svg>
          </Animated.View>

          <Animated.View
            style={[styles.pawAbs, { left: WORD.pawLeft, bottom: WORD.pawBottom }, pawStyle]}
          >
            <PawPrint size={SIZE.paw} color={accentColor} />
          </Animated.View>
        </View>

        {/* Fila 2: "inn" en SVG. La cama va ABSOLUTA dentro de esta fila, así que
            mover bedLeft/bedTop NO recoloca "inn" (era el problema en el HTML). */}
        <View style={styles.row2}>
          <Animated.View style={textStyle}>
            <Svg
              width={WORD.line2.w}
              height={WORD.line2.h}
              viewBox={`0 0 ${WORD.line2.w} ${WORD.line2.h}`}
            >
              <SvgText x={0} y={WORD.line2.baselineY} fill={textColor} textAnchor="start">
                <TSpan fontFamily={boldFontFamily} fontSize={SIZE.base} letterSpacing={LETTER_SPACING}>
                  inn
                </TSpan>
              </SvgText>
            </Svg>
          </Animated.View>

          <Animated.View
            style={[
              styles.bed,
              { left: WORD.bedLeft, top: WORD.bedTop, width: SIZE.bedW, height: SIZE.bedH },
              bedGlowStyle,
            ]}
          >
            <Animated.View style={[styles.bedClip, { width: SIZE.bedW }, bedClipStyle]}>
              <View style={[styles.bedPin, { width: SIZE.bedW, height: SIZE.bedH }]}>
                <DogBed width={SIZE.bedW} height={SIZE.bedH} color={accentColor} />
              </View>
            </Animated.View>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  row: {
    flexDirection: "row",
    // La fila 1 = SVG del wordmark (1 hijo flex) + la huella como overlay absoluto.
  },
  row2: {
    // Contiene "inn" (en flujo) + la cama (absoluta). Es el bloque de referencia
    // de la cama. Sube "inn" hacia "holi"; afínalo en el HTML.
    marginTop: -53,
  },
  pawAbs: {
    position: "absolute",
  },
  bed: {
    // ABSOLUTA dentro de la fila 2: bedLeft/bedTop la mueven sin tocar "inn".
    position: "absolute",
  },
  bedClip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  bedPin: {
    position: "absolute",
    bottom: 0,
    left: 0,
  },
});
