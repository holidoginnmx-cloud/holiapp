import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { SwitchRow } from "@/components/SwitchRow";
import type { PetStayOnDay } from "@/lib/api/baths";
import { formatDateTimeShort, formatStayDay } from "@/lib/format";

type Props = {
  stay: PetStayOnDay;
  /**
   * "client": bloquea — el baño de un perro hospedado se agrega desde su
   * estancia (así no se cobra un baño suelto que luego se reembolsa perdiendo
   * la comisión de Stripe).
   * "team": solo avisa; con `force` se agenda la cita suelta de todos modos.
   */
  mode: "client" | "team";
  onOpenStay: () => void;
  force?: boolean;
  onForceChange?: (value: boolean) => void;
};

/**
 * Aviso de «este perro está hospedado ese día». Origen (2026-11-18): una
 * co-dueña agendó y pagó un baño suelto para Koa mientras estaba hospedado y
 * su estancia ya traía baño; lo canceló y el hotel absorbió la comisión.
 */
export function PetStayBathNotice({ stay, mode, onOpenStay, force, onForceChange }: Props) {
  const name = stay.petName || "Tu perrito";
  const range = `del ${formatStayDay(stay.checkIn)} al ${formatStayDay(stay.checkOut)}`;
  const room = mode === "team" && stay.roomName ? ` (${stay.roomName})` : "";
  const bathWhen = stay.bath?.scheduledAt
    ? ` (${formatDateTimeShort(stay.bath.scheduledAt)})`
    : "";

  const title = `${name} está hospedado ${range}${room}`;
  const body = stay.bath
    ? mode === "client"
      ? `Su estancia ya incluye ${stay.bath.label.toLowerCase()}${bathWhen}. Si quieres otro, escríbenos y lo agregamos a su estancia.`
      : `Su estancia ya incluye ${stay.bath.label.toLowerCase()}${bathWhen}. Revisa antes de agendar otro.`
    : mode === "client"
      ? "Mientras está con nosotros, el baño se agrega desde su estancia y lo bañamos ahí mismo."
      : "Lo normal es agregar el baño dentro de su estancia (Servicios contratados → Agregar).";
  const cta = stay.bath ? "Ver su estancia" : "Ir a su estancia";

  if (mode === "team" && force) {
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={styles.forcedNote}>
          {name} está hospedado ese día; se agenda la cita de baño aparte de su estancia.
        </Text>
        {onForceChange && (
          <SwitchRow label="Agendar de todos modos" value onValueChange={onForceChange} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.card} testID="pet-stay-bath-notice">
      <View style={styles.header}>
        <Ionicons name="bed-outline" size={18} color={COLORS.warningText} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={onOpenStay}
        activeOpacity={0.7}
        testID="pet-stay-bath-open"
      >
        <Text style={styles.buttonText}>{cta}</Text>
        <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
      </TouchableOpacity>
      {mode === "team" && onForceChange && (
        <SwitchRow
          label="Agendar de todos modos"
          value={!!force}
          onValueChange={onForceChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.warningBg,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  body: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    backgroundColor: COLORS.white,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  buttonText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
  },
  forcedNote: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
});
