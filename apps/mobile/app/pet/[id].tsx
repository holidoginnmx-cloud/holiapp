import { COLORS } from "@/constants/colors";
import { ErrorState } from "@/components/ErrorState";
import { useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Modal,
  Pressable,
  Dimensions,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getPetById, deletePet, updatePet } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { formatName, formatPhoneInput, phoneToTelUri, formatDayLongYear } from "@/lib/format";
import { cloudinaryResized } from "@/lib/cloudinary";
import { pickAndUploadPhoto } from "@/lib/photoPicker";
import { PetPhotoViewer } from "@/components/PetPhotoViewer";

const SIZE_LABELS: Record<string, string> = {
  XS: "Extra pequeño",
  S: "Pequeño",
  M: "Mediano",
  L: "Grande",
  XL: "Extra grande",
};

const SEX_LABELS: Record<string, string> = { M: "Macho", F: "Hembra" };
const BEHAVIOR_LABELS: Record<string, string> = {
  amigable: "Amigable",
  nervioso: "Nervioso",
  agresivo: "Agresivo",
  otro: "Otro",
};
const WALK_LABELS: Record<string, string> = {
  aire_libre: "Aire libre",
  instalaciones: "Instalaciones",
};

/** CSV ("amigable,nervioso") → lista de etiquetas legibles. */
function csvToLabels(csv: string | null | undefined, map: Record<string, string>): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => map[v] ?? v);
}

function getVaccineStatus(expiresAt: string | Date | null): {
  label: string;
  bg: string;
  text: string;
} | null {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt);
  const now = new Date();
  const daysUntilExpiry = Math.ceil(
    (expires.getTime() - now.getTime()) / 86_400_000
  );

  if (daysUntilExpiry < 0) {
    return { label: "Vencida", bg: COLORS.errorBg, text: COLORS.errorText };
  }
  if (daysUntilExpiry <= 30) {
    return { label: "Por vencer", bg: COLORS.warningBg, text: COLORS.warningText };
  }
  return null;
}


