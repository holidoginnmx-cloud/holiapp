import { COLORS } from "@/constants/colors";
import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import {
  lookupExistingAccount,
  confirmClaim,
  getPetsByOwner,
  type ClaimCandidate,
} from "@/lib/api";
import { formatPhoneInput } from "@/lib/format";

export const CLAIM_SEEN_KEY = "welcome-claim-seen";

export default function ClaimAccountScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const syncUser = useAuthStore((s) => s.syncUser);
  const queryClient = useQueryClient();

  // Mientras verificamos si el usuario ya tiene mascotas (caso de match por
  // correo), mostramos un spinner para no parpadear el formulario.
  const [checking, setChecking] = useState(true);
  const [useEmail, setUseEmail] = useState(false);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<ClaimCandidate[]>([]);

  const finish = useCallback(async () => {
    // Marca POR USUARIO (lee el id más reciente del store: tras un claim el
    // userId pasa a ser el de la cuenta consolidada).
    const uid = useAuthStore.getState().userId;
    if (uid) {
      await SecureStore.setItemAsync(`${CLAIM_SEEN_KEY}-${uid}`, "1").catch(() => {});
    }
    router.replace("/(tabs)/home" as any);
  }, [router]);

  // Si el usuario ya quedó vinculado por correo (ya tiene mascotas), no tiene
  // sentido preguntarle: marcamos visto y seguimos al flujo normal.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!userId) {
        if (active) setChecking(false);
        return;
      }
      try {
        const pets = await getPetsByOwner(userId);
        if (active && pets.length > 0) {
          await finish();
          return;
        }
      } catch {
        // Si falla, dejamos que vea la pantalla (no es bloqueante).
      }
      if (active) setChecking(false);
    })();
    return () => {
      active = false;
    };
  }, [userId, finish]);

  const handleSearch = async () => {
    setError(null);
    const payload = useEmail
      ? { email: email.trim().toLowerCase() }
      : { phone: phone.trim() };
    if (useEmail ? !payload.email : !payload.phone) {
      setError(useEmail ? "Ingresa tu correo" : "Ingresa tu teléfono");
      return;
    }
    setLoading(true);
    try {
      const res = await lookupExistingAccount(payload);
      setCandidates(res.candidates);
      setSearched(true);
    } catch (e: any) {
      setError(e?.message ?? "No pudimos buscar tu cuenta. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (candidate: ClaimCandidate) => {
    setError(null);
    setConfirmingId(candidate.candidateId);
    try {
      await confirmClaim({
        candidateId: candidate.candidateId,
        phone: useEmail ? undefined : phone.trim() || undefined,
      });
      // Refrescar el usuario (ahora apunta al registro consolidado) y la lista
      // de mascotas antes de salir.
      await syncUser();
      queryClient.invalidateQueries({ queryKey: ["pets"] });
      await finish();
    } catch (e: any) {
      setConfirmingId(null);
      setError(
        e?.message ?? "No pudimos vincular tu cuenta. Intenta de nuevo.",
      );
    }
  };

  if (checking) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="claim-screen"
      >
        <View style={styles.iconWrap}>
          <Ionicons name="search" size={40} color={COLORS.primary} />
        </View>
        <Text style={styles.title}>¿Ya eres cliente de HolidogInn?</Text>
        <Text style={styles.subtitle}>
          Si ya nos visitaste, tu mascota podría estar registrada. Búscala con
          tu {useEmail ? "correo" : "teléfono"} para no duplicarla.
        </Text>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={COLORS.errorText} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{useEmail ? "Correo" : "Teléfono"}</Text>
          {useEmail ? (
            <TextInput
              style={styles.input}
              placeholder="tu@correo.com"
              placeholderTextColor={COLORS.textDisabled}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
            />
          ) : (
            <TextInput
              style={styles.input}
              placeholder="(662) 123 4567"
              placeholderTextColor={COLORS.textDisabled}
              value={phone}
              onChangeText={(t) => setPhone(formatPhoneInput(t))}
              keyboardType="phone-pad"
              editable={!loading}
            />
          )}
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSearch}
          activeOpacity={0.85}
          disabled={loading}
          testID="claim-search-button"
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.buttonText}>Buscar mi cuenta</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            setUseEmail((v) => !v);
            setError(null);
            setSearched(false);
            setCandidates([]);
          }}
          style={styles.linkBtn}
        >
          <Text style={styles.linkText}>
            {useEmail ? "Buscar con mi teléfono" : "Buscar con mi correo"}
          </Text>
        </TouchableOpacity>

        {/* Resultados */}
        {searched && candidates.length === 0 && (
          <View style={styles.noResult}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={COLORS.textTertiary}
            />
            <Text style={styles.noResultText}>
              No encontramos una cuenta con ese dato. Si eres nuevo, continúa y
              registra a tu mascota.
            </Text>
          </View>
        )}

        {candidates.map((c) => (
          <View key={c.candidateId} style={styles.candidateCard}>
            <Text style={styles.candidateName}>
              {c.firstName}
              {c.pets.length > 0 ? "" : " — sin mascotas registradas"}
            </Text>
            {c.pets.length > 0 && (
              <View style={styles.petRow}>
                {c.pets.map((p, i) => (
                  <View key={i} style={styles.petChip}>
                    {p.photoUrl ? (
                      <Image source={{ uri: p.photoUrl }} style={styles.petPhoto} />
                    ) : (
                      <View style={[styles.petPhoto, styles.petPhotoFallback]}>
                        <Ionicons name="paw" size={14} color={COLORS.primary} />
                      </View>
                    )}
                    <Text style={styles.petName}>{p.name}</Text>
                  </View>
                ))}
              </View>
            )}
            <TouchableOpacity
              style={[
                styles.confirmButton,
                confirmingId === c.candidateId && styles.buttonDisabled,
              ]}
              onPress={() => handleConfirm(c)}
              activeOpacity={0.85}
              disabled={!!confirmingId}
              testID="claim-confirm-button"
            >
              {confirmingId === c.candidateId ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.confirmButtonText}>Sí, soy yo</Text>
              )}
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          onPress={finish}
          style={styles.skipBtn}
          disabled={!!confirmingId}
          testID="claim-skip-button"
        >
          <Text style={styles.skipText}>
            Soy nuevo / No encuentro mi cuenta
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 48,
    gap: 14,
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.errorBgLight,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
  },
  errorText: {
    color: COLORS.errorText,
    fontSize: 14,
    flex: 1,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
  linkBtn: {
    alignItems: "center",
    paddingVertical: 6,
  },
  linkText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  noResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  noResultText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 18,
  },
  candidateCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 12,
  },
  candidateName: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  petRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  petChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 20,
    paddingRight: 12,
    paddingLeft: 4,
    paddingVertical: 4,
  },
  petPhoto: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  petPhotoFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
  },
  petName: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  confirmButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  confirmButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
  },
  skipBtn: {
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 8,
  },
  skipText: {
    color: COLORS.textTertiary,
    fontSize: 14,
    fontWeight: "600",
  },
});
