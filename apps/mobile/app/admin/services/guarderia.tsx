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
import { getAdminLodgingPricing, updateAdminLodgingPricing } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

const KEY = ["admin", "lodging-pricing"] as const;

export default function AdminGuarderia() {
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: KEY,
    queryFn: getAdminLodgingPricing,
  });

  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!data) return;
    setDraft(String(data.daycareHourPrice));
  }, [data]);

  const dirtyAndValid = useMemo(() => {
    if (!data) return null;
    const price = parseFloat(draft);
    if (!(price > 0)) return null;
    if (price === data.daycareHourPrice) return null;
    return { daycareHourPrice: price };
  }, [draft, data]);

  const saveMutation = useMutation({
    mutationFn: () => updateAdminLodgingPricing(dirtyAndValid!),
    onSuccess: (next) => {
      qc.setQueryData(KEY, next);
      Alert.alert("Tarifa actualizada", "Solo aplicará a reservas nuevas.");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
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

  const previewPrice = parseFloat(draft) || data.daycareHourPrice;

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
        <Ionicons name="information-circle" size={18} color={COLORS.infoText} />
        <Text style={styles.infoText}>
          Precio por hora de guardería. También se usa para las horas extra
          cuando un cliente excede la hora de recogida.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Tarifa por hora</Text>
      <Text style={styles.sectionSub}>
        El cobro de una guardería = horas estimadas × esta tarifa.
      </Text>

      <View style={styles.fieldGroup}>
        <View style={styles.inputWrap}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            keyboardType="decimal-pad"
            placeholder="25"
            placeholderTextColor={COLORS.textDisabled}
          />
          <Text style={styles.unit}>/ hora</Text>
        </View>
        <Text style={styles.exampleText}>
          Ej. 5 horas ={" "}
          <Text style={styles.exampleStrong}>
            {formatCurrency(previewPrice * 5)}
          </Text>
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
    fontWeight: "600",
  },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary },
  sectionSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    marginBottom: 10,
    fontWeight: "600",
  },
  fieldGroup: { marginBottom: 12 },
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
    fontWeight: "700",
    color: COLORS.textTertiary,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    paddingVertical: 12,
  },
  unit: {
    fontSize: 13,
    color: COLORS.textTertiary,
    fontWeight: "600",
    paddingLeft: 6,
  },
  exampleText: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textTertiary,
    fontWeight: "600",
  },
  exampleStrong: { color: COLORS.primary, fontWeight: "800" },
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
  saveBtnText: { color: COLORS.white, fontSize: 16, fontWeight: "800" },
});
