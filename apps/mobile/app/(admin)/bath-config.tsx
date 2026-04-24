import { COLORS } from "@/constants/colors";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getBathConfig, updateBathConfig, type BathConfig } from "@/lib/api";

function hoursLabel(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

export default function AdminBathConfig() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bath-config"],
    queryFn: getBathConfig,
  });

  const [openHour, setOpenHour] = useState("9");
  const [closeHour, setCloseHour] = useState("18");
  const [slotMinutes, setSlotMinutes] = useState("60");
  const [maxConcurrent, setMaxConcurrent] = useState("1");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setOpenHour(String(data.openHour));
      setCloseHour(String(data.closeHour));
      setSlotMinutes(String(data.slotMinutes));
      setMaxConcurrent(String(data.maxConcurrentBaths));
      setIsActive(data.isActive);
    }
  }, [data]);

  async function handleSave() {
    const openNum = Number(openHour);
    const closeNum = Number(closeHour);
    const slotNum = Number(slotMinutes);
    const maxNum = Number(maxConcurrent);

    if (!Number.isInteger(openNum) || openNum < 0 || openNum > 23) {
      Alert.alert("Error", "Hora de apertura inválida (0–23)");
      return;
    }
    if (!Number.isInteger(closeNum) || closeNum <= openNum || closeNum > 24) {
      Alert.alert("Error", "Hora de cierre debe ser mayor que apertura");
      return;
    }
    if (!Number.isInteger(slotNum) || slotNum < 15 || slotNum > 240) {
      Alert.alert("Error", "Duración del slot inválida (15–240 min)");
      return;
    }
    if (!Number.isInteger(maxNum) || maxNum < 1) {
      Alert.alert("Error", "Capacidad mínima: 1");
      return;
    }

    setSaving(true);
    try {
      await updateBathConfig({
        openHour: openNum,
        closeHour: closeNum,
        slotMinutes: slotNum,
        maxConcurrentBaths: maxNum,
        isActive,
      });
      queryClient.invalidateQueries({ queryKey: ["bath-config"] });
      Alert.alert("Guardado", "La configuración de baños se actualizó.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo guardar";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  const slotsPerDay = (() => {
    const open = Number(openHour);
    const close = Number(closeHour);
    const slot = Number(slotMinutes);
    if (!slot || close <= open) return 0;
    return Math.floor(((close - open) * 60) / slot);
  })();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Agenda activa</Text>
            <Text style={styles.hint}>
              Si la apagas, los dueños no podrán reservar baños nuevos.
            </Text>
          </View>
          <Switch
            value={isActive}
            onValueChange={setIsActive}
            trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
            thumbColor={isActive ? COLORS.primary : COLORS.textDisabled}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Horario</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Hora de apertura</Text>
        <TextInput
          style={styles.input}
          value={openHour}
          onChangeText={setOpenHour}
          keyboardType="number-pad"
          placeholder="9"
        />
        <Text style={styles.preview}>{hoursLabel(Number(openHour) || 0)}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Hora de cierre</Text>
        <TextInput
          style={styles.input}
          value={closeHour}
          onChangeText={setCloseHour}
          keyboardType="number-pad"
          placeholder="18"
        />
        <Text style={styles.preview}>{hoursLabel(Number(closeHour) || 0)}</Text>
      </View>

      <Text style={styles.sectionTitle}>Slot</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Duración (minutos)</Text>
        <TextInput
          style={styles.input}
          value={slotMinutes}
          onChangeText={setSlotMinutes}
          keyboardType="number-pad"
          placeholder="60"
        />
        <Text style={styles.hint}>Cuánto dura cada cita de baño.</Text>
      </View>

      <Text style={styles.sectionTitle}>Capacidad</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Baños simultáneos</Text>
        <TextInput
          style={styles.input}
          value={maxConcurrent}
          onChangeText={setMaxConcurrent}
          keyboardType="number-pad"
          placeholder="1"
        />
        <Text style={styles.hint}>
          Cuántos baños puedes hacer al mismo tiempo.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Ionicons name="information-circle-outline" size={18} color={COLORS.infoText} />
        <Text style={styles.summaryText}>
          Con estos valores tendrás{" "}
          <Text style={styles.summaryBold}>{slotsPerDay} slots por día</Text>{" "}
          de {slotMinutes} min, de {hoursLabel(Number(openHour) || 0)} a{" "}
          {hoursLabel(Number(closeHour) || 0)}.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.saveBtnText}>Guardar cambios</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  hint: { fontSize: 12, color: COLORS.textTertiary, marginTop: 4 },
  preview: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: "600",
    marginTop: 6,
  },
  input: {
    backgroundColor: COLORS.bgSection,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  summaryCard: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: COLORS.infoBg,
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    marginBottom: 20,
  },
  summaryText: { flex: 1, fontSize: 13, color: COLORS.infoText },
  summaryBold: { fontWeight: "800" },
  saveBtn: {
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveBtnDisabled: { backgroundColor: COLORS.textDisabled },
  saveBtnText: { color: COLORS.white, fontSize: 16, fontWeight: "700" },
});
