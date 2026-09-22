import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Entrada y salida de una estancia en UN SOLO selector: se abre un calendario,
 * el primer toque fija el check-in, el segundo el check-out, y los dos días —
 * con todas las noches que quedan en medio — se quedan pintados.
 *
 * Antes eran dos campos con su propio `DateTimePicker` nativo: había que abrir
 * uno, elegir, cerrarlo, abrir el otro… y el rango completo NUNCA se veía, así
 * que contar las noches era de memoria. Con la franja pintada se ve de un
 * vistazo qué días quedan reservados.
 *
 * Las fechas entran y salen como `Date` a MEDIANOCHE LOCAL, que es lo que ya
 * esperaban las pantallas (de ahí se convierten a día UTC al mandarlas a la
 * API). Internamente todo se compara con claves "YYYY-MM-DD" locales: comparar
 * `Date`s con horas distintas es justo lo que hacía que "hoy" a veces quedara
 * fuera del mínimo.
 */

const DIAS_HEADER = ["D", "L", "M", "M", "J", "V", "S"];

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" de un Date, en la zona local del teléfono. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date a medianoche local a partir de una clave "YYYY-MM-DD". */
function fromKey(key: string): Date {
  return new Date(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10)),
  );
}

/** Noches entre dos claves (días calendario, igual que la API). */
function nochesEntre(desde: string, hasta: string): number {
  const ms = fromKey(hasta).getTime() - fromKey(desde).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * "Mar 8 sep". Se arma por partes para quitar el "de" que mete es-MX: las dos
 * fechas comparten un solo campo y con el formato largo no cabían en 375 px.
 */
function etiquetaDia(key: string): string {
  const d = fromKey(key);
  const dia = d.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", "");
  const mes = d.toLocaleDateString("es-MX", { month: "short" }).replace(".", "");
  return `${dia.charAt(0).toUpperCase() + dia.slice(1)} ${d.getDate()} ${mes}`;
}

type Props = {
  checkIn: Date | null;
  checkOut: Date | null;
  onChange: (checkIn: Date | null, checkOut: Date | null) => void;
  /** Primer día elegible (por defecto, hoy). */
  minDate?: Date;
  /**
   * La entrada ya no se puede mover (la estancia arrancó): el calendario abre
   * directo en modo salida y el día de entrada queda fijo.
   */
  lockStart?: boolean;
  testID?: string;
};

export function DateRangeField({
  checkIn,
  checkOut,
  onChange,
  minDate,
  lockStart = false,
  testID,
}: Props) {
  const [open, setOpen] = useState(false);
  // false => el próximo toque fija la ENTRADA; true => la salida.
  const [eligiendoSalida, setEligiendoSalida] = useState(false);

  const hoyKey = useMemo(() => dayKey(new Date()), []);
  const minKey = minDate ? dayKey(minDate) : hoyKey;

  const fromKeyVal = checkIn ? dayKey(checkIn) : null;
  const toKeyVal = checkOut ? dayKey(checkOut) : null;

  // Mes visible en el calendario. Se reposiciona en cada apertura.
  const [vista, setVista] = useState(() => {
    const ancla = checkIn ?? minDate ?? new Date();
    return { anio: ancla.getFullYear(), mes: ancla.getMonth() };
  });

  function abrir(modoSalida: boolean) {
    const anclaKey = (modoSalida ? toKeyVal ?? fromKeyVal : fromKeyVal) ?? minKey;
    const ancla = fromKey(anclaKey);
    setVista({ anio: ancla.getFullYear(), mes: ancla.getMonth() });
    setEligiendoSalida(lockStart || (modoSalida && !!fromKeyVal));
    setOpen(true);
  }

  function tocarDia(key: string) {
    if (lockStart) {
      // Sólo se mueve la salida, y nunca antes de la entrada.
      if (fromKeyVal && key <= fromKeyVal) return;
      onChange(checkIn, fromKey(key));
      setOpen(false);
      return;
    }
    if (!eligiendoSalida || !fromKeyVal) {
      // Entrada nueva: la salida anterior deja de tener sentido.
      onChange(fromKey(key), null);
      setEligiendoSalida(true);
      return;
    }
    if (key > fromKeyVal) {
      onChange(checkIn, fromKey(key));
      setEligiendoSalida(false);
      setOpen(false);
      return;
    }
    // Tocar un día anterior (o el mismo) reinicia el rango: es cómo se corrige
    // una entrada mal puesta sin tener que cerrar y volver a abrir.
    onChange(fromKey(key), null);
    setEligiendoSalida(true);
  }

  const noches = fromKeyVal && toKeyVal ? nochesEntre(fromKeyVal, toKeyVal) : 0;

  // ── Celdas del mes visible ──
  const celdas = useMemo(() => {
    const primeroDow = new Date(vista.anio, vista.mes, 1).getDay();
    const numDias = new Date(vista.anio, vista.mes + 1, 0).getDate();
    const out: (string | null)[] = [];
    for (let i = 0; i < primeroDow; i++) out.push(null);
    for (let d = 1; d <= numDias; d++) {
      out.push(`${vista.anio}-${pad(vista.mes + 1)}-${pad(d)}`);
    }
    return out;
  }, [vista]);

  // No se navega a meses que quedan por completo debajo del mínimo.
  const idxVista = vista.anio * 12 + vista.mes;
  const minDateObj = fromKey(minKey);
  const idxMin = minDateObj.getFullYear() * 12 + minDateObj.getMonth();
  const prevDisabled = idxVista <= idxMin;

  function irMes(delta: -1 | 1) {
    const next = idxVista + delta;
    setVista({ anio: Math.floor(next / 12), mes: next % 12 });
  }

  return (
    <>
      <View style={styles.trigger}>
        <TouchableOpacity
          style={styles.triggerHalf}
          onPress={() => abrir(false)}
          disabled={lockStart}
          activeOpacity={0.7}
          testID={testID}
        >
          <Text style={styles.triggerLabel}>Check-in</Text>
          <View style={styles.triggerValueRow}>
            <Ionicons name="calendar-outline" size={16} color={COLORS.textTertiary} />
            <Text
              style={[styles.triggerValue, !fromKeyVal && styles.triggerValueEmpty]}
              numberOfLines={1}
            >
              {fromKeyVal ? etiquetaDia(fromKeyVal) : "Seleccionar"}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.triggerSep}>
          <Ionicons name="arrow-forward" size={16} color={COLORS.textDisabled} />
          {noches > 0 && (
            <Text style={styles.triggerNights}>
              {noches}n
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={styles.triggerHalf}
          onPress={() => abrir(true)}
          activeOpacity={0.7}
          testID={testID ? `${testID}-out` : undefined}
        >
          <Text style={styles.triggerLabel}>Check-out</Text>
          <View style={styles.triggerValueRow}>
            <Ionicons name="calendar-outline" size={16} color={COLORS.textTertiary} />
            <Text
              style={[styles.triggerValue, !toKeyVal && styles.triggerValueEmpty]}
              numberOfLines={1}
            >
              {toKeyVal ? etiquetaDia(toKeyVal) : "Seleccionar"}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <TouchableOpacity
            style={styles.sheet}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {eligiendoSalida ? "Elige la salida" : "Elige la entrada"}
              </Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={12}>
                <Text style={styles.sheetDone}>Listo</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.monthRow}>
              <TouchableOpacity
                onPress={() => irMes(-1)}
                disabled={prevDisabled}
                hitSlop={8}
                accessibilityLabel="Mes anterior"
              >
                <Ionicons
                  name="chevron-back"
                  size={22}
                  color={prevDisabled ? COLORS.textDisabled : COLORS.primary}
                />
              </TouchableOpacity>
              <Text style={styles.monthLabel}>
                {MESES[vista.mes]} {vista.anio}
              </Text>
              <TouchableOpacity
                onPress={() => irMes(1)}
                hitSlop={8}
                accessibilityLabel="Mes siguiente"
              >
                <Ionicons name="chevron-forward" size={22} color={COLORS.primary} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekRow}>
              {DIAS_HEADER.map((d, i) => (
                <Text key={`${d}${i}`} style={styles.weekday}>
                  {d}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {celdas.map((key, i) => {
                if (!key) return <View key={`b${i}`} style={styles.cell} />;
                const deshabilitado =
                  key < minKey || (lockStart && !!fromKeyVal && key <= fromKeyVal);
                const esInicio = key === fromKeyVal;
                const esFin = key === toKeyVal;
                const enMedio =
                  !!fromKeyVal && !!toKeyVal && key > fromKeyVal && key < toKeyVal;
                const hayRango = !!fromKeyVal && !!toKeyVal;
                return (
                  <View key={key} style={styles.cell}>
                    {/* La franja va DETRÁS del círculo y sólo media celda en los
                        extremos, para que se lea como una barra continua. */}
                    {(enMedio || (hayRango && (esInicio || esFin))) && (
                      <View
                        style={[
                          styles.franja,
                          esInicio && styles.franjaInicio,
                          esFin && styles.franjaFin,
                        ]}
                      />
                    )}
                    <TouchableOpacity
                      style={[
                        styles.day,
                        (esInicio || esFin) && styles.dayExtremo,
                        key === hoyKey && !esInicio && !esFin && styles.dayHoy,
                      ]}
                      disabled={deshabilitado}
                      onPress={() => tocarDia(key)}
                      activeOpacity={0.7}
                      testID={`day-${key}`}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          deshabilitado && styles.dayTextDisabled,
                          enMedio && styles.dayTextEnMedio,
                          (esInicio || esFin) && styles.dayTextExtremo,
                        ]}
                      >
                        {Number(key.slice(8, 10))}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            <Text style={styles.footer}>
              {noches > 0 && fromKeyVal && toKeyVal
                ? `${noches} noche${noches === 1 ? "" : "s"} · ${etiquetaDia(fromKeyVal)} – ${etiquetaDia(toKeyVal)}`
                : "Toca el día de entrada y luego el de salida"}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // ── Campo ──
  trigger: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    overflow: "hidden",
  },
  triggerHalf: { flex: 1, paddingVertical: 10, paddingHorizontal: 12 },
  triggerLabel: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  triggerValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  triggerValue: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
    flexShrink: 1,
  },
  triggerValueEmpty: { color: COLORS.textDisabled },
  triggerSep: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    gap: 2,
  },
  triggerNights: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },

  // ── Sheet ──
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 28,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  sheetDone: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },

  // ── Calendario ──
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  monthLabel: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  weekRow: { flexDirection: "row", marginBottom: 4 },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: 11,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  franja: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 0,
    right: 0,
    backgroundColor: COLORS.primaryLight,
  },
  franjaInicio: { left: "50%", borderTopLeftRadius: 18, borderBottomLeftRadius: 18 },
  franjaFin: { right: "50%", borderTopRightRadius: 18, borderBottomRightRadius: 18 },
  day: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dayExtremo: { backgroundColor: COLORS.primary },
  dayHoy: { borderWidth: 1, borderColor: COLORS.primary },
  dayText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  dayTextDisabled: { color: COLORS.textDisabled },
  dayTextEnMedio: { color: COLORS.primary },
  dayTextExtremo: {
    color: COLORS.white,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  footer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    textAlign: "center",
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
  },
});
