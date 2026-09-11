import { COLORS } from "@/constants/colors";
import { useEffect, useRef } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getInvite, acceptInvite } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { savePendingInvite, clearPendingInvite } from "@/lib/pendingInvite";
import { alertaDeError } from "@/lib/errorAlert";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

const statusOf = (err: unknown) => (err as { status?: number } | null)?.status;

const TERMINAL_COPY = {
  used: {
    title: "Esta invitación ya se usó",
    body: "Cada invitación sirve una sola vez. Pídele a quien te la mandó una nueva.",
  },
  revoked: {
    title: "Esta invitación se canceló",
    body: "Quien te la mandó la canceló. Si fue un error, pídele otra desde su app.",
  },
  expired: {
    title: "Esta invitación ya venció",
    body: "Las invitaciones duran una semana. Pídele a quien te la mandó una nueva.",
  },
} as const;

/**
 * Aceptar una invitación para compartir una mascota.
 *
 * `token` es lo que venga en la URL: el token de la liga (desde el botón
 * "Abrir en la app" del sitio) o el código tecleado en /invite. La API acepta
 * los dos.
 *
 * La pantalla deja la invitación guardada (lib/pendingInvite) apenas se abre:
 * si la persona no tiene cuenta, va a registrarse y el onboarding la saca de
 * aquí con un `replace`; el gate de onboarding (app/_layout.tsx) la reabre
 * cuando ya no le queda ningún paso. Se borra cuando decide (también al salir
 * con sesión) o cuando la invitación ya no sirve.
 */
