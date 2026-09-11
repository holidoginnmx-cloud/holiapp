import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getAllPets, getUsers, type AdminUserListItem } from "@/lib/api";
import { mergeClients } from "@/lib/api/merge";
import {
  formatName,
  formatPhoneInput,
  displayEmail,
  formatCurrency,
  formatDayShortYear,
} from "@/lib/format";
import { alertaDeError } from "@/lib/errorAlert";
import { ErrorState } from "@/components/ErrorState";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

// Dos fichas del MISMO cliente: el equipo lo dio de alta dos veces (Francisco
// Acosta con Nala en una y Luna en otra, con el teléfono mal escrito en una;
// sep-2026). Todo pasa a una sola —perros, reservas, pagos, saldo,
// cotizaciones— y la otra queda dada de baja (API: lib/ownerMerge.ts).
// La que se da de baja no puede tener cuenta de la app: eso es «Vincular
// fichas», que además le hereda la sesión a la ficha.
//
// La pantalla NO pregunta "¿qué ficha se queda?": para quien la usa las dos
// son la misma persona y la pregunta no se entiende (y con el mismo nombre y
// teléfono, las dos opciones se veían idénticas). Se decide sola —la que
// tiene app y, si ninguna, la más vieja— y solo se pregunta por un DATO cuando
// las dos lo tienen distinto: nombre/correo (que salen de la que se queda) y
// teléfono (que se elige aparte).

const tieneApp = (u: AdminUserListItem) => !!(u as { clerkId?: string | null }).clerkId;
const digitos = (tel: string) => tel.replace(/\D/g, "").slice(-10);
// El apellido de relleno ("—") de las altas sin apellido no es parte del nombre.
const nombreDe = (u: AdminUserListItem) =>
  formatName(
    `${u.firstName ?? ""} ${u.lastName ?? ""}`
      .split(/\s+/)
      .filter((w) => !/^[-—–.]+$/.test(w))
      .join(" "),
  );
const correoDe = (u: AdminUserListItem) => displayEmail(u.email);
const altaDe = (u: AdminUserListItem) => new Date(u.createdAt as unknown as string).getTime();
const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function Chip({ activo, texto, onPress }: { activo: boolean; texto: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, activo && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, activo && styles.chipTextOn]}>{texto}</Text>
    </TouchableOpacity>
  );
}

