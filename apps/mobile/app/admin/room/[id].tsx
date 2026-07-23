import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { deleteRoom, getAdminRoomStatus } from "@/lib/api";
import { formatName, formatDayShort } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

const SIZE_LABELS: Record<string, string> = {
  XS: "Extra pequeño",
  S: "Pequeño",
  M: "Mediano",
  L: "Grande",
  XL: "Extra grande",
};

function formatDate(date: string | Date): string {
  // checkIn/checkOut son @db.Date (medianoche UTC): formatear en UTC evita el
  // corrimiento de un día en zonas al oeste de UTC.
  return formatDayShort(date, { timeZone: "UTC" });
}

export default function RoomDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: rooms, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "rooms"],
    queryFn: getAdminRoomStatus,
  });

  const room = rooms?.find((r) => r.id === id);

  const deleteMutation = useMutation({
    mutationFn: () => deleteRoom(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "rooms"] });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      router.replace("/admin/rooms" as any);
    },
    onError: (err: Error) => {
      Alert.alert("No se pudo eliminar", err.message);
    },
  });

  const confirmDelete = () => {
    if (!room) return;
    const activeCount = room.currentReservations?.length ?? 0;
    if (activeCount > 0) {
      Alert.alert(
        "Cuarto ocupado",
        "Este cuarto tiene reservaciones activas. Cancélalas o márcalas como check-out antes de eliminar.",
      );
      return;
    }
    Alert.alert(
      "Eliminar cuarto",
      `¿Seguro que quieres eliminar "${room.name}"? Esta acción no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => deleteMutation.mutate(),
        },
      ],
    );
  };

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!room) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Cuarto no encontrado</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => router.replace("/admin/rooms" as any)}
        >
          <Text style={styles.retryText}>Volver a cuartos</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const reservations = room.currentReservations ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      {/* Header con nombre + status */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{room.name}</Text>
          {room.description ? (
            <Text style={styles.description}>{room.description}</Text>
          ) : null}
        </View>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: room.isActive
                ? COLORS.successBg
                : COLORS.bgSection,
            },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: room.isActive
                  ? COLORS.successText
                  : COLORS.textDisabled,
              },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              {
                color: room.isActive
                  ? COLORS.successText
                  : COLORS.textTertiary,
              },
            ]}
          >
            {room.isActive ? "Activo" : "Inactivo"}
          </Text>
        </View>
      </View>

      {/* Datos del cuarto */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Información</Text>

        <View style={styles.row}>
          <Ionicons name="people-outline" size={18} color={COLORS.primary} />
          <Text style={styles.rowLabel}>Capacidad</Text>
          <Text style={styles.rowValue}>
            {room.capacity} {room.capacity === 1 ? "perro" : "perros"}
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <Ionicons name="resize-outline" size={18} color={COLORS.primary} />
          <Text style={styles.rowLabel}>Tamaños permitidos</Text>
          <View style={styles.sizesWrap}>
            {(room.sizeAllowed as string[]).map((s) => (
              <View key={s} style={styles.sizePill}>
                <Text style={styles.sizePillText}>
                  {s} · {SIZE_LABELS[s] ?? s}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Mascotas hospedadas actualmente */}
      <Text style={styles.groupTitle}>
        Ocupación actual · {reservations.length}/{room.capacity}
      </Text>
      {reservations.length > 0 ? (
        reservations.map((reservation) => (
          <TouchableOpacity
            key={reservation.reservationId}
            style={styles.guestCard}
            activeOpacity={0.85}
            onPress={() =>
              router.push(
                `/admin/reservation/${reservation.reservationId}` as any
              )
            }
            testID={`room-guest-card-${reservation.reservationId}`}
          >
            <Image
              source={
                reservation.pet?.photoUrl
                  ? { uri: reservation.pet.photoUrl }
                  : require("../../../assets/pet-placeholder.png")
              }
              style={styles.guestPhoto}
              defaultSource={require("../../../assets/pet-placeholder.png")}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.guestName}>
                {formatName(reservation.pet?.name ?? "—")}
              </Text>
              <Text style={styles.guestMeta}>
                {reservation.pet?.breed || "Sin raza especificada"} ·{" "}
                {SIZE_LABELS[reservation.pet?.size ?? ""] ?? reservation.pet?.size ?? "—"}
              </Text>
              <View style={styles.ownerRow}>
                <Ionicons
                  name="person-outline"
                  size={13}
                  color={COLORS.textTertiary}
                />
                <Text style={styles.ownerText} numberOfLines={1}>
                  {formatName(reservation.owner?.name ?? "—")}
                </Text>
              </View>
              <View style={styles.datesRow}>
                <Ionicons
                  name="calendar-outline"
                  size={13}
                  color={COLORS.primary}
                />
                <Text style={styles.datesText}>
                  {formatDate(reservation.checkIn)} →{" "}
                  {formatDate(reservation.checkOut)}
                </Text>
              </View>
              {reservation.staff && (
                <View style={styles.staffRow}>
                  <Ionicons
                    name="ribbon-outline"
                    size={13}
                    color={COLORS.textTertiary}
                  />
                  <Text style={styles.staffText}>
                    Asignado a {formatName(reservation.staff.name)}
                  </Text>
                </View>
              )}
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={COLORS.textTertiary}
            />
          </TouchableOpacity>
        ))
      ) : (
        <View style={styles.emptyGuest}>
          <Ionicons name="bed-outline" size={28} color={COLORS.textDisabled} />
          <Text style={styles.emptyGuestText}>
            El cuarto está disponible en este momento.
          </Text>
        </View>
      )}

      {/* Botón editar */}
      <TouchableOpacity
        style={styles.editBtn}
        onPress={() =>
          router.push(`/admin/room/edit?id=${room.id}` as any)
        }
        activeOpacity={0.85}
        testID="room-edit-btn"
      >
        <Ionicons name="create-outline" size={18} color={COLORS.white} />
        <Text style={styles.editBtnText}>Editar información</Text>
      </TouchableOpacity>

      {/* Botón eliminar */}
      <TouchableOpacity
        style={[
          styles.deleteBtn,
          deleteMutation.isPending && styles.deleteBtnDisabled,
        ]}
        onPress={confirmDelete}
        activeOpacity={0.85}
        disabled={deleteMutation.isPending}
        testID="room-delete-btn"
      >
        {deleteMutation.isPending ? (
          <ActivityIndicator color={COLORS.dangerText} />
        ) : (
          <>
            <Ionicons name="trash-outline" size={18} color={COLORS.dangerText} />
            <Text style={styles.deleteBtnText}>Eliminar cuarto</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: COLORS.bgPage,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  name: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  description: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 4,
    lineHeight: 20,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  rowLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    flexShrink: 0,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginLeft: "auto",
  },
  sizesWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
    marginLeft: "auto",
    justifyContent: "flex-end",
  },
  sizePill: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  sizePillText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.bgSection,
    marginVertical: 6,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  guestCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  guestPhoto: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.bgSection,
  },
  guestName: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  guestMeta: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  ownerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  ownerText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: "600",
    flexShrink: 1,
  },
  datesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  datesText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: "700",
  },
  staffRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  staffText: {
    fontSize: 11,
    color: COLORS.textTertiary,
    fontStyle: "italic",
  },
  emptyGuest: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  emptyGuestText: {
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: "center",
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 4,
  },
  editBtnText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.dangerText,
  },
  deleteBtnDisabled: {
    opacity: 0.6,
  },
  deleteBtnText: {
    color: COLORS.dangerText,
    fontSize: 15,
    fontWeight: "700",
  },
  errorText: {
    fontSize: 15,
    color: COLORS.dangerText,
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 14,
  },
});
