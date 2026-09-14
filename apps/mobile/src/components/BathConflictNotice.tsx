import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { COLORS } from "@/constants/colors";
import { SwitchRow } from "@/components/SwitchRow";
import type { BathSlotsResponse } from "@/lib/api/baths";
import type { BathConflict } from "@/hooks/useBathConflict";
import { formatTime, formatWeekdayDayShort, hotelTodayYMD, hotelYMD } from "@/lib/format";

/** Hasta dónde se busca el siguiente día con lugar. */
const DIAS_A_BUSCAR = 14;

function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

type Props = {
  conflict: BathConflict;
  appointmentAt: Date;
  force: boolean;
  onForceChange: (value: boolean) => void;
  /** Mueve la cita al horario sugerido (y la pantalla apaga el forzado). */
  onPick: (date: Date) => void;
  /**
   * Horarios de otro día con los MISMOS parámetros del servicio que usa la
   * pantalla. Con él, si el día elegido ya no tiene lugar, se ofrece el
   * siguiente libre.
   */
  loadSlots: (dateYMD: string) => Promise<BathSlotsResponse>;
  /** Prefijo de caché de la pantalla, para no cruzar resultados entre flujos. */
  queryKey: readonly unknown[];
};

/**
 * Aviso de conflicto de la agenda de estética: qué pasa, el dato que lo explica
 * y los horarios libres a un toque. Con «Agendar de todos modos» encendido deja
 * de ser error y queda como nota de lo que se está aceptando.
 *
 * Compartido entre crear reservación, baño de invitado y reagendar cita.
 */
export function BathConflictNotice({
  conflict,
  appointmentAt,
  force,
  onForceChange,
  onPick,
  loadSlots,
  queryKey,
}: Props) {
  const sinLugarEseDia = conflict.suggestions.length === 0;
  // Se busca desde el día siguiente al elegido, pero nunca antes de hoy: para
  // una fecha pasada lo útil es el próximo hueco real.
  const hoy = hotelTodayYMD();
  const siguiente = addDaysYMD(hotelYMD(appointmentAt), 1);
  const desde = siguiente > hoy ? siguiente : hoy;

  const { data: proximoLibre } = useQuery({
    queryKey: [...queryKey, "next-free", desde],
    queryFn: async () => {
      for (let i = 0; i < DIAS_A_BUSCAR; i++) {
        const res = await loadSlots(addDaysYMD(desde, i));
        const libre = res.slots.find((s) => s.available && !s.inPast);
        if (libre) return libre.startUtc;
      }
      return null;
    },
    enabled: sinLugarEseDia && !force,
  });

  return (
    <>
      {force ? (
        <Text style={styles.forcedNote}>{conflict.forcedNote}</Text>
      ) : (
        <>
          <Text style={styles.warn}>{conflict.message}</Text>
          {conflict.suggestions.length > 0 ? (
            <View style={styles.chipsRow}>
              <Text style={styles.chipsLabel}>Libres:</Text>
              {conflict.suggestions.map((d) => (
                <TouchableOpacity
                  key={d.toISOString()}
                  style={styles.chip}
                  onPress={() => onPick(d)}
                  activeOpacity={0.7}
                  testID="bath-conflict-suggestion"
                >
                  <Text style={styles.chipText}>{formatTime(d)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : proximoLibre ? (
            <View style={styles.chipsRow}>
              <Text style={styles.chipsLabel}>Ese día ya no hay lugar. Próximo libre:</Text>
              <TouchableOpacity
                style={styles.chip}
                onPress={() => onPick(new Date(proximoLibre))}
                activeOpacity={0.7}
                testID="bath-conflict-next-free"
              >
                <Text style={styles.chipText}>
                  {formatWeekdayDayShort(proximoLibre)}, {formatTime(proximoLibre)}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}
      <SwitchRow
        label="Agendar de todos modos"
        value={force}
        onValueChange={onForceChange}
      />
    </>
  );
}

const styles = StyleSheet.create({
  warn: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.errorText,
    marginTop: 8,
  },
  forcedNote: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 8,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  chipsLabel: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
  },
  chip: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
  },
});
