import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getPetById, getPetsByOwner } from "@/lib/api";
import { mergePets } from "@/lib/api/merge";
import { formatName } from "@/lib/format";
import { alertaDeError } from "@/lib/errorAlert";
import { ErrorState } from "@/components/ErrorState";
import { cloudinaryResized } from "@/lib/cloudinary";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

// El mismo perro capturado dos veces por el equipo ("SKY" y "Sky Velazquez",
// la misma Chihuahua de Baltasar Soto, sep-2026). Se juntan en una ficha: la
// que se queda recibe reservas, cartilla, vacunas, notas y contactos de la otra
// (API: lib/petMerge.ts), y la otra queda dada de baja. Solo entre perros del
// MISMO cliente; si el repetido está en otra ficha, primero se juntan las
// fichas de cliente.

type PetLite = {
  id: string;
  name: string;
  breed?: string | null;
  weight?: number | null;
  photoUrl?: string | null;
  cartillaStatus?: string | null;
  createdAt?: string | Date;
  ownerId: string;
  owner?: { firstName: string; lastName?: string | null } | null;
};

const CARTILLA: Record<string, string> = {
  APPROVED: "cartilla aprobada",
  PENDING: "cartilla por revisar",
  REJECTED: "cartilla rechazada",
  EXPIRED: "cartilla vencida",
};

const fecha = (d?: string | Date) => {
  if (!d) return "";
  const x = new Date(d);
  return `${x.getDate()}/${x.getMonth() + 1}/${x.getFullYear()}`;
};

