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
import { alertaDeError } from "@/lib/errorAlert";
import { ErrorState } from "@/components/ErrorState";


function hoursLabel(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

// Se pintan de lunes a domingo, que es como se lee una semana de trabajo,
// pero se guardan con la numeración de JS (0 = domingo) que usa el motor.
const DIAS = [
  { n: 1, corto: "L" },
  { n: 2, corto: "M" },
  { n: 3, corto: "X" },
  { n: 4, corto: "J" },
  { n: 5, corto: "V" },
  { n: 6, corto: "S" },
  { n: 0, corto: "D" },
] as const;

const DIAS_LARGO = [
  "domingos",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábados",
];

/** Orden de lectura: la semana empieza en lunes y el domingo va al final. */
function ordenSemana(d: number): number {
  return d === 0 ? 7 : d;
}

function resumenCerrados(dias: number[]): string {
  if (dias.length === 0) return "Abierto toda la semana.";
  const nombres = [...dias]
    .sort((a, b) => ordenSemana(a) - ordenSemana(b))
    .map((d) => DIAS_LARGO[d]);
  const lista =
    nombres.length === 1
      ? nombres[0]
      : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return `Cerrado los ${lista}. Esos días no se ofrecen horarios ni en la app ni en la página.`;
}

export default function AdminBathConfig() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["bath-config"],
    queryFn: getBathConfig,
  });

  const [openHour, setOpenHour] = useState("9");
  const [closeHour, setCloseHour] = useState("18");
  const [slotMinutes, setSlotMinutes] = useState("60");
  const [maxConcurrent, setMaxConcurrent] = useState("1");
  const [slotStep, setSlotStep] = useState("30");
  const [buffer, setBuffer] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [cerrados, setCerrados] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setOpenHour(String(data.openHour));
      setCloseHour(String(data.closeHour));
      setSlotMinutes(String(data.defaultBathDurationMinutes ?? data.slotMinutes));
      setMaxConcurrent(String(data.maxConcurrentBaths));
      setSlotStep(String(data.slotStepMinutes ?? 30));
      setBuffer(String(data.bufferMinutes ?? 0));
      setIsActive(data.isActive);
      setCerrados(data.closedWeekdays ?? []);
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
    if (cerrados.length >= 7) {
      Alert.alert(
        "Revisa los días",
        "No puedes cerrar los siete días. Si quieres parar la estética por completo, apaga «Agenda activa».",
      );
      return;
    }

    setSaving(true);
    try {
      await updateBathConfig({
        openHour: openNum,
        closeHour: closeNum,
        defaultBathDurationMinutes: slotNum,
        slotStepMinutes: Number(slotStep) || 30,
        bufferMinutes: Number(buffer) || 0,
        maxConcurrentBaths: maxNum,
        closedWeekdays: cerrados,
        isActive,
      });
      queryClient.invalidateQueries({ queryKey: ["bath-config"] });
      Alert.alert("Guardado", "La configuración de baños se actualizó.");
    } catch (err) {
      alertaDeError(err, { respaldo: "No se pudo guardar" });
    } finally {
      setSaving(false);
    }
  }

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

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

      <View style={styles.card}>
        <Text style={styles.label}>Días cerrados</Text>
        <Text style={styles.hint}>
          Toca los días en que la estética no trabaja. Esos días no se ofrecerán horarios.
        </Text>
        <View style={styles.diasRow}>
          {DIAS.map((d) => {
            const cerrado = cerrados.includes(d.n);
            return (
              <TouchableOpacity
                key={d.n}
                accessibilityRole="button"
                accessibilityState={{ selected: cerrado }}
                accessibilityLabel={`${DIAS_LARGO[d.n]}: ${cerrado ? "cerrado" : "abierto"}`}
                style={[styles.diaChip, cerrado && styles.diaChipCerrado]}
                onPress={() =>
                  setCerrados((prev) =>
                    prev.includes(d.n) ? prev.filter((x) => x !== d.n) : [...prev, d.n],
                  )
                }
              >
                <Text style={[styles.diaChipText, cerrado && styles.diaChipTextCerrado]}>
                  {d.corto}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.diasResumen}>{resumenCerrados(cerrados)}</Text>
      </View>

      <Text style={styles.sectionTitle}>Horarios</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Horarios cada (minutos)</Text>
        <TextInput
          style={styles.input}
          value={slotStep}
          onChangeText={setSlotStep}
          keyboardType="number-pad"
          placeholder="30"
        />
        <Text style={styles.hint}>
          Cada cuánto se ofrece un inicio de cita: 9:00, 9:30, 10:00…
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Limpieza entre perros (minutos)</Text>
        <TextInput
          style={styles.input}
          value={buffer}
          onChangeText={setBuffer}
          keyboardType="number-pad"
          placeholder="0"
        />
        <Text style={styles.hint}>Tiempo libre que se deja entre una cita y la siguiente.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Duración de respaldo (minutos)</Text>
        <TextInput
          style={styles.input}
          value={slotMinutes}
          onChangeText={setSlotMinutes}
          keyboardType="number-pad"
          placeholder="60"
        />
        <Text style={styles.hint}>
          Cuánto dura cada servicio se configura por talla y extras en el admin web. Esto solo se
          usa cuando no se puede saber el tipo de baño.
        </Text>
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
          De {hoursLabel(Number(openHour) || 0)} a {hoursLabel(Number(closeHour) || 0)}. Un baño de{" "}
          {slotMinutes} min se puede agendar hasta{" "}
          <Text style={styles.summaryBold}>
            {hoursLabel(
              Math.floor((Number(closeHour) * 60 - Number(slotMinutes) - Number(buffer)) / 60),
            )}
          </Text>
          : la agenda solo ofrece horarios donde el servicio alcanza a terminar.
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
    fontFamily: "PlusJakartaSans_700Bold",
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  hint: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 4 },
  preview: {
    fontSize: 13,
    color: COLORS.primary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    marginTop: 6,
  },
  input: {
    backgroundColor: COLORS.bgSection,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
  },
  diasRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  diaChip: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bgSection,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  diaChipCerrado: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  diaChipText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
  },
  diaChipTextCerrado: { color: COLORS.white },
  diasResumen: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
    marginTop: 10,
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
  summaryText: { flex: 1, fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.infoText },
  summaryBold: { fontFamily: "PlusJakartaSans_700Bold" },
  saveBtn: {
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveBtnDisabled: { backgroundColor: COLORS.textDisabled },
  saveBtnText: { color: COLORS.white, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
});
