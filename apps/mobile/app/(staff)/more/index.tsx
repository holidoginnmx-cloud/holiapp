import { COLORS } from "@/constants/colors";
import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { getStaffStays } from "@/lib/api";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { formatName, hotelTodayYMD, utcDayKey } from "@/lib/format";
import { useResponsive, CONTENT_MAX_WIDTH } from "@/lib/responsive";
import { WhatsNewModal } from "@/components/WhatsNewModal";
import { TeamFeedbackModal } from "@/components/TeamFeedbackModal";

// ── "Más" del staff, hecha en casa ───────────────────────────────────────────
// Con 6 pestañas visibles el tab bar de Apple mostraba 5 y generaba él solo una
// pantalla "More" de UIKit (lista gris, sin nuestra tipografía ni colores) que
// no se puede rediseñar. Aquí dejamos 4 pestañas reales + esta, que sí
// controlamos: Avisos y Perfil viven en su Stack (ver _layout) y las listas
// del día se empujan a /staff-list.

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
  iconTint?: string;
  badge?: number;
  /** Pinta el badge en rojo (sin leer) en vez del gris de conteo neutro. */
  badgeAlert?: boolean;
  isLast?: boolean;
}

function MenuItem({
  icon,
  label,
  subtitle,
  onPress,
  iconTint = COLORS.primary,
  badge,
  badgeAlert,
  isLast,
}: MenuItemProps) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, isLast && styles.menuItemLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.menuIconWrap, { backgroundColor: `${iconTint}15` }]}>
        <Ionicons name={icon} size={18} color={iconTint} />
      </View>
      <View style={styles.menuTextGroup}>
        <Text style={styles.menuLabel}>{label}</Text>
        {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
      </View>
      {badge !== undefined && badge > 0 && (
        <View style={[styles.menuBadge, badgeAlert && styles.menuBadgeAlert]}>
          <Text
            style={[styles.menuBadgeText, badgeAlert && styles.menuBadgeTextAlert]}
          >
            {badge > 99 ? "99+" : badge}
          </Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={COLORS.border} />
    </TouchableOpacity>
  );
}

// checkIn/checkOut son días a medianoche UTC; compararlos en hora local del
// teléfono los corría al día anterior (UTC-7). "Hoy" es el día del hotel.
function isHotelToday(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  return utcDayKey(date) === hotelTodayYMD();
}

export default function StaffMore() {
  const router = useRouter();
  const { isTablet } = useResponsive();
  const userId = useAuthStore((s) => s.userId);
  const firstName = useAuthStore((s) => s.firstName);
  const lastName = useAuthStore((s) => s.lastName);
  const email = useAuthStore((s) => s.email);
  const [novedadesVisible, setNovedadesVisible] = useState(false);
  const [comentarioVisible, setComentarioVisible] = useState(false);

  // Mismas queries (y mismas keys) que el Panel y /staff-list: los números del
  // día salen de la caché, sin pedirle nada nuevo a la API.
  const { data: activeStays } = useQuery({
    queryKey: ["staff", "stays", "hotel", "CHECKED_IN"],
    queryFn: () => getStaffStays("CHECKED_IN", { all: true }),
  });
  const { data: confirmedStays } = useQuery({
    queryKey: ["staff", "stays", "hotel", "CONFIRMED"],
    queryFn: () => getStaffStays("CONFIRMED", { all: true }),
  });

  // Mismo hook que el layout de tabs: el badge de "Más" y este contador salen
  // del mismo dato.
  const { unreadCount } = useUnreadNotifications();

  // Los baños comparten status con las estancias pero son citas: fuera.
  const active = (activeStays ?? []).filter((s) => s.reservationType !== "BATH");
  const confirmed = (confirmedStays ?? []).filter(
    (s) => s.reservationType !== "BATH"
  );

  const hospedados = active.length;
  const checkinsHoy = confirmed.filter((s) => isHotelToday(s.checkIn)).length;
  const checkoutsHoy = active.filter((s) => isHotelToday(s.checkOut)).length;
  const sinReporte = active.filter((s) => s.checklists.length === 0).length;

  return (
    // El ScrollView es la RAÍZ de la pantalla: iOS 26 solo engancha el minimize
    // del tab bar al scroll que es primera subvista del view controller.
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        isTablet && { maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center", width: "100%" },
      ]}
      showsVerticalScrollIndicator={false}
      testID="staff-more-screen"
    >
      {/* Quién eres — atajo al perfil */}
      <TouchableOpacity
        style={styles.profileCard}
        onPress={() => router.push("/(staff)/more/profile" as any)}
        activeOpacity={0.8}
        testID="staff-more-profile-card"
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(firstName?.[0] ?? "S").toUpperCase()}
          </Text>
        </View>
        <View style={styles.profileTextGroup}>
          <Text style={styles.profileName} numberOfLines={1}>
            {formatName(firstName)} {formatName(lastName)}
          </Text>
          {email && (
            <Text style={styles.profileEmail} numberOfLines={1}>
              {email}
            </Text>
          )}
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>STAFF</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.border} />
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Avisos</Text>
      <View style={styles.menuSection}>
        <MenuItem
          icon="notifications-outline"
          label="Notificaciones"
          subtitle={
            unreadCount > 0
              ? `${unreadCount} sin leer`
              : "Al día: no tienes avisos pendientes"
          }
          badge={unreadCount}
          badgeAlert
          onPress={() => router.push("/(staff)/more/notifications" as any)}
          isLast
        />
      </View>

      {/* Registrar — lo que llega sin cita. El equipo de piso es quien recibe
          al perro, así que es quien tiene que poder capturarlo: antes había
          que buscar a un admin y mientras tanto el perro estaba en la casa sin
          existir en el sistema. Las tres pantallas son las mismas del admin. */}
      <Text style={styles.sectionTitle}>Registrar</Text>
      <View style={styles.menuSection}>
        <MenuItem
          icon="add-circle-outline"
          label="Nueva reserva"
          subtitle="Hospedaje, baño o guardería que llega sin cita"
          onPress={() => router.push("/admin/reservation/create" as any)}
        />
        <MenuItem
          icon="person-add-outline"
          label="Nuevo cliente"
          subtitle="Da de alta a quien llega por primera vez"
          onPress={() => router.push("/admin/users/create" as any)}
        />
        <MenuItem
          icon="paw-outline"
          label="Nueva mascota"
          subtitle="Agrega el perro a la cuenta de su dueño"
          onPress={() => router.push("/admin/pets/owner" as any)}
          isLast
        />
      </View>

      <Text style={styles.sectionTitle}>Hoy</Text>
      <View style={styles.menuSection}>
        <MenuItem
          icon="paw-outline"
          label="Perros hospedados"
          subtitle="Quiénes están ahora mismo en la casa"
          badge={hospedados}
          onPress={() => router.push("/staff-list/hospedados" as any)}
        />
        <MenuItem
          icon="shield-checkmark-outline"
          iconTint={COLORS.dangerText}
          label="Atenciones pendientes"
          subtitle="Reportes faltantes, baños y medicaciones"
          onPress={() => router.push("/staff-list/alertas" as any)}
        />
        <MenuItem
          icon="log-in-outline"
          iconTint={COLORS.infoText}
          label="Check-ins de hoy"
          subtitle="Estancias que entran hoy"
          badge={checkinsHoy}
          onPress={() => router.push("/staff-list/checkins" as any)}
        />
        <MenuItem
          icon="log-out-outline"
          iconTint={COLORS.infoText}
          label="Check-outs de hoy"
          subtitle="Estancias que terminan hoy"
          badge={checkoutsHoy}
          onPress={() => router.push("/staff-list/checkouts" as any)}
        />
        <MenuItem
          icon="document-text-outline"
          iconTint={COLORS.successText}
          label="Reportes del día"
          subtitle="Estancias que aún no tienen reporte"
          badge={sinReporte}
          onPress={() => router.push("/staff-list/reportes" as any)}
          isLast
        />
      </View>

      <Text style={styles.sectionTitle}>Cuenta</Text>
      <View style={styles.menuSection}>
        <MenuItem
          icon="person-outline"
          label="Perfil"
          subtitle="Tus datos, tus números y cerrar sesión"
          onPress={() => router.push("/(staff)/more/profile" as any)}
        />
        {/* Reabrir el aviso de novedades: se lee de corrido y se cierra, así que
            sin esto quien lo despacha sin leer pierde la información. */}
        <MenuItem
          icon="sparkles-outline"
          label="Novedades"
          subtitle="Todo lo que se ha ido agregando"
          onPress={() => setNovedadesVisible(true)}
        />
        {/* El canal que hasta ahora era de palabra ("cuando lo uses, anótalo y
            me lo pasas"): lo que se ve trabajando se pierde si no hay dónde
            escribirlo en ese momento. Cae en la bandeja de Avisos del admin. */}
        <MenuItem
          icon="chatbubble-ellipses-outline"
          label="Enviar un comentario"
          subtitle="Qué te falta, qué te estorba o qué te confundió"
          onPress={() => setComentarioVisible(true)}
          isLast
        />
      </View>

      <WhatsNewModal
        role="STAFF"
        open={novedadesVisible}
        onClose={() => setNovedadesVisible(false)}
      />

      <TeamFeedbackModal
        open={comentarioVisible}
        onClose={() => setComentarioVisible(false)}
        screen="Más (staff)"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    gap: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 22,
    fontFamily: "Outfit_600SemiBold",
  },
  profileTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  profileEmail: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  roleBadge: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: "flex-start",
    marginTop: 6,
  },
  roleBadgeText: {
    fontSize: 10,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  menuSection: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  menuLabel: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  menuSubtitle: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  menuBadge: {
    backgroundColor: COLORS.bgSection,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  menuBadgeAlert: { backgroundColor: COLORS.dangerText },
  menuBadgeText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
  },
  menuBadgeTextAlert: { color: COLORS.white },
});
