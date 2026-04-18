import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAdminChangeRequests,
  approveChangeRequest,
  rejectChangeRequest,
  type ChangeRequestWithReservation,
} from "@/lib/api";

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
}

function formatMoney(n: number | string): string {
  return `$${Number(n).toLocaleString("es-MX")}`;
}

export default function AdminChangeRequestsScreen() {
  const qc = useQueryClient();
  const [rejectModalFor, setRejectModalFor] = useState<ChangeRequestWithReservation | null>(
    null
  );
  const [rejectReason, setRejectReason] = useState("");

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["admin", "change-requests", "PENDING"],
    queryFn: () => listAdminChangeRequests("PENDING"),
  });

  const approveMutation = useMutation({
    mutationFn: approveChangeRequest,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "change-requests"] });
      Alert.alert("Aprobado", "La solicitud fue aprobada.");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rejectChangeRequest(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "change-requests"] });
      setRejectModalFor(null);
      setRejectReason("");
      Alert.alert("Rechazado", "El owner fue notificado.");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="checkmark-done-outline" size={48} color={COLORS.textDisabled} />
            <Text style={styles.emptyText}>No hay solicitudes pendientes</Text>
          </View>
        }
        renderItem={({ item }) => {
          const delta = Number(item.deltaAmount);
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.petName}>{item.reservation.pet.name}</Text>
                <Text style={styles.ownerName}>
                  {item.reservation.owner.firstName} {item.reservation.owner.lastName}
                </Text>
              </View>

              <View style={styles.datesRow}>
                <View>
                  <Text style={styles.label}>Actual</Text>
                  <Text style={styles.dateText}>
                    {formatDate(String(item.reservation.checkIn))} →{" "}
                    {formatDate(String(item.reservation.checkOut))}
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color={COLORS.textTertiary} />
                <View>
                  <Text style={styles.label}>Nuevo</Text>
                  <Text style={[styles.dateText, { color: COLORS.primary }]}>
                    {formatDate(item.newCheckIn)} → {formatDate(item.newCheckOut)}
                  </Text>
                </View>
              </View>

              <View style={styles.deltaRow}>
                <Text style={styles.deltaLabel}>Diferencia</Text>
                <Text
                  style={[
                    styles.deltaValue,
                    { color: delta > 0 ? COLORS.errorText : COLORS.successText },
                  ]}
                >
                  {delta > 0 ? "+" : ""}
                  {formatMoney(delta)}
                </Text>
              </View>

              {item.reservation.room && (
                <Text style={styles.roomText}>
                  Cuarto: {item.reservation.room.name}
                </Text>
              )}

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={() =>
                    Alert.alert(
                      "Aprobar extensión",
                      `Se extenderá la estadía y quedará un saldo pendiente de ${formatMoney(delta)}.`,
                      [
                        { text: "Cancelar", style: "cancel" },
                        {
                          text: "Aprobar",
                          onPress: () => approveMutation.mutate(item.id),
                        },
                      ]
                    )
                  }
                  disabled={approveMutation.isPending}
                >
                  <Ionicons name="checkmark" size={18} color={COLORS.white} />
                  <Text style={styles.approveText}>Aprobar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rejectButton}
                  onPress={() => setRejectModalFor(item)}
                  disabled={rejectMutation.isPending}
                >
                  <Ionicons name="close" size={18} color={COLORS.errorText} />
                  <Text style={styles.rejectText}>Rechazar</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      <Modal
        visible={!!rejectModalFor}
        transparent
        animationType="slide"
        onRequestClose={() => setRejectModalFor(null)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Rechazar solicitud</Text>
            <Text style={styles.sheetBody}>
              Escribe una razón para que el owner entienda por qué se rechaza.
            </Text>
            <TextInput
              style={styles.textArea}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Ej. No hay disponibilidad en esas fechas"
              placeholderTextColor={COLORS.textDisabled}
              multiline
              numberOfLines={4}
            />
            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setRejectModalFor(null);
                  setRejectReason("");
                }}
              >
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  (!rejectReason.trim() || rejectMutation.isPending) && { opacity: 0.5 },
                ]}
                onPress={() =>
                  rejectModalFor &&
                  rejectMutation.mutate({
                    id: rejectModalFor.id,
                    reason: rejectReason.trim(),
                  })
                }
                disabled={!rejectReason.trim() || rejectMutation.isPending}
              >
                <Text style={styles.confirmText}>Rechazar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyText: { fontSize: 14, color: COLORS.textDisabled, marginTop: 12 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  petName: { fontSize: 17, fontWeight: "800", color: COLORS.textPrimary },
  ownerName: { fontSize: 13, color: COLORS.textTertiary },
  datesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  label: { fontSize: 11, color: COLORS.textDisabled, fontWeight: "600", marginBottom: 2 },
  dateText: { fontSize: 13, fontWeight: "600", color: COLORS.textPrimary },
  deltaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  deltaLabel: { fontSize: 13, color: COLORS.textTertiary, fontWeight: "600" },
  deltaValue: { fontSize: 16, fontWeight: "800" },
  roomText: { fontSize: 12, color: COLORS.textTertiary },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  approveButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.successText,
  },
  approveText: { color: COLORS.white, fontWeight: "700" },
  rejectButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.errorText,
    backgroundColor: COLORS.white,
  },
  rejectText: { color: COLORS.errorText, fontWeight: "700" },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.white,
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary, marginBottom: 6 },
  sheetBody: { fontSize: 13, color: COLORS.textTertiary, marginBottom: 12 },
  textArea: {
    backgroundColor: COLORS.bgPage,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  sheetActions: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: COLORS.bgSection, alignItems: "center" },
  cancelText: { color: COLORS.textTertiary, fontWeight: "700" },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: COLORS.errorText, alignItems: "center" },
  confirmText: { color: COLORS.white, fontWeight: "700" },
});
