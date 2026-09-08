import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveClaimRequest,
  getClaimRequests,
  rejectClaimRequest,
  searchClaimFichas,
  type ClaimCandidate,
  type ClaimRequestRow,
} from "@/lib/api";
import { formatName } from "@/lib/format";
import { alertaDeError } from "@/lib/errorAlert";
import { ErrorState } from "@/components/ErrorState";

// Clientes de siempre que instalaron la app y a los que NO se les pudo mandar
// un código de verificación: su ficha no tiene correo real (los walk-in llevan
// un @holidoginn.local que genera el sistema) ni un teléfono del que se pueda
// deducir el país.
//
// Antes esto era un callejón: la app les decía "escríbenos por WhatsApp" y
// alguien tenía que resolverlo a mano, sin ninguna herramienta. Aquí el equipo
// ve quién pidió, con qué se buscó y qué fichas coinciden, y vincula.
//
// Solo ADMIN: vincular da acceso al historial, las reservas y el saldo a favor
// de esa ficha. Mismo criterio que los co-dueños de una mascota.

export default function AdminClaimRequests() {
  const qc = useQueryClient();
  const [verTodas, setVerTodas] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  // Mascotas marcadas por solicitud. Se arranca con TODAS las de los
  // candidatos: el caso normal es "sí, son todas suyas".
  const [seleccion, setSeleccion] = useState<Record<string, Set<string>>>({});
  // Búsqueda manual de la ficha, por solicitud. Es el camino cuando la
  // coincidencia automática no da nada, que es justo el caso que trae aquí a
  // la mayoría: la ficha tiene el teléfono mal capturado.
  const [busqueda, setBusqueda] = useState<Record<string, string>>({});
  const [resultados, setResultados] = useState<Record<string, ClaimCandidate[]>>({});
  const [buscando, setBuscando] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["claim-requests", verTodas ? "all" : "pending"],
    queryFn: () => getClaimRequests(verTodas ? "all" : "pending"),
  });

  function mascotasDe(r: ClaimRequestRow) {
    const encontradas = resultados[r.id] ?? [];
    const todas = [...r.candidates, ...encontradas];
    // Una ficha puede salir por coincidencia y por búsqueda a la vez.
    const vistos = new Set<string>();
    return todas
      .flatMap((c) => c.pets)
      .filter((p) => (vistos.has(p.id) ? false : (vistos.add(p.id), true)));
  }

  async function buscar(r: ClaimRequestRow) {
    const q = (busqueda[r.id] ?? "").trim();
    if (q.length < 2) return;
    setBuscando(r.id);
    try {
      const encontradas = await searchClaimFichas(q);
      setResultados((prev) => ({ ...prev, [r.id]: encontradas }));
    } catch (e) {
      alertaDeError(e, { respaldo: "No se pudo buscar" });
    } finally {
      setBuscando(null);
    }
  }

  function marcadas(r: ClaimRequestRow): Set<string> {
    // Arranca con las que coincidieron por teléfono/correo (el caso normal es
    // "son todas suyas"), pero NUNCA con las que el equipo encontró buscando a
    // mano: ésas hay que marcarlas a conciencia, una por una.
    return seleccion[r.id] ?? new Set(r.candidates.flatMap((c) => c.pets).map((p) => p.id));
  }

  function toggle(r: ClaimRequestRow, petId: string) {
    setSeleccion((prev) => {
      const actual = new Set(prev[r.id] ?? r.candidates.flatMap((c) => c.pets).map((p) => p.id));
      if (actual.has(petId)) actual.delete(petId);
      else actual.add(petId);
      return { ...prev, [r.id]: actual };
    });
  }

  async function aprobar(r: ClaimRequestRow) {
    const petIds = [...marcadas(r)];
    if (petIds.length === 0) {
      Alert.alert("Elige mascotas", "Marca al menos una mascota para vincular.");
      return;
    }
    const quien = formatName(`${r.requester.firstName} ${r.requester.lastName}`.trim());
    Alert.alert(
      "Confirmar vinculación",
      `Se le darán ${petIds.length === 1 ? "1 mascota" : `${petIds.length} mascotas`} a ${quien}, junto con su historial de reservas. Asegúrate de que de verdad es esa persona.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Vincular",
          style: "destructive",
          onPress: async () => {
            setTrabajando(r.id);
            try {
              await approveClaimRequest(r.id, petIds);
              qc.invalidateQueries({ queryKey: ["claim-requests"] });
              Alert.alert("Listo", `${quien} ya puede ver sus mascotas en la app.`);
            } catch (e) {
              alertaDeError(e, { respaldo: "No se pudo vincular" });
            } finally {
              setTrabajando(null);
            }
          },
        },
      ],
    );
  }

  async function rechazar(r: ClaimRequestRow) {
    Alert.alert(
      "Rechazar solicitud",
      "Se marca como resuelta y no se le avisa al cliente. Úsalo si no pudiste confirmar quién es, o si ya lo resolviste por otro lado.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Rechazar",
          style: "destructive",
          onPress: async () => {
            setTrabajando(r.id);
            try {
              await rejectClaimRequest(r.id);
              qc.invalidateQueries({ queryKey: ["claim-requests"] });
            } catch (e) {
              alertaDeError(e, { respaldo: "No se pudo rechazar" });
            } finally {
              setTrabajando(null);
            }
          },
        },
      ],
    );
  }

  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  const filas = data ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <TouchableOpacity
        style={styles.filtro}
        onPress={() => setVerTodas((v) => !v)}
        activeOpacity={0.7}
      >
        <Ionicons
          name={verTodas ? "checkbox-outline" : "square-outline"}
          size={18}
          color={COLORS.primary}
        />
        <Text style={styles.filtroText}>Ver también las ya resueltas</Text>
      </TouchableOpacity>

      {filas.length === 0 && (
        <View style={styles.vacio}>
          <Ionicons name="checkmark-done-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.vacioText}>
            No hay solicitudes pendientes. Aquí aparecen los clientes de siempre que
            instalan la app y cuya ficha no tiene un contacto al que mandarles un código.
          </Text>
        </View>
      )}

      {filas.map((r) => {
        const mascotas = mascotasDe(r);
        const sel = marcadas(r);
        const pendiente = r.status === "PENDING";
        return (
          <View key={r.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.nombre}>
                {formatName(`${r.requester.firstName} ${r.requester.lastName}`.trim())}
              </Text>
              {!pendiente && (
                <Text style={[styles.badge, r.status === "APPROVED" ? styles.badgeOk : styles.badgeNo]}>
                  {r.status === "APPROVED" ? "Vinculada" : "Rechazada"}
                </Text>
              )}
            </View>

            <Text style={styles.dato}>Su cuenta: {r.requester.email}</Text>
            <Text style={styles.dato}>
              Buscó con: {r.typedPhone ?? r.typedEmail ?? "—"}
            </Text>
            {!!r.note && <Text style={styles.nota}>“{r.note}”</Text>}

            {pendiente && (
              <>
                <Text style={styles.seccion}>
                  {mascotas.length === 0
                    ? "Ninguna ficha coincide"
                    : "Marca las mascotas que son suyas"}
                </Text>

                {mascotas.length === 0 && (
                  <Text style={styles.aviso}>
                    Con lo que escribió no coincide ninguna ficha — casi siempre es porque
                    su ficha tiene el teléfono mal escrito. Búscala por su nombre aquí
                    abajo.
                  </Text>
                )}

                {/* Búsqueda manual: el camino real cuando la coincidencia
                    automática falla, que es el motivo por el que la mayoría
                    llega a esta pantalla. */}
                <View style={styles.buscador}>
                  <TextInput
                    style={styles.buscadorInput}
                    placeholder="Buscar ficha por nombre o teléfono"
                    placeholderTextColor={COLORS.textDisabled}
                    value={busqueda[r.id] ?? ""}
                    onChangeText={(t) => setBusqueda((prev) => ({ ...prev, [r.id]: t }))}
                    onSubmitEditing={() => buscar(r)}
                    returnKeyType="search"
                    autoCapitalize="words"
                  />
                  <TouchableOpacity
                    style={styles.buscadorBtn}
                    onPress={() => buscar(r)}
                    disabled={buscando === r.id}
                  >
                    {buscando === r.id ? (
                      <ActivityIndicator color={COLORS.white} size="small" />
                    ) : (
                      <Ionicons name="search" size={16} color={COLORS.white} />
                    )}
                  </TouchableOpacity>
                </View>
                {(resultados[r.id]?.length ?? 0) > 0 && (
                  <Text style={styles.avisoBusqueda}>
                    Resultados de tu búsqueda: márcalos solo si estás seguro de que son de
                    esta persona.
                  </Text>
                )}

                {mascotas.length > 0 && (
                  mascotas.map((p) => {
                    const marcada = sel.has(p.id);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={styles.mascota}
                        onPress={() => toggle(r, p.id)}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={marcada ? "checkbox" : "square-outline"}
                          size={20}
                          color={marcada ? COLORS.primary : COLORS.textTertiary}
                        />
                        {p.photoUrl ? (
                          <Image source={{ uri: p.photoUrl }} style={styles.foto} />
                        ) : (
                          <View style={[styles.foto, styles.fotoVacia]}>
                            <Ionicons name="paw" size={14} color={COLORS.textTertiary} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.mascotaNombre}>{formatName(p.name)}</Text>
                          {!!p.breed && <Text style={styles.mascotaRaza}>{p.breed}</Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}

                <View style={styles.acciones}>
                  <TouchableOpacity
                    style={[styles.btnSec, trabajando === r.id && styles.btnDisabled]}
                    onPress={() => rechazar(r)}
                    disabled={trabajando === r.id}
                  >
                    <Text style={styles.btnSecText}>Rechazar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.btnPri,
                      (trabajando === r.id || mascotas.length === 0) && styles.btnDisabled,
                    ]}
                    onPress={() => aprobar(r)}
                    disabled={trabajando === r.id || mascotas.length === 0}
                  >
                    {trabajando === r.id ? (
                      <ActivityIndicator color={COLORS.white} />
                    ) : (
                      <Text style={styles.btnPriText}>Vincular</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {!pendiente && !!r.resolvedBy && (
              <Text style={styles.dato}>
                Por {formatName(`${r.resolvedBy.firstName} ${r.resolvedBy.lastName}`.trim())}
              </Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  filtro: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  filtroText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 4,
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nombre: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    flex: 1,
  },
  badge: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
  },
  badgeOk: { backgroundColor: COLORS.successBg, color: COLORS.successText },
  badgeNo: { backgroundColor: COLORS.bgSection, color: COLORS.textTertiary },
  dato: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  nota: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    fontStyle: "italic",
    marginTop: 4,
  },
  seccion: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 6,
  },
  aviso: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    backgroundColor: COLORS.bgSection,
    padding: 10,
    borderRadius: 8,
  },
  mascota: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  foto: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.bgSection },
  fotoVacia: { alignItems: "center", justifyContent: "center" },
  mascotaNombre: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  mascotaRaza: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  buscador: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 4 },
  buscadorInput: {
    flex: 1,
    backgroundColor: COLORS.bgSection,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
  },
  buscadorBtn: {
    width: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  avisoBusqueda: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.warningText ?? COLORS.textTertiary,
    marginBottom: 4,
  },
  acciones: { flexDirection: "row", gap: 10, marginTop: 14 },
  btnSec: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: COLORS.bgSection,
  },
  btnSecText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
  },
  btnPri: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: COLORS.primary,
  },
  btnPriText: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.white },
  btnDisabled: { opacity: 0.5 },
  vacio: { alignItems: "center", gap: 10, padding: 24 },
  vacioText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 20,
  },
});