const detalle = (p: PetLite) =>
  [
    p.breed,
    p.weight != null ? `${p.weight} kg` : null,
    p.cartillaStatus ? CARTILLA[p.cartillaStatus] : "sin cartilla",
    p.createdAt ? `alta ${fecha(p.createdAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

function Chip({ activo, texto, onPress }: { activo: boolean; texto: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, activo && styles.chipOn]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.chipText, activo && styles.chipTextOn]}>{texto}</Text>
    </TouchableOpacity>
  );
}

function Fila({ pet, marcado, onPress }: { pet: PetLite; marcado?: boolean; onPress?: () => void }) {
  const cuerpo = (
    <>
      {onPress && (
        <Ionicons
          name={marcado ? "radio-button-on" : "radio-button-off"}
          size={20}
          color={marcado ? COLORS.primary : COLORS.textTertiary}
        />
      )}
      {pet.photoUrl ? (
        <Image source={{ uri: cloudinaryResized(pet.photoUrl, 96, "fill") }} style={styles.foto} />
      ) : (
        <View style={[styles.foto, styles.fotoVacia]}>
          <Ionicons name="paw" size={14} color={COLORS.textTertiary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.nombre}>{formatName(pet.name)}</Text>
        <Text style={styles.detalle}>{detalle(pet)}</Text>
      </View>
    </>
  );
  return onPress ? (
    <TouchableOpacity style={styles.fila} onPress={onPress} activeOpacity={0.7}>
      {cuerpo}
    </TouchableOpacity>
  ) : (
    <View style={styles.fila}>{cuerpo}</View>
  );
}

export default function MergePetScreen() {
  const { petId } = useLocalSearchParams<{ petId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [otroId, setOtroId] = useState<string | null>(null);
  const [quedaId, setQuedaId] = useState<string | null>(null);
  const [nombreDeId, setNombreDeId] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const petQ = useQuery({
    queryKey: ["pet", petId],
    queryFn: () => getPetById(petId!),
    enabled: !!petId,
  });
  const pet = petQ.data as unknown as PetLite | undefined;

  const hermanosQ = useQuery({
    queryKey: ["admin", "merge", "pets", pet?.ownerId],
    queryFn: () => getPetsByOwner(pet!.ownerId),
    enabled: !!pet?.ownerId,
  });
  const otros = useMemo(
    () => ((hermanosQ.data ?? []) as unknown as PetLite[]).filter((p) => p.id !== petId),
    [hermanosQ.data, petId],
  );
  const otro = otros.find((p) => p.id === otroId) ?? null;

  function elegir(o: PetLite) {
    setOtroId(o.id);
    // Por default se queda la ficha más vieja: suele ser la del historial.
    const viejo =
      pet && new Date(pet.createdAt ?? 0).getTime() <= new Date(o.createdAt ?? 0).getTime() ? pet : o;
    setQuedaId(viejo.id);
    setNombreDeId(viejo.id);
  }

  async function juntar() {
    if (!pet || !otro || !quedaId || !nombreDeId) return;
    const queda = quedaId === pet.id ? pet : otro;
    const seVa = quedaId === pet.id ? otro : pet;
    const nombreFinal = nombreDeId === pet.id ? pet.name : otro.name;
    Alert.alert(
      "¿Juntar los dos?",
      `Se queda la ficha de ${formatName(queda.name)} con el nombre «${formatName(nombreFinal)}», y recibe las reservas, la cartilla, las vacunas, las notas y los contactos de ${formatName(seVa.name)}, que queda dada de baja. No se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Juntar",
          style: "destructive",
          onPress: async () => {
            setTrabajando(true);
            try {
              await mergePets(seVa.id, queda.id, nombreDeId === seVa.id);
              qc.invalidateQueries({ queryKey: ["pets"] });
              qc.invalidateQueries({ queryKey: ["pet"] });
              qc.invalidateQueries({ queryKey: ["admin"] });
              Alert.alert("Listo", `${formatName(nombreFinal)} ya es una sola ficha.`);
              router.replace(`/pet/${queda.id}` as any);
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

  if (petQ.isError) return <ErrorState error={petQ.error} onRetry={petQ.refetch} />;
  if (!pet || hermanosQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  const dueno = pet.owner ? formatName(`${pet.owner.firstName} ${pet.owner.lastName ?? ""}`.trim()) : "Este cliente";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.aviso}>
        Para cuando el mismo perro quedó capturado dos veces. La ficha que se queda conserva su
        historial y recibe lo de la otra: reservas, cartilla, vacunas, notas y contactos. La otra
        queda dada de baja. No se puede deshacer.
      </Text>

      <Text style={styles.seccion}>Este perro</Text>
      <Fila pet={pet} />

      <Text style={styles.seccion}>¿Con cuál lo juntas?</Text>
      {otros.length === 0 ? (
        <Text style={styles.aviso}>
          {dueno} no tiene otro perro activo. Si el repetido está en otra ficha de cliente, primero
          junta las fichas desde Clientes («Juntar con otra ficha»).
        </Text>
      ) : (
        otros.map((o) => <Fila key={o.id} pet={o} marcado={o.id === otroId} onPress={() => elegir(o)} />)
      )}

      {otro && quedaId && nombreDeId && (
        <>
          <Text style={styles.seccion}>¿Qué ficha se queda?</Text>
          <View style={styles.chips}>
            <Chip activo={quedaId === pet.id} texto={formatName(pet.name)} onPress={() => setQuedaId(pet.id)} />
            <Chip activo={quedaId === otro.id} texto={formatName(otro.name)} onPress={() => setQuedaId(otro.id)} />
          </View>
          <Text style={styles.nota}>
            Lo que la ficha que se queda ya tiene no se toca; solo se completa lo que le falte.
          </Text>

          <Text style={styles.seccion}>Nombre que se queda</Text>
          <View style={styles.chips}>
            <Chip activo={nombreDeId === pet.id} texto={formatName(pet.name)} onPress={() => setNombreDeId(pet.id)} />
            <Chip activo={nombreDeId === otro.id} texto={formatName(otro.name)} onPress={() => setNombreDeId(otro.id)} />
          </View>

          <TouchableOpacity
            style={[styles.boton, trabajando && styles.botonOff]}
            onPress={juntar}
            disabled={trabajando}
            testID="pet-merge-confirm"
          >
            {trabajando ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.botonTexto}>Juntar</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  foto: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.bgSection },
  fotoVacia: { alignItems: "center", justifyContent: "center" },
  nombre: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  detalle: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 2 },
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
