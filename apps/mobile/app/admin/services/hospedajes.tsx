import { COLORS } from "@/constants/colors";
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAdminLodgingPricing,
  updateAdminLodgingPricing,
} from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";
import {
  DEFAULT_PRICE_PER_DAY_SMALL,
  DEFAULT_PRICE_PER_DAY_LARGE,
  DEFAULT_MEDICATION_FEE_PER_NIGHT,
} from "@holidoginn/shared/src/pricing";


import { alertaDeError } from "@/lib/errorAlert";

type Field =
  | "pricePerDaySmall"
  | "pricePerDayLarge"
  | "largeWeightKg"
  | "medicationFeePerNight";

const KEY = ["admin", "lodging-pricing"] as const;

export default function AdminHospedajes() {
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: KEY,
    queryFn: getAdminLodgingPricing,
  });

  // Inputs en strings para no perder estados intermedios al editar.
  const [draft, setDraft] = useState<Record<Field, string>>({
    pricePerDaySmall: "",
    pricePerDayLarge: "",
    largeWeightKg: "",
    medicationFeePerNight: "",
  });

  // Cuando llega data inicial (o refetch), sincroniza el formulario.
  useEffect(() => {
    if (!data) return;
    setDraft({
      pricePerDaySmall: String(data.pricePerDaySmall),
      pricePerDayLarge: String(data.pricePerDayLarge),
      largeWeightKg: String(data.largeWeightKg),
      medicationFeePerNight: String(data.medicationFeePerNight),
    });
  }, [data]);

  const dirtyAndValid = useMemo(() => {
    if (!data) return null;
    const small = parseFloat(draft.pricePerDaySmall);
    const large = parseFloat(draft.pricePerDayLarge);
    const weight = parseFloat(draft.largeWeightKg);
    const medFee = parseFloat(draft.medicationFeePerNight); // pesos por noche
    if (
      !(small > 0) ||
      !(large > 0) ||
      !(weight > 0) ||
      isNaN(medFee) ||
      medFee < 0
    ) {
      return null;
    }
    const changes: Record<string, number> = {};
    if (small !== data.pricePerDaySmall) changes.pricePerDaySmall = small;
    if (large !== data.pricePerDayLarge) changes.pricePerDayLarge = large;
    if (weight !== data.largeWeightKg) changes.largeWeightKg = weight;
    if (medFee !== data.medicationFeePerNight) {
      changes.medicationFeePerNight = medFee;
    }
    return Object.keys(changes).length > 0 ? changes : null;
  }, [draft, data]);

  const saveMutation = useMutation({
    mutationFn: () => updateAdminLodgingPricing(dirtyAndValid!),
    onSuccess: (next) => {
      qc.setQueryData(KEY, next);
      Alert.alert("Tarifas actualizadas", "Solo aplicará a reservas nuevas.");
    },
    onError: (e: Error) => alertaDeError(e),
  });

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const previewSmall = parseFloat(draft.pricePerDaySmall) || data.pricePerDaySmall;
  const previewLarge = parseFloat(draft.pricePerDayLarge) || data.pricePerDayLarge;
  const previewWeight = parseFloat(draft.largeWeightKg) || data.largeWeightKg;
  const previewMed = parseFloat(draft.medicationFeePerNight);
  const previewMedValid = !isNaN(previewMed) && previewMed >= 0;
  const surcharge3Days = 3 * (previewMedValid ? previewMed : data.medicationFeePerNight);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.infoBanner}>
        <Ionicons
          name="information-circle"
          size={18}
          color={COLORS.infoText}
        />
        <Text style={styles.infoText}>
          Estas tarifas solo aplican a reservaciones nuevas. Las existentes
          conservan su precio original.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Tarifa por noche</Text>
      <Text style={styles.sectionSub}>
        Se aplica el precio según el peso de la mascota.
      </Text>

      <View style={styles.fieldGroup}>
        <View style={styles.fieldLabelRow}>
          <Ionicons name="paw" size={16} color={COLORS.primary} />
          <Text style={styles.fieldLabel}>Perros chicos</Text>
          <Text style={styles.fieldHint}>(menos de {previewWeight} kg)</Text>
        </View>
        <View style={styles.inputWrap}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.input}
            value={draft.pricePerDaySmall}
            onChangeText={(v) =>
              setDraft((d) => ({ ...d, pricePerDaySmall: v }))
            }
            keyboardType="decimal-pad"
            placeholder={String(DEFAULT_PRICE_PER_DAY_SMALL)}
            placeholderTextColor={COLORS.textDisabled}
          />
          <Text style={styles.unit}>/ noche</Text>
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.fieldLabelRow}>
          <Ionicons name="paw" size={16} color={COLORS.primary} />
          <Text style={styles.fieldLabel}>Perros grandes</Text>
          <Text style={styles.fieldHint}>({previewWeight} kg o más)</Text>
        </View>
        <View style={styles.inputWrap}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.input}
            value={draft.pricePerDayLarge}
            onChangeText={(v) =>
              setDraft((d) => ({ ...d, pricePerDayLarge: v }))
            }
            keyboardType="decimal-pad"
            placeholder={String(DEFAULT_PRICE_PER_DAY_LARGE)}
            placeholderTextColor={COLORS.textDisabled}
          />
          <Text style={styles.unit}>/ noche</Text>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
        Umbral de peso
      </Text>
      <Text style={styles.sectionSub}>
        A partir de este peso aplica la tarifa de "perros grandes".
      </Text>

      <View style={styles.fieldGroup}>
        <View style={styles.inputWrap}>
          <TextInput
            style={[styles.input, { paddingLeft: 14 }]}
            value={draft.largeWeightKg}
            onChangeText={(v) =>
              setDraft((d) => ({ ...d, largeWeightKg: v }))
            }
            keyboardType="decimal-pad"
            placeholder="20"
            placeholderTextColor={COLORS.textDisabled}
          />
          <Text style={styles.unit}>kg</Text>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
        Recargo por medicación
      </Text>
      <Text style={styles.sectionSub}>
        Monto extra por noche y por mascota cuando hay que darle medicamento.
      </Text>

      <View style={styles.fieldGroup}>
        <View style={styles.inputWrap}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.input}
            value={draft.medicationFeePerNight}
            onChangeText={(v) =>
              setDraft((d) => ({ ...d, medicationFeePerNight: v }))
            }
            keyboardType="decimal-pad"
            placeholder={String(DEFAULT_MEDICATION_FEE_PER_NIGHT)}
            placeholderTextColor={COLORS.textDisabled}
          />
          <Text style={styles.unit}>/ noche</Text>
        </View>
        <Text style={styles.exampleText}>
          Ej. 3 noches con medicación
          ={" "}
          <Text style={styles.exampleStrong}>
            +{formatCurrency(surcharge3Days)}
          </Text>{" "}
          de recargo
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.saveBtn,
          (!dirtyAndValid || saveMutation.isPending) && { opacity: 0.5 },
        ]}
        onPress={() => saveMutation.mutate()}
        disabled={!dirtyAndValid || saveMutation.isPending}
        activeOpacity={0.85}
      >
        {saveMutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons name="save" size={18} color={COLORS.white} />
            <Text style={styles.saveBtnText}>Guardar cambios</Text>
          </>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bgPage,
  },
  infoBanner: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: COLORS.infoBg,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    alignItems: "flex-start",
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.infoText,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  sectionSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    marginBottom: 10,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  fieldGroup: {
    marginBottom: 12,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
  },
  fieldHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 12,
  },
  currency: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    paddingVertical: 12,
  },
  unit: {
    fontSize: 13,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    paddingLeft: 6,
  },
  exampleText: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  exampleStrong: {
    color: COLORS.primary,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  saveBtn: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 16,
  },
  saveBtnText: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
  },
});
