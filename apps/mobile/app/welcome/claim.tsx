import { COLORS } from "@/constants/colors";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import {
  lookupExistingAccount,
  verifyClaimCode,
  confirmClaim,
  getPetsByOwner,
  type ClaimCandidate,
} from "@/lib/api";
import { formatPhoneInput } from "@/lib/format";
import { buildWhatsappUrl } from "@/constants/business";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<ClaimCandidate[]>([]);
  const [selectedPetIds, setSelectedPetIds] = useState<Set<string>>(new Set());
  // Verificación: la ficha se muestra hasta que el cliente escribe el código
  // que el servidor mandó al correo que YA tenía la ficha. Conocer el
  // teléfono no basta para reclamarla (ver /users/claim/* en la API).
  const [challenge, setChallenge] = useState<{
    token: string;
    masked: string[];
    minutes: number;
  } | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [claimToken, setClaimToken] = useState<string | null>(null);
  const [noEmailMessage, setNoEmailMessage] = useState<string | null>(null);

  // Mascotas de TODOS los candidatos: un teléfono puede traer varios registros
  // duplicados del mismo cliente (o de un familiar que comparte teléfono).
  const allCandidatePets = useMemo(
    () =>
      candidates.flatMap((c) =>
        c.pets.map((p) => ({ ...p, ownerName: c.firstName })),
      ),
    [candidates],
  );
  const distinctOwnerCount = useMemo(
    () => new Set(candidates.map((c) => c.firstName)).size,
    [candidates],
  );

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
      setCandidates([]);
      setSelectedPetIds(new Set());
      setClaimToken(null);
      setCode("");
      setSearched(true);
      if (!res.found) {
        setChallenge(null);
        setNoEmailMessage(null);
      } else if (res.channel !== "email" || !res.challengeToken) {
        setChallenge(null);
        setNoEmailMessage(
          res.message ??
            "Encontramos tu ficha, pero no tiene un correo para enviarte el código. Escríbenos por WhatsApp y te la vinculamos.",
        );
      } else {
        setNoEmailMessage(null);
        setChallenge({
          token: res.challengeToken,
          masked: res.maskedEmails ?? [],
          minutes: res.expiresInMinutes ?? 10,
        });
      }
    } catch (e: any) {
      setError(e?.message ?? "No pudimos buscar tu cuenta. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!challenge) return;
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Escribe el código de 6 dígitos que te llegó por correo.");
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      const res = await verifyClaimCode({
        challengeToken: challenge.token,
        code: digits,
      });
      setCandidates(res.candidates);
      setClaimToken(res.claimToken);
      setSelectedPetIds(new Set());
      setChallenge(null);
    } catch (e: any) {
      setError(e?.message ?? "No pudimos validar el código. Intenta de nuevo.");
    } finally {
      setVerifying(false);
    }
  };

  const togglePet = (petId: string) => {
    setSelectedPetIds((prev) => {
      const next = new Set(prev);
      if (next.has(petId)) next.delete(petId);
      else next.add(petId);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selectedPetIds.size === 0 || !claimToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await confirmClaim({
        petIds: [...selectedPetIds],
        claimToken,
        phone: useEmail ? undefined : phone.trim() || undefined,
      });
      // Refrescar el usuario (ahora apunta al registro consolidado) y la lista
      // de mascotas antes de salir.
      await syncUser();
      queryClient.invalidateQueries({ queryKey: ["pets"] });
      await finish();
    } catch (e: any) {
      setSubmitting(false);
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
            setSelectedPetIds(new Set());
            setChallenge(null);
            setClaimToken(null);
            setNoEmailMessage(null);
            setCode("");
          }}
          style={styles.linkBtn}
        >
          <Text style={styles.linkText}>
            {useEmail ? "Buscar con mi teléfono" : "Buscar con mi correo"}
          </Text>
        </TouchableOpacity>

        {/* Ficha encontrada: pedir el código que llegó al correo de la ficha */}
        {challenge && (
          <View style={styles.candidateCard} testID="claim-code-card">
            <Text style={styles.candidateName}>Encontramos tu ficha</Text>
            <Text style={styles.pickHint}>
              Te enviamos un código de 6 dígitos a{" "}
              {challenge.masked.length > 0 ? challenge.masked.join(" y ") : "tu correo"}
              . Escríbelo aquí para ver tus mascotas (vence en {challenge.minutes}{" "}
              minutos).
            </Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="000000"
              placeholderTextColor={COLORS.textDisabled}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              editable={!verifying}
              testID="claim-code-input"
            />
            <TouchableOpacity
              style={[
                styles.confirmButton,
                (code.length !== 6 || verifying) && styles.buttonDisabled,
              ]}
              onPress={handleVerify}
              activeOpacity={0.85}
              disabled={code.length !== 6 || verifying}
              testID="claim-verify-button"
            >
              {verifying ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.confirmButtonText}>Verificar código</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSearch}
              style={styles.linkBtn}
              disabled={loading || verifying}
            >
              <Text style={styles.linkText}>
                {loading ? "Enviando…" : "No me llegó, volver a enviar"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Ficha encontrada pero sin correo real: no hay cómo probar que es suya */}
        {noEmailMessage && (
          <View style={styles.noResult} testID="claim-no-email">
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={COLORS.textTertiary}
            />
            <Text style={styles.noResultText}>{noEmailMessage}</Text>
          </View>
        )}
        {noEmailMessage && (
          <TouchableOpacity
            style={styles.sharedHelp}
            onPress={() =>
              Linking.openURL(
                buildWhatsappUrl(
                  "Hola 👋 Quiero vincular la app con la ficha de mi mascota, pero no tiene mi correo registrado.",
                ),
              )
            }
            activeOpacity={0.7}
          >
            <Ionicons name="logo-whatsapp" size={16} color={COLORS.primary} />
            <Text style={styles.sharedHelpText}>
              Escríbenos por WhatsApp y te la vinculamos.
            </Text>
          </TouchableOpacity>
        )}

        {/* Resultados */}
        {searched && !challenge && !noEmailMessage && candidates.length === 0 && (
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

        {/* Esta búsqueda solo encuentra fichas de clientes que TODAVÍA no
            tienen la app. Si el perro ya está en la cuenta de la pareja, aquí
            nunca va a salir por más que el teléfono sea el correcto — y el
            siguiente paso natural sería registrarlo otra vez. Compartir una
            mascota entre dos cuentas lo hace el equipo, así que ofrecemos el
            atajo justo en el momento en que la búsqueda falla. */}
        {searched && !challenge && !noEmailMessage && candidates.length === 0 && (
          <TouchableOpacity
            style={styles.sharedHelp}
            onPress={() =>
              Linking.openURL(
                buildWhatsappUrl(
                  "Hola 👋 Mi perro ya está registrado en la cuenta de alguien de mi familia y quiero verlo también en la mía."
                )
              )
            }
            testID="claim-shared-help"
            activeOpacity={0.7}
          >
            <Ionicons name="logo-whatsapp" size={16} color={COLORS.primary} />
            <Text style={styles.sharedHelpText}>
              ¿Tu perro ya lo registró tu pareja o alguien de tu familia?
              Escríbenos y lo vinculamos a tu cuenta.
            </Text>
          </TouchableOpacity>
        )}

        {allCandidatePets.length > 0 && (
          <View style={styles.candidateCard}>
            <Text style={styles.candidateName}>¿Cuáles son tuyas?</Text>
            <Text style={styles.pickHint}>
              Marca todas tus mascotas para vincularlas a tu cuenta y no
              duplicarlas.
            </Text>
            {allCandidatePets.map((p) => {
              const selected = selectedPetIds.has(p.id);
              const meta = [
                p.breed,
                distinctOwnerCount > 1 ? p.ownerName : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.petSelectRow,
                    selected && styles.petSelectRowOn,
                  ]}
                  onPress={() => togglePet(p.id)}
                  activeOpacity={0.8}
                  testID={`claim-pet-${p.id}`}
                >
                  {p.photoUrl ? (
                    <Image
                      source={{ uri: p.photoUrl }}
                      style={styles.petPhoto}
                    />
                  ) : (
                    <View style={[styles.petPhoto, styles.petPhotoFallback]}>
                      <Ionicons name="paw" size={14} color={COLORS.primary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.petName}>{p.name}</Text>
                    {meta.length > 0 && (
                      <Text style={styles.petMeta}>{meta}</Text>
                    )}
                  </View>
                  <Ionicons
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={selected ? COLORS.primary : COLORS.textDisabled}
                  />
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[
                styles.confirmButton,
                (selectedPetIds.size === 0 || submitting) &&
                  styles.buttonDisabled,
              ]}
              onPress={handleConfirm}
              activeOpacity={0.85}
              disabled={selectedPetIds.size === 0 || submitting}
              testID="claim-confirm-button"
            >
              {submitting ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.confirmButtonText}>
                  Vincular mis mascotas
                  {selectedPetIds.size > 0 ? ` (${selectedPetIds.size})` : ""}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          onPress={finish}
          style={styles.skipBtn}
          disabled={submitting}
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
  codeInput: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 24,
    letterSpacing: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
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
    fontFamily: "PlusJakartaSans_400Regular",
    flex: 1,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_400Regular",
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
    fontFamily: "PlusJakartaSans_700Bold",
  },
  linkBtn: {
    alignItems: "center",
    paddingVertical: 6,
  },
  linkText: {
    color: COLORS.primary,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  sharedHelp: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    padding: 14,
  },
  sharedHelpText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
    lineHeight: 18,
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
    fontFamily: "PlusJakartaSans_400Regular",
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
    fontFamily: "PlusJakartaSans_700Bold",
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
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_700Bold",
  },
  skipBtn: {
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 8,
  },
  skipText: {
    color: COLORS.textTertiary,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  pickHint: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    lineHeight: 18,
    marginTop: -4,
  },
  petSelectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.bgPage,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  petSelectRowOn: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  petMeta: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 1,
  },
});
