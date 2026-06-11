import { useState } from "react";
import {
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import * as Font from "expo-font";
import { AnimatedSplash } from "./AnimatedSplash";

/**
 * Banco de pruebas del splash, AISLADO de la app (sin login ni providers de
 * negocio). Reproduce <AnimatedSplash /> en bucle y ofrece herramientas para
 * afinar la composición:
 *   • Guías      → líneas de centro + tercios para alinear texto/huella/cama.
 *   • Fondo      → alterna blanco/negro para revisar contraste.
 *   • Reiniciar  → vuelve a montar el splash desde cero.
 *   • Estado de fuentes → confirma si Baloo 2 / Pacifico cargaron de verdad
 *     (si dicen "NO", el texto se está dibujando con la fuente del sistema y por
 *     eso "se ve extraño": revisa la carga en app/_layout.tsx).
 *
 * Se usa desde la ruta app/splash-preview.tsx. No incluir en producción.
 */
export function SplashPreview() {
  const { width, height } = useWindowDimensions();
  // Offset superior aproximado (evita depender de SafeAreaProvider en esta ruta de dev).
  const topOffset = Platform.OS === "ios" ? 54 : (StatusBar.currentHeight ?? 24) + 8;

  const [showGuides, setShowGuides] = useState(true);
  const [dark, setDark] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  const boldLoaded = Font.isLoaded("Baloo2_800ExtraBold");
  const scriptLoaded = Font.isLoaded("Pacifico_400Regular");

  const bg = dark ? "#0C1A20" : "#FFFFFF";

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* El splash en bucle. La key fuerza un remount limpio al reiniciar. */}
      <AnimatedSplash
        key={replayKey}
        loop
        backgroundColor={bg}
        textColor={dark ? "#9FD3E0" : undefined}
      />

      {/* Guías de alineación */}
      {showGuides && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* Centro vertical y horizontal */}
          <View style={[styles.vLine, { left: width / 2 }]} />
          <View style={[styles.hLine, { top: height / 2 }]} />
          {/* Tercios */}
          <View style={[styles.vLineFaint, { left: width / 3 }]} />
          <View style={[styles.vLineFaint, { left: (width * 2) / 3 }]} />
          <View style={[styles.hLineFaint, { top: height / 3 }]} />
          <View style={[styles.hLineFaint, { top: (height * 2) / 3 }]} />
        </View>
      )}

      {/* Panel de estado + controles */}
      <View style={[styles.panel, { top: topOffset }]}>
        <Text style={styles.panelTitle}>Splash preview</Text>
        <Text style={[styles.status, { color: boldLoaded ? "#16A34A" : "#DC2626" }]}>
          Baloo 2: {boldLoaded ? "✓ cargada" : "✗ fallback del sistema"}
        </Text>
        <Text style={[styles.status, { color: scriptLoaded ? "#16A34A" : "#DC2626" }]}>
          Pacifico: {scriptLoaded ? "✓ cargada" : "✗ fallback del sistema"}
        </Text>
        <Text style={styles.meta}>
          {Math.round(width)}×{Math.round(height)} px
        </Text>

        <View style={styles.btnRow}>
          <Btn label={showGuides ? "Guías ✓" : "Guías"} onPress={() => setShowGuides((v) => !v)} />
          <Btn label={dark ? "Fondo ◑" : "Fondo ◐"} onPress={() => setDark((v) => !v)} />
          <Btn label="Reiniciar ↻" onPress={() => setReplayKey((k) => k + 1)} />
        </View>
      </View>
    </View>
  );
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.btn} onPress={onPress}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const GUIDE = "rgba(227,95,39,0.55)";
const GUIDE_FAINT = "rgba(227,95,39,0.18)";

const styles = StyleSheet.create({
  root: { flex: 1 },
  vLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: GUIDE },
  hLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: GUIDE },
  vLineFaint: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: GUIDE_FAINT },
  hLineFaint: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: GUIDE_FAINT },
  panel: {
    position: "absolute",
    left: 12,
    right: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  panelTitle: { color: "#FFF", fontWeight: "700", fontSize: 13, marginBottom: 4 },
  status: { fontSize: 12, fontWeight: "600" },
  meta: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  btn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  btnText: { color: "#FFF", fontSize: 12, fontWeight: "600" },
});
