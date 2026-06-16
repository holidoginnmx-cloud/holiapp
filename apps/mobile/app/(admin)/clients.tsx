import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Image,
} from "react-native";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ErrorState } from "@/components/ErrorState";
import { getAllPets, getUsers } from "@/lib/api";
import type { PetWithOwner } from "@/lib/api";
import { formatName, formatPhoneInput, displayEmail, NO_EMAIL_LABEL, formatCurrency } from "@/lib/format";
import { cloudinaryResized } from "@/lib/cloudinary";

type OwnerGroup = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  pets: PetWithOwner[];
};

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function AdminClients() {
  const [search, setSearch] = useState("");
  const router = useRouter();

  const { data: pets, isLoading: loadingPets, isError: petsError, error: petsErrorObj, refetch: refetchPets, isRefetching } = useQuery({
    queryKey: ["admin", "pets"],
    queryFn: getAllPets,
  });

  const { data: users } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });

  // Group pets by owner
  const owners = useMemo(() => {
    if (!pets) return [];
    const map = new Map<string, OwnerGroup>();
    for (const pet of pets) {
      // Dato legacy con FK huérfana (owner inexistente): se omite para no
      // tumbar la pantalla. La API también lo filtra (defensa en profundidad).
      if (!pet.owner) continue;
      const existing = map.get(pet.owner.id);
      if (existing) {
        existing.pets.push(pet);
      } else {
        map.set(pet.owner.id, {
          id: pet.owner.id,
          firstName: pet.owner.firstName,
          lastName: pet.owner.lastName,
          email: pet.owner.email,
          pets: [pet],
        });
      }
    }
    return Array.from(map.values());
  }, [pets]);

  const filtered = useMemo(() => {
    if (!search.trim()) return owners;
    const q = search.toLowerCase();
    return owners.filter(
      (o) =>
        o.firstName?.toLowerCase().includes(q) ||
        o.lastName?.toLowerCase().includes(q) ||
        o.email?.toLowerCase().includes(q) ||
        o.pets.some(
          (p) =>
            p.name?.toLowerCase().includes(q) ||
            (p.breed && p.breed.toLowerCase().includes(q))
        )
    );
  }, [owners, search]);

  // Get credit info from users data
  const userMap = useMemo(() => {
    if (!users) return new Map<string, { creditBalance: number; phone?: string }>();
    const m = new Map<string, { creditBalance: number; phone?: string }>();
    for (const u of users) {
      m.set(u.id, { creditBalance: Number(u.creditBalance ?? 0), phone: u.phone ?? undefined });
    }
    return m;
  }, [users]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (ownerId: string) =>
    setExpanded((prev) => ({ ...prev, [ownerId]: !prev[ownerId] }));

  const renderOwner = ({ item }: { item: OwnerGroup }) => {
    const userInfo = userMap.get(item.id);
    const credit = userInfo?.creditBalance ?? 0;
    const phone = userInfo?.phone;
    const isOpen = !!expanded[item.id];
    const email = displayEmail(item.email);

    // Aggregate cartilla status: red if any rejected/expired, ambar if any pending, green if all approved
    const hasRejected = item.pets.some(
      (p) => p.cartillaStatus === "REJECTED" || p.cartillaStatus === "EXPIRED"
    );
    const hasPending = item.pets.some(
      (p) =>
        p.cartillaStatus !== "APPROVED" &&
        p.cartillaStatus !== "REJECTED" &&
        p.cartillaStatus !== "EXPIRED"
    );
    const accentColor = hasRejected
      ? COLORS.errorText
      : hasPending
      ? COLORS.warningText
      : COLORS.successText;

    return (
      <View style={styles.ownerCard}>
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />
        <View style={styles.cardBody}>
          {/* Owner header (tap to toggle pets) */}
          <TouchableOpacity
            style={styles.ownerHeader}
            activeOpacity={0.7}
            onPress={() => toggleExpanded(item.id)}
          >
            <View style={styles.ownerAvatar}>
              <Text style={styles.ownerAvatarText}>
                {item.firstName?.[0]?.toUpperCase() ?? "?"}
              </Text>
            </View>
            <View style={styles.ownerInfo}>
              <Text style={styles.ownerName} numberOfLines={1}>
                {formatName(item.firstName)} {formatName(item.lastName)}
              </Text>
              <Text
                style={[styles.ownerEmail, !email && styles.ownerEmailMuted]}
                numberOfLines={1}
              >
                {email || NO_EMAIL_LABEL}
              </Text>
              <View style={styles.ownerMeta}>
                {phone && (
                  <View style={styles.metaChip}>
                    <Ionicons
                      name="call-outline"
                      size={11}
                      color={COLORS.textTertiary}
                    />
                    <Text style={styles.metaText}>
                      {formatPhoneInput(phone)}
                    </Text>
                  </View>
                )}
                {credit > 0 && (
                  <View
                    style={[styles.metaChip, { backgroundColor: COLORS.successBg }]}
                  >
                    <Ionicons
                      name="wallet-outline"
                      size={11}
                      color={COLORS.successText}
                    />
                    <Text
                      style={[styles.metaText, { color: COLORS.successText }]}
                    >
                      {formatCurrency(credit)}
                    </Text>
                  </View>
                )}
                <View
                  style={[styles.metaChip, { backgroundColor: COLORS.primaryLight }]}
                >
                  <Ionicons name="paw" size={11} color={COLORS.primary} />
                  <Text style={[styles.metaText, { color: COLORS.primary }]}>
                    {item.pets.length} mascota
                    {item.pets.length !== 1 ? "s" : ""}
                  </Text>
                </View>
              </View>
            </View>
            <View
              style={[
                styles.expandBtn,
                isOpen && { backgroundColor: COLORS.primaryLight },
              ]}
            >
              <Ionicons
                name={isOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={isOpen ? COLORS.primary : COLORS.textTertiary}
              />
            </View>
          </TouchableOpacity>

          {/* Pets (collapsible) */}
          {isOpen && (
            <View style={styles.petsContainer}>
              {item.pets.map((pet, idx) => {
                const isLast = idx === item.pets.length - 1;
                const cartilla = pet.cartillaStatus;
                const cartillaStyle =
                  cartilla === "APPROVED"
                    ? { bg: COLORS.successBg, color: COLORS.successText, label: "Aprobada" }
                    : cartilla === "REJECTED"
                    ? { bg: COLORS.errorBg, color: COLORS.errorText, label: "Rechazada" }
                    : { bg: COLORS.warningBg, color: COLORS.warningText, label: "Pendiente" };
                return (
                  <TouchableOpacity
                    key={pet.id}
                    style={[styles.petRow, isLast && styles.petRowLast]}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/pet/${pet.id}` as any)}
                  >
                    {pet.photoUrl ? (
                      <Image
                        source={{ uri: cloudinaryResized(pet.photoUrl, 108, "fill") }}
                        style={styles.petPhoto}
                      />
                    ) : (
                      <View style={[styles.petPhoto, styles.petPhotoPlaceholder]}>
                        <Ionicons name="paw" size={16} color={COLORS.border} />
                      </View>
                    )}
                    <View style={styles.petInfo}>
                      <Text style={styles.petName} numberOfLines={1}>
                        {formatName(pet.name)}
                      </Text>
                      <Text style={styles.petBreed} numberOfLines={1}>
                        {pet.breed ?? "Sin raza"}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.cartillaBadge,
                        { backgroundColor: cartillaStyle.bg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.cartillaBadgeText,
                          { color: cartillaStyle.color },
                        ]}
                      >
                        {cartillaStyle.label}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={COLORS.border}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={COLORS.textDisabled} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre, mascota o email..."
          placeholderTextColor={COLORS.textDisabled}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
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

      <Text style={styles.countLabel}>
        {filtered.length} cliente{filtered.length !== 1 ? "s" : ""}
        {" · "}
        {filtered.reduce((sum, o) => sum + o.pets.length, 0)} mascotas
      </Text>

      {petsError ? (
        <ErrorState error={petsErrorObj} onRetry={refetchPets} />
      ) : loadingPets ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetchPets} />
          }
          renderItem={renderOwner}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color={COLORS.border} />
              <Text style={styles.emptyText}>
                {search ? "Sin resultados" : "No hay clientes registrados"}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    margin: 16,
    marginBottom: 0,
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
    color: COLORS.textPrimary,
  },
  countLabel: {
    fontSize: 12,
    color: COLORS.textDisabled,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  list: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
  },
  ownerCard: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
  },
  accentBar: {
    width: 4,
  },
  cardBody: {
    flex: 1,
  },
  ownerHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  ownerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  ownerAvatarText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "800",
  },
  ownerInfo: {
    flex: 1,
    minWidth: 0,
  },
  ownerName: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  ownerEmail: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  ownerEmailMuted: {
    fontStyle: "italic",
    color: COLORS.textDisabled,
  },
  ownerMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  metaText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textTertiary,
  },
  expandBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
    justifyContent: "center",
  },
  petsContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingHorizontal: 14,
  },
  petRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  petRowLast: {
    borderBottomWidth: 0,
  },
  petPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.bgSection,
  },
  petPhotoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  petInfo: {
    flex: 1,
    minWidth: 0,
  },
  petName: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  petBreed: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  cartillaBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  cartillaBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});
