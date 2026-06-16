import { COLORS } from "@/constants/colors";
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPetById, updatePet } from "@/lib/api";
import { ImagePickerButton } from "@/components/ImagePickerButton";
import { ErrorState } from "@/components/ErrorState";
import { formatName, formatDayShortYear } from "@/lib/format";

export default function RenewCartillaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: pet, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["pet", id],
    queryFn: () => getPetById(id!),
    enabled: !!id,
  });

  const [cartillaPhotos, setCartillaPhotos] = useState<string[]>([]);
  const [cartillaStatus, setCartillaStatus] = useState<
    "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | null
  >(null);
  const [cartillaRejectionReason, setCartillaRejectionReason] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!pet) return;
    const existingPhotos = (pet as any).cartillaPhotos as string[] | undefined;
    const legacyUrl = (pet as any).cartillaUrl as string | null;
    setCartillaPhotos(
      existingPhotos && existingPhotos.length > 0
        ? existingPhotos
        : legacyUrl
          ? [legacyUrl]
          : [],
    );
    setCartillaStatus((pet as any).cartillaStatus ?? null);
    setCartillaRejectionReason((pet as any).cartillaRejectionReason ?? null);
  }, [pet]);

  // La cartilla se persiste apenas se sube/elimina — no espera a un botón
  // Guardar. Optimistic update con revert si falla la API.
  const cartillaMutation = useMutation({
    mutationFn: (photos: string[]) =>
      updatePet(id!, {
        cartillaPhotos: photos,
        cartillaUrl: photos[0] ?? null,
      }),
    onMutate: (photos) => {
      const previous = {
        photos: cartillaPhotos,
        status: cartillaStatus,
        reason: cartillaRejectionReason,
      };
      setCartillaPhotos(photos);
      const existing = (pet as any)?.cartillaPhotos as string[] | undefined;
      const changed = JSON.stringify(photos) !== JSON.stringify(existing ?? []);
      if (changed) {
        setCartillaStatus(photos.length > 0 ? "PENDING" : null);
        setCartillaRejectionReason(null);
      }
      return previous;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pet", id] });
      qc.invalidateQueries({ queryKey: ["pets"] });
    },
    onError: (_e: Error, _photos, ctx) => {
      if (ctx) {
        setCartillaPhotos(ctx.photos);
        setCartillaStatus(ctx.status);
        setCartillaRejectionReason(ctx.reason);
      }
      Alert.alert("Error", "No pudimos enviar la cartilla. Inténtalo de nuevo.");
    },
  });

  const { expiredVaccines, expiringVaccines } = useMemo(() => {
    const now = Date.now();
    const WINDOW = 30 * 86_400_000;
    const expired = (pet?.vaccines ?? []).filter(
      (v) => v.expiresAt && new Date(v.expiresAt).getTime() <= now
    );
    const expiring = (pet?.vaccines ?? []).filter((v) => {
      if (!v.expiresAt) return false;
      const ts = new Date(v.expiresAt).getTime();
      return ts > now && ts - now <= WINDOW;
    });
    return { expiredVaccines: expired, expiringVaccines: expiring };
  }, [pet?.vaccines]);

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading || !pet) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Renovar cartilla</Text>
      <Text style={styles.subtitle}>{formatName(pet.name)}</Text>

      {/* Razón */}
      {(expiredVaccines.length > 0 || expiringVaccines.length > 0) && (
        <View
          style={[
            styles.reasonBox,
            expiredVaccines.length > 0 ? styles.reasonDanger : styles.reasonWarning,
          ]}
        >
          <Ionicons
            name={expiredVaccines.length > 0 ? "alert-circle" : "alarm-outline"}
            size={20}
            color={
              expiredVaccines.length > 0 ? COLORS.errorText : COLORS.warningText
            }
          />
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.reasonTitle,
                {
                  color:
                    expiredVaccines.length > 0
                      ? COLORS.errorText
                      : COLORS.warningText,
                },
              ]}
            >
              {expiredVaccines.length > 0
                ? `${expiredVaccines.length === 1 ? "1 vacuna vencida" : `${expiredVaccines.length} vacunas vencidas`}`
                : `${expiringVaccines.length === 1 ? "1 vacuna por vencer" : `${expiringVaccines.length} vacunas por vencer`}`}
            </Text>
            {[...expiredVaccines, ...expiringVaccines].slice(0, 4).map((v) => (
              <Text
                key={v.id}
                style={[
                  styles.reasonItem,
                  {
                    color:
                      expiredVaccines.length > 0
                        ? COLORS.errorText
                        : COLORS.warningText,
                  },
                ]}
              >
                {(v as any).catalog?.displayName ?? v.name}
                {v.expiresAt
                  ? ` · vence ${formatDayShortYear(new Date(v.expiresAt))}`
                  : ""}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/* Instrucciones */}
      <View style={styles.stepsBox}>
        <Text style={styles.stepsTitle}>Cómo renovar</Text>
        <View style={styles.step}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>1</Text>
          </View>
          <Text style={styles.stepText}>
            Lleva a {formatName(pet.name)} con tu veterinario para renovar las vacunas.
          </Text>
        </View>
        <View style={styles.step}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>2</Text>
          </View>
          <Text style={styles.stepText}>
            Toma fotos claras de la nueva cartilla (anverso, reverso, páginas internas) y súbelas aquí abajo.
          </Text>
        </View>
        <View style={styles.step}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>3</Text>
          </View>
          <Text style={styles.stepText}>
            El equipo HDI revisará la cartilla y registrará las nuevas vacunas. Te avisaremos cuando esté lista.
          </Text>
        </View>
      </View>

      {/* Upload */}
      <Text style={styles.uploadLabel}>Cartilla actualizada</Text>
      <Text style={styles.cartillaHelp}>
        Puedes subir varias fotos (una por una). Toca "Agregar más" para añadir páginas adicionales.
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cartillaPhotosRow}
      >
        {cartillaPhotos.map((url, idx) => (
          <View key={`${url}-${idx}`} style={styles.cartillaThumbWrap}>
            <Image source={{ uri: url }} style={styles.cartillaThumb} />
            <TouchableOpacity
              style={styles.cartillaThumbRemove}
              onPress={() => {
                const next = cartillaPhotos.filter((_, i) => i !== idx);
                cartillaMutation.mutate(next);
              }}
              hitSlop={8}
              disabled={cartillaMutation.isPending}
              testID={`cartilla-remove-${idx}`}
            >
              <Ionicons name="close" size={14} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        ))}
        <ImagePickerButton
          imageUrl={null}
          onImageUploaded={(url) => {
            const next = [...cartillaPhotos, url];
            cartillaMutation.mutate(next);
          }}
          folder="cartillas"
          size={110}
          icon={
            cartillaPhotos.length === 0
              ? "shield-checkmark-outline"
              : "add-circle-outline"
          }
          label={cartillaPhotos.length === 0 ? "Cartilla" : "Agregar más"}
          allowsEditing={false}
          disabled={cartillaMutation.isPending}
        />
      </ScrollView>

      {/* Status badge */}
      {cartillaPhotos.length > 0 && cartillaStatus === "PENDING" && (
        <View style={[styles.statusBadge, { backgroundColor: COLORS.warningBg }]}>
          <Ionicons name="time-outline" size={18} color={COLORS.warningText} />
          <Text style={[styles.statusText, { color: COLORS.warningText }]}>
            En revisión — el equipo HDI la está validando.
          </Text>
        </View>
      )}
      {cartillaPhotos.length > 0 && cartillaStatus === "APPROVED" && (
        <View style={[styles.statusBadge, { backgroundColor: COLORS.successBg }]}>
          <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.successText} />
          <Text style={[styles.statusText, { color: COLORS.successText }]}>
            Cartilla aprobada.
          </Text>
        </View>
      )}
      {cartillaPhotos.length > 0 && cartillaStatus === "REJECTED" && (
        <View style={[styles.statusBadge, { backgroundColor: COLORS.errorBg }]}>
          <Ionicons name="close-circle-outline" size={18} color={COLORS.errorText} />
          <Text style={[styles.statusText, { color: COLORS.errorText }]}>
            Cartilla rechazada{cartillaRejectionReason ? `: ${cartillaRejectionReason}` : "."} Sube una nueva.
          </Text>
        </View>
      )}
      {cartillaPhotos.length > 0 && cartillaStatus === "EXPIRED" && (
        <View style={[styles.statusBadge, { backgroundColor: COLORS.errorBg }]}>
          <Ionicons name="alarm-outline" size={18} color={COLORS.errorText} />
          <Text style={[styles.statusText, { color: COLORS.errorText }]}>
            Cartilla vencida — sube la actualizada para volver a reservar.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.detailLink}
        onPress={() => router.push(`/pet/${id}` as any)}
      >
        <Ionicons name="paw-outline" size={16} color={COLORS.primary} />
        <Text style={styles.detailLinkText}>Ver perfil completo de {formatName(pet.name)}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.textPrimary },
  subtitle: { fontSize: 16, color: COLORS.textTertiary, marginTop: 2, marginBottom: 16 },
  reasonBox: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  reasonWarning: {
    backgroundColor: COLORS.warningBg,
    borderColor: COLORS.warningText,
  },
  reasonDanger: {
    backgroundColor: COLORS.errorBg,
    borderColor: COLORS.errorText,
  },
  reasonTitle: { fontSize: 14, fontWeight: "800", marginBottom: 4 },
  reasonItem: { fontSize: 12, lineHeight: 17 },
  stepsBox: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  stepsTitle: { fontSize: 15, fontWeight: "800", color: COLORS.textPrimary },
  step: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumberText: { color: COLORS.white, fontSize: 12, fontWeight: "800" },
  stepText: { flex: 1, fontSize: 14, color: COLORS.textSecondary, lineHeight: 20 },
  uploadLabel: { fontSize: 14, fontWeight: "700", color: COLORS.textSecondary },
  cartillaHelp: {
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 4,
  },
  cartillaPhotosRow: {
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  cartillaThumbWrap: {
    position: "relative",
    width: 110,
    height: 110,
  },
  cartillaThumb: {
    width: 110,
    height: 110,
    borderRadius: 14,
    backgroundColor: COLORS.bgSection,
  },
  cartillaThumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.errorText,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 14,
  },
  statusText: { flex: 1, fontSize: 13, fontWeight: "600" },
  detailLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 20,
    paddingVertical: 12,
  },
  detailLinkText: { fontSize: 14, fontWeight: "700", color: COLORS.primary },
});
