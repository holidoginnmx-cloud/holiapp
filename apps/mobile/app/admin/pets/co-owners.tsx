import { COLORS } from "@/constants/colors";
import { useState, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { ErrorState } from "@/components/ErrorState";
import {
  getUsers,
  getPetCoOwners,
  addPetCoOwner,
  removePetCoOwner,
  getPetInvites,
  revokePetInvite,
} from "@/lib/api";
import type { AdminUserListItem } from "@/lib/api";
import {
  formatName,
  formatPhoneInput,
  formatDayShort,
  displayEmail,
  NO_EMAIL_LABEL,
} from "@/lib/format";

import { alertaDeError } from "@/lib/errorAlert";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

/**
 * ¿Quién más tiene este perro en su cuenta?
 *
 * Caso típico: pareja o familia que comparte perro, cada quien con su cuenta.
 * El que lo registró queda como dueño y el otro no ve nada, así que acaba
 * registrando al mismo perro otra vez. Aquí se vincula a la segunda persona.
 *
 * El dueño NO cambia: el co-dueño se suma. Ve la ficha, la cartilla, los
 * reportes y el historial, puede reservar y recibe los mismos avisos. Lo único
 * que no se comparte es el dinero: el saldo a favor es de cada quien y cada
 * reserva queda a nombre de quien la hizo.
 */
export default function AdminPetCoOwnersScreen() {
  const { petId } = useLocalSearchParams<{ petId: string }>();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const {
    data: info,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["pet", petId, "co-owners"],
    queryFn: () => getPetCoOwners(petId!),
    enabled: !!petId,
  });

  const { data: users } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
    enabled: adding,
  });

  // Invitaciones que el DUEÑO mandó desde su app y nadie ha aceptado. Se
  // enseñan para contestar "ya la mandé, ¿le llegó?" y para poder cancelar una
  // mandada por error. `invalidate()` las alcanza por el prefijo ["pet", petId].
  const { data: invitesInfo } = useQuery({
    queryKey: ["pet", petId, "invites"],
    queryFn: () => getPetInvites(petId!),
    enabled: !!petId,
  });

  const linkedIds = useMemo(
    () =>
      new Set(
        [info?.owner?.id, ...(info?.coOwners ?? []).map((c) => c.user.id)].filter(
          Boolean,
        ) as string[],
      ),
    [info],
  );

  // Clientes activos que todavía no están vinculados. Se busca por nombre,
  // correo o dígitos del teléfono (están capturados en formato libre).
  const candidates = useMemo(() => {
    const base = (users ?? []).filter(
      (u) => u.role === "OWNER" && u.isActive !== false && !linkedIds.has(u.id),
    );
    const q = search.trim().toLowerCase();
    if (!q) return base;
    const digits = q.replace(/\D/g, "");
    return base.filter((u) => {
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      const phoneDigits = (u.phone ?? "").replace(/\D/g, "");
      return (
        name.includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (digits.length > 0 && phoneDigits.includes(digits))
      );
    });
  }, [users, linkedIds, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pet", petId, "co-owners"] });
    qc.invalidateQueries({ queryKey: ["pet", petId] });
    qc.invalidateQueries({ queryKey: ["pets"] });
  };

  const addMutation = useMutation({
    mutationFn: (userId: string) => addPetCoOwner(petId!, userId),
    onSuccess: () => {
      setAdding(false);
      setSearch("");
      invalidate();
      Alert.alert(
        "Listo",
        `${info?.pet.name ?? "La mascota"} ya está en las dos cuentas. A la persona le llega un aviso.`,
      );
    },
    onError: (err: any) => {
      alertaDeError(err, { titulo: "No se pudo", respaldo: "Intenta de nuevo." });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removePetCoOwner(petId!, userId),
    onSuccess: invalidate,
    onError: (err: any) => {
      alertaDeError(err, { titulo: "No se pudo", respaldo: "Intenta de nuevo." });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revokePetInvite(petId!, inviteId),
    onSuccess: invalidate,
    onError: (err: any) => {
      alertaDeError(err, { titulo: "No se pudo", respaldo: "Intenta de nuevo." });
    },
  });

  const confirmRevoke = (inviteId: string, code: string) => {
    Alert.alert(
      `¿Cancelar la invitación ${code}?`,
      "La liga y el código dejan de servir: quien la recibió ya no podrá aceptarla.",
      [
        { text: "No", style: "cancel" },
        {
          text: "Cancelar invitación",
          style: "destructive",
          onPress: () => revokeMutation.mutate(inviteId),
        },
      ],
    );
  };

  const confirmRemove = (userId: string, name: string) => {
    Alert.alert(
      `¿Quitar a ${formatName(name)}?`,
      `Dejará de ver a ${info?.pet.name ?? "la mascota"} en su cuenta y ya no recibirá sus avisos. El perro y su historial no se tocan.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Quitar",
          style: "destructive",
          onPress: () => removeMutation.mutate(userId),
        },
      ],
    );
  };

  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !info) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (adding) {
    return (
      <View style={styles.screen}>
        <View style={styles.introCard}>
          <Ionicons name="people" size={20} color={COLORS.primary} />
          <Text style={styles.introText}>
            ¿Quién más cuida a {info.pet.name}? Va a ver su ficha, su cartilla y sus reportes, y
            va a poder reservar. Su saldo a favor sigue siendo aparte.
          </Text>
        </View>

        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={COLORS.textDisabled} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre o teléfono..."
            placeholderTextColor={COLORS.textDisabled}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            testID="co-owner-search"
          />
          {search.length > 0 && (
            <Ionicons
              name="close-circle"
              size={18}
              color={COLORS.textDisabled}
              onPress={() => setSearch("")}
            />
          )}
        </View>

        <FlatList
          data={candidates}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }: { item: AdminUserListItem }) => (
            <TouchableOpacity
              style={styles.clientRow}
              activeOpacity={0.7}
              disabled={addMutation.isPending}
              onPress={() => addMutation.mutate(item.id)}
              testID={`co-owner-pick-${item.id}`}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.firstName?.[0]?.toUpperCase() ?? "?"}
                </Text>
              </View>
              <View style={styles.clientInfo}>
                <Text style={styles.clientName} numberOfLines={1}>
                  {formatName(item.firstName)} {formatName(item.lastName)}
                </Text>
                <Text style={styles.clientSub} numberOfLines={1}>
                  {item.phone
                    ? formatPhoneInput(item.phone)
                    : displayEmail(item.email) || NO_EMAIL_LABEL}
                </Text>
              </View>
              <Ionicons name="add-circle" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={44} color={COLORS.border} />
              <Text style={styles.emptyText}>
                {search
                  ? "Nadie coincide. Si todavía no tiene cuenta, primero hay que darla de alta."
                  : "No hay clientes disponibles para vincular."}
              </Text>
            </View>
          }
        />

        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => {
            setAdding(false);
            setSearch("");
          }}
        >
          <Text style={styles.cancelBtnText}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.introCard}>
        <Ionicons name="people" size={20} color={COLORS.primary} />
        <Text style={styles.introText}>
          Quiénes tienen a {info.pet.name} en su cuenta. Sirve para las parejas y familias que
          comparten perro: así no lo registran dos veces. El dueño también puede invitar él solo
          desde su app.
        </Text>
      </View>

      <FlatList
        data={info.coOwners}
        keyExtractor={(item) => item.user.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          info.owner ? (
            <View style={styles.clientRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {info.owner.firstName?.[0]?.toUpperCase() ?? "?"}
                </Text>
              </View>
              <View style={styles.clientInfo}>
                <Text style={styles.clientName} numberOfLines={1}>
                  {formatName(info.owner.firstName)} {formatName(info.owner.lastName ?? "")}
                </Text>
                <Text style={styles.clientSub} numberOfLines={1}>
                  {info.owner.phone
                    ? formatPhoneInput(info.owner.phone)
                    : displayEmail(info.owner.email) || NO_EMAIL_LABEL}
                </Text>
              </View>
              <View style={[styles.tag, { backgroundColor: COLORS.primaryLight }]}>
                <Text style={[styles.tagText, { color: COLORS.primary }]}>Dueño</Text>
              </View>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.clientRow}>
            <View style={[styles.avatar, { backgroundColor: COLORS.warningText }]}>
              <Text style={styles.avatarText}>
                {item.user.firstName?.[0]?.toUpperCase() ?? "?"}
              </Text>
            </View>
            <View style={styles.clientInfo}>
              <Text style={styles.clientName} numberOfLines={1}>
                {formatName(item.user.firstName)} {formatName(item.user.lastName ?? "")}
              </Text>
              <Text style={styles.clientSub} numberOfLines={1}>
                {item.user.phone
                  ? formatPhoneInput(item.user.phone)
                  : displayEmail(item.user.email) || NO_EMAIL_LABEL}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => confirmRemove(item.user.id, item.user.firstName)}
              disabled={removeMutation.isPending}
              testID={`co-owner-remove-${item.user.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Quitar a ${formatName(item.user.firstName)}`}
              hitSlop={8}
            >
              <Ionicons name="close-circle-outline" size={22} color={COLORS.errorText} />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="person-outline" size={44} color={COLORS.border} />
            <Text style={styles.emptyText}>
              Por ahora solo lo tiene su dueño.
            </Text>
          </View>
        }
        ListFooterComponent={
          invitesInfo && invitesInfo.invites.length > 0 ? (
            <View style={styles.invitesBlock}>
              <Text style={styles.sectionLabel}>Invitaciones pendientes</Text>
              {invitesInfo.invites.map((inv) => (
                <View key={inv.id} style={styles.clientRow}>
                  <View style={[styles.avatar, { backgroundColor: COLORS.primaryLight }]}>
                    <Ionicons name="mail-outline" size={18} color={COLORS.primary} />
                  </View>
                  <View style={styles.clientInfo}>
                    <Text style={styles.clientName} numberOfLines={1}>
                      {inv.code}
                    </Text>
                    <Text style={styles.clientSub} numberOfLines={1}>
                      La mandó {formatName(inv.invitedBy.firstName)} · vence el{" "}
                      {formatDayShort(inv.expiresAt)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => confirmRevoke(inv.id, inv.code)}
                    disabled={revokeMutation.isPending}
                    testID={`co-owner-invite-revoke-${inv.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Cancelar la invitación ${inv.code}`}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle-outline" size={22} color={COLORS.errorText} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null
        }
      />

      <TouchableOpacity
        style={styles.addBtn}
        activeOpacity={0.85}
        onPress={() => setAdding(true)}
        testID="co-owner-add"
      >
        <Ionicons name="person-add" size={18} color={COLORS.white} />
        <Text style={styles.addBtnText}>Agregar co-dueño</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  introCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 12,
    padding: 12,
    margin: 16,
    marginBottom: 12,
  },
  introText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
  },
  list: { padding: 16, paddingTop: 12, paddingBottom: 32 },
  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  clientInfo: { flex: 1, minWidth: 0 },
  clientName: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  clientSub: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  invitesBlock: { marginTop: 16 },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tagText: { fontSize: 12, fontFamily: "PlusJakartaSans_700Bold" },
  empty: { alignItems: "center", paddingVertical: 40, gap: 12 },
  emptyText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textDisabled,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 20,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    margin: 16,
  },
  addBtnText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  cancelBtn: { alignItems: "center", paddingVertical: 14, margin: 16 },
  cancelBtnText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
});