export default function InviteScreen() {
  const { token: rawKey } = useLocalSearchParams<{ token: string }>();
  const key = (rawKey ?? "").trim();
  const router = useRouter();
  const qc = useQueryClient();
  const { isLoaded, isSignedIn } = useAuth();
  const role = useAuthStore((s) => s.role);
  const esEquipo = role === "ADMIN" || role === "STAFF";

  // Salir de la pantalla con la sesión iniciada también es decidir (el
  // "atrás"): se borra, o el gate de onboarding la volvería a abrir al caer en
  // las pestañas. Sin sesión se conserva: la persona va a registrarse.
  const signedInRef = useRef(isSignedIn);
  signedInRef.current = isSignedIn;
  useEffect(() => {
    if (!key) return;
    savePendingInvite(key);
    return () => {
      if (signedInRef.current) clearPendingInvite();
    };
  }, [key]);

  // Con sesión se espera al rol: así la consulta ya lleva el token y el
  // servidor puede decir si esta mascota ya está en la cuenta.
  const ready = isLoaded && !!key && (!isSignedIn || !!role);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["invite", key, isSignedIn ? "in" : "out"],
    queryFn: () => getInvite(key),
    enabled: ready,
    retry: false,
    staleTime: 0,
  });
  const errStatus = statusOf(error);

  // Estados en los que la invitación ya no le sirve a nadie en este teléfono.
  const terminal =
    errStatus === 404 ||
    (!!isSignedIn && esEquipo) ||
    (!!data && (data.status !== "valid" || (!!isSignedIn && data.alreadyLinked)));
  useEffect(() => {
    if (terminal) clearPendingInvite();
  }, [terminal]);

  const accept = useMutation({
    mutationFn: () => acceptInvite(key),
    onSuccess: async (res) => {
      await clearPendingInvite();
      qc.invalidateQueries({ queryKey: ["pets"] });
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["pet", res.petId] });
      router.replace(`/pet/${res.petId}` as any);
    },
    onError: (err) => {
      alertaDeError(err, { titulo: "No se pudo aceptar", respaldo: "Intenta de nuevo." });
      // Si en el camino se usó, se canceló o venció, que la pantalla lo diga.
      const s = statusOf(err);
      if (s === 404 || s === 409) refetch();
    },
  });

  // dismissTo: vuelve a las pestañas si están abajo en el stack y, si no (se
  // entró en frío desde la liga), las pone. Con replace quedaban dos apiladas.
  const goPets = () => router.dismissTo("/(tabs)/pets" as any);
  const dismiss = async () => {
    await clearPendingInvite();
    if (router.canGoBack()) router.back();
    else goPets();
  };

  if (!ready || isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (isSignedIn && esEquipo) {
    return (
      <Message
        icon="people-outline"
        title="Esta invitación es para clientes"
        body="Las cuentas del equipo ya ven a todas las mascotas. Quien la recibió tiene que abrirla con su cuenta de cliente."
        actionLabel="Entendido"
        onAction={dismiss}
      />
    );
  }

  if (errStatus === 404) {
    return (
      <Message
        icon="search-outline"
        title="No encontramos esa invitación"
        body="Revisa que el código esté completo, o pídele a quien te la mandó que la vuelva a compartir."
        actionLabel="Escribir otro código"
        onAction={() => router.replace("/invite" as any)}
      />
    );
  }

  if (errStatus === 429) {
    return (
      <Message
        icon="hourglass-outline"
        title="Demasiados intentos"
        body={(error as Error | null)?.message || "Espera unos minutos y vuelve a intentarlo."}
        actionLabel="Entendido"
        onAction={dismiss}
      />
    );
  }

  if (error && errStatus !== 401) {
    return (
      <Message
        icon="cloud-offline-outline"
        title="No pudimos cargar la invitación"
        body="Fue un problema de conexión. Tu invitación sigue ahí."
        actionLabel="Intentar de nuevo"
        onAction={() => refetch()}
      />
    );
  }

  if (data && data.status !== "valid") {
    const copy = TERMINAL_COPY[data.status];
    return (
      <Message
        icon="time-outline"
        title={copy.title}
        body={copy.body}
        actionLabel="Ir a mis mascotas"
        onAction={goPets}
      />
    );
  }

  // Sin sesión: la liga sí se puede consultar (el sitio lo hace), el código no
  // (401). En los dos casos se manda a entrar y la invitación queda guardada.
  if (!isSignedIn || errStatus === 401) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <PetHeader
          photoUrl={data?.pet.photoUrl ?? null}
          title={
            data
              ? `${data.invitedByFirstName} te invitó a compartir a ${data.pet.name}`
              : "Tienes una invitación"
          }
        />
        <Text style={styles.body}>
          Entra con tu cuenta, o créala si todavía no tienes, y te traemos de regreso aquí para
          aceptarla.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          // replace y no push: la invitación ya quedó guardada, y con push esta
          // pantalla se quedaba huérfana debajo de las pestañas.
          onPress={() => router.replace("/(auth)/register" as any)}
          activeOpacity={0.85}
          testID="invite-register"
        >
          <Text style={styles.primaryBtnText}>Crear mi cuenta</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => router.replace("/(auth)/login" as any)}
          activeOpacity={0.7}
          testID="invite-login"
        >
          <Text style={styles.secondaryBtnText}>Ya tengo cuenta</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (!data) return null;

  if (data.viewerIsOwner) {
    return (
      <Message
        icon="share-social-outline"
        title="Esta es tu invitación"
        body={`Mándasela a quien quieras que vea a ${data.pet.name}. Cuando la acepte, te llega un aviso.`}
        actionLabel="Entendido"
        onAction={dismiss}
      />
    );
  }

  if (data.alreadyLinked) {
    return (
      <Message
        icon="checkmark-circle-outline"
        title={`${data.pet.name} ya está en tu cuenta`}
        body="No tienes que hacer nada más."
        actionLabel="Ver mis mascotas"
        onAction={goPets}
      />
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <PetHeader
        photoUrl={data.pet.photoUrl}
        title={`${data.invitedByFirstName} te invitó a compartir a ${data.pet.name} 🐾`}
      />
      <View style={styles.card}>
        <Bullet icon="document-text-outline" text="Vas a ver su cartilla, sus reportes diarios y sus fotos." />
        <Bullet icon="calendar-outline" text="Vas a poder reservarle por tu cuenta." />
        <Bullet icon="notifications-outline" text="Te van a llegar los mismos avisos que a quien la registró." />
        <Bullet icon="wallet-outline" text="Tus pagos y tu saldo a favor siguen siendo solo tuyos." />
      </View>
      <TouchableOpacity
        style={[styles.primaryBtn, accept.isPending && styles.btnDisabled]}
        onPress={() => accept.mutate()}
        disabled={accept.isPending}
        activeOpacity={0.85}
        testID="invite-accept"
      >
        {accept.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.primaryBtnText}>Aceptar</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={dismiss}
        disabled={accept.isPending}
        activeOpacity={0.7}
        testID="invite-dismiss"
      >
        <Text style={styles.secondaryBtnText}>Ahora no</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function PetHeader({ photoUrl, title }: { photoUrl: string | null; title: string }) {
  return (
    <>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.photo} />
      ) : (
        <View style={styles.iconCircle}>
          <Ionicons name="paw" size={36} color={COLORS.primary} />
        </View>
      )}
      <Text style={styles.title}>{title}</Text>
    </>
  );
}

function Bullet({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.bullet}>
      <Ionicons name={icon} size={18} color={COLORS.primary} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function Message({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={32} color={COLORS.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onAction} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>{actionLabel}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 24, alignItems: "center" },
  photo: { width: 96, height: 96, borderRadius: 48, marginTop: 8 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  title: {
    marginTop: 16,
    fontSize: 22,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    marginTop: 20,
    alignSelf: "stretch",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 16,
    gap: 12,
  },
  bullet: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bulletText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: 24,
    alignSelf: "stretch",
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  secondaryBtn: { marginTop: 8, alignSelf: "stretch", paddingVertical: 14, alignItems: "center" },
  secondaryBtnText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
});