export default function PetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.userId);
  const role = useAuthStore((s) => s.role);
  const esEquipo = role === "ADMIN" || role === "STAFF";
  const [cartillaFullSizeIdx, setCartillaFullSizeIdx] = useState<number | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  // Editor de la duración de baño propia del perro (solo equipo).
  const [groomingOpen, setGroomingOpen] = useState(false);
  const [groomingDraft, setGroomingDraft] = useState("");

  const { data: pet, isLoading, error, refetch } = useQuery({
    queryKey: ["pet", id],
    queryFn: () => getPetById(id),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePet(id!),
    onSuccess: () => {
      // Optimista: quitamos la mascota de la caché para que las listas se
      // actualicen al instante, sin esperar el refetch de red.
      qc.setQueryData<any[]>(["pets", userId], (old) =>
        old ? old.filter((p) => p.id !== id) : old
      );
      // Revalidamos en segundo plano (sin await) para no bloquear la navegación.
      qc.invalidateQueries({ queryKey: ["pets"] });
      // Mostramos el toast de éxito y luego volvemos.
      setDeleteSuccess(true);
      setTimeout(() => router.back(), 1100);
    },
    onError: (err: Error) => {
      Alert.alert(
        "No se pudo eliminar",
        err.message || "Ocurrió un error al eliminar a tu mascota."
      );
    },
  });

  const photoMutation = useMutation({
    mutationFn: (photoUrl: string | null) => updatePet(id!, { photoUrl }),
    onSuccess: (_data, photoUrl) => {
      // Optimista: la foto nueva aparece al instante en el detalle.
      qc.setQueryData<any>(["pet", id], (old: any) =>
        old ? { ...old, photoUrl } : old
      );
      // Listas del cliente y del admin en segundo plano.
      qc.invalidateQueries({ queryKey: ["pets"] });
      qc.invalidateQueries({ queryKey: ["admin", "pets"] });
    },
    onError: (err: Error) => {
      Alert.alert(
        "No se pudo actualizar la foto",
        err.message || "Inténtalo de nuevo."
      );
    },
  });

  // Duración de baño propia del perro. Se edita aquí y no en el formulario
  // completo a propósito: la mayoría de los perros viejos tienen el perfil a
  // medias (sin contacto de emergencia, sin preferencia de paseo) y el
  // formulario no deja guardar hasta completarlo. Anotar cuánto tarda un baño
  // no puede depender de eso.
  const groomingMutation = useMutation({
    mutationFn: (minutos: number | null) =>
      updatePet(id!, { groomingMinutes: minutos }),
    onSuccess: (_data, minutos) => {
      qc.setQueryData<any>(["pet", id], (old: any) =>
        old ? { ...old, groomingMinutes: minutos } : old
      );
      qc.invalidateQueries({ queryKey: ["pets"] });
      qc.invalidateQueries({ queryKey: ["admin", "pets"] });
      // La agenda y las listas de baños calculan con este número.
      qc.invalidateQueries({ queryKey: ["staff-baths"] });
      qc.invalidateQueries({ queryKey: ["admin-baths"] });
      setGroomingOpen(false);
    },
    onError: (err: Error) => {
      Alert.alert(
        "No se pudo guardar la duración",
        err.message || "Inténtalo de nuevo."
      );
    },
  });

  const guardarGrooming = () => {
    const limpio = groomingDraft.trim();
    if (!limpio) return groomingMutation.mutate(null);
    const min = parseInt(limpio, 10);
    if (!Number.isFinite(min) || min < 15 || min > 600) {
      return Alert.alert(
        "Duración fuera de rango",
        "La duración del baño debe estar entre 15 y 600 minutos."
      );
    }
    groomingMutation.mutate(min);
  };

  const confirmRemovePhoto = () => {
    Alert.alert(
      "Eliminar foto",
      `¿Quitar la foto de perfil de ${formatName(pet?.name ?? "la mascota")}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => photoMutation.mutate(null),
        },
      ]
    );
  };

  const changePhoto = async () => {
    try {
      const url = await pickAndUploadPhoto({
        folder: "pets",
        onUploadStart: () => setPhotoUploading(true),
        // Solo ofrecemos eliminar si hay foto que quitar.
        onRemove: pet?.photoUrl ? confirmRemovePhoto : undefined,
      });
      if (url) photoMutation.mutate(url);
    } catch (err: any) {
      Alert.alert("Error", err.message || "No se pudo subir la imagen");
    } finally {
      setPhotoUploading(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      "Eliminar mascota",
      `¿Seguro que quieres eliminar a ${formatName(pet?.name ?? "tu mascota")}? Esta acción no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => deleteMutation.mutate(),
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (error || !pet) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  const petAny = pet as any;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header con foto — la foto abre el visor; el badge de cámara la cambia.
          Sin foto todavía, tocarla lleva directo a elegir una. */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.photoWrap}
          onPress={pet.photoUrl ? () => setPhotoViewerOpen(true) : changePhoto}
          disabled={photoUploading || photoMutation.isPending}
          activeOpacity={0.8}
          accessibilityLabel={
            pet.photoUrl
              ? `Ver la foto de ${formatName(pet.name)}`
              : `Agregar una foto de ${formatName(pet.name)}`
          }
          testID="pet-photo"
        >
          <Image
            source={
              pet.photoUrl
                ? { uri: pet.photoUrl }
                : require("../../assets/pet-placeholder.png")
            }
            style={styles.photo}
            defaultSource={require("../../assets/pet-placeholder.png")}
          />
          {photoUploading || photoMutation.isPending ? (
            <View style={styles.photoLoadingOverlay}>
              <ActivityIndicator color={COLORS.white} />
            </View>
          ) : (
            <TouchableOpacity
              style={styles.photoCameraBadge}
              onPress={changePhoto}
              hitSlop={10}
              activeOpacity={0.8}
              accessibilityLabel="Cambiar la foto"
              testID="pet-photo-change"
            >
              <Ionicons name="camera" size={15} color={COLORS.white} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
        <Text style={styles.name}>{formatName(pet.name)}</Text>
        <Text style={styles.breed}>{pet.breed || "Sin raza especificada"}</Text>

        {/* Badges */}
        <View style={styles.badgeRow}>
          {petAny.sex && SEX_LABELS[petAny.sex] && (
            <View style={[styles.badge, { backgroundColor: COLORS.infoBg }]}>
              <Text style={[styles.badgeText, { color: COLORS.infoText }]}>
                {SEX_LABELS[petAny.sex]}
              </Text>
            </View>
          )}
          <View
            style={[
              styles.badge,
              {
                backgroundColor: petAny.isNeutered ? COLORS.successBg : COLORS.warningBg,
              },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                {
                  color: petAny.isNeutered ? COLORS.successText : COLORS.warningText,
                },
              ]}
            >
              {petAny.isNeutered ? "Esterilizado" : "No esterilizado"}
            </Text>
          </View>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() =>
            router.push({
              pathname: "/pet/create",
              params: { editId: id! },
            } as any)
          }
        >
          <Ionicons name="create-outline" size={18} color={COLORS.primary} />
          <Text style={styles.actionButtonText}>Editar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() =>
            router.push({
              pathname: "/pet/history",
              params: { petId: id! },
            } as any)
          }
        >
          <Ionicons name="time-outline" size={18} color={COLORS.primary} />
          <Text style={styles.actionButtonText}>Historial</Text>
        </TouchableOpacity>
      </View>

      {/* Info grid */}
      <View style={styles.infoGrid}>
        <View style={styles.infoItem}>
          <Ionicons name="resize-outline" size={20} color={COLORS.primary} />
          <Text style={styles.infoLabel}>Tamaño</Text>
          <Text style={styles.infoValue}>
            {SIZE_LABELS[pet.size] || pet.size}
          </Text>
        </View>
        {pet.weight && (
          <View style={styles.infoItem}>
            <Ionicons name="barbell-outline" size={20} color={COLORS.primary} />
            <Text style={styles.infoLabel}>Peso</Text>
            <Text style={styles.infoValue}>{pet.weight} kg</Text>
          </View>
        )}
        {pet.birthDate && (
          <View style={styles.infoItem}>
            <Ionicons name="calendar-outline" size={20} color={COLORS.primary} />
            <Text style={styles.infoLabel}>Nacimiento</Text>
            <Text style={styles.infoValue}>{formatDayLongYear(pet.birthDate)}</Text>
          </View>
        )}
      </View>

      {/* Duración de su baño — solo el equipo. Se edita aquí mismo: es un dato
          de operación que se descubre bañando al perro, y mandar a alguien al
          formulario completo (que exige contacto de emergencia y demás) para
          anotar un número sería garantizar que nadie lo anote. */}
      {esEquipo && (
        <TouchableOpacity
          style={styles.infoCard}
          activeOpacity={0.8}
          onPress={() => {
            setGroomingDraft(petAny.groomingMinutes?.toString() ?? "");
            setGroomingOpen(true);
          }}
          testID="pet-grooming-card"
        >
          <View style={styles.infoCardHeader}>
            <Ionicons name="time-outline" size={16} color={COLORS.primary} />
            <Text style={styles.infoCardTitle}>Duración de su baño</Text>
            <Ionicons
              name="create-outline"
              size={16}
              color={COLORS.primary}
              style={{ marginLeft: "auto" }}
            />
          </View>
          <Text style={styles.infoCardText}>
            {petAny.groomingMinutes != null
              ? `${petAny.groomingMinutes} minutos · lo que de verdad tarda, no la tabla por talla. El corte y el deslanado suman aparte.`
              : "Sin definir: la agenda usa la tabla por talla. Tócalo para anotar cuánto tarda en realidad."}
          </Text>
        </TouchableOpacity>
      )}

      {/* Personalidad */}
      {petAny.personality && (
        <View style={styles.infoCard}>
          <View style={styles.infoCardHeader}>
            <Ionicons name="happy-outline" size={16} color={COLORS.primary} />
            <Text style={styles.infoCardTitle}>Personalidad</Text>
          </View>
          <Text style={styles.infoCardText}>{petAny.personality}</Text>
        </View>
      )}

      {/* Dieta */}
      {petAny.diet && (
        <View style={styles.infoCard}>
          <View style={styles.infoCardHeader}>
            <Ionicons name="restaurant-outline" size={16} color={COLORS.warningText} />
            <Text style={styles.infoCardTitle}>Dieta</Text>
          </View>
          <Text style={styles.infoCardText}>{petAny.diet}</Text>
        </View>
      )}

      {/* Alimentación */}
      {(petAny.foodType ||
        petAny.feedingAmount ||
        petAny.feedingSchedule ||
        petAny.feedingInstructions) && (
        <View style={styles.infoCard}>
          <View style={styles.infoCardHeader}>
            <Ionicons name="nutrition-outline" size={16} color={COLORS.warningText} />
            <Text style={styles.infoCardTitle}>Alimentación</Text>
          </View>
          {petAny.foodType && (
            <Text style={styles.infoCardText}>
              <Text style={styles.infoCardLabel}>Alimento: </Text>
              {petAny.foodType}
            </Text>
          )}
          {petAny.feedingAmount && (
            <Text style={styles.infoCardText}>
              <Text style={styles.infoCardLabel}>Cantidad: </Text>
              {petAny.feedingAmount}
            </Text>
          )}
          {petAny.feedingSchedule && (
            <Text style={styles.infoCardText}>
              <Text style={styles.infoCardLabel}>Horario: </Text>
              {petAny.feedingSchedule}
            </Text>
          )}
          {petAny.feedingInstructions && (
            <Text style={styles.infoCardText}>
              <Text style={styles.infoCardLabel}>Instrucciones: </Text>
              {petAny.feedingInstructions}
            </Text>
          )}
        </View>
      )}

      {/* Problemas de salud */}
      {petAny.healthIssues && (
        <View style={styles.infoCard}>
          <View style={styles.infoCardHeader}>
            <Ionicons name="fitness-outline" size={16} color={COLORS.errorText} />
            <Text style={styles.infoCardTitle}>Problemas de salud</Text>
          </View>
          <Text style={styles.infoCardText}>{petAny.healthIssues}</Text>
        </View>
      )}

      {/* Comportamiento y preferencia de paseo */}
      {(() => {
        const behaviors = csvToLabels(petAny.behavior, BEHAVIOR_LABELS);
        const walks = csvToLabels(petAny.walkPreference, WALK_LABELS);
        if (behaviors.length === 0 && walks.length === 0) return null;
        return (
          <View style={styles.infoCard}>
            <View style={styles.infoCardHeader}>
              <Ionicons name="paw-outline" size={16} color={COLORS.primary} />
              <Text style={styles.infoCardTitle}>Comportamiento y paseo</Text>
            </View>
            <View style={styles.chipWrap}>
              {behaviors.map((b) => (
                <View key={b} style={styles.detailChip}>
                  <Text style={styles.detailChipText}>{b}</Text>
                </View>
              ))}
              {walks.map((w) => (
                <View
                  key={w}
                  style={[styles.detailChip, { backgroundColor: COLORS.infoBg }]}
                >
                  <Ionicons name="walk-outline" size={12} color={COLORS.infoText} />
                  <Text style={[styles.detailChipText, { color: COLORS.infoText }]}>
                    {w}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        );
      })()}

      {/* Notas */}
      {pet.notes && (
        <View style={styles.notesCard}>
          <Text style={styles.notesTitle}>Notas especiales</Text>
          <Text style={styles.notesText}>{pet.notes}</Text>
        </View>
      )}

      {/* Contactos */}
      {(petAny.vetName || petAny.emergencyContactName) && (
        <View style={styles.contactsSection}>
          <Text style={styles.sectionTitle}>Contactos</Text>

          {petAny.vetName && (
            <View style={styles.contactCard}>
              <View style={styles.contactIcon}>
                <Ionicons name="medkit" size={18} color={COLORS.primary} />
              </View>
              <View style={styles.contactInfo}>
                <View style={styles.contactLabelRow}>
                  <Text style={styles.contactLabel}>Veterinario</Text>
                  {petAny.vetEmergency24h && (
                    <View style={styles.vet24hBadge}>
                      <Text style={styles.vet24hText}>24h</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.contactName}>{formatName(petAny.vetName)}</Text>
                {petAny.vetPhone && (
                  <TouchableOpacity
                    onPress={() =>
                      Linking.openURL(`tel:${phoneToTelUri(petAny.vetPhone)}`)
                    }
                  >
                    <Text style={styles.contactPhone}>{formatPhoneInput(petAny.vetPhone)}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {petAny.emergencyContactName && (
            <View style={styles.contactCard}>
              <View style={styles.contactIcon}>
                <Ionicons name="call" size={18} color={COLORS.errorText} />
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactLabel}>Emergencia</Text>
                <Text style={styles.contactName}>
                  {formatName(petAny.emergencyContactName)}
                </Text>
                {petAny.emergencyContactRelation && (
                  <Text style={styles.contactRelation}>
                    {petAny.emergencyContactRelation}
                  </Text>
                )}
                {petAny.emergencyContactPhone && (
                  <TouchableOpacity
                    onPress={() =>
                      Linking.openURL(
                        `tel:${phoneToTelUri(petAny.emergencyContactPhone)}`
                      )
                    }
                  >
                    <Text style={styles.contactPhone}>
                      {formatPhoneInput(petAny.emergencyContactPhone)}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Vacunas */}
      <Text style={styles.sectionTitle}>
        Vacunas ({pet.vaccines?.length || 0})
      </Text>

      {/* Cartilla de vacunación */}
      <View style={styles.cartillaCard}>
        <View style={styles.cartillaHeader}>
          <Ionicons name="shield-checkmark" size={18} color={COLORS.primary} />
          <Text style={styles.cartillaTitle}>Cartilla de vacunación</Text>
          {(() => {
            const status = (pet as any).cartillaStatus as
              | "PENDING"
              | "APPROVED"
              | "REJECTED"
              | "EXPIRED"
              | null;
            const config = status === "APPROVED"
              ? { label: "Aprobada", bg: COLORS.successBg, text: COLORS.successText }
              : status === "PENDING"
              ? { label: "En revisión", bg: COLORS.warningBg, text: COLORS.warningText }
              : status === "REJECTED"
              ? { label: "Rechazada", bg: COLORS.errorBg, text: COLORS.errorText }
              : status === "EXPIRED"
              ? { label: "Vencida", bg: COLORS.errorBg, text: COLORS.errorText }
              : null;
            if (!config) return null;
            return (
              <View style={[styles.cartillaBadge, { backgroundColor: config.bg }]}>
                <Text style={[styles.cartillaBadgeText, { color: config.text }]}>
                  {config.label}
                </Text>
              </View>
            );
          })()}
        </View>

        {(() => {
          const photos = ((pet as any).cartillaPhotos as string[] | undefined) ?? [];
          const legacyUrl = (pet as any).cartillaUrl as string | null;
          const allPhotos =
            photos.length > 0 ? photos : legacyUrl ? [legacyUrl] : [];

          if (allPhotos.length === 0) {
            return (
              <TouchableOpacity
                style={styles.cartillaEmpty}
                activeOpacity={0.7}
                onPress={() =>
                  router.push({
                    pathname: "/pet/create",
                    params: { editId: id!, focus: "cartilla" },
                  } as any)
                }
              >
                <Ionicons name="cloud-upload-outline" size={32} color={COLORS.primary} />
                <Text style={styles.cartillaEmptyText}>
                  Sin cartilla subida. Necesaria para reservar.
                </Text>
                <Text style={styles.cartillaEmptyCta}>Toca para subir</Text>
              </TouchableOpacity>
            );
          }

          if (allPhotos.length === 1) {
            return (
              <TouchableOpacity
                onPress={() => setCartillaFullSizeIdx(0)}
                activeOpacity={0.85}
              >
                <Image
                  source={{ uri: cloudinaryResized(allPhotos[0], 600, "fill") }}
                  style={styles.cartillaImage}
                  resizeMode="cover"
                />
                <View style={styles.cartillaZoomHint}>
                  <Ionicons name="expand-outline" size={14} color={COLORS.white} />
                  <Text style={styles.cartillaZoomHintText}>Toca para ampliar</Text>
                </View>
              </TouchableOpacity>
            );
          }

          return (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cartillaGalleryRow}
            >
              {allPhotos.map((url, idx) => (
                <TouchableOpacity
                  key={`${url}-${idx}`}
                  onPress={() => setCartillaFullSizeIdx(idx)}
                  activeOpacity={0.85}
                >
                  <Image
                    source={{ uri: cloudinaryResized(url, 540, "fill") }}
                    style={styles.cartillaGalleryThumb}
                    resizeMode="cover"
                  />
                  <View style={styles.cartillaGalleryIndex}>
                    <Text style={styles.cartillaGalleryIndexText}>
                      {idx + 1}/{allPhotos.length}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          );
        })()}

        {(pet as any).cartillaStatus === "REJECTED" &&
          (pet as any).cartillaRejectionReason && (
            <Text style={styles.cartillaRejectionText}>
              Motivo: {(pet as any).cartillaRejectionReason}
            </Text>
          )}

        {/* Observación que el equipo mandó junto con la aprobación (ej.
            "falta desparasitación"); llega también por notificación. */}
        {(pet as any).cartillaStatus === "APPROVED" &&
          (pet as any).cartillaApprovalNote && (
            <View style={styles.cartillaNoteBox}>
              <Text style={styles.cartillaNoteTitle}>Nota del equipo HDI</Text>
              <Text style={styles.cartillaNoteText}>
                {(pet as any).cartillaApprovalNote}
              </Text>
            </View>
          )}
      </View>

      {pet.vaccines && pet.vaccines.length > 0 ? (
        pet.vaccines.map((vaccine) => {
          const status = getVaccineStatus(vaccine.expiresAt);
          return (
            <View key={vaccine.id} style={styles.vaccineCard}>
              <View style={styles.vaccineHeader}>
                <Ionicons
                  name="medkit"
                  size={18}
                  color={status?.text || COLORS.greenBright}
                />
                <Text style={styles.vaccineName}>
                  {(vaccine as any).catalog?.displayName ?? vaccine.name}
                </Text>
                {status && (
                  <View
                    style={[styles.vaccineBadge, { backgroundColor: status.bg }]}
                  >
                    <Text
                      style={[styles.vaccineBadgeText, { color: status.text }]}
                    >
                      {status.label}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.vaccineDetails}>
                <Text style={styles.vaccineDate}>
                  Aplicada: {formatDayLongYear(vaccine.appliedAt)}
                </Text>
                {vaccine.expiresAt && (
                  <Text style={styles.vaccineDate}>
                    Vence: {formatDayLongYear(vaccine.expiresAt)}
                  </Text>
                )}
                {vaccine.vetName && (
                  <Text style={styles.vaccineVet}>{formatName(vaccine.vetName)}</Text>
                )}
              </View>
            </View>
          );
        })
      ) : (
        <Text style={styles.emptyText}>No hay vacunas registradas</Text>
      )}

      {/* Eliminar mascota */}
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={confirmDelete}
        disabled={deleteMutation.isPending}
        activeOpacity={0.85}
      >
        {deleteMutation.isPending ? (
          <ActivityIndicator size="small" color={COLORS.errorText} />
        ) : (
          <>
            <Ionicons name="trash-outline" size={18} color={COLORS.errorText} />
            <Text style={styles.deleteButtonText}>Eliminar mascota</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Toast de éxito al eliminar */}
      <Modal visible={deleteSuccess} transparent animationType="fade">
        <View style={styles.toastOverlay} pointerEvents="none">
          <View style={styles.toastCard}>
            <View style={styles.toastIconWrap}>
              <Ionicons
                name="checkmark-circle"
                size={48}
                color={COLORS.successText}
              />
            </View>
            <Text style={styles.toastText}>Mascota eliminada</Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={cartillaFullSizeIdx !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCartillaFullSizeIdx(null)}
      >
        <Pressable
          style={styles.fullSizeOverlay}
          onPress={() => setCartillaFullSizeIdx(null)}
        >
          <TouchableOpacity
            style={styles.fullSizeClose}
            onPress={() => setCartillaFullSizeIdx(null)}
            hitSlop={16}
          >
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
          {(() => {
            if (cartillaFullSizeIdx === null) return null;
            const photos = ((pet as any).cartillaPhotos as string[] | undefined) ?? [];
            const legacyUrl = (pet as any).cartillaUrl as string | null;
            const allPhotos =
              photos.length > 0 ? photos : legacyUrl ? [legacyUrl] : [];
            const url = allPhotos[cartillaFullSizeIdx];
            if (!url) return null;
            return (
              <>
                <Image
                  source={{ uri: cloudinaryResized(url, 1080, "limit") }}
                  style={styles.fullSizeImage}
                  resizeMode="contain"
                />
                {allPhotos.length > 1 && (
                  <Text style={styles.fullSizeIndex}>
                    {cartillaFullSizeIdx + 1} / {allPhotos.length}
                  </Text>
                )}
              </>
            );
          })()}
        </Pressable>
      </Modal>

      <PetPhotoViewer
        visible={photoViewerOpen}
        photoUrl={pet.photoUrl}
        petName={pet.name}
        breed={pet.breed}
        onClose={() => setPhotoViewerOpen(false)}
        onChangePhoto={() => {
          // Cerrar antes de abrir el picker: si no, el selector de fotos sale
          // encima del visor y al volver te deja en la foto vieja.
          setPhotoViewerOpen(false);
          changePhoto();
        }}
      />

      {/* Editor de la duración de baño */}
      <Modal
        visible={groomingOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGroomingOpen(false)}
      >
        <Pressable
          style={styles.groomingOverlay}
          onPress={() => setGroomingOpen(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <Pressable
              style={styles.groomingSheet}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.groomingTitle}>
                ¿Cuánto tarda el baño de {formatName(pet.name)}?
              </Text>
              <Text style={styles.groomingHelp}>
                Lo que tarda en la práctica, sin extras. Si lo dejas vacío, la
                agenda usa la tabla por talla. El corte y el deslanado siguen
                sumando su tiempo aparte.
              </Text>

              <View style={styles.groomingChips}>
                {[45, 60, 90, 120, 150].map((min) => {
                  const activo = groomingDraft === String(min);
                  return (
                    <TouchableOpacity
                      key={min}
                      style={[styles.groomingChip, activo && styles.groomingChipOn]}
                      onPress={() =>
                        setGroomingDraft(activo ? "" : String(min))
                      }
                    >
                      <Text
                        style={[
                          styles.groomingChipText,
                          activo && styles.groomingChipTextOn,
                        ]}
                      >
                        {min} min
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                style={styles.groomingInput}
                value={groomingDraft}
                onChangeText={(t) => setGroomingDraft(t.replace(/[^0-9]/g, ""))}
                placeholder="Usa la tabla por talla"
                placeholderTextColor={COLORS.textDisabled}
                keyboardType="number-pad"
                maxLength={3}
                testID="pet-grooming-input"
              />

              <TouchableOpacity
                style={styles.groomingSave}
                onPress={guardarGrooming}
                disabled={groomingMutation.isPending}
                testID="pet-grooming-save"
              >
                {groomingMutation.isPending ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.groomingSaveText}>
                    {groomingDraft.trim() ? "Guardar" : "Usar la tabla por talla"}
                  </Text>
                )}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bgPage,
  },
  header: {
    alignItems: "center",
    paddingVertical: 24,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  photoWrap: {
    marginBottom: 12,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.bgSection,
  },
  photoLoadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 60,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoCameraBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 26,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
  },
  breed: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 4,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 14,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.reviewBg,
    borderWidth: 1,
    borderColor: COLORS.reviewBorder,
    borderRadius: 10,
    paddingVertical: 10,
  },
  actionButtonText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
  },
  infoGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: COLORS.white,
    paddingVertical: 16,
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  infoItem: {
    alignItems: "center",
  },
  infoLabel: {
    fontSize: 11,
    color: COLORS.textDisabled,
    marginTop: 4,
    textTransform: "uppercase",
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  infoValue: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  infoCard: {
    backgroundColor: COLORS.white,
    margin: 16,
    marginBottom: 0,
    padding: 14,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  infoCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  infoCardTitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
  },
  infoCardText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    lineHeight: 20,
  },
  infoCardLabel: {
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  detailChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  detailChipText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
  },
  contactLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  vet24hBadge: {
    backgroundColor: COLORS.successBg,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  vet24hText: {
    fontSize: 9,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.successText,
  },
  contactRelation: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  notesCard: {
    backgroundColor: COLORS.warningBg,
    margin: 16,
    marginBottom: 0,
    padding: 14,
    borderRadius: 10,
  },
  notesTitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.notesText,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.notesBorder,
    lineHeight: 20,
  },
  contactsSection: {
    marginTop: 16,
  },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 10,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  contactIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
    justifyContent: "center",
  },
  contactInfo: { flex: 1 },
  contactLabel: {
    fontSize: 11,
    color: COLORS.textDisabled,
    fontFamily: "PlusJakartaSans_600SemiBold",
    textTransform: "uppercase",
  },
  contactName: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
    marginTop: 1,
  },
  contactPhone: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.primary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 12,
  },
  vaccineCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  vaccineHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  vaccineName: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
    flex: 1,
  },
  vaccineBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  vaccineBadgeText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  vaccineDetails: {
    marginTop: 8,
    paddingLeft: 26,
  },
  vaccineDate: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  vaccineVet: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textDisabled,
    marginTop: 4,
    fontStyle: "italic",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textDisabled,
    textAlign: "center",
    marginTop: 12,
  },
  cartillaCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
    gap: 10,
  },
  cartillaHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cartillaTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  cartillaBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cartillaBadgeText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  cartillaImage: {
    width: "100%",
    height: 200,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
  },
  cartillaZoomHint: {
    position: "absolute",
    bottom: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cartillaZoomHintText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.white,
  },
  fullSizeOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullSizeClose: {
    position: "absolute",
    top: 60,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  fullSizeImage: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.85,
  },
  fullSizeIndex: {
    position: "absolute",
    bottom: 50,
    alignSelf: "center",
    color: COLORS.white,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  cartillaGalleryRow: {
    gap: 10,
    paddingVertical: 4,
  },
  cartillaGalleryThumb: {
    width: 140,
    height: 180,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
  },
  cartillaGalleryIndex: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  cartillaGalleryIndexText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  cartillaEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 8,
    backgroundColor: COLORS.bgPage,
    borderRadius: 10,
  },
  cartillaEmptyText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
  },
  cartillaEmptyCta: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
    marginTop: 2,
  },
  cartillaRejectionText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.errorText,
    fontStyle: "italic",
  },
  cartillaNoteBox: {
    backgroundColor: COLORS.warningBg,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    gap: 2,
  },
  cartillaNoteTitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.warningText,
  },
  cartillaNoteText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.warningText,
    lineHeight: 20,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 28,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.errorText,
    backgroundColor: COLORS.errorBg,
  },
  deleteButtonText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.errorText,
  },
  toastOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  toastCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 28,
    alignItems: "center",
    gap: 10,
    minWidth: 220,
    maxWidth: 320,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  toastIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.successBg,
    alignItems: "center",
    justifyContent: "center",
  },
  toastText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  errorText: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.dangerText,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: COLORS.white,
    fontFamily: "PlusJakartaSans_600SemiBold",
    fontSize: 14,
  },
  groomingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  groomingSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 22,
    paddingBottom: 34,
    gap: 12,
  },
  groomingTitle: {
    fontSize: 18,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
  },
  groomingHelp: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    lineHeight: 19,
  },
  groomingChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  groomingChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  groomingChipOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  groomingChipText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  groomingChipTextOn: { color: COLORS.white },
  groomingInput: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bgPage,
  },
  groomingSave: {
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  groomingSaveText: {
    color: COLORS.white,
    fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 15,
  },
});
