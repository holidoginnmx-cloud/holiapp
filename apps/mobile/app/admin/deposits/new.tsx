import { COLORS } from "@/constants/colors";
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createUnassignedDeposit, UNASSIGNED_DEPOSITS_KEY } from "@/lib/api";
import { ClientSearchPicker, type PickedClient } from "@/components/ClientSearchPicker";
import { alertaDeError } from "@/lib/errorAlert";
import { formatCurrency } from "@/lib/format";
import {
  CARD_BRAND_OPTIONS,
  MANUAL_METHOD_OPTIONS,
  manualMethodPayload,
  type CardBrand,
  type ManualPaymentMethod,
} from "@/lib/paymentMethod";

/**
 * Anticipo cobrado SIN reserva (Javier, 18-nov-2026): Jessica pide los datos y
 * el anticipo; hay quien paga y nunca manda los datos del perro. Entra como
 * ingreso «Por asignar» y se cuelga de su reserva cuando exista.
 * El cliente puede no tener ficha: entonces basta su nombre.
 */
export default function NewUnassignedDepositScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [cliente, setCliente] = useState<PickedClient | null>(null);
  const [nombre, setNombre] = useState("");
  const [monto, setMonto] = useState("");
  const [method, setMethod] = useState<ManualPaymentMethod>("TRANSFER");
  const [cardBrand, setCardBrand] = useState<CardBrand | null>(null);
  const [notas, setNotas] = useState("");

  const amount = Number(monto.replace(",", "."));
  const metodo = manualMethodPayload(method, cardBrand);
  const listo = (cliente != null || nombre.trim().length > 0) && amount > 0 && metodo != null;

  const mutation = useMutation({
    mutationFn: () =>
      createUnassignedDeposit({
        userId: cliente?.id ?? null,
        name: cliente ? null : nombre.trim(),
        amount,
        method: metodo!.method,
        ...(metodo!.cardBrand ? { cardBrand: metodo!.cardBrand } : {}),
        notes: notas.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: UNASSIGNED_DEPOSITS_KEY });
      qc.invalidateQueries({ queryKey: ["admin", "revenue"] });
      router.back();
      Alert.alert(
        "Anticipo registrado",
        `${formatCurrency(amount)} quedan «Por asignar». Cuando exista la reserva, asígnalo desde la lista.`,
      );
    },
    onError: (e: Error) => alertaDeError(e, { titulo: "No se pudo registrar el anticipo" }),
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.hint}>
          El cliente ya pagó pero todavía no hay reserva. Cuenta como ingreso desde hoy;
          cuando exista la reserva, lo asignas desde «Anticipos por asignar».
        </Text>

        <Text style={styles.label}>Cliente</Text>
        <ClientSearchPicker value={cliente} onChange={setCliente} />
        {!cliente && (
          <TextInput
            style={styles.input}
            placeholder="…o escribe su nombre si todavía no tiene ficha"
            placeholderTextColor={COLORS.textDisabled}
            value={nombre}
            onChangeText={setNombre}
            maxLength={120}
          />
        )}

        <Text style={styles.label}>Monto</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          placeholderTextColor={COLORS.textDisabled}
          keyboardType="decimal-pad"
          value={monto}
          onChangeText={setMonto}
        />

        <Text style={styles.label}>Método</Text>
        <View style={styles.chipRow}>
          {MANUAL_METHOD_OPTIONS.map((o) => (
            <TouchableOpacity
              key={o.key}
              style={[styles.chip, method === o.key && styles.chipActive]}
              onPress={() => setMethod(o.key)}
            >
              <Text style={[styles.chipText, method === o.key && styles.chipTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {method === "CARD" && (
          <View style={[styles.chipRow, { marginTop: 8 }]}>
            {CARD_BRAND_OPTIONS.map((o) => (
              <TouchableOpacity
                key={o.key}
                style={[styles.chip, cardBrand === o.key && styles.chipActive]}
                onPress={() => setCardBrand(o.key)}
              >
                <Text style={[styles.chipText, cardBrand === o.key && styles.chipTextActive]}>
                  {o.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.label}>Notas (opcional)</Text>
        <TextInput
          style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
          placeholder="Ej. hospedaje 20–23 dic, 2 perros"
          placeholderTextColor={COLORS.textDisabled}
          value={notas}
          onChangeText={setNotas}
          multiline
          maxLength={300}
        />

        <TouchableOpacity
          style={[styles.submitBtn, (!listo || mutation.isPending) && { opacity: 0.5 }]}
          onPress={() => mutation.mutate()}
          disabled={!listo || mutation.isPending}
          testID="deposits-new-submit"
        >
          <Text style={styles.submitText}>
            {mutation.isPending ? "Registrando..." : "Registrar anticipo"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 20, paddingBottom: 40 },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    backgroundColor: COLORS.warningBg,
    borderRadius: 10,
    padding: 12,
  },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginTop: 18,
    marginBottom: 8,
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.bgSection,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textTertiary },
  chipTextActive: { color: COLORS.white },
  submitBtn: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  submitText: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.white },
});
