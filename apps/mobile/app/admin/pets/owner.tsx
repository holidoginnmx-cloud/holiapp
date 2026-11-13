import { COLORS } from "@/constants/colors";
import { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { ErrorState } from "@/components/ErrorState";
import { getUsers, getPetsByOwner } from "@/lib/api";
import type { AdminUserListItem } from "@/lib/api";
import {
  formatName,
  formatFullName,
  formatPhoneInput,
  displayEmail,
  NO_EMAIL_LABEL,
} from "@/lib/format";
import { filtrarPorBusqueda, normalizarBusqueda } from "@/lib/search";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

/**
 * Paso 1 del alta de mascota desde el equipo: ¿de quién es el perro?
 *
 * Se elige un cliente que ya existe o se crea uno nuevo (que al terminar
 * regresa aquí mismo, encadenado al paso 2). El paso 2 es la pantalla de
 * mascota de siempre (`/pet/create`), a la que le pasamos el ownerId: solo el
 * equipo (admin o staff) puede crear una mascota para otro dueño; lo valida el
 * backend, y a un STAFF la lista le llega ya filtrada a clientes activos.
 */
export default function AdminPetOwnerScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const {
    data: users,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });

  // Solo clientes activos: staff/admin no son dueños, y los desactivados son
  // los duplicados que ya se consolidaron — colgarles una mascota los
  // resucitaría en la lista.
  const clients = useMemo(
    () => (users ?? []).filter((u) => u.role === "OWNER" && u.isActive !== false),
    [users],
  );

  // También por el nombre del perro: quien captura casi siempre sabe cómo se
  // llama el perro, y así llega a la ficha que de verdad lo tiene.
  const filtered = useMemo(() => {
    return filtrarPorBusqueda(clients, search, (u) => ({
      textos: [u.firstName, u.lastName, u.email, ...(u.petNames ?? [])],
      telefonos: [u.phone],
    }));
  }, [clients, search]);

  // Dueños con el mismo nombre: hay que distinguirlos por teléfono y perros
  // (dos «Andrea Noriega», nov-2026).
  const homonimos = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const u of clients) {
      const k = normalizarBusqueda(formatFullName(u.firstName, u.lastName));
      cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
    }
    return cuenta;
  }, [clients]);

  // Dueño elegido que ya tiene perros: antes de capturar todo otra vez, se le
  // enseñan sus perros por si el que llegó ya está registrado.
  const [elegido, setElegido] = useState<AdminUserListItem | null>(null);
  const { data: petsDelElegidoRaw, isError: errorPetsElegido } = useQuery({
    queryKey: ["pets", elegido?.id],
    queryFn: () => getPetsByOwner(elegido!.id),
    enabled: !!elegido,
  });
  const petsDelElegido = petsDelElegidoRaw?.filter((p) => p.isActive !== false);

  // `petNames` cuenta también los perros compartidos, que GET /pets?ownerId no
  // trae: si al final no tiene perros propios, no hay nada que enseñar.
  useEffect(() => {
    if (elegido && petsDelElegido && petsDelElegido.length === 0) {
      const u = elegido;
      setElegido(null);
      goToPetForm(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegido, petsDelElegido?.length]);

  const onPickClient = (user: AdminUserListItem) => {
    if ((user.petNames?.length ?? 0) > 0) {
      setElegido(user);
      return;
    }
    goToPetForm(user);
  };

  const goToPetForm = (user: AdminUserListItem) => {
    const ownerName = formatFullName(user.firstName, user.lastName);
    router.push(
      `/pet/create?ownerId=${user.id}&ownerName=${encodeURIComponent(
        ownerName,
      )}` as any,
    );
  };

  const renderClient = ({ item }: { item: AdminUserListItem }) => {
    const email = displayEmail(item.email);
    const mismos =
      homonimos.get(normalizarBusqueda(formatFullName(item.firstName, item.lastName))) ?? 1;
    // null (no 0): un `0 && …` dentro de un <View> revienta en React Native.
    const repetido = mismos > 1 ? mismos : null;
    return (
      <TouchableOpacity
        style={styles.clientRow}
        activeOpacity={0.7}
        onPress={() => onPickClient(item)}
        testID={`pet-owner-${item.id}`}
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
              : email || NO_EMAIL_LABEL}
          </Text>
          {(item.petNames?.length ?? 0) > 0 ? (
            <View style={styles.petsLine}>
              <Ionicons name="paw" size={12} color={COLORS.primary} />
              <Text style={styles.petsText} numberOfLines={1}>
                {item.petNames!.map((n) => formatName(n)).join(", ")}
              </Text>
            </View>
          ) : (
            <Text style={styles.clientMuted}>Sin mascotas</Text>
          )}
          {(item.hasApp || repetido != null) && (
            <View style={styles.tagsRow}>
              {item.hasApp && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>Usa la app</Text>
                </View>
              )}
              {repetido != null && (
                <View style={[styles.tag, styles.tagWarn]}>
                  <Text style={[styles.tagText, styles.tagWarnText]}>
                    Hay {repetido} con este nombre
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.border} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.introCard}>
        <Ionicons name="paw" size={20} color={COLORS.primary} />
        <Text style={styles.introText}>
          ¿De quién es la mascota? Elige al cliente y en el siguiente paso
          capturas los datos del perro.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.newClientBtn}
        activeOpacity={0.8}
        onPress={() => router.push("/admin/users/create?next=pet" as any)}
        testID="pet-owner-new-client"
      >
        <Ionicons name="person-add" size={18} color={COLORS.white} />
        <Text style={styles.newClientBtnText}>Cliente nuevo</Text>
      </TouchableOpacity>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={COLORS.textDisabled} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por cliente, teléfono o perro..."
          placeholderTextColor={COLORS.textDisabled}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          testID="pet-owner-search"
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

      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={renderClient}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={44} color={COLORS.border} />
              <Text style={styles.emptyText}>
                {search
                  ? "Ningún cliente coincide. Si es nuevo, créalo arriba."
                  : "Todavía no hay clientes registrados."}
              </Text>
            </View>
          }
        />
      )}

      <Modal
        visible={!!elegido}
        transparent
        animationType="slide"
        onRequestClose={() => setElegido(null)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setElegido(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>
              {formatName(elegido?.firstName)} ya tiene registrado:
            </Text>
            <Text style={styles.sheetSubtitle}>
              Si es uno de estos, ábrelo y complétalo ahí en vez de capturarlo
              otra vez.
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {errorPetsElegido ? (
                <Text style={[styles.sheetSubtitle, { marginTop: 8 }]}>
                  No pudimos cargar sus perros. Puedes seguir con la captura.
                </Text>
              ) : petsDelElegido === undefined ? (
                <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} />
              ) : (
                petsDelElegido.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.sheetPet}
                      activeOpacity={0.7}
                      onPress={() => {
                        setElegido(null);
                        router.push(`/pet/${p.id}` as any);
                      }}
                      testID={`pet-owner-existing-${p.id}`}
                    >
                      {p.photoUrl ? (
                        <Image source={{ uri: p.photoUrl }} style={styles.sheetPetPhoto} />
                      ) : (
                        <View style={[styles.sheetPetPhoto, styles.sheetPetPhotoEmpty]}>
                          <Ionicons name="paw" size={18} color={COLORS.primary} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.clientName} numberOfLines={1}>
                          {formatName(p.name)}
                        </Text>
                        <Text style={styles.clientSub} numberOfLines={1}>
                          {p.breed ? formatName(p.breed) : "Sin raza"}
                          {p.weight ? ` · ${p.weight} kg` : ""}
                        </Text>
                      </View>
                      <Text style={styles.sheetPetLink}>Es este</Text>
                    </TouchableOpacity>
                  ))
              )}
            </ScrollView>
            <TouchableOpacity
              style={[styles.newClientBtn, { marginTop: 8 }]}
              activeOpacity={0.8}
              onPress={() => {
                const u = elegido;
                setElegido(null);
                if (u) goToPetForm(u);
              }}
              testID="pet-owner-continue-new"
            >
              <Ionicons name="add" size={18} color={COLORS.white} />
              <Text style={styles.newClientBtnText}>Es otro perro</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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
  newClientBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 13,
    marginHorizontal: 16,
  },
  newClientBtnText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
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
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
  },
  list: {
    padding: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
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
  clientInfo: {
    flex: 1,
    minWidth: 0,
  },
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
  empty: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textDisabled,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 20,
  },
  clientMuted: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textDisabled,
    marginTop: 2,
  },
  petsLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 3,
  },
  petsText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 5,
  },
  tag: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
  },
  tagWarn: {
    backgroundColor: COLORS.warningBg,
  },
  tagWarnText: {
    color: COLORS.warningText,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.bgPage,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 32,
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginHorizontal: 16,
  },
  sheetSubtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 18,
  },
  sheetPet: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  sheetPetPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  sheetPetPhotoEmpty: {
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetPetLink: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
});