export default function MergeOwnerScreen() {
  const { ownerId } = useLocalSearchParams<{ ownerId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState("");
  const [otroId, setOtroId] = useState<string | null>(null);
  // De cuál ficha salen nombre y correo cuando las dos los tienen distintos;
  // null = la que se decide sola.
  const [datosDeId, setDatosDeId] = useState<string | null>(null);
  // De cuál ficha es el teléfono que se queda; null = el de la que se queda.
  // El otro deja de encontrarse (las búsquedas por teléfono ignoran las fichas
  // dadas de baja), así que si el bueno es el de la otra hay que elegirlo.
  const [telefonoDeId, setTelefonoDeId] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const usersQ = useQuery({ queryKey: ["admin", "users"], queryFn: getUsers });
  const petsQ = useQuery({ queryKey: ["admin", "pets"], queryFn: getAllPets });

  const clientes = useMemo(
    () => (usersQ.data ?? []).filter((u) => u.role === "OWNER" && u.isActive !== false),
    [usersQ.data],
  );
  const este = clientes.find((u) => u.id === ownerId);

  const perrosDe = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of petsQ.data ?? []) {
      if (!p.owner) continue;
      m.set(p.owner.id, [...(m.get(p.owner.id) ?? []), formatName(p.name)]);
    }
    return m;
  }, [petsQ.data]);

  // Sin búsqueda se sugieren los que se llaman igual; con búsqueda, nombre,
  // correo o dígitos del teléfono.
  const candidatos = useMemo(() => {
    if (!este) return [];
    const otros = clientes.filter((u) => u.id !== este.id);
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) {
      const mio = normal(`${este.firstName ?? ""} ${este.lastName ?? ""}`);
      return otros.filter((u) => normal(`${u.firstName ?? ""} ${u.lastName ?? ""}`) === mio).slice(0, 10);
    }
    const digitos = q.replace(/\D/g, "");
    return otros
      .filter(
        (u) =>
          normal(`${u.firstName ?? ""} ${u.lastName ?? ""}`).includes(normal(q)) ||
          (u.email ?? "").toLowerCase().includes(q) ||
          (digitos.length >= 4 && (u.phone ?? "").replace(/\D/g, "").includes(digitos)),
      )
      .slice(0, 20);
  }, [clientes, este, busqueda]);

  const otro = clientes.find((u) => u.id === otroId) ?? null;

  function elegir(u: AdminUserListItem) {
    setOtroId(u.id);
    setDatosDeId(null);
    setTelefonoDeId(null);
  }

  if (usersQ.isError) return <ErrorState error={usersQ.error} onRetry={usersQ.refetch} />;
  if (usersQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (!este) {
    return (
      <View style={styles.center}>
        <Text style={styles.nota}>Esa ficha ya no está activa.</Text>
      </View>
    );
  }

  const tarjeta = (u: AdminUserListItem, marcado?: boolean, onPress?: () => void) => {
    const credito = Number(u.creditBalance ?? 0);
    const datos = [
      u.phone ? formatPhoneInput(u.phone) : "sin teléfono",
      correoDe(u) || null,
      tieneApp(u) ? "tiene app" : "sin app",
      credito > 0 ? `saldo ${formatCurrency(credito)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const cuerpo = (
      <>
        {onPress && (
          <Ionicons
            name={marcado ? "radio-button-on" : "radio-button-off"}
            size={20}
            color={marcado ? COLORS.primary : COLORS.textTertiary}
          />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.nombre}>{nombreDe(u)}</Text>
          <Text style={styles.detalle}>{datos}</Text>
          <Text style={styles.detalle}>Perros: {(perrosDe.get(u.id) ?? []).join(", ") || "—"}</Text>
          {/* Con el mismo nombre y teléfono, la fecha de alta es lo que las distingue. */}
          <Text style={styles.detalle}>
            Dada de alta el {formatDayShortYear(u.createdAt)}
          </Text>
        </View>
      </>
    );
    return onPress ? (
      <TouchableOpacity key={u.id} style={styles.fila} onPress={onPress} activeOpacity={0.7}>
        {cuerpo}
      </TouchableOpacity>
    ) : (
      <View key={u.id} style={styles.fila}>
        {cuerpo}
      </View>
    );
  };

  const ambasConApp = !!otro && tieneApp(este) && tieneApp(otro);

  // Cuál se queda. Con app, esa sí o sí (la que se va no puede tenerla). Sin
  // app, la más vieja, salvo que el equipo elija los datos de la otra.
  let queda: AdminUserListItem | null = null;
  let seVa: AdminUserListItem | null = null;
  let nombresDistintos = false;
  let correosDistintos = false;
  let hayApp = false;
  if (otro && !ambasConApp) {
    hayApp = tieneApp(este) || tieneApp(otro);
    nombresDistintos = normal(nombreDe(este)) !== normal(nombreDe(otro));
    correosDistintos =
      !!correoDe(este) && !!correoDe(otro) && correoDe(este).toLowerCase() !== correoDe(otro).toLowerCase();
    const porDefecto = tieneApp(este)
      ? este
      : tieneApp(otro)
        ? otro
        : altaDe(otro) < altaDe(este)
          ? otro
          : este;
    queda = !hayApp && datosDeId ? (datosDeId === este.id ? este : otro) : porDefecto;
    seVa = queda.id === este.id ? otro : este;
  }
  const hayQueElegirDatos = !!queda && !hayApp && (nombresDistintos || correosDistintos);
  const telefonosDistintos =
    !!otro && !!este.phone && !!otro.phone && digitos(este.phone) !== digitos(otro.phone);
  const telDeId = telefonoDeId ?? queda?.id;
  const telFinal =
    queda && seVa ? (telDeId === seVa.id ? seVa.phone : queda.phone) || seVa.phone || queda.phone : null;
  const correoFinal = queda && seVa ? correoDe(queda) || correoDe(seVa) : "";
  const perrosFinal = queda && seVa ? [...(perrosDe.get(queda.id) ?? []), ...(perrosDe.get(seVa.id) ?? [])] : [];
  const saldoFinal = queda && seVa ? Number(queda.creditBalance ?? 0) + Number(seVa.creditBalance ?? 0) : 0;

  const etiquetaDatos = (u: AdminUserListItem) =>
    [nombresDistintos ? nombreDe(u) : null, correosDistintos ? correoDe(u) : null].filter(Boolean).join(" · ");
  const tituloDatos =
    nombresDistintos && correosDistintos
      ? "¿Con qué nombre y correo se queda?"
      : nombresDistintos
        ? "¿Con qué nombre se queda?"
        : "¿Con qué correo se queda?";

  async function juntar() {
    if (!queda || !seVa) return;
    const q = queda;
    const v = seVa;
    const telefono = telDeId === v.id ? "from" : "into";
    const perros = perrosFinal.length > 0 ? ` con ${listaY(perrosFinal)}` : "";
    Alert.alert(
      "¿Juntar las dos fichas?",
      `Quedará una sola ficha de ${nombreDe(q)}${telFinal ? ` (${formatPhoneInput(telFinal)})` : ""}${perros}. No se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Juntar",
          style: "destructive",
          onPress: async () => {
            setTrabajando(true);
            try {
              await mergeClients(v.id, q.id, telefono);
              qc.invalidateQueries({ queryKey: ["admin"] });
              qc.invalidateQueries({ queryKey: ["pets"] });
              Alert.alert("Listo", `${nombreDe(q)} ya es una sola ficha.`);
              router.back();
            } catch (e) {
              alertaDeError(e, { respaldo: "No se pudieron juntar" });
            } finally {
              setTrabajando(false);
            }
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.aviso}>
        Para cuando el mismo cliente quedó dado de alta dos veces. Las dos fichas se vuelven una
        sola, con los perros, reservas, pagos, saldo y cotizaciones de ambas. No se puede deshacer.
      </Text>

      <Text style={styles.seccion}>Esta ficha</Text>
      {tarjeta(este)}

      <Text style={styles.seccion}>¿Con cuál la juntas?</Text>
      <View style={styles.buscador}>
        <Ionicons name="search" size={16} color={COLORS.textDisabled} />
        <TextInput
          style={styles.buscadorInput}
          placeholder="Buscar por nombre, correo o teléfono"
          placeholderTextColor={COLORS.textDisabled}
          value={busqueda}
          onChangeText={setBusqueda}
          autoCapitalize="words"
        />
      </View>
      {busqueda.trim().length < 2 && candidatos.length > 0 && (
        <Text style={styles.nota}>Fichas con el mismo nombre:</Text>
      )}
      {candidatos.length === 0 ? (
        <Text style={styles.nota}>
          {busqueda.trim().length < 2
            ? "No hay otra ficha con el mismo nombre. Búscala arriba."
            : "Ninguna ficha coincide."}
        </Text>
      ) : (
        candidatos.map((u) => tarjeta(u, u.id === otroId, () => elegir(u)))
      )}

      {otro && ambasConApp && (
        <Text style={styles.aviso}>
          Las dos tienen cuenta en la app, así que no se pueden juntar aquí: el cliente perdería
          una de sus dos sesiones. Escríbenos si hace falta.
        </Text>
      )}

      {otro && queda && seVa && (
        <>
          {hayQueElegirDatos && (
            <>
              <Text style={styles.seccion}>{tituloDatos}</Text>
              <View style={styles.chips}>
                {[este, otro].map((u) => (
                  <Chip
                    key={u.id}
                    activo={queda!.id === u.id}
                    texto={etiquetaDatos(u)}
                    onPress={() => setDatosDeId(u.id)}
                  />
                ))}
              </View>
            </>
          )}

          {telefonosDistintos && (
            <>
              <Text style={styles.seccion}>¿Con qué teléfono se queda?</Text>
              <View style={styles.chips}>
                {[este, otro].map((u) => (
                  <Chip
                    key={u.id}
                    activo={telDeId === u.id}
                    texto={formatPhoneInput(u.phone!)}
                    onPress={() => setTelefonoDeId(u.id)}
                  />
                ))}
              </View>
              <Text style={styles.nota}>
                Con este teléfono lo encuentran el baño sin cita y la app. El otro deja de usarse.
              </Text>
            </>
          )}

          <Text style={styles.seccion}>Así va a quedar</Text>
          <View style={[styles.fila, styles.resultado]}>
            <Ionicons name="person-circle-outline" size={28} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.nombre}>{nombreDe(queda)}</Text>
              <Text style={styles.detalle}>
                {[
                  telFinal ? formatPhoneInput(telFinal) : "sin teléfono",
                  correoFinal || null,
                  tieneApp(queda) ? "tiene app" : null,
                  saldoFinal > 0 ? `saldo ${formatCurrency(saldoFinal)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <Text style={styles.detalle}>Perros: {perrosFinal.join(", ") || "—"}</Text>
            </View>
          </View>
          {hayApp && (nombresDistintos || correosDistintos) && (
            <Text style={styles.nota}>
              Se quedan el nombre y el correo de la cuenta de la app.
            </Text>
          )}

          <TouchableOpacity
            style={[styles.boton, trabajando && styles.botonOff]}
            onPress={juntar}
            disabled={trabajando}
            testID="owner-merge-confirm"
          >
            {trabajando ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.botonTexto}>Juntar fichas</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function listaY(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  aviso: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    backgroundColor: COLORS.bgSection,
    padding: 12,
    borderRadius: 10,
    lineHeight: 18,
  },
  seccion: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 14,
  },
  fila: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
  },
  resultado: { borderWidth: 1, borderColor: COLORS.primary },
  nombre: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  detalle: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 2 },
  buscador: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 12,
  },
  buscadorInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
  },
  chipOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  chipText: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textTertiary },
  chipTextOn: { color: COLORS.primary },
  nota: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary },
  boton: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  botonOff: { opacity: 0.6 },
  botonTexto: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.white },
});
