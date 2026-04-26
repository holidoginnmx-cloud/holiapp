import { COLORS } from "@/constants/colors";
import { View, Text, Image, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Pet, Vaccine } from "@holidoginn/shared";

const SIZE_LABELS: Record<string, string> = {
  XS: "Extra pequeño",
  S: "Pequeño",
  M: "Mediano",
  L: "Grande",
  XL: "Extra grande",
};

type PetReservationSummary = {
  id: string;
  checkIn: string;
  checkOut: string;
  status: "PENDING" | "CONFIRMED" | "CHECKED_IN";
  paymentType?: "FULL" | "DEPOSIT" | null;
  totalAmount?: string;
};

type PetWithContext = Pet & {
  vaccines?: Vaccine[];
  reservations?: PetReservationSummary[];
};

interface PetCardProps {
  pet: PetWithContext;
  ownerName?: string;
  onPress?: () => void;
  onReserveHotel?: () => void;
  onReserveBath?: () => void;
}

type Chip = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  bg: string;
  fg: string;
};

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
}

function buildStatusChips(pet: PetWithContext): Chip[] {
  const chips: Chip[] = [];

  const reservations = pet.reservations ?? [];
  const checkedIn = reservations.find((r) => r.status === "CHECKED_IN");
  const upcoming = reservations
    .filter((r) => r.status === "CONFIRMED" || r.status === "PENDING")
    .sort((a, b) => +new Date(a.checkIn) - +new Date(b.checkIn))[0];
  const pendingBalance = reservations.find((r) => r.status === "PENDING");

  if (checkedIn) {
    chips.push({
      icon: "bed-outline",
      label: "En hotel",
      bg: COLORS.successBg,
      fg: COLORS.successText,
    });
  } else if (upcoming) {
    chips.push({
      icon: "calendar-outline",
      label: `Hotel el ${formatShortDate(upcoming.checkIn)}`,
      bg: COLORS.infoBg,
      fg: COLORS.infoText,
    });
  }

  if (pendingBalance) {
    chips.push({
      icon: "alert-circle-outline",
      label: "Saldo pendiente",
      bg: COLORS.warningBg,
      fg: COLORS.warningText,
    });
  }

  if (!pet.cartillaUrl) {
    chips.push({
      icon: "medkit-outline",
      label: "Agregar cartilla",
      bg: COLORS.warningBg,
      fg: COLORS.warningText,
    });
  } else if (pet.cartillaStatus === "APPROVED") {
    chips.push({
      icon: "shield-checkmark-outline",
      label: "Cartilla vigente",
      bg: COLORS.successBg,
      fg: COLORS.successText,
    });
  } else if (pet.cartillaStatus === "REJECTED") {
    chips.push({
      icon: "alert-circle-outline",
      label: "Cartilla rechazada",
      bg: COLORS.errorBg,
      fg: COLORS.errorText,
    });
  } else {
    chips.push({
      icon: "time-outline",
      label: "Pendiente de aprobación",
      bg: COLORS.infoBg,
      fg: COLORS.infoText,
    });
  }

  return chips;
}

export function PetCard({
  pet,
  ownerName,
  onPress,
  onReserveHotel,
  onReserveBath,
}: PetCardProps) {
  const chips = buildStatusChips(pet);
  const sizeLabel = SIZE_LABELS[pet.size] || pet.size;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.photoWrap}>
        <Image
          source={
            pet.photoUrl
              ? { uri: pet.photoUrl }
              : require("../../assets/pet-placeholder.png")
          }
          style={styles.photo}
          defaultSource={require("../../assets/pet-placeholder.png")}
        />
        <View style={styles.photoBadge}>
          <Text style={styles.photoBadgeText}>{sizeLabel}</Text>
        </View>
        <View style={styles.photoNameWrap}>
          <Text style={styles.photoName} numberOfLines={1}>
            {pet.name}
          </Text>
          {ownerName && (
            <Text style={styles.photoOwner} numberOfLines={1}>
              {ownerName}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.metaRow}>
          <Ionicons name="paw" size={14} color={COLORS.primary} />
          <Text style={styles.breed} numberOfLines={1}>
            {pet.breed || "Sin raza especificada"}
          </Text>
          {pet.weight != null && (
            <>
              <View style={styles.metaDot} />
              <Text style={styles.breed}>{pet.weight} kg</Text>
            </>
          )}
        </View>

        {chips.length > 0 && (
          <View style={styles.chipRow}>
            {chips.map((chip, i) => (
              <View
                key={`${chip.label}-${i}`}
                style={[styles.chip, { backgroundColor: chip.bg }]}
              >
                <Ionicons name={chip.icon} size={12} color={chip.fg} />
                <Text style={[styles.chipText, { color: chip.fg }]}>
                  {chip.label}
                </Text>
              </View>
            ))}
          </View>
        )}

        {(onReserveHotel || onReserveBath) && (
          <View style={styles.actionsRow}>
            {onReserveHotel && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionPrimary]}
                onPress={onReserveHotel}
                activeOpacity={0.8}
                testID={`pet-${pet.id}-action-hotel`}
              >
                <Ionicons name="bed" size={16} color={COLORS.white} />
                <Text style={styles.actionPrimaryText}>Hotel</Text>
              </TouchableOpacity>
            )}
            {onReserveBath && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionSecondary]}
                onPress={onReserveBath}
                activeOpacity={0.8}
                testID={`pet-${pet.id}-action-bath`}
              >
                <Ionicons name="water" size={16} color={COLORS.primary} />
                <Text style={styles.actionSecondaryText}>Baño</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  photoWrap: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: COLORS.bgSection,
  },
  photo: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  photoBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  photoBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
    letterSpacing: 0.3,
  },
  photoNameWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
  },
  photoName: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.white,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  photoOwner: {
    fontSize: 12,
    color: "rgba(255,255,255,0.9)",
    marginTop: 2,
  },
  body: {
    padding: 14,
    gap: 10,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.textDisabled,
    marginHorizontal: 4,
  },
  breed: {
    fontSize: 13,
    color: COLORS.textTertiary,
    flexShrink: 1,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionPrimary: {
    backgroundColor: COLORS.primary,
  },
  actionPrimaryText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "700",
  },
  actionSecondary: {
    backgroundColor: COLORS.primaryLight,
  },
  actionSecondaryText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "700",
  },
});
