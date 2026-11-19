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
import { getReservationById, getStoreVariants, addAccountProduct } from "@/lib/api";
import { formatName, formatCurrency } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import { alertaDeError } from "@/lib/errorAlert";

/**
 * Carga un producto de la tienda (una correa, croquetas…) a la CUENTA de la
 * reserva, para cobrarlo junto con la estancia o el baño (Javier, 18-nov-2026).
 *
 * El stock se descuenta al agregarlo. El cobro llega con el siguiente "Registrar
 * pago manual": el servidor paga primero los productos (cuentan como Tienda en
 * los ingresos) y el resto va a la reserva.
 */
export default function AdminAddProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: reservation } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
  });
  const {
    data: variants,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({ queryKey: ["admin", "store-variants"], queryFn: getStoreVariants });

  const [q, setQ] = useState("");
  const [variantId, setVariantId] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(1);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    const lista = variants ?? [];
    if (!t) return lista;
    return lista.filter(
      (v) => v.product.toLowerCase().includes(t) || v.variant.toLowerCase().includes(t),
    );
  }, [variants, q]);
  const elegida = (variants ?? []).find((v) => v.variantId === variantId) ?? null;

  const mutation = useMutation({
    mutationFn: () => addAccountProduct(id!, { variantId: variantId!, quantity: cantidad }),
    onSuccess: (res) => {
      invalidateReservationScope(qc, id);
      qc.invalidateQueries({ queryKey: ["admin", "store-variants"] });
      if (res.agotado) {
        Alert.alert("Se acabó el stock", `${res.productName} quedó en 0. Revisa el inventario.`);
      }
      router.back();
    },
    onError: (e: Error) => alertaDeError(e, { titulo: "No se pudo agregar el producto" }),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {reservation && (
        <>
          <Text style={styles.pet}>{formatName(reservation.pet?.name ?? "")}</Text>
          <Text style={styles.subtitle}>
            Se cobra junto con el siguiente pago de la reserva. El inventario se descuenta ya.
          </Text>
        </>
      )}

      <TextInput
        style={styles.input}
        placeholder="Buscar producto…"
        placeholderTextColor={COLORS.textTertiary}
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
      />

      <View style={{ marginTop: 12, gap: 8 }}>
        {filtradas.length === 0 && (
          <Text style={styles.hint}>Sin productos que coincidan.</Text>
        )}
        {filtradas.map((v) => {
          const activa = v.variantId === variantId;
          const sinStock = v.stock != null && v.stock <= 0;
          return (
            <TouchableOpacity
              key={v.variantId}
              style={[styles.row, activa && styles.rowActive]}
              onPress={() => {
                setVariantId(v.variantId);
                setCantidad(1);
              }}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{v.product}</Text>
                <Text style={styles.rowSub}>
                  {[v.variant, v.stock == null ? null : sinStock ? "Sin stock" : `${v.stock} en stock`]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <Text style={styles.rowPrice}>{formatCurrency(v.price)}</Text>
              {activa && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {elegida && (
        <View style={styles.previewBox}>
          <View style={styles.stepper}>
            <TouchableOpacity
              onPress={() => setCantidad((c) => Math.max(1, c - 1))}
              style={styles.stepBtn}
              disabled={cantidad <= 1}
            >
              <Ionicons name="remove" size={18} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.stepVal}>{cantidad}</Text>
            <TouchableOpacity
              onPress={() => setCantidad((c) => Math.min(99, c + 1))}
              style={styles.stepBtn}
            >
              <Ionicons name="add" size={18} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.previewText}>
            {elegida.product} · {formatCurrency(elegida.price * cantidad)}
            {elegida.stock != null && cantidad > elegida.stock
              ? `\nSolo quedan ${Math.max(0, elegida.stock)}: se agrega igual y el stock queda en 0.`
              : ""}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitBtn, (!elegida || mutation.isPending) && { opacity: 0.5 }]}
        onPress={() => mutation.mutate()}
        disabled={!elegida || mutation.isPending}
        testID="admin-add-product-submit"
      >
        <Text style={styles.submitText}>
          {mutation.isPending ? "Agregando..." : "Agregar a la cuenta"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  pet: { fontSize: 20, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 16,
  },
  hint: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary },
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
  },
  rowActive: { borderColor: COLORS.primary },
  rowTitle: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textPrimary },
  rowSub: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary },
  rowPrice: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  previewBox: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
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
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
  },
  stepVal: {
    minWidth: 20,
    textAlign: "center",
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  submitBtn: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  submitText: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.white },
});
