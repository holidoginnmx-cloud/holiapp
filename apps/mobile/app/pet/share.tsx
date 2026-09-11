import { COLORS } from "@/constants/colors";
import { useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { ErrorState } from "@/components/ErrorState";
import { useSuccessBanner } from "@/components/SuccessBanner";
import {
  getPetById,
  getPetInvites,
  createPetInvite,
  revokePetInvite,
  removePetCoOwner,
} from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { formatName, formatDayShort } from "@/lib/format";
import { alertaDeError } from "@/lib/errorAlert";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

/**
 * Compartir una mascota con otra cuenta, desde la app del CLIENTE.
 *
 * El dueño invita (una liga por WhatsApp, con un código de respaldo para quien
 * todavía no tiene la app), ve las invitaciones pendientes y puede quitar a
 * quien sea. El co-dueño ve con quién se comparte y solo puede salirse: no
 * invita a terceros ni saca a nadie, para que tras una separación nadie se
 * quede con el perro a escondidas.
 *
 * El equipo tiene su propia pantalla (app/admin/pets/co-owners), que vincula
 * directo sin invitación.
 */
export default function PetShareScreen() {
  const { petId } = useLocalSearchParams<{ petId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.userId);
  const { banner, showSuccess } = useSuccessBanner();

  const {
    data: pet,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["pet", petId],
    queryFn: () => getPetById(petId!),
    enabled: !!petId,
  });
  const isOwner = !!pet && !!userId && pet.ownerId === userId;

  const {
    data: invitesInfo,
    isError: invitesError,
    refetch: refetchInvites,
  } = useQuery({
    queryKey: ["pet", petId, "invites"],
    queryFn: () => getPetInvites(petId!),
    enabled: !!petId && isOwner,
  });

  // ["pet", petId] alcanza también ["pet", petId, "invites"].
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pet", petId] });
    qc.invalidateQueries({ queryKey: ["pets"] });
  };

  // La hoja nativa: WhatsApp, Mensajes, copiar… lo que la persona use.
  // Devuelve si de verdad se mandó (o copió) algo.
  const share = async (message: string): Promise<boolean> => {
    try {
      const res = await Share.share({ message });
      return res.action !== Share.dismissedAction;
    } catch {
      return false;
    }
  };

  // Un toque doble rápido llega antes de que `isPending` deshabilite el botón.
  const creatingRef = useRef(false);

  const createMutation = useMutation({
    mutationFn: () => createPetInvite(petId!),
    onSuccess: async (invite) => {
      invalidate();
      // Si cerró la hoja sin mandarla, esa invitación apartaría un lugar del
      // tope durante una semana. Pero iOS se entera de "sin mandar" por lo que
      // le reporte la app elegida, y no todas lo reportan bien: se pregunta en
      // vez de cancelarla a ciegas. Cerrar el aviso la deja viva.
      const sent = await share(invite.shareText);
      if (!sent) {
        Alert.alert(
          "¿Se mandó la invitación?",
          "Si cerraste sin mandarla, mejor cancélala: mientras siga pendiente aparta uno de los lugares.",
          [
            { text: "Sí, se mandó", style: "cancel" },
            {
              text: "No, cancelarla",
              style: "destructive",
              onPress: () => {
                revokePetInvite(petId!, invite.id)
                  .then(invalidate)
                  .catch(() => {});
              },
            },
          ],
        );
      }
    },
    onError: (err) => {
      alertaDeError(err, { titulo: "No se pudo crear la invitación", respaldo: "Intenta de nuevo." });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revokePetInvite(petId!, inviteId),
    onSuccess: () => {
      invalidate();
      showSuccess("Invitación cancelada");
    },
    onError: (err) => {
      alertaDeError(err, { titulo: "No se pudo cancelar", respaldo: "Intenta de nuevo." });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (targetId: string) => removePetCoOwner(petId!, targetId),
    onSuccess: (_res, targetId) => {
      if (targetId === userId) {
        // Me salí: la ficha ya no es mía. Se quita de la lista al instante y
        // se vuelve a Mis Mascotas (la ficha de atrás daría error al refrescar).
        qc.setQueryData<any[]>(["pets", userId], (old) =>
          old ? old.filter((p) => p.id !== petId) : old,
        );
        qc.removeQueries({ queryKey: ["pet", petId] });
        qc.invalidateQueries({ queryKey: ["pets"] });
        qc.invalidateQueries({ queryKey: ["reservations"] });
        // dismissTo y no replace: con replace quedaban dos pestañas apiladas y
        // el gesto de atrás revelaba la vieja.
        router.dismissTo("/(tabs)/pets" as any);
        return;
      }
      invalidate();
      showSuccess("Listo, ya no la comparte");
    },
    onError: (err) => {
      alertaDeError(err, { titulo: "No se pudo", respaldo: "Intenta de nuevo." });
    },
  });

  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !pet) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const petName = pet.name;
  const ownerName = formatName(pet.owner?.firstName ?? "");
  const coOwners = (pet.coOwners ?? []).map((c) => c.user);
  const slotsLeft = invitesInfo?.slotsLeft ?? 0;
  const maxCoOwners = invitesInfo?.maxCoOwners ?? 3;
  const invites = invitesInfo?.invites ?? [];

  const confirmRemove = (targetId: string, name: string) => {
    Alert.alert(
      `¿Quitar a ${formatName(name)}?`,
      `Dejará de ver a ${petName} en su cuenta y ya no recibirá sus avisos. Sus reservas pasadas no se tocan.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Quitar", style: "destructive", onPress: () => removeMutation.mutate(targetId) },
      ],
    );
  };

  const confirmLeave = () => {
    Alert.alert(
      `¿Dejar de compartir a ${petName}?`,
      `Ya no la verás en tu cuenta ni te llegarán sus avisos. Para volver, ${ownerName || "quien la registró"} tendría que invitarte otra vez.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Salirme", style: "destructive", onPress: () => removeMutation.mutate(userId!) },
      ],
    );
  };

  const confirmRevoke = (inviteId: string, code: string) => {
    Alert.alert(
      `¿Cancelar la invitación ${code}?`,
      "La liga y el código dejan de servir: quien la recibió ya no podrá aceptarla.",
      [
        { text: "No", style: "cancel" },
        {
          text: "Cancelar invitación",
          style: "destructive",
          onPress: () => revokeMutation.mutate(inviteId),
        },
      ],
    );
  };

  return (
    <View style={styles.flex}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.introCard}>
          <Ionicons name="people" size={20} color={COLORS.primary} />
          <Text style={styles.introText}>
            {isOwner
              ? `Comparte a ${petName} con tu pareja o tu familia: van a ver su cartilla, sus reportes y sus fotos, y van a poder reservar. Cada quien paga lo suyo y tu saldo a favor sigue siendo tuyo.`
              : `${ownerName || "Su dueño"} te comparte a ${petName}. Ves y reservas igual que quien la registró; tus pagos y tu saldo a favor son solo tuyos.`}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Quiénes la tienen en su cuenta</Text>
        <PersonRow
          name={`${pet.owner?.firstName ?? ""} ${pet.owner?.lastName ?? ""}`}
          tag={pet.ownerId === userId ? "Tú · dueño" : "Dueño"}
          tagColor={COLORS.primary}
          tagBg={COLORS.primaryLight}
        />
        {coOwners.map((u) => (
          <PersonRow
            key={u.id}
            name={`${u.firstName ?? ""} ${u.lastName ?? ""}`}
            tag={u.id === userId ? "Tú" : "Comparte"}
            tagColor={COLORS.infoText}
            tagBg={COLORS.infoBg}
            onRemove={
              isOwner ? () => confirmRemove(u.id, u.firstName ?? "") : undefined
            }
            removing={removeMutation.isPending}
            testID={`share-remove-${u.id}`}
          />
        ))}

        {isOwner && invites.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, styles.sectionGap]}>Invitaciones pendientes</Text>
            {invites.map((inv) => (
              <View key={inv.id} style={styles.row}>
                <View style={[styles.avatar, { backgroundColor: COLORS.primaryLight }]}>
                  <Ionicons name="mail-outline" size={18} color={COLORS.primary} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>{inv.code}</Text>
                  <Text style={styles.rowSub}>Nadie la ha aceptado · vence el {formatDayShort(inv.expiresAt)}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => inv.shareText && share(inv.shareText)}
                  hitSlop={8}
                  testID={`share-resend-${inv.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Volver a mandar la invitación ${inv.code}`}
                >
                  <Ionicons name="share-outline" size={22} color={COLORS.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => confirmRevoke(inv.id, inv.code)}
                  disabled={revokeMutation.isPending}
                  hitSlop={8}
                  testID={`share-revoke-${inv.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Cancelar la invitación ${inv.code}`}
                >
                  <Ionicons name="close-circle-outline" size={22} color={COLORS.errorText} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {isOwner ? (
          <>
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                (slotsLeft === 0 || createMutation.isPending) && styles.btnDisabled,
              ]}
              onPress={() => {
                if (creatingRef.current) return;
                creatingRef.current = true;
                createMutation.mutate(undefined, {
                  onSettled: () => {
                    creatingRef.current = false;
                  },
                });
              }}
              disabled={slotsLeft === 0 || createMutation.isPending || !invitesInfo}
              activeOpacity={0.85}
              testID="share-invite"
            >
              {createMutation.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="person-add" size={18} color={COLORS.white} />
                  <Text style={styles.primaryBtnText}>Invitar a alguien</Text>
                </>
              )}
            </TouchableOpacity>
            {invitesError ? (
              <TouchableOpacity onPress={() => refetchInvites()} accessibilityRole="button">
                <Text style={styles.hint}>
                  No pudimos cargar tus invitaciones. Toca aquí para reintentar.
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.hint}>
                {slotsLeft === 0 && invitesInfo
                  ? `${petName} ya se comparte con el máximo de ${maxCoOwners} personas, contando las invitaciones pendientes. Cancela una o quita a alguien para invitar a otra persona.`
                  : "Te abrimos WhatsApp o Mensajes con la liga lista. Sirve una sola vez y vence en una semana. Si la otra persona todavía no tiene la app, el mensaje trae un código para escribirlo al instalarla. Por ahora la app es solo para iPhone."}
              </Text>
            )}
          </>
        ) : (
          <TouchableOpacity
            style={styles.leaveBtn}
            onPress={confirmLeave}
            disabled={removeMutation.isPending}
            activeOpacity={0.7}
            testID="share-leave"
          >
            <Ionicons name="exit-outline" size={18} color={COLORS.errorText} />
            <Text style={styles.leaveBtnText}>Dejar de compartir</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      {banner}
    </View>
  );
}

