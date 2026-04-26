import { COLORS } from "@/constants/colors";
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";

interface PreStayChecklistCardProps {
  reservationId: string;
  petName: string;
  checkIn: string | Date;
  cartillaApproved: boolean;
  saldoLiquidado: boolean;
}

type ManualKey = "comida" | "juguete" | "manta";

const MANUAL_ITEMS: { key: ManualKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "comida", label: "Comida etiquetada (bolsa por día)", icon: "restaurant-outline" },
  { key: "juguete", label: "Juguete favorito", icon: "tennisball-outline" },
  { key: "manta", label: "Manta o cama familiar", icon: "bed-outline" },
];

function hoursUntil(date: string | Date): number {
  return (new Date(date).getTime() - Date.now()) / (1000 * 60 * 60);
}

export function PreStayChecklistCard({
  reservationId,
  petName,
  checkIn,
  cartillaApproved,
  saldoLiquidado,
}: PreStayChecklistCardProps) {
  const storageKey = `prestay_checklist_${reservationId}`;
  const [manual, setManual] = useState<Record<ManualKey, boolean>>({
    comida: false,
    juguete: false,
    manta: false,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(storageKey)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            setManual({
              comida: !!parsed.comida,
              juguete: !!parsed.juguete,
              manta: !!parsed.manta,
            });
          } catch {}
        }
      })
      .finally(() => setLoaded(true));
  }, [storageKey]);

  const toggle = (key: ManualKey) => {
    const next = { ...manual, [key]: !manual[key] };
    setManual(next);
    SecureStore.setItemAsync(storageKey, JSON.stringify(next)).catch(() => {});
  };

  const hours = Math.max(0, Math.round(hoursUntil(checkIn)));
  const totalDone =
    (cartillaApproved ? 1 : 0) +
    (saldoLiquidado ? 1 : 0) +
    Object.values(manual).filter(Boolean).length;
  const totalItems = 5;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerIconWrap}>
          <Ionicons name="checkmark-done-circle" size={22} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{petName} llega en {hours}h</Text>
          <Text style={styles.subtitle}>
            ¿Todo listo? {totalDone}/{totalItems}
          </Text>
        </View>
      </View>

      {loaded && (
        <View style={styles.list}>
          <ChecklistItem
            icon="document-text-outline"
            label="Cartilla aprobada"
            checked={cartillaApproved}
            disabled
          />
          {MANUAL_ITEMS.map((item) => (
            <ChecklistItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              checked={manual[item.key]}
              onPress={() => toggle(item.key)}
            />
          ))}
          <ChecklistItem
            icon="card-outline"
            label="Saldo liquidado"
            checked={saldoLiquidado}
            disabled
          />
        </View>
      )}
    </View>
  );
}

function ChecklistItem({
  icon,
  label,
  checked,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.item}
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.checkbox,
          checked && styles.checkboxChecked,
          disabled && checked && styles.checkboxAuto,
        ]}
      >
        {checked && <Ionicons name="checkmark" size={14} color={COLORS.white} />}
      </View>
      <Ionicons
        name={icon}
        size={18}
        color={checked ? COLORS.textTertiary : COLORS.textSecondary}
      />
      <Text
        style={[
          styles.itemLabel,
          checked && styles.itemLabelChecked,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  headerIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 1,
    fontWeight: "600",
  },
  list: {
    gap: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.borderLight,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkboxAuto: {
    backgroundColor: COLORS.successText,
    borderColor: COLORS.successText,
  },
  itemLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: "500",
  },
  itemLabelChecked: {
    color: COLORS.textTertiary,
    textDecorationLine: "line-through",
  },
});
