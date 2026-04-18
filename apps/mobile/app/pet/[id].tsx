import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getPetById } from "@/lib/api";

const SIZE_LABELS: Record<string, string> = {
  XS: "Extra pequeño",
  S: "Pequeño",
  M: "Mediano",
  L: "Grande",
  XL: "Extra grande",
};

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

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function PetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: pet, isLoading, error, refetch } = useQuery({
    queryKey: ["pet", id],
    queryFn: () => getPetById(id),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (error || !pet) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error al cargar mascota</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const petAny = pet as any;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header con foto */}
      <View style={styles.header}>
        <Image
          source={
            pet.photoUrl
              ? { uri: pet.photoUrl }
              : require("../../assets/pet-placeholder.png")
          }
          style={styles.photo}
          defaultSource={require("../../assets/pet-placeholder.png")}
        />
        <Text style={styles.name}>{pet.name}</Text>
        <Text style={styles.breed}>{pet.breed || "Sin raza especificada"}</Text>

        {/* Badges */}
        <View style={styles.badgeRow}>
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
            <Text style={styles.infoValue}>{formatDate(pet.birthDate)}</Text>
          </View>
        )}
      </View>

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
                <Text style={styles.contactLabel}>Veterinario</Text>
                <Text style={styles.contactName}>{petAny.vetName}</Text>
                {petAny.vetPhone && (
                  <TouchableOpacity
                    onPress={() =>
                      Linking.openURL(`tel:${petAny.vetPhone}`)
                    }
                  >
                    <Text style={styles.contactPhone}>{petAny.vetPhone}</Text>
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
                  {petAny.emergencyContactName}
                </Text>
                {petAny.emergencyContactPhone && (
                  <TouchableOpacity
                    onPress={() =>
                      Linking.openURL(
                        `tel:${petAny.emergencyContactPhone}`
                      )
                    }
                  >
                    <Text style={styles.contactPhone}>
                      {petAny.emergencyContactPhone}
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
              | null;
            const config = status === "APPROVED"
              ? { label: "Aprobada", bg: COLORS.successBg, text: COLORS.successText }
              : status === "PENDING"
              ? { label: "En revisión", bg: COLORS.warningBg, text: COLORS.warningText }
              : status === "REJECTED"
              ? { label: "Rechazada", bg: COLORS.errorBg, text: COLORS.errorText }
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

        {(pet as any).cartillaUrl ? (
          <Image
            source={{ uri: (pet as any).cartillaUrl }}
            style={styles.cartillaImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.cartillaEmpty}>
            <Ionicons name="document-outline" size={32} color={COLORS.textDisabled} />
            <Text style={styles.cartillaEmptyText}>
              Sin cartilla subida. Necesaria para reservar.
            </Text>
          </View>
        )}

        {(pet as any).cartillaStatus === "REJECTED" &&
          (pet as any).cartillaRejectionReason && (
            <Text style={styles.cartillaRejectionText}>
              Motivo: {(pet as any).cartillaRejectionReason}
            </Text>
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
                <Text style={styles.vaccineName}>{vaccine.name}</Text>
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
                  Aplicada: {formatDate(vaccine.appliedAt)}
                </Text>
                {vaccine.expiresAt && (
                  <Text style={styles.vaccineDate}>
                    Vence: {formatDate(vaccine.expiresAt)}
                  </Text>
                )}
                {vaccine.vetName && (
                  <Text style={styles.vaccineVet}>{vaccine.vetName}</Text>
                )}
              </View>
            </View>
          );
        })
      ) : (
        <Text style={styles.emptyText}>No hay vacunas registradas</Text>
      )}
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
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.bgSection,
    marginBottom: 12,
  },
  name: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  breed: {
    fontSize: 16,
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
    fontWeight: "700",
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
    fontWeight: "600",
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
    fontWeight: "600",
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "700",
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
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  infoCardText: {
    fontSize: 14,
    color: COLORS.textTertiary,
    lineHeight: 20,
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
    fontWeight: "700",
    color: COLORS.notesText,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 14,
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
    fontWeight: "600",
    textTransform: "uppercase",
  },
  contactName: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginTop: 1,
  },
  contactPhone: {
    fontSize: 14,
    color: COLORS.primary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
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
    fontWeight: "600",
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
    fontWeight: "700",
  },
  vaccineDetails: {
    marginTop: 8,
    paddingLeft: 26,
  },
  vaccineDate: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  vaccineVet: {
    fontSize: 13,
    color: COLORS.textDisabled,
    marginTop: 4,
    fontStyle: "italic",
  },
  emptyText: {
    fontSize: 14,
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
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  cartillaBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cartillaBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  cartillaImage: {
    width: "100%",
    height: 200,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
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
    color: COLORS.textTertiary,
    textAlign: "center",
  },
  cartillaRejectionText: {
    fontSize: 12,
    color: COLORS.errorText,
    fontStyle: "italic",
  },
  errorText: {
    fontSize: 16,
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
    fontWeight: "600",
    fontSize: 14,
  },
});
