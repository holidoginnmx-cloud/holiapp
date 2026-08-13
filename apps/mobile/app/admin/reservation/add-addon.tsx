import { COLORS } from "@/constants/colors";
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getReservationById,
  getAdminServices,
  adminCreateReservationAddon,
} from "@/lib/api";
import { formatName, formatCurrency } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";
import { SwitchRow } from "@/components/SwitchRow";
import { SelectField } from "@/components/SelectField";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import { bathSizeKey, sizeFromWeight } from "@holidoginn/shared/src/pricing";

/**
 * Agrega un servicio a una reserva que ya existe: el caso que faltaba para
 * poder regalar un baño ("que salga en la agenda y lo bañen, pero no se
 * cobre") o sumar un desparasitante después de crearla.
 *
 * El toggle de cortesía NO es cosmético: el servidor deja el add-on fuera del
 * total, así que el saldo del cliente y el auto-cierre de la reserva siguen
 * cuadrando sin que nadie tenga que acordarse de ajustar el precio a mano.
 */
export default function AdminAddAddonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const {
    data: reservation,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
  });

  const { data: services, isLoading: loadingServices } = useQuery({
    queryKey: ["admin", "services"],
    queryFn: getAdminServices,
  });

  const [serviceCode, setServiceCode] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [isCourtesy, setIsCourtesy] = useState(false);
  const [courtesyReason, setCourtesyReason] = useState("");
  const [internalNote, setInternalNote] = useState("");

  const activeServices = useMemo(
    () => (services ?? []).filter((s) => s.isActive),
    [services],
  );
  const selectedService = activeServices.find((s) => s.code === serviceCode);

  // Talla del perro para preseleccionar la variante correcta: el catálogo de
  // baño tiene una fila por talla × combinación de corte/deslanado, y elegir a
  // mano entre 16 opciones invita a equivocarse.
  // El catálogo de baño se indexa por S/M/L/XL, y la talla sale del PESO (no de
  // la talla visual del perro, que es otra escala). `bathSizeKey` colapsa XS→S.
  const petSizeKey = reservation?.pet?.weight != null
    ? bathSizeKey(sizeFromWeight(reservation.pet.weight))
    : null;

  const variants = useMemo(() => {
    const all = (selectedService?.variants ?? []).filter((v) => v.isActive);
    if (selectedService?.code !== "BATH" || !petSizeKey) return all;
    // En baño se acotan a la talla del perro; si no hay ninguna, se muestran
    // todas para no dejar la pantalla vacía.
    const porTalla = all.filter((v) => v.petSize === petSizeKey);
    return porTalla.length > 0 ? porTalla : all;
  }, [selectedService, petSizeKey]);

  const selectedVariant = variants.find((v) => v.id === variantId);

  function variantLabel(v: { petSize: string; deslanado: boolean; corte: boolean; price: number }) {
    const extras: string[] = [];
    if (v.deslanado) extras.push("Deslanado");
    if (v.corte) extras.push("Corte");
    const sufijo = extras.length > 0 ? ` + ${extras.join(" + ")}` : "";
    return `${v.petSize}${sufijo} — ${formatCurrency(v.price)}`;
  }

  const mutation = useMutation({
    mutationFn: () =>
      adminCreateReservationAddon(id!, {
        variantId: variantId!,
        isCourtesy,
        ...(isCourtesy && courtesyReason.trim()
          ? { courtesyReason: courtesyReason.trim() }
          : {}),
        ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
      }),
    onSuccess: (res) => {
      invalidateReservationScope(qc, id);
      const impacto =
        res.addedToTotal > 0
          ? `Se sumaron ${formatCurrency(res.addedToTotal)} al total (${formatCurrency(res.totalAmount)}).`
          : "No se sumó nada al total.";
      Alert.alert("Servicio agregado", impacto, [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => Alert.alert("No se pudo agregar", e.message),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (isError || !reservation) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : "No se pudo cargar"}
        onRetry={refetch}
      />
    );
  }

  const canSubmit = !!variantId && !mutation.isPending;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.pet}>{formatName(reservation.pet?.name ?? "")}</Text>
      <Text style={styles.subtitle}>
        Total actual: {formatCurrency(Number(reservation.totalAmount))}
      </Text>

      <Text style={styles.label}>Servicio</Text>
      {loadingServices ? (
        <ActivityIndicator color={COLORS.primary} />
      ) : (
        <View style={styles.chipRow}>
          {activeServices.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[
                styles.chip,
                serviceCode === s.code && styles.chipActive,
              ]}
              onPress={() => {
                setServiceCode(s.code);
                setVariantId(null);
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  serviceCode === s.code && { color: COLORS.white },
                ]}
              >
                {s.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {selectedService && (
        <>
          <SelectField
            title="Opción"
            placeholder="Elige una opción"
            options={variants.map((v) => ({
              key: v.id,
              label: variantLabel(v),
            }))}
            selectedKey={variantId}
            onSelect={setVariantId}
            emptyText="No hay opciones activas para este servicio."
            testID="admin-add-addon-variant"
          />
          {selectedService.code === "BATH" && petSizeKey ? (
            <Text style={styles.hint}>
              Filtrado por la talla del perro ({petSizeKey}).
            </Text>
          ) : null}
        </>
      )}

      <SwitchRow
        label="Cortesía"
        hint="Se agenda y se ejecuta, pero no se cobra ni suma al total."
        value={isCourtesy}
        onValueChange={setIsCourtesy}
        testID="admin-add-addon-courtesy"
      />

      {isCourtesy && (
        <>
          <Text style={styles.label}>Motivo de la cortesía (opcional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Descuento olvidado, compensación…"
            placeholderTextColor={COLORS.textDisabled}
            value={courtesyReason}
            onChangeText={setCourtesyReason}
          />
        </>
      )}

      <Text style={styles.label}>Nota para quien lo ejecuta (opcional)</Text>
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="Ej. Usar shampoo hipoalergénico."
        placeholderTextColor={COLORS.textDisabled}
        value={internalNote}
        onChangeText={setInternalNote}
        multiline
        maxLength={500}
      />

      {/* Vista previa del impacto en el total: el equipo tiene que ver qué va a
          pasar con el dinero ANTES de guardar. */}
      {selectedVariant && (
        <View style={styles.previewBox}>
          <Ionicons
            name={isCourtesy ? "gift-outline" : "cash-outline"}
            size={18}
            color={isCourtesy ? COLORS.warningText : COLORS.primary}
          />
          <Text style={styles.previewText}>
            {isCourtesy
              ? `No suma al total. Se registra que se regalaron ${formatCurrency(selectedVariant.price)}.`
              : `Se sumarán ${formatCurrency(selectedVariant.price)} al total: ${formatCurrency(
                  Number(reservation.totalAmount) + selectedVariant.price,
                )}.`}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitBtn, !canSubmit && { opacity: 0.5 }]}
        onPress={() => mutation.mutate()}
        disabled={!canSubmit}
        testID="admin-add-addon-submit"
      >
        <Text style={styles.submitText}>
          {mutation.isPending ? "Agregando..." : "Agregar servicio"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  pet: {
    fontSize: 20,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginTop: 16,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 4,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.bgSection,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    backgroundColor: COLORS.white,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  previewBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    padding: 14,
    marginTop: 20,
  },
  previewText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
  },
  submitBtn: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  submitText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});
