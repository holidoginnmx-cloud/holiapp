import { COLORS } from "@/constants/colors";
import { BUSINESS, buildWhatsappUrl } from "@/constants/business";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Linking,
  Image,
  RefreshControl,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { getReservations, getMe, getPetsByOwner } from "@/lib/api";
import { ReservationCard } from "@/components/ReservationCard";
import { HeroStayCard } from "@/components/HeroStayCard";
import { PreStayChecklistCard } from "@/components/PreStayChecklistCard";
import { HomeSkeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { formatName, formatCurrency } from "@/lib/format";
import { cloudinaryResized } from "@/lib/cloudinary";

const URGENT_BALANCE_WINDOW_MS = 72 * 60 * 60 * 1000;

function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Buenos días";
  if (h >= 12 && h < 19) return "Buenas tardes";
  return "Buenas noches";
}

export default function HomeScreen() {
  const firstName = useAuthStore((s) => s.firstName);
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: activeReservations,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reservations", userId, "CHECKED_IN"],
    queryFn: () => getReservations({ ownerId: userId!, status: "CHECKED_IN" }),
    enabled: !!userId,
  });

  const { data: upcomingReservations } = useQuery({
    queryKey: ["reservations", userId, "CONFIRMED"],
    queryFn: () => getReservations({ ownerId: userId!, status: "CONFIRMED" }),
    enabled: !!userId,
  });

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const creditBalance = Number(me?.creditBalance ?? 0);

  const { data: pets } = useQuery({
    queryKey: ["pets", userId],
    queryFn: () => getPetsByOwner(userId!),
    enabled: !!userId,
  });

  // Derivados memoizados: antes todo este bloque (filtros anidados, new Date
  // por vacuna) se recalculaba en cada render de la pantalla de inicio.
  const activePets = useMemo(
    () => pets?.filter((p) => p.isActive) ?? [],
    [pets]
  );
  const hasActiveStays = (activeReservations?.length ?? 0) > 0;
  const hasUpcoming = (upcomingReservations?.length ?? 0) > 0;
  const hasAnyReservation = hasActiveStays || hasUpcoming;

  const upcomingStays = useMemo(
    () => (upcomingReservations ?? []).filter((r) => r.reservationType !== "BATH"),
    [upcomingReservations]
  );
  const upcomingBaths = useMemo(
    () => (upcomingReservations ?? []).filter((r) => r.reservationType === "BATH"),
    [upcomingReservations]
  );

  // Alertas inteligentes
  const balanceUrgent = useMemo(() => {
    const now = Date.now();
    return (
      upcomingReservations?.filter(
        (r) =>
          r.hasBalance &&
          r.depositDeadline &&
          new Date(r.depositDeadline).getTime() > now &&
          new Date(r.depositDeadline).getTime() - now < URGENT_BALANCE_WINDOW_MS
      ) ?? []
    );
  }, [upcomingReservations]);

  const cartillaPending = useMemo(
    () =>
      activePets.filter(
        (p) => p.cartillaStatus === null || p.cartillaStatus === "REJECTED"
      ),
    [activePets]
  );

  const changeAlerts = useMemo(
    () =>
      [...(activeReservations ?? []), ...(upcomingReservations ?? [])].filter(
        (r) => r.hasPendingChangeRequest
      ),
    [activeReservations, upcomingReservations]
  );

  // Vacunas vencidas o por vencer (≤30 días) por mascota.
  // Si el backend ya marcó cartillaStatus = EXPIRED, se considera urgente
  // aunque la lista de vacunas esté limpia (pets ya marcadas se siguen alertando).
  const petsWithVaccineAlert = useMemo(() => {
    const now = Date.now();
    const VACCINE_WINDOW_MS = 30 * 86_400_000;
    return activePets
      .map((p) => {
        const expired = (p.vaccines ?? []).filter(
          (v) => v.expiresAt && new Date(v.expiresAt).getTime() <= now
        );
        const expiringSoon = (p.vaccines ?? []).filter((v) => {
          if (!v.expiresAt) return false;
          const ts = new Date(v.expiresAt).getTime();
          return ts > now && ts - now <= VACCINE_WINDOW_MS;
        });
        const cartillaExpired = (p as any).cartillaStatus === "EXPIRED";
        return { pet: p, expired, expiringSoon, cartillaExpired };
      })
      .filter(
        (x) =>
          x.expired.length > 0 || x.expiringSoon.length > 0 || x.cartillaExpired
      );
  }, [activePets]);

  const prestayReservations = useMemo(() => {
    const now = Date.now();
    const PRESTAY_WINDOW_MS = 48 * 60 * 60 * 1000;
    return (
      upcomingReservations?.filter(
        (r) =>
          r.reservationType !== "BATH" &&
          r.checkIn &&
          new Date(r.checkIn).getTime() > now &&
          new Date(r.checkIn).getTime() - now < PRESTAY_WINDOW_MS,
      ) ?? []
    );
  }, [upcomingReservations]);

  const prestayPetCartilla = (reservation: typeof prestayReservations[number]) => {
    const pet = activePets.find((p) => p.id === reservation.petId);
    return pet?.cartillaStatus === "APPROVED";
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetch(),
      qc.refetchQueries({ queryKey: ["reservations", userId, "CONFIRMED"] }),
      qc.refetchQueries({ queryKey: ["pets", userId] }),
      qc.refetchQueries({ queryKey: ["me"] }),
    ]);
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <HomeSkeleton />
      </View>
    );
  }

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  return (
    <View style={styles.root}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="home-screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
        />
      }
    >
      <Text style={styles.greeting}>
        {getTimeGreeting()}, {formatName(firstName)} 👋
      </Text>

      {/* Mis mascotas */}
      {activePets.length > 0 && (
        <View style={styles.petsSection}>
          <Text style={styles.sectionTitle}>Mis mascotas</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.petsList}
          >
            {activePets.map((pet) => (
              <TouchableOpacity
                key={pet.id}
                style={styles.petItem}
                onPress={() => router.push(`/pet/${pet.id}` as any)}
                activeOpacity={0.7}
              >
                {pet.photoUrl ? (
                  <Image source={{ uri: cloudinaryResized(pet.photoUrl, 128, "fill") }} style={styles.petAvatar} />
                ) : (
                  <View style={[styles.petAvatar, styles.petAvatarFallback]}>
                    <Ionicons name="paw" size={28} color={COLORS.primary} />
                  </View>
                )}
                <Text style={styles.petName} numberOfLines={1}>
                  {formatName(pet.name)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.petItem}
              onPress={() => router.push("/pet/create" as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.petAvatar, styles.petAvatarAdd]}>
                <Ionicons name="add" size={26} color={COLORS.primary} />
              </View>
              <Text style={[styles.petName, { color: COLORS.primary }]}>
                Agregar
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Alertas inteligentes */}
      {balanceUrgent.map((r) => (
        <TouchableOpacity
          key={`bal-${r.id}`}
          style={[styles.alert, styles.alertWarning]}
          onPress={() =>
            router.push(`/reservation/detail/${r.id}?from=home` as any)
          }
          activeOpacity={0.85}
        >
          <Ionicons name="alert-circle" size={20} color={COLORS.warningText} />
          <View style={{ flex: 1 }}>
            <Text style={styles.alertTitle}>Saldo pendiente — {formatName(r.pet?.name ?? "—")}</Text>
            <Text style={styles.alertSub} numberOfLines={2}>
              Liquídalo en la app o al entregar a tu mascota en la sucursal.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.warningText} />
        </TouchableOpacity>
      ))}

      {cartillaPending.length === 1 && (
        <TouchableOpacity
          style={[styles.alert, styles.alertWarning]}
          onPress={() => router.push(`/pet/${cartillaPending[0].id}` as any)}
          activeOpacity={0.85}
        >
          <Ionicons
            name="document-attach-outline"
            size={20}
            color={COLORS.warningText}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.alertTitle}>
              {cartillaPending[0].cartillaStatus === "REJECTED"
                ? `Cartilla rechazada — ${formatName(cartillaPending[0].name)}`
                : `Sube la cartilla de ${formatName(cartillaPending[0].name)}`}
            </Text>
            <Text style={styles.alertSub} numberOfLines={1}>
              {cartillaPending[0].cartillaStatus === "REJECTED"
                ? "Sube una nueva para poder reservar"
                : "Necesaria para hacer reservaciones"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.warningText} />
        </TouchableOpacity>
      )}

      {cartillaPending.length > 1 && (
        <TouchableOpacity
          style={[styles.alert, styles.alertWarning]}
          onPress={() => router.push("/(tabs)/pets" as any)}
          activeOpacity={0.85}
        >
          <Ionicons
            name="document-attach-outline"
            size={20}
            color={COLORS.warningText}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.alertTitle}>
              {cartillaPending.length} mascotas con cartilla pendiente
            </Text>
            <Text style={styles.alertSub} numberOfLines={1}>
              Súbelas para poder reservar
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.warningText} />
        </TouchableOpacity>
      )}

      {petsWithVaccineAlert.map(({ pet, expired, expiringSoon, cartillaExpired }) => {
        const isExpired = expired.length > 0 || cartillaExpired;
        const total = expired.length + expiringSoon.length;
        const firstVaccine = expired[0] ?? expiringSoon[0];
        const vaxName = firstVaccine
          ? (firstVaccine as any).catalog?.displayName ?? firstVaccine.name
          : null;
        const isUrgent = isExpired;
        return (
          <TouchableOpacity
            key={`vax-${pet.id}`}
            style={[styles.alert, isUrgent ? styles.alertDanger : styles.alertWarning]}
            onPress={() => router.push(`/pet/renew-cartilla/${pet.id}` as any)}
            activeOpacity={0.85}
          >
            <Ionicons
              name={isUrgent ? "alert-circle" : "medkit"}
              size={20}
              color={isUrgent ? COLORS.errorText : COLORS.warningText}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.alertTitle,
                  isUrgent && { color: COLORS.errorText },
                ]}
              >
                {cartillaExpired
                  ? `Cartilla vencida — ${formatName(pet.name)}`
                  : isExpired
                  ? `Vacuna vencida — ${formatName(pet.name)}`
                  : `Vacuna por vencer — ${formatName(pet.name)}`}
              </Text>
              <Text
                style={[
                  styles.alertSub,
                  isUrgent && { color: COLORS.errorText },
                ]}
                numberOfLines={2}
              >
                {!vaxName
                  ? "Renueva la cartilla para volver a reservar."
                  : total > 1
                  ? `${vaxName} y ${total - 1} más. Renuévalas pronto.`
                  : `${vaxName}. Renuévala pronto para mantener tus reservaciones.`}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={isUrgent ? COLORS.errorText : COLORS.warningText}
            />
          </TouchableOpacity>
        );
      })}

      {changeAlerts.map((r) => (
        <View key={`chg-${r.id}`} style={[styles.alert, styles.alertInfo]}>
          <Ionicons name="time-outline" size={20} color={COLORS.infoText} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.alertTitle, { color: COLORS.infoText }]}>
              Cambio en revisión — {formatName(r.pet?.name ?? "—")}
            </Text>
            <Text style={[styles.alertSub, { color: COLORS.infoText }]}>
              Te avisaremos cuando lo aprobemos
            </Text>
          </View>
        </View>
      ))}

      {/* Pre-stay checklist */}
      {prestayReservations.map((r) => (
        <PreStayChecklistCard
          key={`prestay-${r.id}`}
          reservationId={r.id}
          petName={formatName(r.pet?.name ?? "—")}
          checkIn={r.checkIn!}
          cartillaApproved={prestayPetCartilla(r)}
          saldoLiquidado={!r.hasBalance}
        />
      ))}

      {/* Saldo a favor */}
      {creditBalance > 0 && (
        <TouchableOpacity
          style={styles.creditCard}
          onPress={() => router.push("/profile/credit-history" as any)}
          activeOpacity={0.85}
          testID="home-credit-card"
        >
          <View style={styles.creditIconWrap}>
            <Ionicons name="wallet" size={22} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.creditTitle}>
              Tienes {formatCurrency(creditBalance)} de saldo a favor
            </Text>
            <Text style={styles.creditSub}>Úsalo en tu próxima reservación</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
        </TouchableOpacity>
      )}

      {/* Acciones primarias */}
      <View style={styles.primaryActions}>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push("/reservation/create")}
          activeOpacity={0.85}
          testID="home-reserve-button"
        >
          <View style={styles.actionIconWrap}>
            <Ionicons name="bed-outline" size={26} color={COLORS.primary} />
          </View>
          <Text style={styles.actionTitle}>Hotel</Text>
          <Text style={styles.actionSub}>Hospedaje</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push("/bath/create" as any)}
          activeOpacity={0.85}
          testID="home-bath-button"
        >
          <View style={styles.actionIconWrap}>
            <Ionicons name="water-outline" size={26} color={COLORS.primary} />
          </View>
          <Text style={styles.actionTitle}>Baño</Text>
          <Text style={styles.actionSub}>Agenda ya</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push("/daycare/create" as any)}
          activeOpacity={0.85}
          testID="home-daycare-button"
        >
          <View style={styles.actionIconWrap}>
            <Ionicons name="sunny-outline" size={26} color={COLORS.primary} />
          </View>
          <Text style={styles.actionTitle}>Guardería</Text>
          <Text style={styles.actionSub}>Por día</Text>
        </TouchableOpacity>
      </View>

      {/* Estancias / Empty state */}
      {!hasAnyReservation ? (
        <View style={styles.heroEmpty}>
          <View style={styles.heroEmptyIcon}>
            <Ionicons name="paw" size={48} color={COLORS.primary} />
          </View>
          <Text style={styles.heroEmptyTitle}>
            Tu primera reservación te espera
          </Text>
          <Text style={styles.heroEmptySub}>
            Reserva una estancia o agenda un baño para tu peludo. Nosotros nos
            encargamos del resto.
          </Text>
          <View style={styles.heroEmptyActions}>
            <TouchableOpacity
              style={[styles.heroEmptyBtn, styles.heroEmptyBtnPrimary]}
              onPress={() => router.push("/reservation/create")}
              activeOpacity={0.85}
            >
              <Ionicons name="bed-outline" size={16} color={COLORS.white} />
              <Text style={styles.heroEmptyBtnTextPrimary}>Reservar hotel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.heroEmptyBtn, styles.heroEmptyBtnSecondary]}
              onPress={() => router.push("/bath/create" as any)}
              activeOpacity={0.85}
            >
              <Ionicons name="water-outline" size={16} color={COLORS.primary} />
              <Text style={styles.heroEmptyBtnTextSecondary}>Agendar baño</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          {hasActiveStays && (
            <>
              <Text style={styles.sectionTitle}>
                Estancias activas ({activeReservations!.length})
              </Text>
              {activeReservations!.map((res) => (
                <HeroStayCard
                  key={res.id}
                  reservationId={res.id}
                  petName={res.pet?.name ?? "—"}
                  petPhotoUrl={res.pet?.photoUrl ?? null}
                  roomName={res.room?.name ?? null}
                  checkIn={res.checkIn}
                  checkOut={res.checkOut}
                  onPress={() =>
                    router.push(`/reservation/detail/${res.id}?from=home` as any)
                  }
                />
              ))}
            </>
          )}

          {upcomingStays.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="bed-outline" size={18} color={COLORS.primary} />
                <Text style={styles.sectionTitleInline}>Próximas estancias</Text>
              </View>
              {upcomingStays.slice(0, 2).map((res) => (
                <ReservationCard
                  key={res.id}
                  petName={res.pet?.name ?? "—"}
                  roomName={res.room?.name ?? null}
                  status={res.status}
                  checkIn={res.checkIn}
                  checkOut={res.checkOut}
                  reservationType={res.reservationType}
                  appointmentAt={res.appointmentAt}
                  totalAmount={Number(res.totalAmount)}
                  paymentType={res.paymentType}
                  hasBalance={res.hasBalance}
                  hasPendingChangeRequest={res.hasPendingChangeRequest}
                  lastUpdateAt={res.lastUpdateAt}
                  hasReview={res.hasReview}
                  reviewRating={res.reviewRating}
                  hasDeslanado={res.hasDeslanado}
                  hasCorte={res.hasCorte}
                  onPress={() =>
                    router.push(`/reservation/detail/${res.id}?from=home` as any)
                  }
                />
              ))}
            </>
          )}

          {upcomingBaths.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="water-outline" size={18} color={COLORS.primary} />
                <Text style={styles.sectionTitleInline}>
                  Próximas citas de baño
                </Text>
              </View>
              {upcomingBaths.slice(0, 2).map((res) => (
                <ReservationCard
                  key={res.id}
                  petName={res.pet?.name ?? "—"}
                  roomName={res.room?.name ?? null}
                  status={res.status}
                  checkIn={res.checkIn}
                  checkOut={res.checkOut}
                  reservationType={res.reservationType}
                  appointmentAt={res.appointmentAt}
                  totalAmount={Number(res.totalAmount)}
                  paymentType={res.paymentType}
                  hasBalance={res.hasBalance}
                  hasPendingChangeRequest={res.hasPendingChangeRequest}
                  lastUpdateAt={res.lastUpdateAt}
                  hasReview={res.hasReview}
                  reviewRating={res.reviewRating}
                  hasDeslanado={res.hasDeslanado}
                  hasCorte={res.hasCorte}
                  onPress={() =>
                    router.push(`/reservation/detail/${res.id}?from=home` as any)
                  }
                />
              ))}
            </>
          )}
        </>
      )}
    </ScrollView>

      {/* FAB WhatsApp */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() =>
          Linking.openURL(buildWhatsappUrl(BUSINESS.whatsappOwnerInfoMessage))
        }
        activeOpacity={0.85}
        testID="home-whatsapp-button"
        accessibilityLabel="Escríbenos por WhatsApp"
      >
        <Ionicons name="logo-whatsapp" size={28} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bgPage,
  },
  greeting: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginBottom: 12,
    marginTop: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 12,
  },
  sectionTitleInline: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  heroEmpty: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginTop: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  heroEmptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  heroEmptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
    marginBottom: 6,
  },
  heroEmptySub: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
    maxWidth: 300,
  },
  heroEmptyActions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  heroEmptyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  heroEmptyBtnPrimary: {
    backgroundColor: COLORS.primary,
  },
  heroEmptyBtnSecondary: {
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  heroEmptyBtnTextPrimary: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.white,
  },
  heroEmptyBtnTextSecondary: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
  primaryActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
    marginBottom: 20,
  },
  actionCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  actionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  actionSub: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.whatsapp,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  alert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  alertWarning: {
    backgroundColor: COLORS.warningBg,
    borderColor: COLORS.warningText,
  },
  alertInfo: {
    backgroundColor: COLORS.infoBg,
    borderColor: COLORS.infoText,
  },
  alertDanger: {
    backgroundColor: COLORS.errorBg,
    borderColor: COLORS.errorText,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.warningText,
  },
  alertSub: {
    fontSize: 12,
    color: COLORS.warningText,
    marginTop: 1,
    opacity: 0.85,
  },
  creditCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  creditIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
  },
  creditTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  creditSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  petsSection: {
    marginBottom: 8,
  },
  petsList: {
    gap: 14,
    paddingRight: 8,
  },
  petItem: {
    alignItems: "center",
    width: 72,
  },
  petAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.bgSection,
    marginBottom: 6,
  },
  petAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  petAvatarAdd: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: "dashed",
  },
  petName: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textPrimary,
    textAlign: "center",
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
