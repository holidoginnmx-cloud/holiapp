import { COLORS } from "@/constants/colors";
import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import ConfettiCannon from "react-native-confetti-cannon";
import { getChecklists, createDailyChecklist, getStaffStayById } from "@/lib/api";
import { ErrorState } from "@/components/ErrorState";
import { uploadToCloudinary } from "@/lib/cloudinary";
import type { MoodLevel } from "@holidoginn/shared";
import { formatName, utcDayKey, localDayKey, formatDateLong } from "@/lib/format";

const { width: SCREEN_W } = Dimensions.get("window");

const MOOD_OPTIONS: { key: MoodLevel; emoji: string; label: string }[] = [
  { key: "SAD", emoji: "😢", label: "Triste" },
  { key: "NEUTRAL", emoji: "😐", label: "Neutral" },
  { key: "HAPPY", emoji: "😊", label: "Feliz" },
  { key: "EXCITED", emoji: "🤩", label: "Emocionado" },
];

export default function ChecklistForm() {
  const { reservationId } = useLocalSearchParams<{ reservationId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Form state — campos visibles
  const [mood, setMood] = useState<MoodLevel>("HAPPY");
  const [mealsCompleted, setMealsCompleted] = useState(false);
  const [walksCompleted, setWalksCompleted] = useState(false);
  const [bathroomBreaks, setBathroomBreaks] = useState(false);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [handoffNotes, setHandoffNotes] = useState("");
  // Evidencias del día (fotos y/o videos). Cada nueva selección se agrega;
  // las anteriores no se pisan. Al guardar, todas se suben como StayUpdates
  // separados (una llamada al API).
  type MediaPick = { uri: string; type: "image" | "video" };
  const [mediaItems, setMediaItems] = useState<MediaPick[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const confettiRef = useRef<ConfettiCannon>(null);

  const { data: stay } = useQuery({
    queryKey: ["staff", "stay", reservationId],
    queryFn: () => getStaffStayById(reservationId!),
    enabled: !!reservationId,
  });

  const { data: checklists, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["staff", "checklists", reservationId],
    queryFn: () => getChecklists(reservationId!),
    enabled: !!reservationId,
  });

  const todayKey = localDayKey();
  const existing = checklists?.find(
    (c) => utcDayKey(c.date) === todayKey
  );

  useEffect(() => {
    if (existing) {
      setMood(existing.mood as MoodLevel);
      setMealsCompleted(existing.mealsCompleted);
      setWalksCompleted(existing.walksCompleted);
      setBathroomBreaks(existing.bathroomBreaks);
      const notes = existing.additionalNotes ?? "";
      const handoffMatch = notes.match(/\[HANDOFF\] ([\s\S]*)/);
      if (handoffMatch) {
        setAdditionalNotes(notes.replace(/\n?\[HANDOFF\] [\s\S]*/, ""));
        setHandoffNotes(handoffMatch[1]);
      } else {
        setAdditionalNotes(notes);
        setHandoffNotes("");
      }
    }
  }, [existing?.id]);

  function assetToPick(asset: ImagePicker.ImagePickerAsset): MediaPick {
    return {
      uri: asset.uri,
      type: asset.type === "video" ? "video" : "image",
    };
  }

  async function pickMedia(
    source: "camera-photo" | "camera-video" | "library",
  ) {
    if (source === "camera-photo" || source === "camera-video") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permiso requerido", "Necesitamos acceso a la cámara.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: source === "camera-video" ? ["videos"] : ["images"],
        quality: 0.8,
      });
      if (result.canceled) return;
      setMediaItems((prev) => [...prev, assetToPick(result.assets[0])]);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tu galería.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.8,
      allowsMultipleSelection: true,
    });
    if (result.canceled) return;
    setMediaItems((prev) => [...prev, ...result.assets.map(assetToPick)]);
  }

  function promptMedia() {
    Alert.alert("Evidencia del día", "¿Qué quieres agregar?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Tomar foto", onPress: () => pickMedia("camera-photo") },
      { text: "Grabar video", onPress: () => pickMedia("camera-video") },
      { text: "Elegir de galería", onPress: () => pickMedia("library") },
    ]);
  }

  function removeMediaAt(index: number) {
    setMediaItems((prev) => prev.filter((_, i) => i !== index));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (mediaItems.length === 0)
        throw new Error("Agrega al menos una foto o video del día");
      const uploads = await Promise.all(
        mediaItems.map((it) =>
          uploadToCloudinary(it.uri, "checklists", it.type),
        ),
      );
      // UTC midnight de la fecha LOCAL del staff. Así el server (en cualquier TZ)
      // y Postgres @db.Date guardan el día correcto sin shifts.
      const now = new Date();
      const localDayUTC = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
      );
      return createDailyChecklist({
        date: localDayUTC,
        // Campos del schema que ya no se piden ni se muestran en la card.
        // Se mantienen con valores neutrales para satisfacer el schema —
        // si se removieran del schema en el futuro, también se quitan aquí.
        energy: "MEDIUM",
        socialization: "SOCIAL",
        rest: "GOOD",
        playtime: false,
        socializationDone: false,
        mood,
        mealsCompleted,
        mealsNotes: null,
        walksCompleted,
        bathroomBreaks,
        feedingNotes: null,
        behaviorNotes: null,
        additionalNotes:
          [
            additionalNotes,
            handoffNotes ? `[HANDOFF] ${handoffNotes}` : "",
          ]
            .filter(Boolean)
            .join("\n") || null,
        reservationId: reservationId!,
        mediaItems: uploads.map((u, i) => ({
          url: u.secure_url,
          type: mediaItems[i].type,
        })),
      });
    },
    onSuccess: async () => {
      // Refetch explícito (no sólo invalidate) — garantiza que el detalle
      // y la lista tengan la nueva foto antes de regresar.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["staff", "stay", reservationId] }),
        queryClient.refetchQueries({ queryKey: ["staff", "checklists", reservationId] }),
      ]);
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      setShowSuccess(true);
      setTimeout(() => confettiRef.current?.start(), 150);
      setTimeout(() => {
        setShowSuccess(false);
        router.replace(`/staff/stay/${reservationId}` as any);
      }, 3000);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const canSubmit = mediaItems.length > 0 && !saveMutation.isPending;

  return (
    <ScrollView
      style={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            Reporte diario — {formatName(stay?.pet.name ?? "")}
          </Text>
          <Text style={styles.subtitle}>
            {formatDateLong(new Date())}
          </Text>
        </View>
      </View>

      {/* Mood */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>¿Cómo se siente hoy?</Text>
        <View style={styles.moodRow}>
          {MOOD_OPTIONS.map((opt) => {
            const active = mood === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.moodPill, active && styles.moodPillActive]}
                onPress={() => setMood(opt.key)}
                activeOpacity={0.7}
              >
                <Text style={styles.moodEmoji}>{opt.emoji}</Text>
                <Text
                  style={[
                    styles.moodLabel,
                    active && styles.moodLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Checklist */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Necesidades básicas</Text>
        <ChecklistSwitch
          label="Comió"
          value={mealsCompleted}
          onValueChange={setMealsCompleted}
        />
        <ChecklistSwitch
          label="Paseó"
          value={walksCompleted}
          onValueChange={setWalksCompleted}
        />
        <ChecklistSwitch
          label="Sanitario"
          value={bathroomBreaks}
          onValueChange={setBathroomBreaks}
        />
      </View>

      {/* Notas */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notas del día</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Algo importante que el dueño deba saber (opcional)"
          placeholderTextColor={COLORS.textDisabled}
          value={additionalNotes}
          onChangeText={setAdditionalNotes}
          multiline
        />
      </View>

      {/* Handoff */}
      <View style={styles.card}>
        <View style={styles.handoffHeader}>
          <Ionicons name="swap-horizontal" size={18} color={COLORS.infoText} />
          <Text style={styles.cardTitle}>Notas para el siguiente turno</Text>
        </View>
        <TextInput
          style={styles.textArea}
          placeholder="Indicaciones internas (medicación, perros incompatibles…)"
          placeholderTextColor={COLORS.textDisabled}
          value={handoffNotes}
          onChangeText={setHandoffNotes}
          multiline
        />
      </View>

      {/* Evidencia del día (fotos y/o videos) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Evidencia del día <Text style={styles.required}>*</Text>
        </Text>
        {mediaItems.length > 0 ? (
          <View>
            <View style={styles.photoGrid}>
              {mediaItems.map((item, idx) => (
                <View key={`${item.uri}-${idx}`} style={styles.photoThumbWrap}>
                  <Image source={{ uri: item.uri }} style={styles.photoThumb} />
                  {item.type === "video" && (
                    <View style={styles.videoOverlay}>
                      <Ionicons
                        name="play-circle"
                        size={32}
                        color={COLORS.white}
                      />
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.photoRemoveButton}
                    onPress={() => removeMediaAt(idx)}
                    hitSlop={8}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={14} color={COLORS.white} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <TouchableOpacity
              style={styles.photoChangeButton}
              onPress={promptMedia}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={16} color={COLORS.primary} />
              <Text style={styles.photoChangeText}>Agregar más evidencia</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.photoButton}
            onPress={promptMedia}
            activeOpacity={0.85}
          >
            <Ionicons name="camera" size={28} color={COLORS.primary} />
            <Text style={styles.photoButtonText}>Agregar fotos o videos</Text>
            <Text style={styles.photoHint}>
              Puedes subir varias. El dueño las verá en su reservación.
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitButton, !canSubmit && { opacity: 0.5 }]}
        onPress={() => saveMutation.mutate()}
        disabled={!canSubmit}
      >
        {saveMutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
            <Text style={styles.submitButtonText}>
              {existing ? "Actualizar reporte" : "Guardar reporte"}
            </Text>
          </>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />

      <Modal
        visible={showSuccess}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.successOverlay}>
          <ConfettiCannon
            ref={confettiRef}
            count={160}
            origin={{ x: SCREEN_W / 2, y: 0 }}
            autoStart={false}
            fadeOut
            fallSpeed={3000}
            explosionSpeed={420}
            colors={[COLORS.primary, "#F7B84B", "#7AB5A8", "#E35F27", "#3a7cab"]}
          />
          <View style={styles.successCard}>
            <View style={styles.successIconCircle}>
              <Ionicons name="checkmark" size={44} color={COLORS.white} />
            </View>
            <Text style={styles.successTitle}>¡Listo!</Text>
            <Text style={styles.successSubtitle}>
              El reporte se ha enviado.
            </Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function ChecklistSwitch({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: COLORS.borderLight, true: COLORS.reviewToggle }}
        thumbColor={value ? COLORS.primary : COLORS.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
    textTransform: "capitalize",
  },
  card: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 14,
  },
  required: {
    color: COLORS.errorText,
  },
  moodRow: {
    flexDirection: "row",
    gap: 8,
  },
  moodPill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
    alignItems: "center",
    gap: 4,
  },
  moodPillActive: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  moodEmoji: {
    fontSize: 28,
  },
  moodLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  moodLabelActive: {
    color: COLORS.primary,
    fontWeight: "700",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  switchLabel: {
    fontSize: 15,
    color: COLORS.textPrimary,
    fontWeight: "600",
  },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    minHeight: 70,
    textAlignVertical: "top",
  },
  photoButton: {
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    gap: 6,
  },
  photoButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.primary,
    marginTop: 4,
  },
  photoHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  photoPreview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: COLORS.bgSection,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  photoThumbWrap: {
    width: "31%",
    aspectRatio: 1,
    position: "relative",
  },
  photoThumb: {
    width: "100%",
    height: "100%",
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
  },
  photoRemoveButton: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  videoOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.18)",
    borderRadius: 10,
  },
  photoChangeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
  },
  photoChangeText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    marginHorizontal: 16,
    marginTop: 20,
    padding: 16,
    borderRadius: 14,
  },
  submitButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
  normalDayButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
  },
  normalDayText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
  },
  handoffHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  successOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  successCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 28,
    alignItems: "center",
    width: "100%",
    maxWidth: 320,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  successIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  successSubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 21,
  },
});
