import { COLORS } from "@/constants/colors";
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getUnassignedDeposits,
  getReservations,
  getAllPets,
  assignDeposit,
  UNASSIGNED_DEPOSITS_KEY,
} from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import { ClientSearchPicker, type PickedClient } from "@/components/ClientSearchPicker";
import { ErrorState } from "@/components/ErrorState";
import { alertaDeError } from "@/lib/errorAlert";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import { formatCurrency, formatDayShort, formatName, formatStayDay } from "@/lib/format";

const TIPO: Record<string, string> = { STAY: "Hospedaje", BATH: "Baño", DAYCARE: "Guardería" };

/**
 * Cuelga un anticipo «Por asignar» de su reserva. Arranca con las reservas del
 * cliente que pagó; si la reserva quedó en otra cuenta (co-dueño, ficha
 * duplicada), se cambia de cliente y el servidor pide confirmarlo.
 */
export default function AssignDepositScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: deposits, isLoading, isError, error, refetch } = useQuery({
    queryKey: UNASSIGNED_DEPOSITS_KEY,
    queryFn: getUnassignedDeposits,
  });
  const deposit = deposits?.find((d) => d.id === id) ?? null;
  const { data: pets } = useQuery({ queryKey: ["admin", "all-pets"], queryFn: getAllPets });

  const [cliente, setCliente] = useState<PickedClient | null>(null);
  // Preselecciona a quien pagó, una sola vez.
  const [precargado, setPrecargado] = useState(false);
  useEffect(() => {
    if (precargado || !deposit) return;
    setPrecargado(true);
    if (deposit.userId) {
      setCliente({
        id: deposit.userId,
        name: deposit.clientName ?? "Cliente",
        petNames: (pets ?? [])
          .filter((p) => p.owner?.id === deposit.userId)
          .map((p) => formatName(p.name)),
      });
    }
  }, [deposit, pets, precargado]);

  const { data: reservas, isLoading: cargandoReservas } = useQuery({
    queryKey: ["reservations", "owner", cliente?.id],
    queryFn: () => getReservations({ ownerId: cliente!.id }),
    enabled: !!cliente,
  });
  const vivas = useMemo(
    () =>
      (reservas ?? [])
        .filter((r) => r.status !== "CANCELLED")
        .sort((a, b) =>
          String(b.checkIn ?? b.appointmentAt ?? "").localeCompare(
            String(a.checkIn ?? a.appointmentAt ?? ""),
          ),
        ),
    [reservas],
  );

  const mutation = useMutation({
    mutationFn: (v: { reservationId: string; confirmOtherOwner?: boolean }) =>
      assignDeposit(id!, v),
    onSuccess: (res, v) => {
      qc.invalidateQueries({ queryKey: UNASSIGNED_DEPOSITS_KEY });
      qc.invalidateQueries({ queryKey: ["admin", "revenue"] });
      invalidateReservationScope(qc, v.reservationId);
      router.back();
      const partes = [
        res.balance > 0 ? `Saldo pendiente de la reserva: ${formatCurrency(res.balance)}.` : null,
        res.overpaid > 0
          ? `Quedó pagada de más por ${formatCurrency(res.overpaid)}: revisa si se devuelve o se deja a favor.`
          : null,
      ].filter(Boolean);
      Alert.alert("Anticipo asignado", partes.join("\n") || "Se aplicó a la reserva.");
    },
    onError: (e: Error, v) => {
      if (e instanceof ApiError && e.code === "OTHER_OWNER") {
        Alert.alert("La reserva es de otra cuenta", e.message, [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Asignar de todos modos",
            onPress: () => mutation.mutate({ ...v, confirmOtherOwner: true }),
          },
        ]);
        return;
      }
      alertaDeError(e, { titulo: "No se pudo asignar" });
    },
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (!deposit) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Este anticipo ya se asignó o ya no existe.</Text>
      </View>
    );
  }

  const fechaDe = (r: (typeof vivas)[number]) =>
    r.reservationType === "STAY"
      ? `${r.checkIn ? formatStayDay(r.checkIn) : ""}${r.checkOut ? ` – ${formatStayDay(r.checkOut)}` : ""}`
      : r.appointmentAt
        ? formatDayShort(r.appointmentAt)
        : "";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.summary}>
        <Text style={styles.summaryAmount}>{formatCurrency(deposit.amount)}</Text>
        <Text style={styles.summarySub}>
          {deposit.clientName ? `Pagado por ${deposit.clientName}` : deposit.notes ?? "Anticipo sin reserva"}
        </Text>
      </View>

      <Text style={styles.label}>Cliente de la reserva</Text>
      <ClientSearchPicker value={cliente} onChange={setCliente} />

      {cliente && (
        <>
          <Text style={styles.label}>Reserva</Text>
          {cargandoReservas ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : vivas.length === 0 ? (
            <Text style={styles.hint}>
              Este cliente no tiene reservas. Créala primero y vuelve a asignar el anticipo.
            </Text>
          ) : (
            vivas.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.card}
                disabled={mutation.isPending}
                onPress={() =>
                  Alert.alert(
                    "Asignar anticipo",
                    `${formatCurrency(deposit.amount)} a ${TIPO[r.reservationType] ?? "la reserva"} de ${formatName(r.pet.name)} (${fechaDe(r)}).`,
                    [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Asignar", onPress: () => mutation.mutate({ reservationId: r.id }) },
                    ],
                  )
                }
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {formatName(r.pet.name)} · {TIPO[r.reservationType] ?? r.reservationType}
                  </Text>
                  <Text style={styles.cardSub}>{fechaDe(r)}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.cardAmount}>{formatCurrency(Number(r.totalAmount))}</Text>
                  <Text style={[styles.cardSub, r.hasBalance && { color: COLORS.warningText }]}>
                    {r.hasBalance ? "Con saldo" : "Pagada"}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </>
      )}
      {mutation.isPending && <ActivityIndicator style={{ marginTop: 16 }} color={COLORS.primary} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  summary: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  summaryAmount: { fontSize: 22, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  summarySub: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 2 },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginTop: 18,
    marginBottom: 8,
  },
  hint: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: 8,
  },
  cardTitle: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  cardSub: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 2 },
  cardAmount: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
});
