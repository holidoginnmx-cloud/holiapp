import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStaffBaths, completeStaffBath, type StaffBath } from "@/lib/api";

const SIZE_LABEL: Record<string, string> = {
  XS: "XS",
  S: "S",
  M: "M",
  L: "L",
  XL: "XL",
};

function todayYMD(): string {
  const now = new Date();
  // Hora Hermosillo (UTC-7)
  const local = new Date(now.getTime() - 7 * 3600 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function addDaysYMD(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString("es-MX", {
    timeZone: "America/Hermosillo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function describeVariant(bath: StaffBath): string {
  const variant = bath.addons[0]?.variant;
  if (!variant) return "Baño";
  const extras: string[] = [];
  if (variant.deslanado) extras.push("Deslanado");
  if (variant.corte) extras.push("Corte");
  return extras.length > 0 ? `Baño + ${extras.join(" + ")}` : "Baño";
}

export default function StaffBaths() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState<string>(() => todayYMD());
  const [completingId, setCompletingId] = useState<string | null>(null);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["staff-baths", date],
    queryFn: () => getStaffBaths(date),
    refetchInterval: 60_000,
  });

  const baths = data?.baths ?? [];
  const { pending, done } = useMemo(() => {
    return {
      pending: baths.filter((b) => b.status !== "CHECKED_OUT"),
      done: baths.filter((b) => b.status === "CHECKED_OUT"),
    };
  }, [baths]);

  async function handleComplete(bath: StaffBath) {
    Alert.alert(
      "Marcar como completado",
      `¿Confirmar que ${bath.pet.name} ya terminó su baño? Se notificará al dueño.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Completar",
          onPress: async () => {
            setCompletingId(bath.id);
            try {
              await completeStaffBath(bath.id);
              queryClient.invalidateQueries({ queryKey: ["staff-baths"] });
            } catch (err) {
              const msg = err instanceof Error ? err.message : "No se pudo completar";
              Alert.alert("Error", msg);
            } finally {
              setCompletingId(null);
            }
          },
        },
      ],
    );
  }

  const renderBath = ({ item }: { item: StaffBath }) => {
    const isDone = item.status === "CHECKED_OUT";
    const variantLine = describeVariant(item);
    const ownerPhone = item.owner.phone;

    return (
      <View style={[styles.card, isDone && styles.cardDone]} testID={`bath-card-${item.id}`}>
        <View style={styles.cardHeader}>
          <View style={styles.timeBadge}>
            <Ionicons name="time-outline" size={14} color={COLORS.primary} />
            <Text style={styles.timeText}>
              {item.appointmentAt ? formatTime(item.appointmentAt) : "—"}
            </Text>
          </View>
          {isDone && (
            <View style={styles.doneBadge}>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.successText} />
              <Text style={styles.doneText}>Completado</Text>
            </View>
          )}
        </View>

        <View style={styles.petRow}>
          <View style={styles.avatar}>
            <Ionicons name="paw" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.petName}>{item.pet.name}</Text>
            <Text style={styles.petMeta}>
              {item.pet.weight ? `${item.pet.weight} kg · ` : ""}
              {item.pet.breed || "Sin raza"} · Talla {SIZE_LABEL[item.pet.size]}
            </Text>
          </View>
        </View>

        <View style={styles.row}>
          <Ionicons name="water-outline" size={16} color={COLORS.textTertiary} />
          <Text style={styles.rowText}>{variantLine}</Text>
        </View>

        <View style={styles.row}>
          <Ionicons name="person-outline" size={16} color={COLORS.textTertiary} />
          <Text style={styles.rowText}>
            {item.owner.firstName} {item.owner.lastName}
          </Text>
          {ownerPhone && (
            <TouchableOpacity
              onPress={() => Linking.openURL(`tel:${ownerPhone}`)}
              style={styles.callBtn}
            >
              <Ionicons name="call" size={14} color={COLORS.primary} />
              <Text style={styles.callText}>Llamar</Text>
            </TouchableOpacity>
          )}
        </View>

        {item.pet.notes && (
          <View style={styles.notes}>
            <Ionicons
              name="information-circle-outline"
              size={14}
              color={COLORS.warningText}
            />
            <Text style={styles.notesText}>{item.pet.notes}</Text>
          </View>
        )}

        {!isDone && (
          <TouchableOpacity
            style={[
              styles.completeBtn,
              completingId === item.id && styles.completeBtnDisabled,
            ]}
            onPress={() => handleComplete(item)}
            disabled={completingId === item.id}
            testID={`bath-complete-${item.id}`}
          >
            {completingId === item.id ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color={COLORS.white} />
                <Text style={styles.completeText}>Marcar completado</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  type Row =
    | { type: "header"; title: string; count: number }
    | { type: "item"; bath: StaffBath }
    | { type: "empty"; msg: string };

  const rows: Row[] = [];
  const sections: { title: string; data: StaffBath[]; emptyMsg: string | null }[] = [
    { title: "Pendientes", data: pending, emptyMsg: "No hay baños pendientes hoy" },
    { title: "Completados", data: done, emptyMsg: null },
  ];
  for (const s of sections) {
    if (s.data.length > 0) {
      rows.push({ type: "header", title: s.title, count: s.data.length });
      for (const b of s.data) rows.push({ type: "item", bath: b });
    } else if (s.emptyMsg) {
      rows.push({ type: "empty", msg: s.emptyMsg });
    }
  }

  return (
    <View style={styles.container}>
      {/* Date nav */}
      <View style={styles.dateNav}>
        <TouchableOpacity
          onPress={() => setDate((d) => addDaysYMD(d, -1))}
          style={styles.dateBtn}
        >
          <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={styles.dateDisplay}>
          <Text style={styles.dateText}>{formatDate(date)}</Text>
          {date !== todayYMD() && (
            <TouchableOpacity onPress={() => setDate(todayYMD())}>
              <Text style={styles.todayLink}>Ir a hoy</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={() => setDate((d) => addDaysYMD(d, 1))}
          style={styles.dateBtn}
        >
          <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList<Row>
          data={rows}
          keyExtractor={(item, i) =>
            item.type === "item" ? item.bath.id : `${item.type}-${i}`
          }
          renderItem={({ item }) => {
            if (item.type === "header") {
              return (
                <Text style={styles.sectionHeader}>
                  {item.title} · {item.count}
                </Text>
              );
            }
            if (item.type === "empty") {
              return (
                <View style={styles.emptyCard}>
                  <Ionicons name="water-outline" size={32} color={COLORS.border} />
                  <Text style={styles.emptyText}>{item.msg}</Text>
                </View>
              );
            }
            return renderBath({ item: item.bath });
          }}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="water-outline" size={32} color={COLORS.border} />
              <Text style={styles.emptyText}>Sin citas de baño este día</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  dateBtn: {
    padding: 8,
    borderRadius: 8,
  },
  dateDisplay: { flex: 1, alignItems: "center" },
  dateText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  todayLink: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: "600",
    marginTop: 2,
  },
  listContent: { padding: 16, paddingBottom: 40 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardDone: {
    opacity: 0.75,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  timeText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.primary,
  },
  doneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.successBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  doneText: {
    fontSize: 11,
    color: COLORS.successText,
    fontWeight: "700",
  },
  petRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  petName: { fontSize: 17, fontWeight: "700", color: COLORS.textPrimary },
  petMeta: { fontSize: 13, color: COLORS.textTertiary, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowText: { fontSize: 13, color: COLORS.textSecondary, flex: 1 },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 999,
  },
  callText: { fontSize: 12, fontWeight: "700", color: COLORS.primary },
  notes: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: COLORS.notesBg,
    padding: 8,
    borderRadius: 8,
  },
  notesText: { flex: 1, fontSize: 12, color: COLORS.notesText },
  completeBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 11,
    borderRadius: 10,
    marginTop: 4,
  },
  completeBtnDisabled: { opacity: 0.7 },
  completeText: { color: COLORS.white, fontSize: 15, fontWeight: "700" },
  emptyCard: {
    alignItems: "center",
    padding: 24,
    gap: 8,
  },
  emptyText: { fontSize: 13, color: COLORS.textDisabled },
});
