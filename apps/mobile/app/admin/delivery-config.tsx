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
import { getAdminDeliveryConfig, updateAdminDeliveryConfig } from "@/lib/api";

export default function AdminDeliveryConfig() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "delivery-config"],
    queryFn: getAdminDeliveryConfig,
  });

  const [baseFee, setBaseFee] = useState("0");
  const [pricePerKm, setPricePerKm] = useState("0");
  const [isActive, setIsActive] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setBaseFee(String(data.baseFee));
      setPricePerKm(String(data.pricePerKm));
      setIsActive(data.isActive);
    }
  }, [data]);

  async function handleSave() {
    const baseNum = Number(baseFee);
    const kmNum = Number(pricePerKm);

    if (!Number.isFinite(baseNum) || baseNum < 0) {
      Alert.alert("Error", "La tarifa base no puede ser negativa");
      return;
    }
    if (!Number.isFinite(kmNum) || kmNum < 0) {
      Alert.alert("Error", "El precio por km no puede ser negativo");
      return;
    }

    setSaving(true);
    try {
      await updateAdminDeliveryConfig({
        baseFee: baseNum,
        pricePerKm: kmNum,
        isActive,
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "delivery-config"] });
      Alert.alert("Guardado", "La configuración de domicilio se actualizó.");
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

  // Ejemplo a 5 km redondos para que el admin vea el efecto del precio.
  const exampleKm = 5;
  const examplePrice =
    (Number(baseFee) || 0) + exampleKm * 2 * (Number(pricePerKm) || 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Servicio a domicilio activo</Text>
            <Text style={styles.hint}>
              Si lo apagas, los clientes no podrán elegir domicilio al reservar.
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

      <Text style={styles.sectionTitle}>Tarifas</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Tarifa base ($)</Text>
        <TextInput
          style={styles.input}
          value={baseFee}
          onChangeText={setBaseFee}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        <Text style={styles.hint}>Costo fijo que se cobra en cada domicilio.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Precio por km ($)</Text>
        <TextInput
          style={styles.input}
          value={pricePerKm}
          onChangeText={setPricePerKm}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        <Text style={styles.hint}>
          Se cobra por la distancia redonda (ida y vuelta) entre HDI y el
          domicilio del cliente.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Ionicons name="information-circle-outline" size={18} color={COLORS.infoText} />
        <Text style={styles.summaryText}>
          Ejemplo: un cliente a <Text style={styles.summaryBold}>{exampleKm} km</Text>{" "}
          pagaría <Text style={styles.summaryBold}>${examplePrice.toLocaleString("es-MX")}</Text>{" "}
          de domicilio (base + {exampleKm}×2 km × precio/km).
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