function PersonRow({
  name,
  tag,
  tagColor,
  tagBg,
  onRemove,
  removing,
  testID,
}: {
  name: string;
  tag: string;
  tagColor: string;
  tagBg: string;
  onRemove?: () => void;
  removing?: boolean;
  testID?: string;
}) {
  const clean = name.trim();
  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{clean[0]?.toUpperCase() ?? "?"}</Text>
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {clean
            .split(/\s+/)
            .map((w) => formatName(w))
            .join(" ") || "Sin nombre"}
        </Text>
      </View>
      <View style={[styles.tag, { backgroundColor: tagBg }]}>
        <Text style={[styles.tagText, { color: tagColor }]}>{tag}</Text>
      </View>
      {onRemove && (
        <TouchableOpacity
          onPress={onRemove}
          disabled={removing}
          hitSlop={8}
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`Quitar a ${clean || "esta persona"}`}
        >
          <Ionicons name="close-circle-outline" size={22} color={COLORS.errorText} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40 },
  introCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  introText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionGap: { marginTop: 16 },
  row: {
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
  avatarText: { color: COLORS.white, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  rowSub: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  tagText: { fontSize: 12, fontFamily: "PlusJakartaSans_700Bold" },
  primaryBtn: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 15,
  },
  btnDisabled: { opacity: 0.45 },
  primaryBtnText: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.white },
  hint: {
    marginTop: 12,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    lineHeight: 19,
    textAlign: "center",
  },
  leaveBtn: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.errorText,
    paddingVertical: 14,
  },
  leaveBtnText: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.errorText },
});
